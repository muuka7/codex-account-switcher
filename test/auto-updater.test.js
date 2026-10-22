const test = require('node:test');
const assert = require('node:assert/strict');
const { createAutoUpdater, safeErrorMessage } = require('../src/auto-updater');

test('auto updater stays inert outside a packaged macOS build', async () => {
  const statuses = [];
  const updater = createAutoUpdater({ supported: false, packaged: true, onStatus: (status) => statuses.push(status) });

  assert.equal(updater.getStatus().state, 'unsupported');
  assert.equal((await updater.checkForUpdates()).state, 'unsupported');
  assert.equal(statuses.length, 1);
  updater.dispose();
});

test('auto updater error messages do not expose update URLs', () => {
  const message = safeErrorMessage(new Error('Request failed: https://example.test/private-token'));
  assert.equal(message, 'Request failed: [update service]');
});
