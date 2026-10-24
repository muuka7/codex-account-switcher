const fs = require('node:fs/promises');

function stoppedError() { return Object.assign(new Error('The helper-owned Codex process group did not stop.'), { code: 'APP_SERVER_STOP_FAILED' }); }

async function groupAlive(pid) {
  try { process.kill(-pid, 0); } catch (e) { return e.code !== 'ESRCH'; }
  if (process.platform !== 'linux') return true;
  // A killed grandchild can briefly remain a zombie after its wrapper exits.
  // Zombies cannot rotate credentials or write files; wait for live members.
  try {
    for (const entry of await fs.readdir('/proc')) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        if ((await fs.stat(`/proc/${entry}`)).uid !== process.getuid()) continue;
        const stat = await fs.readFile(`/proc/${entry}/stat`, 'utf8');
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        if (Number(fields[2]) === pid && !['Z', 'X'].includes(fields[0])) return true;
      } catch (error) { if (!['ENOENT', 'ESRCH'].includes(error.code)) return true; }
    }
    return false;
  } catch { return true; }
}

function ownedProcess(child, { grouped = process.platform !== 'win32' } = {}) {
  let closed = false;
  child.once('close', () => { closed = true; });
  const signal = name => {
    if (!child.pid) return;
    try { grouped ? process.kill(-child.pid, name) : child.kill(name); }
    catch (error) { if (error.code !== 'ESRCH') throw stoppedError(); }
  };
  async function wait(ms) {
    const end = Date.now() + ms;
    do {
      if (closed && (!grouped || !child.pid || !await groupAlive(child.pid))) return true;
      await new Promise(done => setTimeout(done, 25));
    } while (Date.now() < end);
    return false;
  }
  return {
    get closed() { return closed; },
    async stop() {
      try { child.stdin?.end(); } catch {}
      signal('SIGTERM');
      if (await wait(1800)) return;
      signal('SIGKILL');
      if (!await wait(1200)) throw stoppedError();
    },
  };
}
module.exports = { ownedProcess, groupAlive };
