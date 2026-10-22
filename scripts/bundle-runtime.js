const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { digest } = require('./verify-release');
const tar = require('tar');
const { Arch } = require('builder-util');
const { TARGETS } = require('../src/codex-app-server');
const run = promisify(execFile);

async function copyRuntime(packageRoot, target, resources) {
  const vendor = path.join(packageRoot, 'vendor', target.triple);
  const binary = path.join(vendor, 'bin', target.binary);
  if (!(await fs.stat(binary)).isFile()) throw new Error('The target Codex runtime is missing.');
  const root = path.join(resources, 'codex-runtime');
  await fs.mkdir(resources, { recursive: true });
  await fs.cp(vendor, root, { recursive: true });
  return root;
}

async function bundleRuntime(context) {
  const target = TARGETS[`${context.electronPlatformName}:${Arch[context.arch]}`];
  if (!target) throw new Error('No Codex runtime exists for the packaging target.');
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  const spec = require('@openai/codex/package.json').optionalDependencies[target.packageName];
  const alias = /^npm:(@openai\/codex)@(\d+\.\d+\.\d+-(?:darwin|win32)-(?:x64|arm64))$/.exec(spec || '');
  if (!alias) throw new Error('The Codex runtime must have an exact pinned package alias.');
  const [, packageName, version] = alias;
  const locked = require('../package-lock.json').packages[`node_modules/${target.packageName}`];
  if (locked?.version !== version || !locked.integrity?.startsWith('sha512-')) throw new Error('The target runtime is not pinned in the lockfile.');
  let installed;
  try { installed = path.dirname(require.resolve(`${target.packageName}/package.json`)); } catch {}
  if (installed && require(path.join(installed, 'package.json')).version === version) {
    return copyRuntime(installed, target, resources);
  }

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'switcher-runtime-build-'));
  try {
    // npm verifies registry integrity. pack bypasses host OS/CPU installation
    // filters without running package scripts or changing the dependency tree.
    const npmCli = process.env.npm_execpath;
    if (!npmCli) throw new Error('Build through npm run pack:mac or npm run pack:win.');
    const { stdout } = await run(process.execPath, [npmCli, 'pack', `${packageName}@${version}`, '--ignore-scripts', '--json', '--pack-destination', temp]);
    const packed = JSON.parse(stdout)[0];
    if (!packed?.integrity || path.basename(packed.filename) !== packed.filename) throw new Error('Invalid Codex runtime package metadata.');
    if (`sha512-${await digest(path.join(temp, packed.filename), 'sha512')}` !== locked.integrity) throw new Error('Codex runtime archive does not match the committed lockfile integrity.');
    await tar.x({ file: path.join(temp, packed.filename), cwd: temp });
    const pkgRoot = path.join(temp, 'package');
    const manifest = JSON.parse(await fs.readFile(path.join(pkgRoot, 'package.json'), 'utf8'));
    if (manifest.name !== packageName || manifest.version !== version) throw new Error('The Codex runtime package does not match the target.');
    return await copyRuntime(pkgRoot, target, resources);
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}

module.exports = { bundleRuntime, copyRuntime };
