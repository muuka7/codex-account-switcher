const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Servers } = require('../src/server/servers');
const { validHost } = require('../src/server/ssh-hosts');
const { createHelperArchive } = require('./bundle-server');
const os = require('node:os');

async function main() {
  const alias = process.argv[2];
  if (!validHost(alias) || process.argv.length !== 3) throw new Error('Usage: node scripts/install-server.js <SSH alias or saved server name>');
  const connection = await new Servers().connection(alias);
  const taskRoot = path.resolve(__dirname, '..');
  const script = await fs.readFile(path.join(__dirname, 'server-install-remote.sh'), 'utf8');
  console.log(`Installing the headless helper on ${alias} as the configured SSH user.`);
  console.log('Installs source and two pinned dependencies. No sudo, login import, Codex config change or daemon restart.');
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'switcher-install-'));
  try {
    const archive = await createHelperArchive(path.join(temp, 'helper.tar.gz'), { root: taskRoot });
    const ssh = spawn('ssh', [...connection.args, '--', connection.destination, script], { stdio: ['pipe', 'inherit', 'inherit'] });
    ssh.stdin.on('error', () => {}); ssh.stdin.end(await fs.readFile(archive));
    const code = await new Promise((resolve, reject) => { ssh.once('error', reject); ssh.once('close', resolve); });
    if (code !== 0) throw new Error('Server setup failed; the live Codex login was not changed.');
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
