const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chooseHandoff,
  isFiveHourExhausted,
  normalizeHandoffSettings,
} = require('../src/handoff-policy');

const now = Date.parse('2026-08-31T10:00:00.000Z');
const accounts = [{ id: 'personal' }, { id: 'work' }, { id: 'reserve' }];

function snapshot(fiveHour, weekly, extra = {}) {
  return {
    status: 'fresh',
    confirmedAt: new Date(now - 60_000).toISOString(),
    fiveHour: { remainingPercent: fiveHour },
    weekly: { remainingPercent: weekly },
    rateLimitReachedType: null,
    ...extra,
  };
}

function settings(overrides = {}) {
  return {
    enabled: true,
    reservePercent: 10,
    cooldownMinutes: 30,
    accounts: {
      personal: { enabled: true, group: 'Personal' },
      work: { enabled: true, group: 'Personal' },
      reserve: { enabled: true, group: 'Personal' },
    },
    ...overrides,
  };
}

test('requires a recent confirmed reading before treating the five-hour limit as exhausted', () => {
  assert.equal(isFiveHourExhausted(snapshot(0, 80), now), true);
  assert.equal(isFiveHourExhausted({ ...snapshot(0, 80), confirmedAt: null }, now), false);
  assert.equal(isFiveHourExhausted(snapshot(null, 80), now), false);
  assert.equal(isFiveHourExhausted({ ...snapshot(50, 80), rateLimitReachedType: 'primary' }, now), true);
});

test('selects the eligible same-group account with the most short-window capacity', () => {
  const result = chooseHandoff({
    accounts,
    activeId: 'personal',
    rateLimits: {
      personal: snapshot(0, 80),
      work: snapshot(45, 90),
      reserve: snapshot(75, 40),
    },
    settings: settings(),
    journal: {},
    now,
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.targetId, 'reserve');
});

test('does not cross continuity groups or use an account below reserve', () => {
  const result = chooseHandoff({
    accounts,
    activeId: 'personal',
    rateLimits: {
      personal: snapshot(0, 80),
      work: snapshot(9, 90),
      reserve: snapshot(90, 90),
    },
    settings: settings({
      accounts: {
        personal: { enabled: true, group: 'Personal' },
        work: { enabled: true, group: 'Personal' },
        reserve: { enabled: true, group: 'Company' },
      },
    }),
    journal: {},
    now,
  });
  assert.deepEqual(result, { status: 'blocked', reason: 'noEligibleDestination' });
});

test('respects cooldown and an existing handoff', () => {
  const input = {
    accounts,
    activeId: 'personal',
    rateLimits: { personal: snapshot(0, 80), work: snapshot(50, 80), reserve: snapshot(40, 80) },
    settings: settings(),
    now,
  };
  assert.equal(chooseHandoff({ ...input, journal: { phase: 'queued' } }).reason, 'handoffInProgress');
  assert.equal(chooseHandoff({ ...input, journal: { lastCompletedAt: new Date(now - 5 * 60_000).toISOString() } }).reason, 'cooldown');
});

test('weekly exhaustion does not trigger a handoff and weekly-exhausted targets are ineligible', () => {
  const base = {
    accounts,
    activeId: 'personal',
    settings: settings(),
    journal: {},
    now,
  };
  assert.equal(chooseHandoff({
    ...base,
    rateLimits: { personal: snapshot(40, 0), work: snapshot(80, 80), reserve: snapshot(70, 70) },
  }).reason, 'sourceNotExhausted');
  assert.equal(chooseHandoff({
    ...base,
    rateLimits: { personal: snapshot(0, 60), work: snapshot(80, 0), reserve: snapshot(70, 0) },
  }).reason, 'noEligibleDestination');
});

test('normalizes account policies without carrying removed accounts', () => {
  const normalized = normalizeHandoffSettings(settings(), ['personal', 'work']);
  assert.deepEqual(Object.keys(normalized.accounts), ['personal', 'work']);
  assert.equal(normalized.continuationMode, 'reopen_only');
});
