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
  removeAccount: (id) => ipcRenderer.invoke('account:remove', id),
  setAccountShortcut: (id, accelerator) => ipcRenderer.invoke('account:set-shortcut', id, accelerator),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (changes) => ipcRenderer.invoke('settings:set', changes),
  getUsage: () => ipcRenderer.invoke('usage:get'),
  clearUsage: () => ipcRenderer.invoke('usage:clear'),
  openCodex: () => ipcRenderer.invoke('codex:open'),
  openStoreFolder: () => ipcRenderer.invoke('folder:open-store'),
}));
