const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function safeErrorMessage(error) {
  const message = error?.message || String(error || 'Unknown update error');
  return message.replace(/https?:\/\/\S+/gi, '[update service]').slice(0, 240);
}

function createAutoUpdater({ supported, packaged, onStatus }) {
  const enabled = Boolean(supported && packaged);
  let updater = null;
  let checkPromise = null;
  let checkTimer = null;
  let status = {
    supported: Boolean(supported),
    enabled,
    state: enabled ? 'idle' : 'unsupported',
    currentVersion: null,
    availableVersion: null,
    percent: null,
    checkedAt: null,
    error: null,
  };

  const publish = () => {
    onStatus?.({ ...status });
  };

  const setStatus = (changes) => {
    status = { ...status, ...changes };
    publish();
    return status;
  };

  if (!enabled) {
    publish();
    return {
      getStatus: () => ({ ...status }),
      checkForUpdates: async () => ({ ...status }),
      downloadUpdate: async () => ({ ...status }),
      installUpdate: () => ({ ...status }),
      dispose: () => {},
    };
  }

  ({ autoUpdater: updater } = require('electron-updater'));
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;
  updater.allowDowngrade = false;
  status.currentVersion = require('electron').app.getVersion();

  updater.on('checking-for-update', () => {
    setStatus({ state: 'checking', error: null, percent: null });
  });
  updater.on('update-available', (info = {}) => {
    setStatus({
      state: 'available',
      availableVersion: info.version || null,
      error: null,
      percent: 0,
      checkedAt: new Date().toISOString(),
    });
  });
  updater.on('update-not-available', () => {
    setStatus({ state: 'up-to-date', availableVersion: null, error: null, percent: null, checkedAt: new Date().toISOString() });
  });
  updater.on('download-progress', (progress = {}) => {
    setStatus({ state: 'downloading', percent: Number.isFinite(Number(progress.percent)) ? Number(progress.percent) : null, error: null });
  });
  updater.on('update-downloaded', (info = {}) => {
    setStatus({
      state: 'downloaded',
      availableVersion: info.version || status.availableVersion,
      percent: 100,
      error: null,
    });
  });
  updater.on('error', (error) => {
    setStatus({ state: 'error', error: safeErrorMessage(error), percent: null, checkedAt: new Date().toISOString() });
  });

  const checkForUpdates = async () => {
    if (checkPromise) return checkPromise;
    checkPromise = updater.checkForUpdates()
      .then(() => ({ ...status }))
      .catch((error) => {
        setStatus({ state: 'error', error: safeErrorMessage(error), percent: null, checkedAt: new Date().toISOString() });
        return { ...status };
      })
      .finally(() => { checkPromise = null; });
    return checkPromise;
  };

  const downloadUpdate = async () => {
    if (status.state !== 'available') return { ...status };
    setStatus({ state: 'downloading', percent: 0, error: null });
    try {
      await updater.downloadUpdate();
    } catch (error) {
      setStatus({ state: 'error', error: safeErrorMessage(error), percent: null });
    }
    return { ...status };
  };

  const installUpdate = () => {
    if (status.state !== 'downloaded') return { ...status };
    updater.quitAndInstall();
    return { ...status };
  };

  checkTimer = setInterval(() => { checkForUpdates().catch(() => {}); }, UPDATE_CHECK_INTERVAL_MS);
  checkTimer.unref?.();

  return {
    getStatus: () => ({ ...status }),
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    dispose: () => { if (checkTimer) clearInterval(checkTimer); },
  };
}

module.exports = { createAutoUpdater, safeErrorMessage };
