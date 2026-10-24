const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const tar = require('tar');
const files = require('../src/remote/helper-files');

async function createHelperArchive(output, { root = path.resolve(__dirname, '..') } = {}) {
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'switcher-helper-build-'));
  try {
    for (const file of files) {
      const source = path.join(root, file);
      if (!(await fs.lstat(source)).isFile()) throw new Error('Helper sources must be regular files.');
      const target = path.join(stage, file);
      await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(source, target);
    }
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'server/package.json'), 'utf8'));
    await fs.writeFile(path.join(stage, 'server/build.json'), JSON.stringify({ version: pkg.version, protocol: 1 }));
    await fs.mkdir(path.dirname(output), { recursive: true });
    await tar.c({ cwd: stage, file: output, gzip: true, portable: true, noMtime: true }, [...files, 'server/build.json']);
    return output;
  } finally { await fs.rm(stage, { recursive: true, force: true }); }
}

async function bundleServer(context) {
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents/Resources')
    : path.join(context.appOutDir, 'resources');
  await createHelperArchive(path.join(resources, 'server-helper.tar.gz'));
}
module.exports = { createHelperArchive, bundleServer };
