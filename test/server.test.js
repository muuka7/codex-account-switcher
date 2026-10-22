const test = process.platform === 'win32' ? require('node:test').skip : require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { ServerAccounts } = require('../src/server/accounts');
const { encrypt, decrypt, atomicWrite, readPrivate, withLock } = require('../src/server/security');
const { allBucketsFromResult, snapshotFromResult } = require('../src/rate-limits');
const password = 'a long test passphrase';

function auth(email, id, refresh = 'refresh-original') {
  const claims = { email, 'https://api.openai.com/auth': { chatgpt_account_id: id, chatgpt_plan_type: 'pro' } };
  return { auth_mode: 'chatgpt', tokens: { id_token: `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`, access_token: 'access-secret', refresh_token: refresh, account_id: id } };
}
const quota = { rateLimitsByLimitId: { codex: { primary: { usedPercent: 22, windowDurationMins: 300, resetsAt: 1999999999 } }, other: { primary: { usedPercent: 55, windowDurationMins: 90, resetsAt: null } } } };

async function fixture(t, overrides = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'switcher-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'codex');
  await atomicWrite(path.join(home, 'auth.json'), JSON.stringify(auth('one@example.test', 'workspace-one')));
  await atomicWrite(path.join(home, 'config.toml'), 'cli_auth_credentials_store = "file"\n');
  const manager = new ServerAccounts({ root: path.join(dir, 'store'), codexHome: home, scanner: async () => [], readLimits: async () => quota, ...overrides });
  return { dir, home, manager };
}

test('server vault authenticates encryption and rejects tampering or wrong passphrases', async () => {
  const data = { token: 'a secret credential' }, bytes = await encrypt(data, password);
  assert.ok(!bytes.includes(Buffer.from(data.token)));
  assert.deepEqual(await decrypt(bytes, password), data);
  await assert.rejects(decrypt(bytes, 'wrong password'), { code: 'VAULT_LOCKED' });
  const changed = JSON.parse(bytes); changed.data = Buffer.alloc(32).toString('base64');
  await assert.rejects(decrypt(Buffer.from(JSON.stringify(changed)), password), { code: 'VAULT_LOCKED' });
});

test('import saves an encrypted login, never changes live auth, and exposes metadata only', async t => {
  const { manager } = await fixture(t);
  const original = await fs.readFile(manager.authPath);
  const state = await manager.importCurrent('personal', password);
  assert.equal(state.accounts[0].identity.email, 'one@example.test');
  assert.equal(state.accounts[0].isSelected, true);
  assert.ok(!JSON.stringify(state).includes('access-secret'));
  assert.ok(!(await fs.readFile(manager.statePath, 'utf8')).includes('refresh-original'));
  assert.deepEqual(await fs.readFile(manager.authPath), original);
  assert.equal((await fs.stat(manager.vaultPath)).mode & 0o777, 0o600);
  assert.equal((await fs.stat(manager.root)).mode & 0o777, 0o700);
  assert.ok(!(await fs.readFile(manager.vaultPath)).includes(Buffer.from('access-secret')));
});

test('file reads reject symlinked auth and world-readable credentials', async t => {
  const { manager, dir } = await fixture(t);
  await fs.chmod(manager.authPath, 0o644);
  await assert.rejects(manager.importCurrent('personal', password), { code: 'UNSAFE_PATH' });
  await fs.chmod(manager.authPath, 0o600);
  await fs.rename(manager.authPath, path.join(dir, 'original'));
  await fs.symlink(path.join(dir, 'original'), manager.authPath);
  await assert.rejects(manager.importCurrent('personal', password));
});

test('refresh and switch refuse running Codex before any probe or credential write', async t => {
  let calls = 0;
  const { manager } = await fixture(t, { scanner: async () => [{ pid: 42, name: 'codex' }], readLimits: async () => { calls++; return quota; } });
  await manager.importCurrent('personal', password);
  const original = await fs.readFile(manager.authPath);
  await assert.rejects(manager.refresh(password), { code: 'CODEX_RUNNING' });
  await assert.rejects(manager.switchAccount('personal', password), { code: 'CODEX_RUNNING' });
  assert.equal(calls, 0); assert.deepEqual(await fs.readFile(manager.authPath), original);
});

test('refresh preserves rotated credentials even when the subsequent usage request fails', async t => {
  const { manager } = await fixture(t, { readLimits: async ({ codexHome }) => {
    await atomicWrite(path.join(codexHome, 'auth.json'), JSON.stringify(auth('one@example.test', 'workspace-one', 'rotated-secret')));
    throw Object.assign(new Error('raw backend secret must not escape'), { code: 'RATE_LIMITS_READ_FAILED' });
  } });
  await manager.importCurrent('personal', password);
  const state = await manager.refresh(password);
  assert.match(state.accounts[0].usage.error, /could not be refreshed/);
  assert.equal(JSON.parse(await fs.readFile(manager.authPath)).tokens.refresh_token, 'rotated-secret');
  const vault = await manager.load(password);
  assert.equal(vault.accounts[0].auth.tokens.refresh_token, 'rotated-secret');
  assert.equal(vault.pending, null);
  assert.deepEqual(await fs.readdir(path.join(manager.root, 'probes')), []);
  assert.ok(!JSON.stringify(state).includes('raw backend'));
});

test('switch preserves the latest outgoing login and records no plaintext credentials', async t => {
  const { manager } = await fixture(t);
  await manager.importCurrent('personal', password);
  await manager.transaction(password, async vault => { manager.add(vault, 'work', auth('two@example.test', 'workspace-two')); await manager.save(vault, password); });
  await atomicWrite(manager.authPath, JSON.stringify(auth('one@example.test', 'workspace-one', 'latest-source')));
  await manager.switchAccount('work', password);
  const vault = await manager.load(password);
  assert.equal(vault.accounts.find(a => a.label === 'personal').auth.tokens.refresh_token, 'latest-source');
  assert.equal(JSON.parse(await fs.readFile(manager.authPath)).tokens.account_id, 'workspace-two');
  assert.equal(vault.pending, null);
});

test('a competing live login change is never overwritten and leaves a recovery journal', async t => {
  let manager;
  ({ manager } = await fixture(t, { readLimits: async () => {
    await atomicWrite(manager.authPath, JSON.stringify(auth('external@example.test', 'external')));
    return quota;
  } }));
  await manager.importCurrent('personal', password);
  await manager.transaction(password, async vault => { manager.add(vault, 'work', auth('two@example.test', 'workspace-two')); await manager.save(vault, password); });
  await assert.rejects(manager.switchAccount('work', password), { code: 'LIVE_AUTH_CHANGED' });
  assert.equal(JSON.parse(await fs.readFile(manager.authPath)).tokens.account_id, 'external');
  assert.equal((await manager.load(password)).pending.kind, 'switch');
  await assert.rejects(manager.recover(password), { code: 'LIVE_AUTH_CHANGED' });
});

test('failed encrypted persistence retains the private probe recovery copy', async t => {
  const { manager } = await fixture(t, { readLimits: async ({ codexHome }) => {
    await atomicWrite(path.join(codexHome, 'auth.json'), JSON.stringify(auth('one@example.test', 'workspace-one', 'rotated')));
    return quota;
  } });
  await manager.importCurrent('personal', password);
  manager.save = async () => { throw new Error('simulated disk full'); };
  await assert.rejects(manager.refresh(password), { code: 'PERSIST_FAILED' });
  const entries = await fs.readdir(path.join(manager.root, 'probes'));
  assert.equal(entries.length, 1);
  const bytes = await readPrivate(path.join(manager.root, 'probes', entries[0], 'auth.json'));
  assert.equal(JSON.parse(bytes).tokens.refresh_token, 'rotated');
});

test('exclusive management lock refuses another caller and never steals stale locks', async t => {
  const { manager } = await fixture(t);
  await withLock(manager.root, async () => assert.rejects(withLock(manager.root, () => {}), { code: 'BUSY' }));
  await atomicWrite(path.join(manager.root, 'operation.lock'), JSON.stringify({ pid: 999999999 }));
  await assert.rejects(withLock(manager.root, () => {}), { code: 'BUSY' });
});

test('null quota values stay unknown and every bucket retains its reported duration', () => {
  const result = allBucketsFromResult(quota);
  assert.equal(result.length, 2); assert.equal(result[1].primary.windowDurationMins, 90);
  assert.equal(result[1].primary.resetsAt, null);
  assert.equal(snapshotFromResult({ rateLimits: { primary: { usedPercent: null, windowDurationMins: 300 } } }).fiveHour, null);
  assert.equal(allBucketsFromResult({ rateLimitsByLimitId: {}, rateLimits: quota.rateLimitsByLimitId.codex }).length, 1);
});

for (const blockAt of [2, 3]) test(`recovery reconciles a runtime appearing ${blockAt === 2 ? 'before' : 'after'} the live write without repeating the switch`, async t => {
  let scans = 0, probes = 0;
  const { manager } = await fixture(t, { readLimits: async () => { probes++; return quota; } });
  await manager.importCurrent('personal', password);
  await manager.transaction(password, async vault => { manager.add(vault, 'work', auth('two@example.test', 'workspace-two')); await manager.save(vault, password); });
  manager.scanner = async () => ++scans === blockAt ? [{ pid: 123, name: 'codex' }] : [];
  await assert.rejects(manager.switchAccount('work', password), { code: 'CODEX_RUNNING' });
  assert.ok((await manager.load(password)).pending);
  manager.scanner = async () => [];
  const result = await manager.recover(password);
  assert.equal(probes, 1);
  assert.equal(result.accounts.find(a => a.isSelected).label, blockAt === 2 ? 'personal' : 'work');
  assert.equal((await manager.load(password)).pending, null);
});

test('quoted TOML auth settings and misleading multiline strings are handled by a real parser', async t => {
  const { manager, home } = await fixture(t);
  await atomicWrite(path.join(home, 'config.toml'), 'note = """\ncli_auth_credentials_store = "file"\n"""\ncli_auth_credentials_store = "keyring"\n');
  await assert.rejects(manager.requireFileStore(), { code: 'FILE_STORE_REQUIRED' });
  await atomicWrite(path.join(home, 'config.toml'), '"cli_auth_credentials_store" = "file"\n');
  await manager.requireFileStore();
});
