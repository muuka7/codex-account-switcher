const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');

async function digest(file, algorithm) {
  const hash = crypto.createHash(algorithm);
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest(algorithm === 'sha512' ? 'base64' : 'hex');
}

async function verifyRelease(dir, platform, version) {
  if (!['mac', 'win', 'all'].includes(platform)) throw new Error('Expected platform mac, win, or all.');
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('A stable release version is required.');
  const expected = [];
  if (platform !== 'win') {
    for (const arch of ['x64', 'arm64']) {
      for (const ext of ['dmg', 'zip']) expected.push(`CodexAccountSwitcher-${version}-${arch}.${ext}`);
    }
    expected.push('latest-mac.yml');
  }
  if (platform !== 'mac') expected.push(`CodexAccountSwitcher-Setup-${version}-x64.exe`);
  for (const name of expected) {
    const stat = await fs.lstat(path.join(dir, name));
    if (!stat.isFile() || stat.size === 0) throw new Error(`Missing or empty release file: ${name}`);
  }
  if (platform !== 'win') {
    const info = yaml.load(await fs.readFile(path.join(dir, 'latest-mac.yml'), 'utf8'), { schema: yaml.JSON_SCHEMA });
    if (info?.version !== version || !Array.isArray(info.files)) throw new Error('Invalid macOS update metadata version or file list.');
    const listed = new Set();
    for (const entry of info.files) {
      if (typeof entry.url !== 'string' || path.basename(entry.url) !== entry.url || !expected.includes(entry.url) || entry.url.endsWith('.yml')) {
        throw new Error('Update metadata references an unexpected file.');
      }
      const file = path.join(dir, entry.url);
      const stat = await fs.stat(file);
      if (entry.size !== stat.size || entry.sha512 !== await digest(file, 'sha512')) throw new Error(`Update metadata integrity mismatch: ${entry.url}`);
      listed.add(entry.url);
    }
    for (const name of expected.filter(name => name.endsWith('.zip'))) {
      if (!listed.has(name)) throw new Error(`Update metadata is missing ${name}`);
    }
  }
  return expected;
}

async function verifyPackagedRuntimes(dir, platform) {
  const resources = platform === 'mac' ? [
    path.join(dir, 'mac', 'Codex Account Switcher.app', 'Contents', 'Resources'),
    path.join(dir, 'mac-arm64', 'Codex Account Switcher.app', 'Contents', 'Resources'),
  ] : [path.join(dir, 'win-unpacked', 'resources')];
  for (const root of resources) {
    const binary = path.join(root, 'codex-runtime', 'bin', platform === 'mac' ? 'codex' : 'codex.exe');
    if (!(await fs.stat(binary)).isFile()) throw new Error('A packaged Codex runtime is missing.');
  }
}

if (require.main === module) {
  verifyRelease(process.argv[2] || 'release', process.argv[3] || 'all', require('../package.json').version)
    .then(async files => {
      if (process.argv.includes('--packaged')) await verifyPackagedRuntimes(process.argv[2], process.argv[3]);
      console.log(`Verified ${files.length} release assets and update integrity.`);
    })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { verifyRelease, verifyPackagedRuntimes, digest };
