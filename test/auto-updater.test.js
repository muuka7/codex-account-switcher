const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
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

test('checks never download automatically and installation requires a completed explicit download', async () => {
  const service = new EventEmitter();
  let downloads = 0, installs = 0;
  service.checkForUpdates = async () => service.emit('update-available', { version: '0.2.3' });
  service.downloadUpdate = async () => { downloads++; service.emit('update-downloaded', { version: '0.2.3' }); };
  service.quitAndInstall = () => { installs++; };
  const updater = createAutoUpdater({ supported: true, packaged: true, updater: service, currentVersion: '0.2.2' });
  try {
    updater.installUpdate();
    assert.equal(installs, 0);
    await updater.checkForUpdates();
    assert.equal(downloads, 0);
    assert.equal(service.autoDownload, false);
    assert.equal(service.autoInstallOnAppQuit, false);
    assert.equal(service.allowDowngrade, false);
    await updater.downloadUpdate();
    assert.equal(downloads, 1);
    assert.equal(installs, 0);
    updater.installUpdate();
    assert.equal(installs, 1);
  } finally { updater.dispose(); }
});
