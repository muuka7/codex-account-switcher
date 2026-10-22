const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { copyRuntime } = require('../scripts/bundle-runtime');
const { TARGETS, resolveCodexRuntime } = require('../src/codex-app-server');

test('packaged runtime selection follows the target architecture rather than the build host', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'switcher-bundle-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const previousResources = process.resourcesPath;
  const previousOverride = process.env.CODEX_SWITCHER_CODEX_BINARY;
  t.after(() => {
    if (previousResources === undefined) delete process.resourcesPath; else process.resourcesPath = previousResources;
    if (previousOverride === undefined) delete process.env.CODEX_SWITCHER_CODEX_BINARY; else process.env.CODEX_SWITCHER_CODEX_BINARY = previousOverride;
  });
  delete process.env.CODEX_SWITCHER_CODEX_BINARY;
  for (const [key, target] of Object.entries(TARGETS)) {
    const [platform, arch] = key.split(':');
    const packageRoot = path.join(temp, key.replace(':', '-'));
    const bin = path.join(packageRoot, 'vendor', target.triple, 'bin');
    await fs.mkdir(bin, { recursive: true });
    await fs.writeFile(path.join(bin, target.binary), 'synthetic target runtime');
    const resources = path.join(packageRoot, 'resources');
    await copyRuntime(packageRoot, target, resources);
    process.resourcesPath = resources;
    const runtime = resolveCodexRuntime({ platform, arch });
    assert.equal(await fs.readFile(runtime.binaryPath, 'utf8'), 'synthetic target runtime');
    assert.equal(runtime.binaryPath, path.join(resources, 'codex-runtime', 'bin', target.binary));
  }
});
