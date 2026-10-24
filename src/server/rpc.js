const { ServerAccounts, validLabel } = require('./accounts');
const { publicError } = require('./errors');
const { publicState, publicUsage, text } = require('./public-data');
const { fail } = require('./security');

const PROTOCOL = 1;
const READ = new Set(['doctor', 'state', 'live']);
const MUTATE = new Set(['import', 'refresh', 'switch', 'recover', 'login', 'reauth']);

async function dispatch(request, { manager = new ServerAccounts(), event = () => {}, signal } = {}) {
  if (!request || request.version !== PROTOCOL) throw fail('PROTOCOL_MISMATCH', 'Unsupported helper protocol.');
  if (![...READ, ...MUTATE].includes(request.method) || !request.params || typeof request.params !== 'object' || Array.isArray(request.params)) throw fail('ARGUMENTS', 'Invalid RPC method or parameters.');
  if (Object.keys(request).some(k => !['version', 'method', 'params', 'secret'].includes(k)) || Object.keys(request.params).some(k => k !== 'label')) throw fail('ARGUMENTS', 'Unexpected RPC fields.');
  if (['import', 'switch', 'login', 'reauth'].includes(request.method)) validLabel(request.params.label);
  if (MUTATE.has(request.method) && (typeof request.secret !== 'string' || request.secret.length < 12 || request.secret.length > 1024)) throw fail('PASSPHRASE_REQUIRED', 'A vault key is required.');
  if (READ.has(request.method) && request.secret !== undefined) throw fail('ARGUMENTS', 'Read methods do not accept a secret.');
  switch (request.method) {
    case 'doctor': return { ...await manager.doctor(), protocol: PROTOCOL };
    case 'state': return publicState(await manager.cached());
    case 'live': {
      const result = await manager.live();
      return { ...publicUsage(result), account: result.account ? { id: text(result.account.id, 200), email: text(result.account.email), planType: text(result.account.planType, 80) } : null, scope: 'existing-daemon', note: 'Other Codex processes may use a different account.' };
    }
    case 'import': return publicState(await manager.importCurrent(request.params.label, request.secret));
    case 'refresh': return publicState(await manager.refresh(request.secret));
    case 'switch': return publicState(await manager.switchAccount(request.params.label, request.secret));
    case 'recover': return publicState(await manager.recover(request.secret));
    case 'login': return publicState(await manager.login(request.params.label, request.secret, { signal, onCode: code => event({ kind: 'device-code', ...code }) }));
    case 'reauth': return publicState(await manager.login(request.params.label, request.secret, { replace: true, signal, onCode: code => event({ kind: 'device-code', ...code }) }));
  }
}

function serve({ input = process.stdin, output = process.stdout, manager } = {}) {
  return new Promise(resolve => {
    const abort = new AbortController(); let buffer = '', started = false, done = false;
    const write = value => { if (!output.destroyed) output.write(`${JSON.stringify({ version: PROTOCOL, ...value })}\n`); };
    const finish = value => { if (done) return; done = true; write(value); input.off('data', data); input.off('end', disconnected); input.pause(); resolve(); };
    const disconnected = () => { abort.abort(); if (!started) finish({ type: 'error', error: publicError(fail('ARGUMENTS', 'Input ended before a request.')) }); };
    // A disconnected SSH client must cancel a pending device login; EPIPE is
    // expected here and must not crash the helper before its cleanup runs.
    output.on('error', disconnected);
    input.on('error', disconnected);
    const data = bytes => {
      if (started) { if (bytes.toString().trim()) abort.abort(); return; }
      buffer += bytes.toString('utf8');
      if (Buffer.byteLength(buffer) > 64 * 1024) return finish({ type: 'error', error: publicError(fail('ARGUMENTS', 'Request is too large.')) });
      const end = buffer.indexOf('\n'); if (end < 0) return;
      started = true;
      let request;
      try { if (buffer.slice(end + 1).trim()) throw new Error(); request = JSON.parse(buffer.slice(0, end)); }
      catch { return finish({ type: 'error', error: publicError(fail('ARGUMENTS', 'Invalid request.')) }); }
      buffer = '';
      dispatch(request, { manager, signal: abort.signal, event: event => write({ type: 'event', event }) })
        .then(result => finish({ type: 'result', result }), error => finish({ type: 'error', error: publicError(error) }))
        .finally(() => { if (request) delete request.secret; });
    };
    input.on('data', data); input.once('end', disconnected); input.resume();
  });
}
module.exports = { PROTOCOL, dispatch, serve };
