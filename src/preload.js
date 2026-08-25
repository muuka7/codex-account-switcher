const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexSwitcher', Object.freeze({
  getState: () => ipcRenderer.invoke('state:get'),
  importCurrent: (name) => ipcRenderer.invoke('account:import-current', name),
  switchAccount: (id) => ipcRenderer.invoke('account:switch', id),
  removeAccount: (id) => ipcRenderer.invoke('account:remove', id),
  openCodex: () => ipcRenderer.invoke('codex:open'),
  openStoreFolder: () => ipcRenderer.invoke('folder:open-store'),
}));
