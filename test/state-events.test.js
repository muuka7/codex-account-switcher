const test = require('node:test');
const assert = require('node:assert/strict');
const { publishState } = require('../src/state-events');

test('publishes completed account state to a live renderer', () => {
  const calls = [];
  const window = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => false,
      send: (...args) => calls.push(args),
    },
  };
  const state = { activeId: 'account-two', accounts: [] };

  assert.equal(publishState(window, state), true);
  assert.deepEqual(calls, [['state:updated', state]]);
});

test('does not publish when the window is absent or destroyed', () => {
  assert.equal(publishState(null, {}), false);
  assert.equal(publishState({ isDestroyed: () => true }, {}), false);

  const calls = [];
  const window = {
    isDestroyed: () => false,
    webContents: {
      isDestroyed: () => true,
      send: (...args) => calls.push(args),
    },
  };

  assert.equal(publishState(window, {}), false);
  assert.deepEqual(calls, []);
});
