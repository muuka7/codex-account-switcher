const { spawn } = require('node:child_process');
const { Servers } = require('../server/servers');
const { validHost, remoteCommand } = require('../server/ssh-hosts');
const { validateRequest, sanitizeResult, sanitizeEvent, serverError } = require('./protocol');

function sshError(code, message) { return Object.assign(new Error(message), { code }); }
function classifySsh(stderr) {
  if (/Host key verification failed|REMOTE HOST IDENTIFICATION HAS CHANGED/.test(stderr)) return sshError('SSH_HOST_KEY', 'OpenSSH could not verify this server. Verify its host key in your terminal before connecting here.');
  if (/Permission denied|sign_and_send_pubkey|no mutual signature/.test(stderr)) return sshError('SSH_AUTH', 'SSH authentication failed. Unlock your SSH key or agent and check this alias in a terminal.');
  if (/Cannot find module.*cli\.js|No such file.*cli\.js/.test(stderr)) return sshError('HELPER_MISSING', 'The server helper is not installed. Choose Set up server.');
  return sshError('SSH_FAILED', 'The SSH connection or server helper failed. Check the server address, SSH access and helper installation.');
}

async function request(host, method, params = {}, { secret, onEvent = () => {}, signal, timeoutMs, servers = new Servers(), spawnProcess = spawn } = {}) {
  if (!validHost(host)) throw sshError('INVALID_HOST', 'Choose a concrete SSH server alias.');
  validateRequest(method, params, secret);
  const connection = await servers.connection(host);
  return new Promise((resolve, reject) => {
    const child = spawnProcess('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', ...connection.args, '--', connection.destination, remoteCommand(null, ['serve'])], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', stderr = '', finished = false, received = false, closed = false, totalBytes = 0;
    const finish = (error, value) => {
      if (finished) return; finished = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      try { child.stdin.end(); } catch {}
      if (!received) child.kill('SIGTERM');
      const reap = setTimeout(() => { if (!closed) child.kill('SIGKILL'); }, 2500);
      reap.unref?.(); child.once('close', () => clearTimeout(reap));
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(sshError('CANCELLED', 'The connection was cancelled. Check server state before repeating a credential operation.'));
    const duration = timeoutMs || (['login', 'reauth'].includes(method) ? 16 * 60 * 1000 : method === 'refresh' ? 10 * 60 * 1000 : 90000);
    const timer = setTimeout(() => finish(sshError('SSH_TIMEOUT', 'The server operation timed out. Reconnect to check its state before repeating a credential operation.')), duration);
    child.once('error', () => finish(sshError('SSH_FAILED', 'OpenSSH could not start.')));
    child.stdin.on('error', () => { /* close reports the classified connection error */ });
    child.stderr.on('data', bytes => { if (stderr.length < 32768) stderr += bytes.toString('utf8').slice(0, 32768 - stderr.length); });
    child.stdout.on('data', bytes => {
      if (finished) return;
      totalBytes += bytes.length;
      buffer += bytes.toString('utf8');
      if (totalBytes > 4 * 1024 * 1024) return finish(sshError('REMOTE_PROTOCOL', 'The helper response exceeded its size limit.'));
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n'), line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let value;
        try {
          value = JSON.parse(line);
          if (value.version !== 1) throw new Error();
          if (value.type === 'event') { onEvent(sanitizeEvent(value.event)); continue; }
          if (value.type === 'error') { received = true; finish(serverError(value.error)); return; }
          if (value.type !== 'result') throw new Error();
          const result = sanitizeResult(method, value.result); received = true; finish(null, result); return;
        } catch { finish(sshError('REMOTE_PROTOCOL', 'The server helper returned an invalid response. Update it before continuing.')); return; }
      }
    });
    child.once('close', () => { closed = true; if (!finished) finish(classifySsh(stderr)); });
    signal?.addEventListener('abort', abort, { once: true });
    const body = Buffer.from(`${JSON.stringify({ version: 1, method, params, ...(secret !== undefined ? { secret } : {}) })}\n`);
    child.stdin.write(body, () => body.fill(0));
    if (signal?.aborted) abort();
  });
}
module.exports = { request, classifySsh, sshError };
