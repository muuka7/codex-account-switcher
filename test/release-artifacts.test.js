const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const yaml = require('js-yaml');
const { digest, verifyRelease } = require('../scripts/verify-release');

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'switcher-release-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const files = [];
  for (const arch of ['arm64', 'x64']) {
    for (const ext of ['zip', 'dmg']) {
      const url = `CodexAccountSwitcher-0.2.2-${arch}.${ext}`;
      await fs.writeFile(path.join(dir, url), `synthetic installer ${arch} ${ext}`);
      files.push({ url, size: (await fs.stat(path.join(dir, url))).size, sha512: await digest(path.join(dir, url), 'sha512') });
    }
  }
  await fs.writeFile(path.join(dir, 'CodexAccountSwitcher-Setup-0.2.2-x64.exe'), 'synthetic Windows installer');
  const metadata = { version: '0.2.2', files };
  const writeMetadata = () => fs.writeFile(path.join(dir, 'latest-mac.yml'), yaml.dump(metadata));
  await writeMetadata();
  return { dir, metadata, writeMetadata };
}

test('release verification accepts complete native installers and matching update hashes', async t => {
  const { dir } = await fixture(t);
  assert.equal((await verifyRelease(dir, 'all', '0.2.2')).length, 6);
});

test('release verification fails when an architecture ZIP was omitted', async t => {
  const { dir } = await fixture(t);
  await fs.rm(path.join(dir, 'CodexAccountSwitcher-0.2.2-arm64.zip'));
  await assert.rejects(verifyRelease(dir, 'mac', '0.2.2'), /ENOENT/);
});

test('release verification rejects corrupt downloads and unlisted update payloads', async t => {
  const { dir, metadata, writeMetadata } = await fixture(t);
  await fs.appendFile(path.join(dir, metadata.files[0].url), 'corruption');
  await assert.rejects(verifyRelease(dir, 'mac', '0.2.2'), /integrity mismatch/);
  metadata.files[0].url = '../outside.zip'; await writeMetadata();
  await assert.rejects(verifyRelease(dir, 'mac', '0.2.2'), /unexpected file/);
});

test('release verification rejects metadata for the wrong version or missing ZIP references', async t => {
  const { dir, metadata, writeMetadata } = await fixture(t);
  metadata.version = '0.2.1'; await writeMetadata();
  await assert.rejects(verifyRelease(dir, 'mac', '0.2.2'), /metadata version/);
  metadata.version = '0.2.2'; metadata.files = metadata.files.filter(f => f.url.endsWith('.dmg')); await writeMetadata();
  await assert.rejects(verifyRelease(dir, 'mac', '0.2.2'), /metadata is missing/);
});
