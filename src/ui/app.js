/* =========================================================================
   Codex Account Switcher — renderer

   Shape of this file:
     1. helpers        2. alerts + busy     3. dialog/layer plumbing
     4. rendering      5. actions           6. settings      7. wiring
   ========================================================================= */

const api = window.codexSwitcher;
const el = (id) => document.getElementById(id);

/* ---------- 1. helpers -------------------------------------------------- */

const THEME_KEY = 'codex-switcher-theme';
const THEMES = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

function readTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return THEMES.some((theme) => theme.id === stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode — session only */ }
}

applyTheme(readTheme());

let currentState = null;
let currentSettings = null;
let busyDepth = 0;
let openMenu = null;
let liveWatchTimer = null;
let lastLive = null;

function initials(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.slice(0, 2) || '—').toUpperCase();
}

const KEY_LABELS = { Control: 'Ctrl', Command: '⌘', Super: 'Win', Shift: 'Shift', Alt: 'Alt', Space: 'Space' };

function prettyShortcut(accelerator = '') {
  return accelerator.split('+').filter(Boolean).map((part) => KEY_LABELS[part] || part).join(' + ');
}

function fallbackShortcut(position) { return `Control+Alt+${position + 1}`; }

function shortcutFor(account, position) {
  return account.shortcut || fallbackShortcut(position);
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const UNITS = [['day', 86400000], ['hour', 3600000], ['minute', 60000]];

function formatRelative(value) {
  if (!value) return 'never';
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return 'never';
  const delta = timestamp - Date.now();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(delta) >= ms) return RELATIVE.format(Math.round(delta / ms), unit);
  }
  return 'just now';
}

function healthText(health) {
  if (!health || health.level === 'unknown') return 'freshness unknown';
  return `${health.label.toLowerCase()} · saved ${formatRelative(health.updatedAt)}`;
}

/* ---------- 2. alerts + busy -------------------------------------------- */

const alertsEl = el('alerts');
const progressEl = el('progress');

function clearAlerts() { alertsEl.replaceChildren(); }

/**
 * One visible message at a time. Errors persist until dismissed or replaced;
 * successes fade on their own so the list stays the focus of the screen.
 */
function showAlert(kind, message, { title = null, timeout = 0 } = {}) {
  clearAlerts();
  const node = document.createElement('div');
  node.className = `notice notice-${kind}`;
  node.setAttribute('role', kind === 'error' ? 'alert' : 'status');

  const icon = document.createElement('span');
  icon.className = 'notice-icon';
  icon.innerHTML = codexIcon(kind === 'error' || kind === 'warn' ? 'alert' : kind === 'ok' ? 'check' : 'info');

  const body = document.createElement('div');
  body.className = 'notice-body';
  if (title) {
    const strong = document.createElement('strong');
    strong.textContent = title;
    body.append(strong);
  }
  const text = document.createElement('p');
  text.textContent = message;
  body.append(text);

  const dismiss = document.createElement('button');
  dismiss.className = 'btn btn-icon';
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Dismiss message');
  dismiss.innerHTML = codexIcon('close');
  dismiss.addEventListener('click', clearAlerts);

  node.append(icon, body, dismiss);
  alertsEl.append(node);
  if (timeout) setTimeout(() => { if (node.isConnected) clearAlerts(); }, timeout);
}

function reportError(error) {
  showAlert('error', error?.message || String(error), { title: 'That did not work' });
}

function setBusy(on) {
  busyDepth = Math.max(0, busyDepth + (on ? 1 : -1));
  progressEl.hidden = busyDepth === 0;
  document.querySelectorAll('[data-blocks-on-busy]').forEach((node) => { node.disabled = busyDepth > 0; });
}

/** Wrap an async action: progress bar on, errors surfaced, state re-rendered. */
async function run(label, action) {
  setBusy(true);
  try {
    const next = await action();
    if (next && Array.isArray(next.accounts)) applyState(next);
    if (label) showAlert('ok', label, { timeout: 4000 });
  } catch (error) {
    reportError(error);
  } finally {
    setBusy(false);
  }
}

/* ---------- 3. dialog / layer plumbing ---------------------------------- */

const layerStack = [];
const FOCUSABLE = 'button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

function openLayer(node, focusTarget) {
  closeMenu();
  layerStack.push({ node, restoreTo: document.activeElement });
  node.hidden = false;
  const target = focusTarget || node.querySelector(FOCUSABLE);
  if (target) target.focus();
}

function closeLayer(node) {
  const index = layerStack.findIndex((layer) => layer.node === node);
  if (index === -1) return;
  const [layer] = layerStack.splice(index, 1);
  node.hidden = true;
  if (layer.restoreTo && layer.restoreTo.isConnected) layer.restoreTo.focus();
}

function topLayer() { return layerStack[layerStack.length - 1] || null; }

document.addEventListener('keydown', (event) => {
  const layer = topLayer();
  if (event.key === 'Escape') {
    if (openMenu) { closeMenu(); return; }
    if (layer) { event.preventDefault(); dismissLayer(layer.node); }
    return;
  }
  if (event.key !== 'Tab' || !layer) return;
  const focusable = [...layer.node.querySelectorAll(FOCUSABLE)].filter((node) => node.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

/** Escape / backdrop routes through the layer's own cancel path. */
function dismissLayer(node) {
  if (node === el('confirm-dialog')) settleConfirm(false);
  else if (node === el('add-dialog')) closeAddDialog();
  else if (node === el('save-dialog')) closeLayer(node);
  else if (node === el('shortcut-dialog')) closeLayer(node);
  else closeLayer(node);
}

document.querySelectorAll('[data-close]').forEach((backdrop) => {
  backdrop.addEventListener('click', () => dismissLayer(backdrop.closest('.dialog-layer')));
});

/* --- confirmation --- */
let confirmResolver = null;

function askConfirm({ title, message, confirmLabel = 'Continue', tone = 'warn' }) {
  el('confirm-title').textContent = title;
  el('confirm-message').textContent = message;
  el('confirm-accept').textContent = confirmLabel;
  el('confirm-accept').className = tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary';
  el('confirm-icon').className = `dialog-icon ${tone}`;
  openLayer(el('confirm-dialog'), el('confirm-accept'));
  return new Promise((resolve) => { confirmResolver = resolve; });
}

function settleConfirm(result) {
  closeLayer(el('confirm-dialog'));
  const resolve = confirmResolver;
  confirmResolver = null;
  if (resolve) resolve(result);
}

/* --- per-account overflow menu --- */

function closeMenu() {
  if (!openMenu) return;
  openMenu.trigger.setAttribute('aria-expanded', 'false');
  openMenu.node.remove();
  openMenu = null;
}

document.addEventListener('click', (event) => {
  if (openMenu && !openMenu.node.contains(event.target) && !openMenu.trigger.contains(event.target)) closeMenu();
});

function buildMenu(trigger, items) {
  closeMenu();
  const node = document.createElement('div');
  node.className = 'menu';
  node.setAttribute('role', 'menu');
  items.forEach((item) => {
    if (item.separator) { node.append(document.createElement('hr')); return; }
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('role', 'menuitem');
    if (item.danger) button.className = 'danger';
    button.disabled = Boolean(item.disabled);
    button.innerHTML = codexIcon(item.icon);
    const label = document.createElement('span');
    label.textContent = item.label;
    button.append(label);
    button.addEventListener('click', () => { closeMenu(); item.run(); });
    node.append(button);
  });
  trigger.parentElement.append(node);
  trigger.setAttribute('aria-expanded', 'true');
  openMenu = { node, trigger };
  node.querySelector('button:not(:disabled)')?.focus();
}

/* ---------- 4. rendering ------------------------------------------------ */

const accountsEl = el('accounts');

function accountCard(account, position, state) {
  const item = document.createElement('li');
  const active = account.isActive && !state.pendingLogin;
  item.className = `acct${active ? ' is-active' : ''}${account.isPendingReauth ? ' is-pending' : ''}`;

  const avatarWrap = document.createElement('span');
  avatarWrap.className = 'avatar-wrap';
  const avatar = document.createElement('span');
  avatar.className = `avatar tone-${position % 4}`;
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = initials(account.displayName);
  const dot = document.createElement('span');
  dot.className = `health-dot ${account.health?.level || 'unknown'}`;
  dot.setAttribute('aria-hidden', 'true');
  avatarWrap.append(avatar, dot);

  const copy = document.createElement('span');
  copy.className = 'acct-copy';
  const nameRow = document.createElement('span');
  nameRow.className = 'acct-name';
  const name = document.createElement('strong');
  name.textContent = account.displayName;
  nameRow.append(name);
  if (active) {
    const chip = document.createElement('span');
    chip.className = 'chip chip-ok';
    chip.innerHTML = '<span class="dot"></span>';
    chip.append(document.createTextNode('Active'));
    nameRow.append(chip);
  } else if (account.isPendingReauth) {
    const chip = document.createElement('span');
    chip.className = 'chip chip-warn';
    chip.textContent = 'Signing in';
    nameRow.append(chip);
  }

  const meta = document.createElement('span');
  meta.className = 'acct-meta';
  const identity = [account.email, account.planType].filter(Boolean).join(' · ') || 'Saved account';
  meta.append(document.createTextNode(`${identity} · `));
  const health = document.createElement('span');
  health.className = `health-label ${account.health?.level || 'unknown'}`;
  health.textContent = healthText(account.health);
  meta.append(health);
  copy.append(nameRow, meta);

  const shortcut = document.createElement('kbd');
  shortcut.className = 'acct-shortcut';
  shortcut.textContent = prettyShortcut(shortcutFor(account, position));

  const actions = document.createElement('span');
  actions.className = 'acct-actions';

  if (!active) {
    const switchBtn = document.createElement('button');
    switchBtn.type = 'button';
    switchBtn.className = 'btn btn-switch';
    switchBtn.dataset.blocksOnBusy = 'true';
    switchBtn.innerHTML = codexIcon(account.isActive ? 'rotate' : 'arrow');
    const label = document.createElement('span');
    label.className = 'btn-label';
    label.textContent = account.isActive ? 'Restore' : 'Switch';
    switchBtn.append(label);
    switchBtn.setAttribute('aria-label', `${account.isActive ? 'Restore' : 'Switch to'} ${account.displayName}`);
    switchBtn.addEventListener('click', () => switchTo(account));
    actions.append(switchBtn);
  }

  const anchor = document.createElement('span');
  anchor.className = 'menu-anchor';
  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'btn btn-icon';
  more.setAttribute('aria-haspopup', 'menu');
  more.setAttribute('aria-expanded', 'false');
  more.setAttribute('aria-label', `More actions for ${account.displayName}`);
  more.innerHTML = codexIcon('more');
  more.addEventListener('click', (event) => {
    event.stopPropagation();
    if (openMenu && openMenu.trigger === more) { closeMenu(); return; }
    buildMenu(more, [
      { icon: 'rotate', label: 'Re-authenticate…', disabled: Boolean(state.pendingLogin), run: () => reauth(account) },
      { icon: 'keyboard', label: 'Change shortcut…', run: () => openShortcutDialog(account, position) },
      { separator: true },
      {
        icon: 'trash', label: 'Remove account…', danger: true,
        disabled: active || Boolean(state.pendingLogin),
        run: () => removeAccount(account),
      },
    ]);
  });
  anchor.append(more);
  actions.append(anchor);

  item.append(avatarWrap, copy, shortcut, actions);
  return item;
}

function renderAccounts(state) {
  accountsEl.replaceChildren();
  state.accounts.forEach((account, position) => accountsEl.append(accountCard(account, position, state)));
  el('count').textContent = state.accounts.length ? `${state.accounts.length} saved` : '';
  el('empty').hidden = state.accounts.length > 0;
  accountsEl.hidden = state.accounts.length === 0;
}

function renderPending(state) {
  const pending = state.pendingLogin;
  const node = el('pending');
  node.hidden = !pending;
  el('add-account').disabled = Boolean(pending);
  if (!pending) return;

  const reauth = pending.mode === 'reauth';
  el('pending-title').textContent = reauth
    ? `Sign back in as ${pending.accountName || 'the selected account'}`
    : 'Sign in to the new account';
  el('pending-message').textContent = reauth
    ? 'Codex is waiting at its sign-in screen. Sign in as that account, then come back and finish here.'
    : 'Codex is waiting at its sign-in screen. Sign in as the account you want to add, then come back and name it.';
  el('pending-complete').hidden = !reauth;
  el('pending-resume').hidden = reauth;
}

function renderLive(state) {
  const node = el('live-card');
  const hasAccounts = state.accounts.length > 0;
  const orphaned = hasAccounts && !state.activeId;

  if (state.pendingLogin) { node.hidden = true; return; }

  if (!hasAccounts) {
    node.hidden = false;
    el('live-title').textContent = 'Save the account Codex is signed in to';
    el('live-message').textContent = 'Give the login Codex is currently using a name, and the switcher will keep an encrypted copy of it here.';
    return;
  }
  if (orphaned) {
    node.hidden = false;
    el('live-title').textContent = 'Codex is signed in to an account you have not saved';
    el('live-message').textContent = 'None of your saved accounts is currently active. Save this login too, or switch to one below.';
    return;
  }
  node.hidden = true;
}

function renderShortcutRows(state) {
  const list = el('shortcut-rows');
  list.replaceChildren();
  if (!state.accounts.length) {
    const empty = document.createElement('div');
    empty.className = 'setting';
    empty.innerHTML = '<div class="setting-copy"><p>Save an account to give it a shortcut.</p></div>';
    list.append(empty);
    return;
  }
  state.accounts.forEach((account, position) => {
    const row = document.createElement('div');
    row.className = 'shortcut-row';
    const avatar = document.createElement('span');
    avatar.className = `avatar tone-${position % 4}`;
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = initials(account.displayName);
    const copy = document.createElement('span');
    copy.className = 'acct-copy';
    const name = document.createElement('span');
    name.className = 'acct-name';
    const strong = document.createElement('strong');
    strong.textContent = account.displayName;
    name.append(strong);
    const meta = document.createElement('span');
    meta.className = 'acct-meta';
    meta.textContent = account.email || 'Saved locally';
    copy.append(name, meta);
    const key = document.createElement('kbd');
    key.textContent = prettyShortcut(shortcutFor(account, position));
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'btn btn-sm';
    edit.textContent = 'Change';
    edit.setAttribute('aria-label', `Change shortcut for ${account.displayName}`);
    edit.addEventListener('click', () => openShortcutDialog(account, position));
    row.append(avatar, copy, key, edit);
    list.append(row);
  });
}

function applyState(state) {
  currentState = state;
  renderAccounts(state);
  renderPending(state);
  renderLive(state);
  renderShortcutRows(state);
  if (state.warning) showAlert('warn', state.warning);
  else if (state.configCompatibility?.changed) {
    showAlert('warn', 'Codex was switched to file-backed credentials so switching works. The previous config.toml was backed up.', { timeout: 8000 });
  }
}

/* ---------- 5. actions -------------------------------------------------- */

/* Switching is routine and reversible, so it runs without a confirmation
   step. The destructive paths below all keep one. */
function switchTo(account) {
  run(`Switched to ${account.displayName}.`, () => api.switchAccount(account.id));
}

async function reauth(account) {
  const ok = await askConfirm({
    title: `Re-authenticate ${account.displayName}?`,
    message: 'Codex will close and its local login file will be cleared so you can sign in again. Your saved encrypted snapshots are untouched.',
    confirmLabel: 'Clear login and open Codex',
  });
  if (!ok) return;
  run(null, () => api.prepareReauth(account.id));
}

async function removeAccount(account) {
  const ok = await askConfirm({
    title: `Remove ${account.displayName}?`,
    message: 'This permanently deletes the encrypted snapshot from this device. You can import the account again later by signing in to it.',
    confirmLabel: 'Remove permanently',
    tone: 'danger',
  });
  if (!ok) return;
  run(`Removed ${account.displayName}.`, () => api.removeAccount(account.id));
}

/* --- save the current login --- */

function openSaveDialog() {
  el('save-name').value = '';
  openLayer(el('save-dialog'), el('save-name'));
}

async function confirmSave() {
  const displayName = el('save-name').value.trim();
  if (!displayName) { el('save-name').focus(); showAlert('warn', 'Give this account a name first.'); return; }
  closeLayer(el('save-dialog'));
  run(`Saved ${displayName}.`, () => api.importCurrent(displayName));
}

/* --- add another account --- */

function setAddStep(step) {
  const second = step === 2;
  el('step-1').setAttribute('aria-current', String(!second));
  el('step-2').setAttribute('aria-current', String(second));
  el('add-step-1').hidden = second;
  el('add-step-2').hidden = !second;
  // Keep the dialog's accessible name on the heading that is actually visible.
  el('add-dialog').querySelector('.dialog').setAttribute('aria-labelledby', second ? 'add-title-2' : 'add-title');
  if (second) { startLiveWatch(); el('add-name').focus(); }
  else { stopLiveWatch(); el('add-prepare').focus(); }
}

function openAddDialog() {
  const resuming = currentState?.pendingLogin?.mode === 'new';
  el('add-name').value = '';
  openLayer(el('add-dialog'));
  setAddStep(resuming ? 2 : 1);
}

function closeAddDialog() {
  stopLiveWatch();
  closeLayer(el('add-dialog'));
}

/* The live probe is optional: if the main process does not expose it, the
   dialog simply drops the detection hint rather than breaking. */
function startLiveWatch() {
  stopLiveWatch();
  if (typeof api.getLiveAccount !== 'function') {
    el('add-waiting').hidden = true;
    el('add-detected').hidden = true;
    return;
  }
  const tick = async () => {
    try {
      const live = await api.getLiveAccount();
      lastLive = live;
      const known = currentState?.accounts.some((account) => account.email && live?.email
        && account.email.toLowerCase() === live.email.toLowerCase());
      const detected = Boolean(live?.present) && !known;
      el('add-detected').hidden = !detected;
      el('add-waiting').hidden = detected;
      if (detected) {
        el('add-detected-text').textContent = live.email
          ? `Signed in as ${live.email}`
          : 'A new Codex sign-in was detected';
        if (!el('add-name').value.trim() && live.email) el('add-name').placeholder = live.email;
      }
    } catch { /* transient — the next tick retries */ }
  };
  tick();
  liveWatchTimer = setInterval(tick, 2000);
}

function stopLiveWatch() {
  if (liveWatchTimer) clearInterval(liveWatchTimer);
  liveWatchTimer = null;
}

/* Step 1 of this dialog already spells out exactly what is about to happen,
   so it stands in for the confirmation rather than stacking a second one. */
async function prepareAdd() {
  setBusy(true);
  try {
    applyState(await api.prepareNewAccount());
    setAddStep(2);
  } catch (error) {
    reportError(error);
    closeAddDialog();
  } finally {
    setBusy(false);
  }
}

async function importAdded() {
  const displayName = el('add-name').value.trim() || el('add-name').placeholder.trim();
  if (!displayName) { el('add-name').focus(); showAlert('warn', 'Give the new account a name first.'); return; }
  closeAddDialog();
  run(`Saved ${displayName}.`, () => api.importCurrent(displayName));
}

async function cancelPending() {
  closeAddDialog();
  run('Restored your previous account.', () => api.cancelPendingLogin());
}

async function completeReauth() {
  run('Re-authentication saved.', () => api.completeReauth());
}

/* --- shortcut capture --- */

let shortcutAccountId = null;
let shortcutDraft = '';

function openShortcutDialog(account, position) {
  shortcutAccountId = account.id;
  shortcutDraft = shortcutFor(account, position);
  el('shortcut-title').textContent = `Shortcut for ${account.displayName}`;
  el('shortcut-display').textContent = prettyShortcut(shortcutDraft);
  el('shortcut-error').hidden = true;
  openLayer(el('shortcut-dialog'), el('shortcut-capture'));
}

function keyToAccelerator(event) {
  const modifiers = [];
  if (event.ctrlKey) modifiers.push('Control');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Super');
  const named = { ' ': 'Space', Escape: 'Esc', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
  let key = named[event.key] || event.key;
  if (key.length === 1) key = key.toUpperCase();
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(key) || !modifiers.length) return '';
  return [...modifiers, key].join('+');
}

/* ---------- 6. settings ------------------------------------------------- */

function renderTheme() {
  const seg = el('theme-seg');
  const active = readTheme();
  seg.replaceChildren();
  THEMES.forEach((theme) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = theme.label;
    button.setAttribute('aria-pressed', String(theme.id === active));
    button.addEventListener('click', () => { applyTheme(theme.id); renderTheme(); });
    seg.append(button);
  });
}

function renderSettings(settings) {
  currentSettings = settings;

  const presets = el('presets');
  presets.replaceChildren();
  Object.entries(settings.windowPresets || {}).forEach(([id, preset]) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'preset';
    button.setAttribute('aria-pressed', String(id === settings.windowPreset));
    const glyph = document.createElement('span');
    glyph.className = `glyph ${id}`;
    glyph.setAttribute('aria-hidden', 'true');
    const label = document.createElement('strong');
    label.textContent = preset.label;
    const size = document.createElement('small');
    size.textContent = `${preset.width} × ${preset.height}`;
    button.append(glyph, label, size);
    button.addEventListener('click', () => updateSettings({ windowPreset: id }));
    presets.append(button);
  });

  el('launch-on-login').checked = Boolean(settings.launchOnLogin);

  const remember = el('remember-window-size');
  if (remember) {
    remember.checked = Boolean(settings.rememberLastWindowSize);
    const size = settings.lastWindowSize;
    el('last-window-size').textContent = size
      ? `Reopens at ${size.width} × ${size.height}.`
      : 'Resize the window and it will reopen at that size.';
  }
}

function renderUsage(usage) {
  const toggle = el('usage-tracking');
  if (!toggle) return;
  toggle.checked = Boolean(usage.enabled);
  el('clear-usage').hidden = !usage.enabled || !usage.hasData;
  if (!usage.enabled) {
    el('usage-summary').textContent = 'Off — nothing is recorded.';
    return;
  }
  if (!usage.hasData) {
    el('usage-summary').textContent = 'On — counts stay on this device.';
    return;
  }
  const switches = `${usage.switchCount} switch${usage.switchCount === 1 ? '' : 'es'}`;
  el('usage-summary').textContent = `${switches} · ${usage.openCount} open${usage.openCount === 1 ? '' : 's'} since ${formatRelative(usage.firstTrackedAt)}.`;
}

async function updateSettings(changes) {
  setBusy(true);
  try {
    renderSettings(await api.setSettings(changes));
  } catch (error) {
    reportError(error);
    await loadSettings();
  } finally {
    setBusy(false);
  }
}

async function loadSettings() {
  try { renderSettings(await api.getSettings()); } catch (error) { reportError(error); }
}

async function loadUsage() {
  if (typeof api.getUsage !== 'function') return;
  try { renderUsage(await api.getUsage()); } catch { /* usage is optional */ }
}

/* ---------- 7. wiring --------------------------------------------------- */

el('open-codex').addEventListener('click', () => run(null, async () => { await api.openCodex(); }));
el('open-store').addEventListener('click', () => api.openStoreFolder().catch(reportError));
el('settings-open-store').addEventListener('click', () => api.openStoreFolder().catch(reportError));

el('open-settings').addEventListener('click', () => {
  renderTheme();
  loadUsage();
  openLayer(el('settings-sheet'), el('settings-back'));
});
el('settings-back').addEventListener('click', () => closeLayer(el('settings-sheet')));

el('add-account').addEventListener('click', openAddDialog);
el('add-cancel').addEventListener('click', closeAddDialog);
el('add-prepare').addEventListener('click', prepareAdd);
el('add-import').addEventListener('click', importAdded);
el('add-cancel-pending').addEventListener('click', cancelPending);

el('live-save').addEventListener('click', openSaveDialog);
el('save-cancel').addEventListener('click', () => closeLayer(el('save-dialog')));
el('save-confirm').addEventListener('click', confirmSave);
el('save-name').addEventListener('keydown', (event) => { if (event.key === 'Enter') confirmSave(); });

el('pending-complete').addEventListener('click', completeReauth);
el('pending-resume').addEventListener('click', openAddDialog);
el('pending-cancel').addEventListener('click', cancelPending);

el('confirm-accept').addEventListener('click', () => settleConfirm(true));
el('confirm-cancel').addEventListener('click', () => settleConfirm(false));

el('launch-on-login').addEventListener('change', (event) => updateSettings({ launchOnLogin: event.target.checked }));
el('remember-window-size')?.addEventListener('change', (event) => updateSettings({ rememberLastWindowSize: event.target.checked }));
el('usage-tracking')?.addEventListener('change', async (event) => {
  await updateSettings({ usageTracking: event.target.checked });
  loadUsage();
});
el('clear-usage')?.addEventListener('click', async () => {
  const ok = await askConfirm({
    title: 'Clear local activity counts?',
    message: 'The switch and open counts recorded on this device will be deleted.',
    confirmLabel: 'Clear counts',
    tone: 'danger',
  });
  if (!ok) return;
  try { await api.clearUsage(); await loadUsage(); } catch (error) { reportError(error); }
});

el('shortcut-capture').addEventListener('click', () => { el('shortcut-display').textContent = 'Press keys…'; });
el('shortcut-capture').addEventListener('keydown', (event) => {
  if (event.key === 'Tab') return;
  event.preventDefault();
  const value = keyToAccelerator(event);
  if (!value) {
    el('shortcut-error').textContent = 'Add a modifier — Ctrl, Alt, Shift or the Windows/Command key.';
    el('shortcut-error').hidden = false;
    return;
  }
  shortcutDraft = value;
  el('shortcut-display').textContent = prettyShortcut(value);
  el('shortcut-error').hidden = true;
});
el('shortcut-cancel').addEventListener('click', () => closeLayer(el('shortcut-dialog')));
el('shortcut-save').addEventListener('click', () => {
  if (!shortcutDraft || !shortcutAccountId) return;
  const id = shortcutAccountId;
  const accelerator = shortcutDraft;
  closeLayer(el('shortcut-dialog'));
  run('Shortcut saved.', async () => {
    const next = await api.setAccountShortcut(id, accelerator);
    renderShortcutRows(next);
    return next;
  });
});

/* --- boot --- */
(async function boot() {
  setBusy(true);
  try {
    applyState(await api.getState());
    await loadSettings();
    await loadUsage();
    renderTheme();
    if (currentState?.pendingLogin?.mode === 'new') openAddDialog();
  } catch (error) {
    reportError(error);
  } finally {
    setBusy(false);
  }
}());
