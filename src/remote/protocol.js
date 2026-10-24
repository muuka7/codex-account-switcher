const { publicState, publicUsage, text } = require('../server/public-data');
const { publicError } = require('../server/errors');

const methods = new Set(['doctor', 'state', 'live', 'unlock', 'import', 'refresh', 'switch', 'recover', 'login', 'reauth']);
function validateRequest(method, params, secret) {
  if (!methods.has(method) || !params || typeof params !== 'object' || Array.isArray(params) || Object.keys(params).some(k => k !== 'label')) throw new Error('Invalid remote request.');
  if (['import', 'switch', 'login', 'reauth'].includes(method) && !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(params.label || '')) throw new Error('Use a short account label containing letters, digits, dots, underscores or hyphens.');
  if (!['import', 'switch', 'login', 'reauth'].includes(method) && Object.keys(params).length) throw new Error('This request does not accept account parameters.');
  if (['doctor', 'state', 'live'].includes(method) && secret !== undefined) throw new Error('Read requests do not accept a vault key.');
  if (!['doctor', 'state', 'live'].includes(method) && secret === undefined) throw new Error('A remote vault key is required.');
  if (secret !== undefined && (typeof secret !== 'string' || secret.length < 12 || secret.length > 1024)) throw new Error('Invalid remote vault key.');
}
function sanitizeResult(method, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid server response.');
  if (method === 'doctor') return {
    protocol: result.protocol === 1 ? 1 : null, host: text(result.host), platform: text(result.platform, 20),
    installationId: /^[a-f0-9-]{36}$/.test(result.installationId || '') ? result.installationId : null,
    helperVersion: text(result.helperVersion, 40), codexVersion: text(result.codexVersion, 80),
    codexHome: text(result.codexHome, 1000), root: text(result.root, 1000),
    vaultExists: result.vaultExists === true, fileStoreReady: result.fileStoreReady === true,
    running: (Array.isArray(result.running) ? result.running : []).slice(0, 200).filter(p => Number.isSafeInteger(p.pid) && p.pid > 0).map(p => ({ pid: p.pid, name: text(p.name, 80) })),
  };
  if (method === 'live') return { ...publicUsage(result), account: result.account ? { id: text(result.account.id, 200), email: text(result.account.email), planType: text(result.account.planType, 80) } : null, scope: 'existing-daemon', note: 'Other independently launched Codex processes may use a different account.' };
  return publicState(result);
}
function sanitizeEvent(event) {
  if (event?.kind !== 'device-code' || event.verificationUrl !== 'https://auth.openai.com/codex/device' || !/^[A-Za-z0-9-]{4,32}$/.test(event.userCode || '')) throw new Error('Invalid device login event.');
  return { kind: 'device-code', verificationUrl: event.verificationUrl, userCode: event.userCode };
}
function serverError(value) {
  const safe = publicError({ code: value?.code });
  return Object.assign(new Error(safe.message), { code: safe.code });
}
module.exports = { validateRequest, sanitizeResult, sanitizeEvent, serverError };
