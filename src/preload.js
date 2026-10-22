const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexSwitcher', Object.freeze({
  getState: () => ipcRenderer.invoke('state:get'),
  getLiveAccount: () => ipcRenderer.invoke('state:live'),
  importCurrent: (name) => ipcRenderer.invoke('account:import-current', name),
  prepareNewAccount: () => ipcRenderer.invoke('account:prepare-new'),
  prepareReauth: (id) => ipcRenderer.invoke('account:prepare-reauth', id),
  completeReauth: () => ipcRenderer.invoke('account:complete-reauth'),
  cancelPendingLogin: () => ipcRenderer.invoke('account:cancel-pending'),
  switchAccount: (id) => ipcRenderer.invoke('account:switch', id),
  onStateUpdated: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('state:updated', listener);
    return () => ipcRenderer.removeListener('state:updated', listener);
  },
  removeAccount: (id) => ipcRenderer.invoke('account:remove', id),
  setAccountShortcut: (id, accelerator) => ipcRenderer.invoke('account:set-shortcut', id, accelerator),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (changes) => ipcRenderer.invoke('settings:set', changes),
  getUsage: () => ipcRenderer.invoke('usage:get'),
  clearUsage: () => ipcRenderer.invoke('usage:clear'),
  getRateLimits: () => ipcRenderer.invoke('rate-limits:get'),
  refreshRateLimits: () => ipcRenderer.invoke('rate-limits:refresh'),
  onRateLimitsUpdated: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('rate-limits:updated', listener);
    return () => ipcRenderer.removeListener('rate-limits:updated', listener);
  },
  getHandoff: () => ipcRenderer.invoke('handoff:get'),
  cancelHandoff: () => ipcRenderer.invoke('handoff:cancel'),
  acknowledgeHandoff: () => ipcRenderer.invoke('handoff:acknowledge'),
  onHandoffUpdated: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('handoff:updated', listener);
    return () => ipcRenderer.removeListener('handoff:updated', listener);
  },
  openCodex: () => ipcRenderer.invoke('codex:open'),
  openStoreFolder: () => ipcRenderer.invoke('folder:open-store'),
  getUpdateStatus: () => ipcRenderer.invoke('update:get'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateStatus: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update:status', listener);
    return () => ipcRenderer.removeListener('update:status', listener);
  },
}));
