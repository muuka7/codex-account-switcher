const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const yaml = require('js-yaml');
const { digest } = require('../scripts/verify-release');
const { requireDraft, writeReceipt, verifyReceipt, writeMacVerification, writeChecksums } = require('../scripts/release-manifest');
const { inspectApp } = require('../scripts/verify-mac-signatures');
const { selectIdentity, signingEnvironment } = require('../scripts/local-release');
const context = { version: '0.2.2', tag: 'v0.2.2', sha: 'a'.repeat(40), teamId: 'XV69GQQN2L', workflowRunId: '12345' };

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'switcher-pipeline-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const files = [];
  for (const arch of ['arm64', 'x64']) {
    for (const ext of ['zip', 'dmg']) {
      const url = `CodexAccountSwitcher-${context.version}-${arch}.${ext}`;
      await fs.writeFile(path.join(dir, url), `synthetic ${arch} ${ext}`);
      files.push({ url, size: (await fs.stat(path.join(dir, url))).size, sha512: await digest(path.join(dir, url), 'sha512') });
    }
  }
  await fs.writeFile(path.join(dir, 'latest-mac.yml'), yaml.dump({ version: context.version, files }));
  await fs.writeFile(path.join(dir, `CodexAccountSwitcher-Setup-${context.version}-x64.exe`), 'synthetic windows');
  await writeReceipt(dir, 'mac', context);
  await writeReceipt(dir, 'win', context);
  await writeMacVerification(dir, context);
  return dir;
}

test('publication requires a matching draft, source commit and version', () => {
  requireDraft({ isDraft: true, tagName: context.tag }, context);
  assert.throws(() => requireDraft({ isDraft: false, tagName: context.tag }, context), /Published releases/);
  assert.throws(() => requireDraft({ isDraft: true, tagName: 'v0.2.1' }, context), /matching draft/);
  assert.throws(() => requireDraft({ isDraft: true, tagName: context.tag }, { ...context, tag: 'v0.2.1' }), /must match/);
});

test('combined receipts produce checksums for all verified assets and verification records', async t => {
  const dir = await fixture(t);
  const files = await writeChecksums(dir, context);
  assert.equal(files.length, 10);
  const sums = await fs.readFile(path.join(dir, 'SHA256SUMS.txt'), 'utf8');
  for (const file of files.filter(file => file !== 'SHA256SUMS.txt')) assert.ok(sums.includes(`${await digest(path.join(dir, file), 'sha256')}  ${file}\n`));
});

test('stale source, signing team and workflow run receipts fail closed', async t => {
  const dir = await fixture(t);
  await assert.rejects(verifyReceipt(dir, 'mac', { ...context, sha: 'b'.repeat(40) }), /source commit/);
  await assert.rejects(verifyReceipt(dir, 'mac', { ...context, teamId: 'AAAAAAAAAA' }), /Apple team/);
  await assert.rejects(verifyReceipt(dir, 'win', { ...context, workflowRunId: '67890' }), /this workflow run/);
  await assert.rejects(writeChecksums(dir, { ...context, workflowRunId: '67890' }), /this workflow run/);
});

test('altered Windows asset and rewritten macOS receipt cannot pass combined verification', async t => {
  const dir = await fixture(t);
  const winFile = path.join(dir, `CodexAccountSwitcher-Setup-${context.version}-x64.exe`);
  await fs.appendFile(winFile, 'changed');
  await assert.rejects(writeChecksums(dir, context), /changed after verification/);
  await writeReceipt(dir, 'win', context);
  const macReceipt = path.join(dir, 'macos-verification.json');
  await fs.appendFile(macReceipt, '\n'); // Even a valid-JSON rewrite invalidates the independent Mac snapshot.
  await assert.rejects(writeChecksums(dir, context), /independent signature verification/);
});

test('duplicate receipt entries cannot substitute for a missing architecture', async t => {
  const dir = await fixture(t);
  const file = path.join(dir, 'macos-verification.json');
  const receipt = JSON.parse(await fs.readFile(file, 'utf8'));
  receipt.assets[1] = receipt.assets[0];
  await fs.writeFile(file, JSON.stringify(receipt));
  await assert.rejects(verifyReceipt(dir, 'mac', context), /duplicate filename/);
});

test('macOS verification rejects the wrong team and notarization failure', async () => {
  const calls = [];
  const execute = async (command, args) => {
    calls.push([command, args]);
    return { stdout: '', stderr: `Authority=Developer ID Application: Example (${context.teamId})\nTeamIdentifier=${context.teamId}\nCDHash=abcdef1234\n` };
  };
  assert.equal(await inspectApp('/synthetic.app', context.teamId, execute), 'abcdef1234');
  assert.ok(calls.some(([command, args]) => command.endsWith('xcrun') && args[0] === 'stapler'));
  assert.ok(calls.some(([command]) => command.endsWith('spctl')));
  await assert.rejects(inspectApp('/synthetic.app', 'AAAAAAAAAA', execute), /expected Apple team/);
  await assert.rejects(inspectApp('/synthetic.app', context.teamId, async (command, args) => {
    if (args[0] === 'stapler') throw new Error('No stapled ticket');
    return execute(command, args);
  }), /No stapled ticket/);
});

test('local signing selects only the expected valid identity and isolates build credentials', () => {
  const identity = 'F'.repeat(40);
  const output = `1) ${identity} "Developer ID Application: Example (${context.teamId})"`;
  assert.equal(selectIdentity(output, context.teamId), identity);
  assert.throws(() => selectIdentity(output, 'AAAAAAAAAA'), /exactly one/);
  assert.throws(() => selectIdentity(`${output}\n${output}`, context.teamId), /exactly one/);
  const env = signingEnvironment({ PATH: '/tools', APPLE_ID: 'private', APPLE_API_KEY: '/private.p8', CSC_LINK: 'private', CSC_KEY_PASSWORD: 'private', GH_TOKEN: 'private', GITHUB_TOKEN: 'private' }, { identity, profile: 'notary' }, '/working');
  for (const name of ['APPLE_ID', 'APPLE_API_KEY', 'CSC_LINK', 'CSC_KEY_PASSWORD', 'GH_TOKEN', 'GITHUB_TOKEN']) assert.equal(env[name], undefined);
  assert.equal(env.APPLE_KEYCHAIN_PROFILE, 'notary');
  assert.equal(env.CSC_NAME, identity);
  assert.equal(env.PATH, '/tools');
  assert.equal(env.TMPDIR, path.join('/working', 'tmp'));
});
