const CONFIRMED_SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
const ACTIVE_PHASES = new Set(['queued', 'switching', 'verifying']);

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function cleanGroup(value) {
  return String(value || '').trim().slice(0, 60);
}

function normalizeHandoffSettings(value, accountIds = null) {
  const raw = value && typeof value === 'object' ? value : {};
  const rawAccounts = raw.accounts && typeof raw.accounts === 'object' ? raw.accounts : {};
  const ids = Array.isArray(accountIds) ? accountIds : Object.keys(rawAccounts);
  const accounts = {};
  for (const accountId of ids) {
    const policy = rawAccounts[accountId] && typeof rawAccounts[accountId] === 'object' ? rawAccounts[accountId] : {};
    accounts[accountId] = {
      enabled: Boolean(policy.enabled),
      group: cleanGroup(policy.group),
    };
  }
  return {
    enabled: Boolean(raw.enabled),
    reservePercent: clampNumber(raw.reservePercent, 10, 1, 50),
    cooldownMinutes: clampNumber(raw.cooldownMinutes, 30, 5, 1440),
    continuationMode: 'reopen_only',
    accounts,
  };
}

function normalizeHandoffJournal(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const phases = new Set(['idle', 'queued', 'switching', 'verifying', 'continuationReady', 'completed', 'cancelled', 'failed']);
  return {
    version: 1,
    id: typeof raw.id === 'string' ? raw.id : null,
    phase: phases.has(raw.phase) ? raw.phase : 'idle',
    sourceId: typeof raw.sourceId === 'string' ? raw.sourceId : null,
    targetId: typeof raw.targetId === 'string' ? raw.targetId : null,
    trigger: raw.trigger === 'fiveHourExhausted' ? raw.trigger : null,
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : null,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    completedAt: typeof raw.completedAt === 'string' ? raw.completedAt : null,
    lastCompletedAt: typeof raw.lastCompletedAt === 'string' ? raw.lastCompletedAt : null,
    errorCode: typeof raw.errorCode === 'string' ? raw.errorCode : null,
    message: typeof raw.message === 'string' ? raw.message.slice(0, 240) : null,
  };
}

function isConfirmedFresh(snapshot, now = Date.now()) {
  if (!snapshot || snapshot.status !== 'fresh' || !snapshot.confirmedAt) return false;
  const confirmedAt = Date.parse(snapshot.confirmedAt);
  return Number.isFinite(confirmedAt) && now - confirmedAt >= 0 && now - confirmedAt <= CONFIRMED_SNAPSHOT_MAX_AGE_MS;
}

function isFiveHourExhausted(snapshot, now = Date.now()) {
  if (!isConfirmedFresh(snapshot, now)) return false;
  const rawRemaining = snapshot.fiveHour?.remainingPercent;
  const remaining = Number(rawRemaining);
  if (rawRemaining !== null && rawRemaining !== undefined && Number.isFinite(remaining) && remaining <= 0) return true;
  return /primary|short|five.?hour/i.test(String(snapshot.rateLimitReachedType || ''));
}

function targetCapacity(snapshot, reservePercent, now) {
  if (!isConfirmedFresh(snapshot, now)) return null;
  const fiveHour = Number(snapshot.fiveHour?.remainingPercent);
  const weekly = Number(snapshot.weekly?.remainingPercent);
  if (!Number.isFinite(fiveHour) || !Number.isFinite(weekly)) return null;
  if (fiveHour < reservePercent || weekly <= 0) return null;
  return { fiveHour, weekly };
}

function chooseHandoff({ accounts = [], activeId, rateLimits = {}, settings, journal, now = Date.now() }) {
  const policy = normalizeHandoffSettings(settings, accounts.map((account) => account.id));
  const history = normalizeHandoffJournal(journal);
  if (!policy.enabled) return { status: 'blocked', reason: 'disabled' };
  if (ACTIVE_PHASES.has(history.phase)) return { status: 'blocked', reason: 'handoffInProgress' };

  const source = accounts.find((account) => account.id === activeId);
  if (!source) return { status: 'blocked', reason: 'activeAccountUnknown' };
  const sourcePolicy = policy.accounts[source.id];
  if (!sourcePolicy?.enabled || !sourcePolicy.group) return { status: 'blocked', reason: 'sourceNotEligible' };
  if (!isFiveHourExhausted(rateLimits[source.id], now)) return { status: 'blocked', reason: 'sourceNotExhausted' };

  const lastCompletedAt = Date.parse(history.lastCompletedAt || '');
  if (Number.isFinite(lastCompletedAt) && now - lastCompletedAt < policy.cooldownMinutes * 60 * 1000) {
    return { status: 'blocked', reason: 'cooldown' };
  }

  const candidates = accounts.flatMap((account, order) => {
    if (account.id === source.id) return [];
    const accountPolicy = policy.accounts[account.id];
    if (!accountPolicy?.enabled || accountPolicy.group !== sourcePolicy.group) return [];
    const capacity = targetCapacity(rateLimits[account.id], policy.reservePercent, now);
    return capacity ? [{ account, capacity, order }] : [];
  });
  candidates.sort((left, right) => (
    right.capacity.fiveHour - left.capacity.fiveHour
    || right.capacity.weekly - left.capacity.weekly
    || left.order - right.order
  ));
  if (!candidates.length) return { status: 'blocked', reason: 'noEligibleDestination' };

  return {
    status: 'ready',
    trigger: 'fiveHourExhausted',
    sourceId: source.id,
    targetId: candidates[0].account.id,
    capacity: candidates[0].capacity,
    group: sourcePolicy.group,
  };
}

module.exports = {
  ACTIVE_PHASES,
  CONFIRMED_SNAPSHOT_MAX_AGE_MS,
  chooseHandoff,
  isConfirmedFresh,
  isFiveHourExhausted,
  normalizeHandoffJournal,
  normalizeHandoffSettings,
};
