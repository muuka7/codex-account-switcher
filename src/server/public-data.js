const { allBucketsFromResult } = require('../rate-limits');

function text(value, max = 320) {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, max) : null;
}
function publicIdentity(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  return { accountId: text(value.accountId, 200), email: text(value.email), planType: text(value.planType, 80) };
}
function publicUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const buckets = {};
  for (const b of Array.isArray(value.buckets) ? value.buckets.slice(0, 100) : []) {
    const id = text(b?.id, 120); if (!id) continue;
    Object.defineProperty(buckets, id, { value: { limitId: id, limitName: text(b.name, 120), primary: b.primary, secondary: b.secondary, rateLimitReachedType: text(b.reached, 80) }, enumerable: true });
  }
  const checkedAt = typeof value.checkedAt === 'string' && Number.isFinite(Date.parse(value.checkedAt)) ? value.checkedAt : null;
  return { checkedAt, buckets: allBucketsFromResult({ rateLimitsByLimitId: buckets }), stale: !checkedAt || Date.now() - Date.parse(checkedAt) > 30 * 60 * 1000, error: value.error ? 'Usage could not be refreshed. The last reading may be stale.' : null };
}
function publicState(value = {}) {
  if (!value || typeof value !== 'object') value = {};
  return {
    version: 1, host: text(value.host), codexHome: text(value.codexHome, 1000), recoveryRequired: value.recoveryRequired === true,
    accounts: (Array.isArray(value.accounts) ? value.accounts : []).filter(a => a && typeof a === 'object').slice(0, 100).map(a => ({ id: text(a.id, 100), label: text(a.label, 64), identity: publicIdentity(a.identity), savedAt: text(a.savedAt, 80), usage: publicUsage(a.usage), isSelected: a.isSelected === true })),
  };
}
module.exports = { text, publicIdentity, publicUsage, publicState };
