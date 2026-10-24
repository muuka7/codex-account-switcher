const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { request } = require('../src/remote/ssh-client');

function fixture(reply, inspect = () => {}) {
  return (_command, args) => {
    const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    let body = '';
    child.kill = () => { queueMicrotask(() => child.emit('close', 1)); return true; };
    child.stdin.on('data', bytes => {
      body += bytes.toString(); if (!body.endsWith('\n')) return;
      inspect(args, JSON.parse(body));
      queueMicrotask(() => child.stdout.write(`${JSON.stringify(reply)}\n`));
    });
    child.stdin.on('end', () => child.emit('close', 0));
    return child;
  };
}
const servers = { connection: async () => ({ destination: 'example.test', args: ['-l', 'user'] }) };

test('SSH sends the key only through stdin, preserves host verification, and filters the response', async () => {
  const key = 'synthetic-vault-key-not-a-real-secret';
  const spawnProcess = fixture({ version: 1, type: 'result', result: { accounts: [], tokens: key } }, (args, body) => {
    assert.ok(!args.join(' ').includes(key)); assert.ok(!args.some(a => /StrictHostKeyChecking=no|UserKnownHostsFile/.test(a)));
    assert.ok(args.includes('BatchMode=yes')); assert.equal(body.secret, key); assert.equal(body.method, 'import');
  });
  const result = await request('server', 'import', { label: 'work' }, { secret: key, servers, spawnProcess });
  assert.ok(!JSON.stringify(result).includes(key));
});

test('an incompatible helper response fails before exposing raw result fields', async () => {
  await assert.rejects(request('server', 'state', {}, { servers, spawnProcess: fixture({ version: 99, type: 'result', result: { secret: 'hidden' } }) }), { code: 'REMOTE_PROTOCOL' });
});

test('local cancellation terminates the SSH operation without replaying it', async () => {
  const controller = new AbortController(); let killed = false, calls = 0;
  const spawnProcess = () => {
    calls++; const child = new EventEmitter(); child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { killed = true; queueMicrotask(() => child.emit('close', 1)); return true; };
    queueMicrotask(() => controller.abort()); return child;
  };
  await assert.rejects(request('server', 'state', {}, { servers, spawnProcess, signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(killed, true); assert.equal(calls, 1);
});
