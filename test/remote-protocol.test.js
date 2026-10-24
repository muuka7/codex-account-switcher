const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { dispatch, serve } = require('../src/server/rpc');
const { sanitizeResult, sanitizeEvent, serverError } = require('../src/remote/protocol');

const state = { host: 'test', auth: 'DO-NOT-LEAK', accounts: [{ id: 'id', label: 'work', identity: { accountId: 'workspace', email: 'user@example.test', access_token: 'DO-NOT-LEAK' }, auth: { access_token: 'DO-NOT-LEAK' }, usage: { checkedAt: new Date().toISOString(), buckets: [{ id: 'codex', primary: { usedPercent: 15, windowDurationMins: 300, resetsAt: 1999999999 }, auth: 'DO-NOT-LEAK' }] } }] };

test('server and desktop independently filter unexpected credential fields', async () => {
  const result = await dispatch({ version: 1, method: 'state', params: {} }, { manager: { cached: async () => state } });
  assert.ok(!JSON.stringify(result).includes('DO-NOT-LEAK'));
  assert.equal(result.accounts[0].usage.buckets[0].primary.remainingPercent, 85);
  assert.ok(!JSON.stringify(sanitizeResult('state', state)).includes('DO-NOT-LEAK'));
});

test('RPC rejects arbitrary methods, file paths, versions and secrets on read methods', async () => {
  for (const request of [
    { version: 1, method: 'exec', params: {} }, { version: 2, method: 'state', params: {} },
    { version: 1, method: 'state', params: { root: '/other' } },
    { version: 1, method: 'state', params: {}, secret: 'a private secret' },
    { version: 1, method: 'import', params: { label: '../escape' }, secret: 'a private secret' },
  ]) await assert.rejects(dispatch(request, { manager: {} }));
});

test('RPC wire errors never echo the key or raw server exception', async () => {
  const input = new PassThrough(), output = new PassThrough(); let wire = '';
  output.on('data', c => { wire += c; });
  const running = serve({ input, output, manager: { importCurrent: async () => { throw new Error('the-private-secret raw account token'); } } });
  input.write(JSON.stringify({ version: 1, method: 'import', params: { label: 'work' }, secret: 'the-private-secret' }) + '\n');
  await running;
  assert.ok(!wire.includes('the-private-secret')); assert.ok(!wire.includes('raw account token'));
  assert.equal(JSON.parse(wire).error.code, 'OPERATION_FAILED');
});

test('device event and remote-error validation reject unsafe URLs and response text', () => {
  assert.throws(() => sanitizeEvent({ kind: 'device-code', verificationUrl: 'https://evil.example/login', userCode: 'ABCD-1234' }));
  assert.deepEqual(sanitizeEvent({ kind: 'device-code', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234' }), { kind: 'device-code', verificationUrl: 'https://auth.openai.com/codex/device', userCode: 'ABCD-1234' });
  assert.ok(!serverError({ code: 'BUSY', message: 'raw secret' }).message.includes('raw secret'));
});

test('RPC accepts only one bounded request per connection', async () => {
  const input = new PassThrough(), output = new PassThrough(); let wire = '';
  output.on('data', c => { wire += c; });
  const running = serve({ input, output, manager: {} });
  input.write('x'.repeat(65537)); await running;
  assert.equal(JSON.parse(wire).error.code, 'ARGUMENTS');
});

test('vault unlocking verifies credentials without returning decrypted vault contents', async () => {
  let verified = false;
  const manager = { load: async secret => { assert.equal(secret, 'synthetic vault passphrase'); verified = true; return { auth: 'NEVER-RETURN-THIS' }; }, cached: async () => state };
  const result = await dispatch({ version: 1, method: 'unlock', params: {}, secret: 'synthetic vault passphrase' }, { manager });
  assert.equal(verified, true); assert.ok(!JSON.stringify(result).includes('NEVER-RETURN-THIS')); assert.ok(!JSON.stringify(result).includes('DO-NOT-LEAK'));
});
