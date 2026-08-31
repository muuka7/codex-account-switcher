function publishState(mainWindow, state) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return false;
  mainWindow.webContents.send('state:updated', state);
  return true;
}

module.exports = { publishState };
