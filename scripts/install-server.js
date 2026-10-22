const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Servers } = require('../src/server/servers');
const { validHost } = require('../src/server/ssh-hosts');

async function main() {
  const alias = process.argv[2];
  if (!validHost(alias) || process.argv.length !== 3) throw new Error('Usage: node scripts/install-server.js <SSH alias or saved server name>');
  const connection = await new Servers().connection(alias);
  const taskRoot = path.resolve(__dirname, '..');
  const script = await fs.readFile(path.join(__dirname, 'server-install-remote.sh'), 'utf8');
  console.log(`Installing the headless helper on ${alias} as the configured SSH user.`);
  console.log('Installs source and two pinned dependencies. No sudo, login import, Codex config change or daemon restart.');
  const tar = spawn('tar', ['--no-xattrs', '--no-acls', '-C', taskRoot, '-cf', '-', 'src/server', 'src/codex-app-server.js', 'src/rate-limits.js', 'server/package.json', 'server/package-lock.json', 'LICENSE', 'NOTICE.md', 'docs/LINUX-SERVER.md'], { env: { ...process.env, COPYFILE_DISABLE: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  const ssh = spawn('ssh', [...connection.args, '--', connection.destination, script], { stdio: ['pipe', 'inherit', 'inherit'] });
  tar.stdout.pipe(ssh.stdin); ssh.stdin.on('error', () => {});
  const status = child => new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  const codes = await Promise.all([status(tar), status(ssh)]);
  if (codes.some(code => code !== 0)) throw new Error('Server setup failed; the live Codex login was not changed.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
