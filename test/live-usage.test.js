const test = process.platform === 'win32' ? require('node:test').skip : require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { WebSocketServer } = require('ws');
const { liveUsage } = require('../src/server/live-usage');

test('live usage uses the existing socket and exposes only identity and sanitized quotas', async t => {
  // Signed builds place TMPDIR deep inside the chosen working volume. Unix
  // socket names have a small platform byte limit, unlike ordinary files.
  const temporary = Buffer.byteLength(path.join(await fs.realpath(os.tmpdir()), 'live-usage-XXXXXX/control.sock')) > 100 ? '/tmp' : os.tmpdir();
  const dir = await fs.mkdtemp(path.join(temporary, 'live-usage-')); const socketPath = path.join(dir, 'control.sock');
  const server = http.createServer(), ws = new WebSocketServer({ server });
  t.after(async () => { ws.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(dir, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await fs.chmod(socketPath, 0o600);
  const methods = [];
  ws.on('connection', socket => socket.on('message', bytes => {
    const message = JSON.parse(bytes); methods.push(message.method);
    if (message.id === 1) socket.send(JSON.stringify({ id: 1, result: {} }));
    if (message.id === 2) socket.send(JSON.stringify({ id: 2, result: { account: { id: 'account', email: 'user@example.test', planType: 'pro', secret: 'never-return' } } }));
    if (message.id === 3) socket.send(JSON.stringify({ id: 3, result: { rateLimits: { primary: { usedPercent: 15, windowDurationMins: 300, resetsAt: null }, unexpectedSecret: 'never-return' } } }));
  }));
  const result = await liveUsage(dir, { socketPath });
  assert.equal(result.buckets[0].primary.remainingPercent, 85);
  assert.equal(result.account.email, 'user@example.test');
  assert.ok(!JSON.stringify(result).includes('never-return'));
  assert.deepEqual(methods, ['initialize', 'initialized', 'account/read', 'account/rateLimits/read']);
  const symlink = path.join(dir, 'daemon-link.sock'); await fs.symlink(socketPath, symlink);
  assert.equal((await liveUsage(dir, { socketPath: symlink })).buckets[0].primary.remainingPercent, 85);
  await fs.chmod(socketPath, 0o666);
  await assert.rejects(liveUsage(dir, { socketPath }), { code: 'UNSAFE_SOCKET' });
});
