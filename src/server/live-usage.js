const fs = require('node:fs/promises');
const path = require('node:path');
const WebSocket = require('ws');
const { fail } = require('./security');
const { allBucketsFromResult } = require('../rate-limits');

// Connect to the daemon that already owns its credentials. A new sidecar must
// not independently refresh that same active account's token.
async function liveUsage(codexHome, { socketPath = path.join(codexHome, 'app-server-control', 'app-server-control.sock'), timeoutMs = 15000 } = {}) {
  const link = await fs.lstat(socketPath);
  const resolvedPath = await fs.realpath(socketPath);
  const stat = await fs.lstat(resolvedPath);
  // Current Linux Codex points the home entry at a private daemon socket in
  // /tmp. Validate both owners and connect to the resolved socket directly.
  if (link.uid !== process.getuid() || !stat.isSocket() || stat.uid !== process.getuid() || (stat.mode & 0o077) || /[:?]/.test(resolvedPath)) throw fail('UNSAFE_SOCKET', 'The Codex control socket must be private and owned by your user.');
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws+unix:${resolvedPath}:/`, { handshakeTimeout: timeoutMs, maxPayload: 4 * 1024 * 1024, perMessageDeflate: false, followRedirects: false });
    let finished = false, account = null;
    const finish = (error, value) => {
      if (finished) return;
      finished = true; clearTimeout(timer); socket.terminate();
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(fail('LIVE_USAGE_TIMEOUT', 'The existing Codex daemon did not answer. Cached account usage is still available.')), timeoutMs);
    socket.on('error', () => finish(fail('LIVE_USAGE_UNAVAILABLE', 'Could not connect to the existing Codex daemon. No new daemon was started.')));
    socket.on('close', () => finish(fail('LIVE_USAGE_UNAVAILABLE', 'The Codex daemon closed the usage connection.')));
    socket.on('open', () => socket.send(JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'codex-account-switcher', version: '0.2.1' }, capabilities: {} } })));
    socket.on('message', bytes => {
      let message; try { message = JSON.parse(bytes); } catch { return; }
      if (message.error && [1, 2, 3].includes(message.id)) return finish(fail('LIVE_USAGE_UNAVAILABLE', 'Codex rejected the live usage request.'));
      if (message.id === 1 && message.result) {
        socket.send(JSON.stringify({ method: 'initialized', params: {} }));
        socket.send(JSON.stringify({ id: 2, method: 'account/read', params: { refreshToken: false } }));
      } else if (message.id === 2 && message.result) {
        const a = message.result.account;
        account = a ? { id: typeof a.id === 'string' ? a.id : null, email: typeof a.email === 'string' ? a.email : null, planType: typeof a.planType === 'string' ? a.planType : null } : null;
        socket.send(JSON.stringify({ id: 3, method: 'account/rateLimits/read', params: {} }));
      } else if (message.id === 3 && message.result) {
        finish(null, { checkedAt: new Date().toISOString(), account, buckets: allBucketsFromResult(message.result), scope: 'existing-daemon', note: 'Other independently launched Codex processes may use a different account.' });
      }
    });
  });
}

module.exports = { liveUsage };
