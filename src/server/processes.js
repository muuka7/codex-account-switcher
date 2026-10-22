const fs = require('node:fs/promises');
const path = require('node:path');
const { fail } = require('./security');

async function codexProcesses({ procRoot = '/proc', uid = process.getuid?.() } = {}) {
  if (process.platform !== 'linux' && procRoot === '/proc') throw fail('LINUX_REQUIRED', 'Account management runs on Linux. Use --host for an SSH server.');
  const result = [];
  for (const pid of await fs.readdir(procRoot)) {
    if (!/^\d+$/.test(pid)) continue;
    const dir = path.join(procRoot, pid);
    try {
      if ((await fs.stat(dir)).uid !== uid) continue;
      const name = (await fs.readFile(path.join(dir, 'comm'), 'utf8')).trim();
      if (/^codex(?:$|[-_])/.test(name)) result.push({ pid: Number(pid), name });
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ESRCH') throw fail('PROCESS_CHECK_FAILED', 'Codex process ownership could not be checked. No login will be changed.');
    }
  }
  return result;
}

async function requireQuiet(scanner = codexProcesses) {
  const running = await scanner();
  if (running.length) throw fail('CODEX_RUNNING', `Stop Codex clients and disconnect desktop SSH sessions before this operation. Running Codex PIDs: ${running.map(p => p.pid).join(', ')}. Cached usage and live daemon usage remain available.`);
}

module.exports = { codexProcesses, requireQuiet };
