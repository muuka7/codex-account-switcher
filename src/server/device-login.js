const { spawn } = require('node:child_process');
const { fail } = require('./security');
const { ownedProcess } = require('../owned-process');

// Uses the official structured device-code flow. Never parse token-bearing
// terminal output and never return auth.json to the desktop.
function deviceLogin({ binary, home, env, onCode = () => {}, signal, timeoutMs = 15 * 60 * 1000 }) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['app-server'], { cwd: home, env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    const owned = ownedProcess(child);
    let buffer = '', settled = false, loginId;
    const send = value => { if (child.stdin.writable) child.stdin.write(`${JSON.stringify(value)}\n`); };
    async function finish(error) {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (error && loginId) send({ id: 3, method: 'account/login/cancel', params: { loginId } });
      try { await owned.stop(); } catch (stopError) { reject(stopError); return; }
      error ? reject(error) : resolve();
    }
    const abort = () => finish(fail('CANCELLED', 'Device login cancelled.'));
    const timer = setTimeout(() => finish(fail('LOGIN_FAILED', 'Device login timed out.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    child.once('error', () => finish(fail('LOGIN_FAILED', 'Device login could not start.')));
    child.stdin.on('error', () => finish(fail('LOGIN_FAILED', 'Device login connection closed.')));
    child.stderr.on('data', () => {});
    child.once('close', () => { if (!settled) finish(fail('LOGIN_FAILED', 'Device login stopped.')); });
    child.stdout.on('data', bytes => {
      if (settled) return;
      buffer += bytes.toString('utf8');
      if (buffer.length > 1024 * 1024) return finish(fail('LOGIN_FAILED', 'Invalid device login response.'));
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.error && [1, 2].includes(m.id)) return finish(fail('LOGIN_FAILED', 'Codex rejected device login.'));
        if (m.id === 1 && m.result) {
          send({ method: 'initialized', params: {} });
          send({ id: 2, method: 'account/login/start', params: { type: 'chatgptDeviceCode' } });
        } else if (m.id === 2 && m.result) {
          const { verificationUrl, userCode } = m.result;
          let url; try { url = new URL(verificationUrl); } catch { return finish(fail('LOGIN_FAILED', 'Invalid device login URL.')); }
          if (url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.pathname !== '/codex/device' || url.username || url.password || url.port || url.search || url.hash || !/^[A-Za-z0-9-]{4,32}$/.test(userCode || '')) return finish(fail('LOGIN_FAILED', 'Invalid device login instructions.'));
          if (typeof m.result.loginId !== 'string' || !m.result.loginId || m.result.loginId.length > 200) return finish(fail('LOGIN_FAILED', 'Invalid login identifier.'));
          loginId = m.result.loginId;
          onCode({ verificationUrl: url.href, userCode });
        } else if (m.method === 'account/login/completed') {
          if (!loginId || m.params?.loginId !== loginId) continue;
          finish(m.params.success === true ? null : fail('LOGIN_FAILED', 'Device login did not complete.'));
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'codex-account-switcher', version: '0.3.0' }, capabilities: {} } });
    if (signal?.aborted) abort();
  });
}
module.exports = { deviceLogin };
