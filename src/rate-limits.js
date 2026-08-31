const FIVE_HOURS_MINS = 300;
const ONE_WEEK_MINS = 10080;
const CACHE_STALE_MS = 30 * 60 * 1000;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeWindow(window) {
  if (!window || typeof window !== 'object') return null;
  const usedPercent = finiteNumber(window.usedPercent);
  const windowDurationMins = finiteNumber(window.windowDurationMins);
  const resetsAt = finiteNumber(window.resetsAt);
  if (usedPercent === null || windowDurationMins === null) return null;
  return {
    usedPercent: Math.min(100, Math.max(0, usedPercent)),
    remainingPercent: Math.min(100, Math.max(0, 100 - usedPercent)),
    windowDurationMins,
    resetsAt,
  };
}

function bucketFromResult(result = {}) {
  const multi = result.rateLimitsByLimitId && typeof result.rateLimitsByLimitId === 'object'
    ? result.rateLimitsByLimitId
    : {};
  return multi.codex || result.rateLimits || Object.values(multi)[0] || null;
}

function snapshotFromResult(result, checkedAt = new Date().toISOString()) {
  const bucket = bucketFromResult(result);
  if (!bucket) throw Object.assign(new Error('Codex returned no usage-limit data.'), { code: 'RATE_LIMITS_EMPTY' });
  const windows = [normalizeWindow(bucket.primary), normalizeWindow(bucket.secondary)].filter(Boolean);
  return {
    status: 'fresh',
    checkedAt,
    confirmedAt: null,
    fiveHour: windows.find((window) => window.windowDurationMins === FIVE_HOURS_MINS) || null,
    weekly: windows.find((window) => window.windowDurationMins === ONE_WEEK_MINS) || null,
    rateLimitReachedType: bucket.rateLimitReachedType || null,
    error: null,
  };
}

function normalizeError(error) {
  const allowedCodes = new Set([
    'APP_SERVER_ERROR',
    'APP_SERVER_TIMEOUT',
    'APP_SERVER_START_FAILED',
    'APP_SERVER_EXITED',
    'RATE_LIMITS_READ_FAILED',
    'RATE_LIMITS_EMPTY',
    'RUNTIME_MISSING',
    'RUNTIME_UNSUPPORTED',
    'ACCOUNT_CREDENTIAL_MISSING',
    'ACCOUNT_IDENTITY_MISMATCH',
    'USAGE_CHECK_FAILED',
  ]);
  const code = allowedCodes.has(error?.code) ? error.code : 'USAGE_CHECK_FAILED';
  const messages = {
    RUNTIME_MISSING: 'Usage runtime unavailable. Reinstall or update the switcher.',
    RUNTIME_UNSUPPORTED: 'Usage checks are not supported on this device.',
    APP_SERVER_TIMEOUT: 'Usage check timed out. Try again.',
    APP_SERVER_START_FAILED: 'Usage runtime could not start.',
    APP_SERVER_EXITED: 'Usage runtime stopped before the check finished.',
    RATE_LIMITS_READ_FAILED: 'Codex could not read this account’s limits.',
    RATE_LIMITS_EMPTY: 'No five-hour or weekly limit data was returned.',
    ACCOUNT_CREDENTIAL_MISSING: 'The saved login is missing. Re-authenticate this account.',
    ACCOUNT_IDENTITY_MISMATCH: 'The refreshed login did not match this saved account.',
    USAGE_CHECK_FAILED: 'Usage could not be refreshed. Try again.',
  };
  return { code, message: messages[code] || messages.USAGE_CHECK_FAILED };
}

function normalizeAccountSnapshot(value) {
  const snapshot = value && typeof value === 'object' ? value : {};
  return {
    status: ['fresh', 'stale', 'refreshing', 'error'].includes(snapshot.status) ? snapshot.status : 'stale',
    checkedAt: typeof snapshot.checkedAt === 'string' ? snapshot.checkedAt : null,
    confirmedAt: typeof snapshot.confirmedAt === 'string' ? snapshot.confirmedAt : null,
    fiveHour: normalizeWindow(snapshot.fiveHour),
    weekly: normalizeWindow(snapshot.weekly),
    rateLimitReachedType: snapshot.rateLimitReachedType || null,
    error: snapshot.error && typeof snapshot.error === 'object'
      ? { code: String(snapshot.error.code || 'USAGE_CHECK_FAILED'), message: String(snapshot.error.message || 'Usage could not be refreshed.') }
      : null,
  };
}

function normalizeRateLimitCache(value) {
  const cache = value && typeof value === 'object' ? value : {};
  const accounts = {};
  if (cache.accounts && typeof cache.accounts === 'object') {
    for (const [accountId, snapshot] of Object.entries(cache.accounts)) {
      accounts[accountId] = normalizeAccountSnapshot(snapshot);
    }
  }
  return {
    version: 1,
    checkedAt: typeof cache.checkedAt === 'string' ? cache.checkedAt : null,
    confirmedAt: typeof cache.confirmedAt === 'string' ? cache.confirmedAt : null,
    confirmationPendingUntil: typeof cache.confirmationPendingUntil === 'string' ? cache.confirmationPendingUntil : null,
    accounts,
  };
}

function publicRateLimitState(cacheValue, { refreshing = false, now = Date.now(), accountIds = [] } = {}) {
  const cache = normalizeRateLimitCache(cacheValue);
  const accounts = {};
  for (const accountId of accountIds) {
    const snapshot = cache.accounts[accountId];
    if (!snapshot) {
      accounts[accountId] = { status: refreshing ? 'refreshing' : 'stale', checkedAt: null, confirmedAt: null, fiveHour: null, weekly: null, rateLimitReachedType: null, error: null };
      continue;
    }
    const checkedAtMs = Date.parse(snapshot.checkedAt || '');
    const stale = !Number.isFinite(checkedAtMs) || now - checkedAtMs > CACHE_STALE_MS;
    accounts[accountId] = {
      ...snapshot,
      status: refreshing ? 'refreshing' : snapshot.error ? 'error' : stale ? 'stale' : snapshot.status,
    };
  }
  return {
    refreshing,
    checkedAt: cache.checkedAt,
    confirmedAt: cache.confirmedAt,
    confirmationPendingUntil: cache.confirmationPendingUntil,
    accounts,
  };
}

module.exports = {
  CACHE_STALE_MS,
  FIVE_HOURS_MINS,
  ONE_WEEK_MINS,
  normalizeError,
  normalizeRateLimitCache,
  publicRateLimitState,
  snapshotFromResult,
};
