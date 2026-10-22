const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { deriveIdentity, identityMatches } = require('../src/account-identity');

function auth(email, accountId = 'workspace-A', refresh = 'synthetic-refresh') {
  const claims = { email, 'https://api.openai.com/auth': { chatgpt_account_id: accountId } };
  return Buffer.from(JSON.stringify({ tokens: { id_token: `fixture.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.unsigned`, refresh_token: refresh } }));
}

async function desktop(t, readLimits = async () => ({}), primary = true) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'switcher-identity-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const home = path.join(root, 'home'), store = path.join(root, 'store');
  await fs.mkdir(home); await fs.mkdir(path.join(store, 'vault'), { recursive: true });
  const sourcePath = path.resolve(__dirname, '../src/main.js');
  const nativeRequire = createRequire(sourcePath);
  let startup;
  let quitCount = 0;
  const events = new Map();
  const app = {
    isPackaged: false, getPath: () => store, setPath: () => {},
    requestSingleInstanceLock: () => primary, quit: () => { quitCount++; },
    whenReady: () => ({ then: fn => { startup = fn; } }), on: (name, fn) => events.set(name, fn),
  };
  const sandbox = {
    Buffer, console, setTimeout, clearTimeout, setInterval, clearInterval,
    __dirname: path.dirname(sourcePath),
    process: { platform: 'darwin', env: { CODEX_HOME: home } },
    require: name => name === 'electron' ? {
      app, safeStorage: { isEncryptionAvailable: () => true, encryptString: value => Buffer.from(`protected:${value}`) },
    } : name === './codex-app-server' ? { readRateLimits: () => readLimits({ home, store }) } : nativeRequire(name),
  };
  vm.runInNewContext(`${await fs.readFile(sourcePath, 'utf8')}\nthis.api = { probeSavedAccount, saveActiveCredential };`, sandbox, { filename: sourcePath });
  return { ...sandbox.api, home, store, startup: () => startup(), events, quitCount: () => quitCount };
}

test('identity requires both the workspace and user; missing metadata fails closed', () => {
  const saved = deriveIdentity(auth('first@example.test'));
  assert.equal(identityMatches(saved, deriveIdentity(auth('FIRST@example.test'))), true);
  assert.equal(identityMatches(saved, deriveIdentity(auth('other@example.test'))), false);
  assert.equal(identityMatches(saved, deriveIdentity(auth('first@example.test', 'workspace-B'))), false);
  assert.equal(identityMatches(saved, {}), false);
  assert.equal(identityMatches({}, {}), false);
});

test('an independent login change cannot overwrite the saved account during usage or switching', async t => {
  let probes = 0;
  const api = await desktop(t, async () => { probes++; return {}; });
  const saved = auth('first@example.test'), live = auth('other@example.test');
  const account = { id: 'profile-A', identity: deriveIdentity(saved) };
  const blob = path.join(api.store, 'vault/profile-A.secure');
  await fs.writeFile(blob, 'original-encrypted-snapshot');
  await fs.writeFile(path.join(api.home, 'auth.json'), live);
  const index = { activeId: account.id, accounts: [account] };
  await assert.rejects(api.probeSavedAccount(account, index), { code: 'ACCOUNT_IDENTITY_MISMATCH' });
  await assert.rejects(api.saveActiveCredential(index), { code: 'ACCOUNT_IDENTITY_MISMATCH' });
  assert.equal(probes, 0);
  assert.equal(await fs.readFile(blob, 'utf8'), 'original-encrypted-snapshot');
  assert.deepEqual(account.identity, deriveIdentity(saved));
  assert.deepEqual(await fs.readFile(path.join(api.home, 'auth.json')), live);
});

test('a login change while a usage request runs is rejected before vault persistence', async t => {
  const api = await desktop(t, async ({ home }) => {
    await fs.writeFile(path.join(home, 'auth.json'), auth('other@example.test'));
    return {};
  });
  const original = auth('first@example.test');
  const account = { id: 'profile-A', identity: deriveIdentity(original) };
  const blob = path.join(api.store, 'vault/profile-A.secure');
  await fs.writeFile(blob, 'original-encrypted-snapshot');
  await fs.writeFile(path.join(api.home, 'auth.json'), original);
  await assert.rejects(api.probeSavedAccount(account, { activeId: account.id }), { code: 'ACCOUNT_IDENTITY_MISMATCH' });
  assert.equal(await fs.readFile(blob, 'utf8'), 'original-encrypted-snapshot');
  assert.deepEqual(account.identity, deriveIdentity(original));
});

test('legitimate token rotation for the same user is preserved with encryption', async t => {
  const rotated = auth('first@example.test', 'workspace-A', 'rotated-synthetic-refresh');
  const api = await desktop(t, async ({ home }) => {
    await fs.writeFile(path.join(home, 'auth.json'), rotated);
    return { syntheticUsage: true };
  });
  const original = auth('first@example.test');
  const account = { id: 'profile-A', identity: deriveIdentity(original) };
  await fs.writeFile(path.join(api.home, 'auth.json'), original);
  const result = await api.probeSavedAccount(account, { activeId: account.id });
  assert.equal(result.syntheticUsage, true);
  const protectedSnapshot = await fs.readFile(path.join(api.store, 'vault/profile-A.secure'), 'utf8');
  assert.equal(protectedSnapshot, `protected:${rotated.toString('base64')}`);
});

test('a second instance exits before initialization or credential operations', async t => {
  const api = await desktop(t, undefined, false);
  assert.equal(api.quitCount(), 1);
  await api.startup();
  assert.deepEqual(await fs.readdir(api.home), []);
});
