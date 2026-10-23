const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { verifyRelease } = require('./verify-release');
const run = promisify(execFile);

async function inspectApp(app, teamId, execute = run) {
  await execute('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  const result = await execute('/usr/bin/codesign', ['--display', '--verbose=4', app]);
  const metadata = `${result.stdout || ''}\n${result.stderr || ''}`;
  if (!metadata.includes('Authority=Developer ID Application:') || !metadata.split('\n').includes(`TeamIdentifier=${teamId}`)) throw new Error('The app is not Developer ID signed by the expected Apple team.');
  const hash = /^CDHash=([a-f0-9]+)$/m.exec(metadata)?.[1];
  if (!hash) throw new Error('The app has no verifiable code-directory hash.');
  await execute('/usr/bin/xcrun', ['stapler', 'validate', app]);
  await execute('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', app]);
  return hash;
}

async function verifyMacSignatures(dir, version, teamId) {
  if (process.platform !== 'darwin') throw new Error('macOS signature verification requires a Mac.');
  if (!/^[A-Z0-9]{10}$/.test(teamId)) throw new Error('An expected Apple team ID is required.');
  await verifyRelease(dir, 'mac', version);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'switcher-signature-check-'));
  let mounted = false;
  try {
    for (const arch of ['x64', 'arm64']) {
      const zipDir = path.join(temp, arch); await fs.mkdir(zipDir);
      await run('/usr/bin/ditto', ['-x', '-k', path.join(dir, `CodexAccountSwitcher-${version}-${arch}.zip`), zipDir]);
      const zipHash = await inspectApp(path.join(zipDir, 'Codex Account Switcher.app'), teamId);
      const mount = path.join(temp, `dmg-${arch}`); await fs.mkdir(mount);
      await run('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, path.join(dir, `CodexAccountSwitcher-${version}-${arch}.dmg`)]);
      mounted = true;
      try {
        const dmgHash = await inspectApp(path.join(mount, 'Codex Account Switcher.app'), teamId);
        if (zipHash !== dmgHash) throw new Error('The DMG and update ZIP contain different apps.');
      } finally { await run('/usr/bin/hdiutil', ['detach', mount]); mounted = false; }
      await fs.rm(zipDir, { recursive: true, force: true });
    }
  } finally {
    // Never recursively clean a directory containing a disk image that failed to detach.
    if (!mounted) await fs.rm(temp, { recursive: true, force: true });
  }
}

if (require.main === module) {
  verifyMacSignatures(path.resolve(process.argv[2]), require('../package.json').version, require('../.github/release-policy.json').macTeamId)
    .then(() => console.log('Both macOS architectures passed signing, notarization and DMG/ZIP checks.'))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { inspectApp, verifyMacSignatures };
