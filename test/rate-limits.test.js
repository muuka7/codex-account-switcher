const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeError,
  publicRateLimitState,
  snapshotFromResult,
} = require('../src/rate-limits');

test('converts used percentages into remaining five-hour and weekly capacity', () => {
  const snapshot = snapshotFromResult({
    rateLimits: {
      primary: { usedPercent: 43, windowDurationMins: 300, resetsAt: 1788114798 },
      secondary: { usedPercent: 24, windowDurationMins: 10080, resetsAt: 1788643407 },
      rateLimitReachedType: null,
    },
  }, '2026-08-30T15:00:00.000Z');

  assert.equal(snapshot.fiveHour.remainingPercent, 57);
  assert.equal(snapshot.weekly.remainingPercent, 76);
  assert.equal(snapshot.fiveHour.resetsAt, 1788114798);
});

test('uses the codex multi-bucket view and identifies windows by duration', () => {
  const snapshot = snapshotFromResult({
    rateLimits: { primary: { usedPercent: 99, windowDurationMins: 15, resetsAt: 1 } },
    rateLimitsByLimitId: {
      codex_other: { primary: { usedPercent: 80, windowDurationMins: 60, resetsAt: 2 } },
      codex: {
        primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 3 },
        secondary: { usedPercent: 20, windowDurationMins: 10080, resetsAt: 4 },
      },
    },
  });

  assert.equal(snapshot.fiveHour.remainingPercent, 90);
  assert.equal(snapshot.weekly.remainingPercent, 80);
});

test('does not mislabel an unknown window as the five-hour limit', () => {
  const snapshot = snapshotFromResult({
    rateLimits: { primary: { usedPercent: 25, windowDurationMins: 15, resetsAt: 1 } },
  });

  assert.equal(snapshot.fiveHour, null);
  assert.equal(snapshot.weekly, null);
});

test('marks old cached snapshots stale without discarding their values', () => {
  const state = publicRateLimitState({
    accounts: {
      account_1: {
        status: 'fresh',
        checkedAt: '2026-08-30T10:00:00.000Z',
        fiveHour: { usedPercent: 40, remainingPercent: 60, windowDurationMins: 300, resetsAt: 10 },
      },
    },
  }, {
    accountIds: ['account_1'],
    now: Date.parse('2026-08-30T11:00:00.000Z'),
  });

  assert.equal(state.accounts.account_1.status, 'stale');
  assert.equal(state.accounts.account_1.fiveHour.remainingPercent, 60);
});

test('redacts unexpected failures into a stable UI error', () => {
  const error = normalizeError(new Error('secret path and process details'));
  assert.deepEqual(error, {
    code: 'USAGE_CHECK_FAILED',
    message: 'Usage could not be refreshed. Try again.',
  });
});
