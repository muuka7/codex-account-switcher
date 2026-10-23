const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { verifyRelease, verifyPackagedRuntimes } = require('./verify-release');
const { writeReceipt } = require('./release-manifest');
const { verifyMacSignatures } = require('./verify-mac-signatures');

const root = path.resolve(__dirname, '..');
const pkg = require('../package.json');
const policy = require('../.github/release-policy.json');
const repo = `${pkg.build.publish.owner}/${pkg.build.publish.repo}`;
const configFile = path.join(os.homedir(), '.config', 'codex-account-switcher', 'mac-release.json');
const minimumSpace = 8n * 1024n ** 3n;

function capture(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim();
}
function execute(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options });
}
function selectIdentity(output, teamId) {
  const identities = [...output.matchAll(/\b([A-F0-9]{40}) "(Developer ID Application: [^"]+)"/g)]
    .filter(match => match[2].endsWith(`(${teamId})`));
  if (identities.length !== 1) throw new Error('Expected exactly one valid Developer ID Application identity for the configured Apple team.');
  return identities[0][1];
}
function signingEnvironment(env, config, work) {
  const result = { ...env };
  for (const name of Object.keys(result)) {
    if (/^(APPLE_|CSC_|MAC_CSC_|WIN_CSC_)/.test(name) || ['GH_TOKEN', 'GITHUB_TOKEN'].includes(name)) delete result[name];
  }
  return {
    ...result,
    CSC_NAME: config.identity,
    CSC_IDENTITY_AUTO_DISCOVERY: 'true',
    APPLE_KEYCHAIN_PROFILE: config.profile,
    ...(config.keychain ? { APPLE_KEYCHAIN: config.keychain } : {}),
    TMPDIR: path.join(work, 'tmp'),
    ELECTRON_CACHE: path.join(work, 'electron'),
    ELECTRON_BUILDER_CACHE: path.join(work, 'builder'),
    npm_config_cache: path.join(work, 'npm'),
  };
}
async function checkSpace(directory) {
  const stats = await fs.statfs(directory, { bigint: true });
  if (stats.bavail * stats.bsize < minimumSpace) throw new Error(`At least 8 GiB of free space is required in ${directory}. Free space or configure another volume with release:setup -- --output /absolute/path.`);
}
async function readConfig() {
  const config = JSON.parse(await fs.readFile(configFile, 'utf8'));
  if (!/^[A-F0-9]{40}$/.test(config.identity) || !config.profile || typeof config.profile !== 'string' || !path.isAbsolute(config.output) || config.teamId !== policy.macTeamId) {
    throw new Error('Invalid local release configuration. Run npm run release:setup again.');
  }
  return config;
}
async function configure(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--profile', '--output', '--keychain'].includes(args[i]) || !args[i + 1]) throw new Error('Setup options: --profile NAME --output /absolute/path --keychain /absolute/path.');
    options[args[i].slice(2)] = args[i + 1];
  }
  let previous = {};
  try { previous = await readConfig(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const config = {
    ...previous,
    identity: selectIdentity(capture('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']), policy.macTeamId),
    teamId: policy.macTeamId,
    profile: options.profile || previous.profile || 'codex-account-switcher-notary',
    output: options.output || previous.output || path.join(os.homedir(), 'Library', 'Caches', 'codex-account-switcher', 'releases'),
    ...(options.keychain ? { keychain: options.keychain } : {}),
  };
  if (!path.isAbsolute(config.output) || (config.keychain && !path.isAbsolute(config.keychain))) throw new Error('Output and Keychain paths must be absolute.');
  // Never put the build workspace inside the source checkout.
  const relative = path.relative(root, config.output);
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Choose an output folder outside the repository.');
  await fs.mkdir(path.dirname(configFile), { recursive: true, mode: 0o700 });
  await fs.writeFile(configFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(configFile, 0o600);
  console.log(`Saved non-secret configuration to ${configFile}. Apple credentials remain in Keychain.`);
}
async function doctor(config) {
  const problems = [];
  const check = async (label, fn) => {
    try { await fn(); console.log(`OK: ${label}`); }
    catch (error) { problems.push(label); console.error(`NEEDS SETUP: ${label}${error.message.startsWith('At least') ? ` — ${error.message}` : ''}`); }
  };
  await check('Developer ID signing identity', () => {
    const identity = selectIdentity(capture('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']), policy.macTeamId);
    if (identity !== config.identity) throw new Error('The configured identity changed.');
  });
  await check(`Apple notarization profile ${config.profile}`, () => capture('/usr/bin/xcrun', ['notarytool', 'history', '--keychain-profile', config.profile, ...(config.keychain ? ['--keychain', config.keychain] : []), '--output-format', 'json']));
  await check('GitHub authentication and repository access', () => {
    const access = JSON.parse(capture('gh', ['repo', 'view', repo, '--json', 'viewerPermission']));
    if (!['ADMIN', 'MAINTAIN', 'WRITE'].includes(access.viewerPermission)) throw new Error('Write access required.');
  });
  await check('Build working space', async () => { await fs.mkdir(config.output, { recursive: true }); await checkSpace(config.output); });
  if (problems.length) throw new Error(`Resolve ${problems.length} prerequisite(s), then rerun npm run release:doctor. See RELEASING.md.`);
}
function requireCleanSource() {
  if (capture('git', ['status', '--porcelain'])) throw new Error('Commit all source changes before releasing.');
}
async function release(config) {
  await doctor(config);
  requireCleanSource();
  if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Expected a stable package version.');
  const tag = `v${pkg.version}`;
  const sha = capture('git', ['rev-parse', 'HEAD']);
  execute('git', ['fetch', 'origin', 'main']);
  if (sha !== capture('git', ['rev-parse', 'origin/main'])) throw new Error('Release source must match the pushed main branch.');
  const checks = JSON.parse(capture('gh', ['run', 'list', '--repo', repo, '--workflow', 'ci.yml', '--commit', sha, '--branch', 'main', '--limit', '1', '--json', 'status,conclusion']));
  if (checks[0]?.status !== 'completed' || checks[0]?.conclusion !== 'success') throw new Error('The exact pushed source commit must have a successful CI run before release.');
  const existingTags = capture('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`, `refs/tags/${tag}^{}`]);
  if (existingTags) throw new Error('This version already has a remote tag. Resume its draft with the Release workflow, or bump the version.');
  if (JSON.parse(capture('gh', ['api', `repos/${repo}/releases`, '--paginate', '--slurp'])).flat().some(item => item.tag_name === tag)) throw new Error('A release already exists for this version. Resume its draft or bump the version.');
  const directory = path.join(config.output, `${tag}-${sha.slice(0, 12)}`);
  // Refuse to reuse stale builds or erase a failed attempt automatically.
  await fs.mkdir(directory);
  const work = path.join(directory, 'work');
  for (const name of ['tmp', 'electron', 'builder', 'npm']) await fs.mkdir(path.join(work, name), { recursive: true });
  const env = signingEnvironment(process.env, config, work);
  const npm = args => execute(process.execPath, [process.env.npm_execpath, ...args], { env });
  npm(['ci']); npm(['run', 'lint']); npm(['test']); npm(['audit', '--audit-level=moderate']);
  npm(['ci', '--prefix', 'server', '--ignore-scripts']); npm(['audit', '--prefix', 'server', '--audit-level=moderate']);
  npm(['run', 'pack:mac', '--', `-c.directories.output=${directory}`]);
  await verifyRelease(directory, 'mac', pkg.version);
  await verifyPackagedRuntimes(directory, 'mac');
  // Verification extracts ZIPs on the configured working volume too.
  const oldTemp = process.env.TMPDIR; process.env.TMPDIR = path.join(work, 'tmp');
  try { await verifyMacSignatures(directory, pkg.version, config.teamId); }
  finally { if (oldTemp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTemp; }
  requireCleanSource();
  if (sha !== capture('git', ['rev-parse', 'HEAD'])) throw new Error('The source commit changed during the build.');
  const assets = await writeReceipt(directory, 'mac', { tag, version: pkg.version, sha, teamId: config.teamId });
  execute('git', ['tag', tag, sha]);
  execute('git', ['push', 'origin', `refs/tags/${tag}`]);
  const notes = path.join(directory, 'release-notes.md');
  await fs.writeFile(notes, `macOS Intel and Apple Silicon installers are Developer ID signed and notarized by Apple. macOS builds were produced on the maintainer's Mac; Windows was built in GitHub Actions from commit ${sha}.\n\nPublication is automatic after the Release workflow independently checks the macOS signatures, notarization, source receipts and downloaded checksums. Windows installers are unsigned; updates on Windows are manual.\n\nDownload the DMG for your Mac's architecture, or the x64 Windows EXE. ZIPs and latest-mac.yml support macOS updates. The first signed macOS release must be installed manually. See CHANGELOG.md for changes and SHA256SUMS.txt for download checksums.\n`);
  execute('gh', ['release', 'create', tag, '--repo', repo, '--verify-tag', '--draft', '--title', `Codex Account Switcher ${tag}`, '--notes-file', notes, ...assets.map(name => path.join(directory, name))]);
  execute('gh', ['workflow', 'run', 'release.yml', '--repo', repo, '--ref', 'main', '-f', `tag=${tag}`]);
  console.log(`Uploaded verified macOS builds for ${tag}. GitHub will build Windows, verify both platforms and publish automatically: https://github.com/${repo}/actions/workflows/release.yml`);
}
async function main() {
  if (process.platform !== 'darwin') throw new Error('Local signed releases require macOS.');
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('Use Node.js 24 (see .nvmrc).');
  const [command, ...args] = process.argv.slice(2);
  if (command === 'setup') await configure(args);
  else if (command === 'doctor' && !args.length) await doctor(await readConfig());
  else if (command === 'release' && !args.length) await release(await readConfig());
  else throw new Error('Expected setup, doctor or release.');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { selectIdentity, signingEnvironment, checkSpace };
