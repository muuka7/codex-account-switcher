const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const tar = require('tar');
const { createHelperArchive } = require('../scripts/bundle-server');
const files = require('../src/remote/helper-files');
const { verifyHelperArchive } = require('../scripts/verify-release');

test('source helper archive contains only the positive source allowlist and protocol metadata', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'switcher-archive-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const archive = await createHelperArchive(path.join(dir, 'helper.tar.gz'));
  const entries = []; await tar.t({ file: archive, onReadEntry: e => entries.push(e.path) });
  assert.deepEqual(entries.sort(), [...files, 'server/build.json'].sort());
  assert.ok(!entries.some(p => /(?:auth\.json|\.vault$|\.secure$|node_modules|\.git\/)/.test(p)));
  await verifyHelperArchive(archive, require('../package.json').version);
  await assert.rejects(verifyHelperArchive(archive, '99.0.0'), /version or protocol/);
});
