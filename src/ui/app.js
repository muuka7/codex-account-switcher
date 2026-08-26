const accountsEl = document.getElementById('accounts');
const emptyEl = document.getElementById('empty');
const countEl = document.getElementById('count');
const alertsEl = document.getElementById('alerts');
const progressEl = document.getElementById('progress');
const pendingEl = document.getElementById('pending');
const pendingTitle = document.getElementById('pending-title');
const pendingMessage = document.getElementById('pending-message');
const pendingComplete = document.getElementById('pending-complete');
const pendingResume = document.getElementById('pending-resume');
const pendingCancel = document.getElementById('pending-cancel');
const addAccountBtn = document.getElementById('add-account');
const liveCard = document.getElementById('live-card');
const saveDialog = document.getElementById('save-dialog');
const saveName = document.getElementById('save-name');
const saveConfirm = document.getElementById('save-confirm');
const addDialog = document.getElementById('add-dialog');
const addStepOne = document.getElementById('add-step-1');
const addStepTwo = document.getElementById('add-step-2');
const stepOne = document.getElementById('step-1');
const stepTwo = document.getElementById('step-2');
const addDetected = document.getElementById('add-detected');
const addDetectedText = document.getElementById('add-detected-text');
const addWaiting = document.getElementById('add-waiting');
const addName = document.getElementById('add-name');
const addPrepare = document.getElementById('add-prepare');
const addImport = document.getElementById('add-import');
const addCancel = document.getElementById('add-cancel');
const addCancelPending = document.getElementById('add-cancel-pending');
const confirmDialog = document.getElementById('confirm-dialog');
const confirmIcon = document.getElementById('confirm-icon');
const confirmTitle = document.getElementById('confirm-title');
const confirmMessage = document.getElementById('confirm-message');
const confirmAccept = document.getElementById('confirm-accept');
const confirmCancel = document.getElementById('confirm-cancel');
const shortcutDialog = document.getElementById('shortcut-dialog');
const shortcutTitle = document.getElementById('shortcut-title');
const shortcutCapture = document.getElementById('shortcut-capture');
const shortcutDisplay = document.getElementById('shortcut-display');
const shortcutError = document.getElementById('shortcut-error');
const shortcutSave = document.getElementById('shortcut-save');
const shortcutCancel = document.getElementById('shortcut-cancel');
const settingsSheet = document.getElementById('settings-sheet');
const themeSeg = document.getElementById('theme-seg');
const shortcutRows = document.getElementById('shortcut-rows');
const presetsEl = document.getElementById('presets');
const rememberWindowSize = document.getElementById('remember-window-size');
const lastWindowSize = document.getElementById('last-window-size');
const launchOnLogin = document.getElementById('launch-on-login');
const usageTracking = document.getElementById('usage-tracking');
const usageSummary = document.getElementById('usage-summary');
const clearUsageBtn = document.getElementById('clear-usage');

let currentState = null;
let settingsState = null;
let shortcutAccountId = null;
let shortcutDraft = '';
let confirmationResolver = null;
let accountMenu = null;

function setBusy() { progressEl.hidden = false; }
function setReady() { progressEl.hidden = true; }
function clearAlerts() { alertsEl.replaceChildren(); }
function showAlert(message, tone = 'error') {
  const notice = document.createElement('section');
  notice.className = `notice notice-${tone}`;
  const icon = document.createElement('span');
  icon.className = 'notice-icon';
  icon.innerHTML = codexIcon(tone === 'error' ? 'alert' : tone === 'ok' ? 'check' : 'info');
  const body = document.createElement('div');
  body.className = 'notice-body';
  const text = document.createElement('p');
  text.textContent = message;
  body.append(text);
  notice.append(icon, body);
  alertsEl.replaceChildren(notice);
}
function applyStateMessage(state) {
  clearAlerts();
  if (state.warning) showAlert(state.warning, 'warn');
  else if (state.configCompatibility?.changed) showAlert('Credential storage was secured and backed up.', 'ok');
}
function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0]?.slice(0, 2) || '—').toUpperCase();
}
function prettyShortcut(value = '') {
  return value.split('+').filter(Boolean).map((part) => ({ Control: 'Ctrl', Command: '⌘', Super: 'Win', Shift: 'Shift', Alt: 'Alt', Space: 'Space' })[part] || part).join(' + ');
}
function fallbackShortcut(position) { return `Control+Alt+${position + 1}`; }
function formatRelative(value) {
  if (!value) return 'No sign-in recorded';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'No sign-in recorded';
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}
function healthCopy(account) {
  const health = account.health || { label: 'Unknown', updatedAt: null };
  return `${health.label} · ${formatRelative(health.updatedAt)}`;
}
function selectedAccount() { return currentState?.accounts.find((account) => account.isActive) || null; }

function closeAccountMenu() { accountMenu?.remove(); accountMenu = null; }
function openAccountMenu(account, anchor) {
  closeAccountMenu();
  accountMenu = document.createElement('div');
  accountMenu.className = 'menu';
  accountMenu.addEventListener('click', (event) => event.stopPropagation());
  const addItem = (label, icon, action, danger = false) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = danger ? 'danger' : '';
    button.innerHTML = `${codexIcon(icon)}<span>${label}</span>`;
    button.addEventListener('click', () => { closeAccountMenu(); action(); });
    accountMenu.append(button);
  };
  addItem('Re-authenticate', 'rotate', () => requestReauth(account));
  if (!account.isActive) addItem('Remove account', 'trash', () => requestRemove(account), true);
  document.body.append(accountMenu);
  const rect = anchor.getBoundingClientRect();
  accountMenu.style.top = `${Math.min(window.innerHeight - accountMenu.offsetHeight - 8, rect.bottom + 4)}px`;
  accountMenu.style.left = `${Math.max(8, rect.right - accountMenu.offsetWidth)}px`;
}

function accountRow(account, position) {
  const row = document.createElement('li');
  row.className = `acct${account.isActive ? ' is-active' : ''}${account.isPendingReauth ? ' is-pending' : ''}${account.isSelected ? ' is-selected' : ''}`;
  const select = document.createElement('button');
  select.className = 'acct-select';
  select.type = 'button';
  select.setAttribute('aria-label', `Select ${account.displayName}`);
  select.addEventListener('click', () => { currentState.accounts.forEach((item) => { item.isSelected = item.id === account.id; }); render(currentState); });
  const avatar = document.createElement('span');
  avatar.className = `avatar tone-${position % 4}`;
  avatar.textContent = initials(account.displayName);
  const copy = document.createElement('span');
  copy.className = 'acct-copy';
  const name = document.createElement('span');
  name.className = 'acct-name';
  const strong = document.createElement('strong');
  strong.textContent = account.displayName;
  const health = document.createElement('span');
  health.className = `health-dot ${account.health?.level || 'unknown'}`;
  health.title = healthCopy(account);
  health.setAttribute('aria-label', healthCopy(account));
  name.append(strong, health);
  const meta = document.createElement('span');
  meta.className = 'acct-meta';
  meta.textContent = [account.email || account.planType || 'Saved locally', healthCopy(account)].join(' · ');
  copy.append(name, meta);
  const shortcut = document.createElement('kbd');
  shortcut.className = 'acct-shortcut';
  shortcut.textContent = prettyShortcut(account.shortcut || fallbackShortcut(position));
  select.append(avatar, copy, shortcut);
  const actions = document.createElement('div');
  actions.className = 'acct-actions';
  if (!account.isActive || currentState.pendingLogin) {
    const switchButton = document.createElement('button');
    switchButton.className = 'btn btn-sm';
    switchButton.type = 'button';
    switchButton.innerHTML = `${codexIcon(account.isActive ? 'rotate' : 'arrow')}<span class="btn-label">${account.isActive ? 'Restore' : 'Switch'}</span>`;
    switchButton.addEventListener('click', () => requestSwitch(account));
    actions.append(switchButton);
  }
  const menuButton = document.createElement('button');
  menuButton.className = 'btn btn-icon acct-menu-button';
  menuButton.type = 'button';
  menuButton.setAttribute('aria-label', `More actions for ${account.displayName}`);
  menuButton.innerHTML = codexIcon('more');
  menuButton.addEventListener('click', (event) => { event.stopPropagation(); openAccountMenu(account, menuButton); });
  actions.append(menuButton);
  row.append(select, actions);
  return row;
}

function renderPending(state) {
  const pending = state.pendingLogin;
  pendingEl.hidden = !pending;
  pendingComplete.hidden = !pending || pending.mode !== 'reauth';
  pendingResume.hidden = !pending || pending.mode !== 'new';
  pendingCancel.hidden = !pending;
  if (!pending) return;
  pendingTitle.textContent = pending.mode === 'reauth' ? 'Waiting for re-authentication' : 'Waiting for new account sign-in';
  pendingMessage.textContent = pending.mode === 'reauth'
    ? `Sign in to ${pending.accountName || 'the selected account'} in Codex, then finish here.`
    : 'Sign in to the new account in Codex, then return here to save it.';
}
function render(state) {
  currentState = state;
  accountsEl.replaceChildren();
  state.accounts.forEach((account, position) => accountsEl.append(accountRow(account, position)));
  countEl.textContent = state.accounts.length ? String(state.accounts.length) : '';
  emptyEl.hidden = state.accounts.length > 0;
  addAccountBtn.disabled = Boolean(state.pendingLogin);
  renderPending(state);
}

function setConfirmIcon(danger = false) {
  confirmIcon.className = `dialog-icon${danger ? ' danger' : ''}`;
  confirmIcon.innerHTML = codexIcon(danger ? 'trash' : 'alert');
}
function askForConfirmation({ title, message, confirmLabel = 'Continue', danger = false }) {
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmAccept.textContent = confirmLabel;
  setConfirmIcon(danger);
  confirmDialog.hidden = false;
  confirmAccept.focus();
  return new Promise((resolve) => { confirmationResolver = resolve; });
}
function closeConfirmation(result) { confirmDialog.hidden = true; confirmationResolver?.(result); confirmationResolver = null; }
async function runConfirmed(config, action) { if (!(await askForConfirmation(config))) return; try { await action(); } catch (error) { showAlert(error?.message || String(error)); setReady(); } }
async function requestSwitch(account) {
  await runConfirmed({ title: `Switch to ${account.displayName}?`, message: 'Codex will close, swap the local encrypted credential, and reopen.', confirmLabel: 'Switch account' }, async () => { setBusy(); const next = await window.codexSwitcher.switchAccount(account.id); render(next); applyStateMessage(next); setReady(); });
}
async function requestReauth(account) {
  await runConfirmed({ title: `Re-authenticate ${account.displayName}?`, message: 'Codex will close and clear only its local login file so you can sign in again.', confirmLabel: 'Start re-authentication' }, async () => { setBusy(); const next = await window.codexSwitcher.prepareReauth(account.id); render(next); applyStateMessage(next); setReady(); });
}
async function requestRemove(account) {
  await runConfirmed({ title: `Remove ${account.displayName}?`, message: 'This deletes its encrypted saved snapshot from this device.', confirmLabel: 'Remove account', danger: true }, async () => { setBusy(); const next = await window.codexSwitcher.removeAccount(account.id); render(next); setReady(); });
}

function openSaveDialog() { saveDialog.hidden = false; saveName.value = ''; saveName.focus(); }
function closeSaveDialog() { saveDialog.hidden = true; }
async function saveCurrentAccount() {
  const displayName = saveName.value.trim();
  if (!displayName) { showAlert('Give this account a display name first.'); return; }
  await runConfirmed({ title: `Save ${displayName} locally?`, message: 'The current Codex login will be encrypted with your operating system account and stored on this device.', confirmLabel: 'Encrypt and save' }, async () => { setBusy(); const next = await window.codexSwitcher.importCurrent(displayName); closeSaveDialog(); render(next); applyStateMessage(next); setReady(); });
}
function setAddStep(step) {
  const naming = step === 2;
  addStepOne.hidden = naming; addStepTwo.hidden = !naming;
  stepOne.setAttribute('aria-current', naming ? 'false' : 'true'); stepTwo.setAttribute('aria-current', naming ? 'true' : 'false');
  if (naming) { addName.focus(); detectNewAccount(); }
}
function openAddDialog(resume = false) { addDialog.hidden = false; setAddStep(resume || currentState?.pendingLogin?.mode === 'new' ? 2 : 1); }
function closeAddDialog() { addDialog.hidden = true; }
async function prepareAddAccount() {
  await runConfirmed({ title: 'Open a new account sign-in?', message: 'Codex will close and clear only its local login file. Saved snapshots remain encrypted and unchanged.', confirmLabel: 'Open Codex sign-in' }, async () => { setBusy(); const next = await window.codexSwitcher.prepareNewAccount(); render(next); setAddStep(2); applyStateMessage(next); setReady(); });
}
async function importAddedAccount() {
  const displayName = addName.value.trim();
  if (!displayName) { showAlert('Give this account a display name first.'); return; }
  await runConfirmed({ title: `Save ${displayName} locally?`, message: 'The newly signed-in login will be encrypted and stored on this device.', confirmLabel: 'Save account' }, async () => { setBusy(); const next = await window.codexSwitcher.importCurrent(displayName); closeAddDialog(); render(next); applyStateMessage(next); setReady(); });
}
async function cancelPendingLogin() {
  await runConfirmed({ title: 'Cancel this sign-in flow?', message: 'The previously saved active account will be restored and Codex will reopen with that identity.', confirmLabel: 'Restore saved account' }, async () => { setBusy(); const next = await window.codexSwitcher.cancelPendingLogin(); closeAddDialog(); render(next); applyStateMessage(next); setReady(); });
}
async function completeReauth() {
  await runConfirmed({ title: 'Save refreshed credentials?', message: 'The signed-in identity will replace the saved encrypted snapshot.', confirmLabel: 'Save refreshed credentials' }, async () => { setBusy(); const next = await window.codexSwitcher.completeReauth(); render(next); applyStateMessage(next); setReady(); });
}
function detectNewAccount() { const pending = currentState?.pendingLogin?.mode === 'new'; addDetected.hidden = !pending; addWaiting.hidden = pending; if (pending) addDetectedText.textContent = 'Sign-in flow is ready to save.'; }

function renderThemes() {
  const current = localStorage.getItem('codex-theme') || 'system';
  themeSeg.replaceChildren();
  [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']].forEach(([id, label]) => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.setAttribute('aria-pressed', String(current === id));
    button.addEventListener('click', () => { localStorage.setItem('codex-theme', id); document.documentElement.dataset.theme = id === 'system' ? '' : id; renderThemes(); });
    themeSeg.append(button);
  });
}
function renderShortcuts(state) {
  shortcutRows.replaceChildren();
  if (!state.accounts.length) { const empty = document.createElement('div'); empty.className = 'shortcut-row'; empty.textContent = 'Save an account to customize its shortcut.'; shortcutRows.append(empty); return; }
  state.accounts.forEach((account, position) => {
    const row = document.createElement('div'); row.className = 'shortcut-row';
    const avatar = document.createElement('span'); avatar.className = `avatar tone-${position % 4}`; avatar.textContent = initials(account.displayName);
    const copy = document.createElement('span'); copy.className = 'acct-copy'; const name = document.createElement('strong'); name.textContent = account.displayName; copy.append(name);
    const key = document.createElement('kbd'); key.textContent = prettyShortcut(account.shortcut || fallbackShortcut(position));
    const edit = document.createElement('button'); edit.className = 'btn btn-sm'; edit.type = 'button'; edit.textContent = 'Edit'; edit.addEventListener('click', () => openShortcutDialog(account));
    row.append(avatar, copy, key, edit); shortcutRows.append(row);
  });
}
function renderPresets(settings) {
  presetsEl.replaceChildren();
  Object.entries(settings.windowPresets || {}).forEach(([id, preset]) => {
    const button = document.createElement('button'); button.className = 'preset'; button.type = 'button'; button.setAttribute('aria-pressed', String(id === settings.windowPreset));
    button.innerHTML = `<span class="glyph ${id}" aria-hidden="true"></span><strong>${preset.label}</strong><small>${preset.width} × ${preset.height}</small>`;
    button.addEventListener('click', () => setWindowPreset(id)); presetsEl.append(button);
  });
}
function renderSettings(settings) {
  settingsState = settings; renderPresets(settings); rememberWindowSize.checked = Boolean(settings.rememberLastWindowSize);
  lastWindowSize.textContent = settings.lastWindowSize ? `Last size ${settings.lastWindowSize.width} × ${settings.lastWindowSize.height}` : 'Resize the window to save it.';
  launchOnLogin.checked = Boolean(settings.launchOnLogin); renderThemes();
}
function renderUsage(usage) {
  usageTracking.checked = Boolean(usage.enabled);
  if (!usage.enabled) { usageSummary.textContent = 'Off · counts opens and switches locally'; clearUsageBtn.hidden = true; return; }
  usageSummary.textContent = `${usage.switchCount} switch${usage.switchCount === 1 ? '' : 'es'} · ${usage.openCount} open${usage.openCount === 1 ? '' : 's'}`;
  clearUsageBtn.hidden = !usage.hasData;
}
function defaultSettings() {
  return { windowPreset: 'standard', launchOnLogin: false, rememberLastWindowSize: false, lastWindowSize: null, usageTracking: false, windowPresets: { portrait: { label: 'Portrait', width: 420, height: 720 }, compact: { label: 'Compact', width: 800, height: 620 }, standard: { label: 'Standard', width: 980, height: 700 }, wide: { label: 'Wide', width: 1180, height: 780 } } };
}
function defaultUsage() { return { enabled: false, openCount: 0, switchCount: 0, importCount: 0, reauthCount: 0, hasData: false }; }
async function loadSettings() { try { return await window.codexSwitcher.getSettings(); } catch (error) { if (String(error).includes("No handler registered for 'settings:get'")) return defaultSettings(); throw error; } }
async function loadUsage() { try { return await window.codexSwitcher.getUsage(); } catch (error) { if (String(error).includes("No handler registered for 'usage:get'")) return defaultUsage(); throw error; } }
async function setWindowPreset(preset) { try { setBusy(); renderSettings(await window.codexSwitcher.setSettings({ windowPreset: preset })); setReady(); } catch (error) { showAlert(error?.message || String(error)); setReady(); } }
async function setRememberWindowSize(enabled) { try { setBusy(); renderSettings(await window.codexSwitcher.setSettings({ rememberLastWindowSize: enabled })); setReady(); } catch (error) { rememberWindowSize.checked = !enabled; showAlert(error?.message || String(error)); setReady(); } }
async function setLaunchOnLogin(enabled) { try { setBusy(); renderSettings(await window.codexSwitcher.setSettings({ launchOnLogin: enabled })); setReady(); } catch (error) { launchOnLogin.checked = !enabled; showAlert(error?.message || String(error)); setReady(); } }
async function setUsageTracking(enabled) { try { setBusy(); renderSettings(await window.codexSwitcher.setSettings({ usageTracking: enabled })); renderUsage(await loadUsage()); setReady(); } catch (error) { usageTracking.checked = !enabled; showAlert(error?.message || String(error)); setReady(); } }
async function clearUsage() { await runConfirmed({ title: 'Clear local usage history?', message: 'This removes only the switcher counters stored on this device. Account snapshots are not affected.', confirmLabel: 'Clear history', danger: true }, async () => { setBusy(); renderUsage(await window.codexSwitcher.clearUsage()); setReady(); }); }

function openShortcutDialog(account) { shortcutAccountId = account.id; shortcutDraft = account.shortcut || fallbackShortcut(currentState.accounts.indexOf(account)); shortcutTitle.textContent = `Shortcut for ${account.displayName}`; shortcutDisplay.textContent = prettyShortcut(shortcutDraft); shortcutError.hidden = true; shortcutDialog.hidden = false; shortcutCapture.focus(); }
function closeShortcutDialog() { shortcutDialog.hidden = true; shortcutAccountId = null; shortcutDraft = ''; }
function keyToAccelerator(event) {
  const modifiers = []; if (event.ctrlKey) modifiers.push('Control'); if (event.altKey) modifiers.push('Alt'); if (event.shiftKey) modifiers.push('Shift'); if (event.metaKey) modifiers.push('Super');
  const keyMap = { ' ': 'Space', Escape: 'Esc', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }; let key = keyMap[event.key] || event.key; if (key.length === 1) key = key.toUpperCase();
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key) || !modifiers.length) return ''; return [...modifiers, key].join('+');
}

async function refresh() {
  try { const [state, settings, usage] = await Promise.all([window.codexSwitcher.getState(), loadSettings(), loadUsage()]); render(state); renderShortcuts(state); renderSettings(settings); renderUsage(usage); if (state.pendingLogin?.mode === 'new') openAddDialog(true); applyStateMessage(state); } catch (error) { showAlert(error?.message || String(error)); }
}

document.addEventListener('click', () => closeAccountMenu());
document.getElementById('open-settings').addEventListener('click', () => { settingsSheet.hidden = false; renderShortcuts(currentState || { accounts: [] }); });
document.getElementById('settings-back').addEventListener('click', () => { settingsSheet.hidden = true; });
document.getElementById('settings-open-store').addEventListener('click', () => window.codexSwitcher.openStoreFolder().catch((error) => showAlert(error?.message || String(error))));
document.getElementById('open-store').addEventListener('click', () => window.codexSwitcher.openStoreFolder().catch((error) => showAlert(error?.message || String(error))));
document.getElementById('open-codex').addEventListener('click', async () => { try { setBusy(); await window.codexSwitcher.openCodex(); setReady(); } catch (error) { showAlert(error?.message || String(error)); setReady(); } });
addAccountBtn.addEventListener('click', () => openAddDialog());
document.getElementById('live-save').addEventListener('click', openSaveDialog);
saveConfirm.addEventListener('click', saveCurrentAccount);
pendingComplete.addEventListener('click', completeReauth); pendingResume.addEventListener('click', () => openAddDialog(true)); pendingCancel.addEventListener('click', cancelPendingLogin);
addPrepare.addEventListener('click', prepareAddAccount); addImport.addEventListener('click', importAddedAccount); addCancel.addEventListener('click', closeAddDialog); addCancelPending.addEventListener('click', cancelPendingLogin);
rememberWindowSize.addEventListener('change', () => setRememberWindowSize(rememberWindowSize.checked)); launchOnLogin.addEventListener('change', () => setLaunchOnLogin(launchOnLogin.checked)); usageTracking.addEventListener('change', () => setUsageTracking(usageTracking.checked)); clearUsageBtn.addEventListener('click', clearUsage);
confirmAccept.addEventListener('click', () => closeConfirmation(true)); confirmCancel.addEventListener('click', () => closeConfirmation(false)); shortcutCancel.addEventListener('click', closeShortcutDialog);
shortcutSave.addEventListener('click', async () => { if (!shortcutAccountId || !shortcutDraft) return; try { setBusy(); const next = await window.codexSwitcher.setAccountShortcut(shortcutAccountId, shortcutDraft); closeShortcutDialog(); render(next); renderShortcuts(next); setReady(); } catch (error) { showAlert(error?.message || String(error)); setReady(); } });
shortcutCapture.addEventListener('keydown', (event) => { event.preventDefault(); const value = keyToAccelerator(event); if (!value) { shortcutError.textContent = 'Use at least one modifier key.'; shortcutError.hidden = false; return; } shortcutDraft = value; shortcutDisplay.textContent = prettyShortcut(value); shortcutError.hidden = true; });
document.querySelectorAll('.backdrop[data-close]').forEach((backdrop) => backdrop.addEventListener('click', () => { const layer = backdrop.parentElement; if (layer === confirmDialog) closeConfirmation(false); else if (layer === addDialog) closeAddDialog(); else if (layer === saveDialog) closeSaveDialog(); else if (layer === shortcutDialog) closeShortcutDialog(); }));
document.addEventListener('keydown', (event) => { if (event.key !== 'Escape') return; closeAccountMenu(); if (!confirmDialog.hidden) closeConfirmation(false); else if (!shortcutDialog.hidden) closeShortcutDialog(); else if (!addDialog.hidden) closeAddDialog(); else if (!saveDialog.hidden) closeSaveDialog(); else if (!settingsSheet.hidden) settingsSheet.hidden = true; });

const savedTheme = localStorage.getItem('codex-theme'); if (savedTheme && savedTheme !== 'system') document.documentElement.dataset.theme = savedTheme;
refresh();
