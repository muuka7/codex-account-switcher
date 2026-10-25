const { app, BrowserWindow, ipcMain, safeStorage, session, globalShortcut, shell, clipboard, Tray, Menu, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { ensureFileCredentialStore } = require('./codex-config');
const { readRateLimits } = require('./codex-app-server');
const { publishState } = require('./state-events');
const { createAutoUpdater } = require('./auto-updater');
const { RemoteController } = require('./remote/controller');
const { deriveIdentity, identityMatches, assertSavedIdentity } = require('./account-identity');
const {
  chooseHandoff,
  normalizeHandoffJournal,
  normalizeHandoffSettings,
} = require('./handoff-policy');
const {
  normalizeError,
  normalizeRateLimitCache,
  publicRateLimitState,
  snapshotFromResult,
} = require('./rate-limits');

if (!app.isPackaged && process.env.CODEX_SWITCHER_USER_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.CODEX_SWITCHER_USER_DATA_DIR));
}

const APP_NAME = 'Codex Account Switcher';
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const AUTH_PATH = path.join(CODEX_HOME, 'auth.json');
const STORE_ROOT = path.join(app.getPath('userData'), 'vault');
const INDEX_PATH = path.join(app.getPath('userData'), 'accounts.json');
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
const USAGE_PATH = path.join(app.getPath('userData'), 'usage.json');
const RATE_LIMITS_PATH = path.join(app.getPath('userData'), 'rate-limits.json');
const HANDOFF_PATH = path.join(app.getPath('userData'), 'handoff.json');
const BACKUP_PATH = path.join(app.getPath('userData'), 'last-auth-backup.secure');
const WINDOWS_CODEX_AUMID = 'OpenAI.Codex_2p2nqsd0c76g0!App';
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';
const WINDOW_PRESETS = Object.freeze({
  portrait: { label: 'Portrait', width: 420, height: 720 },
  compact: { label: 'Compact', width: 800, height: 620 },
  standard: { label: 'Standard', width: 980, height: 700 },
  wide: { label: 'Wide', width: 1180, height: 780 },
});

let mainWindow;
let tray;
let operationQueue = Promise.resolve();
let configCompatibility = { changed: false, backupPath: null };
let registeredAccelerators = new Set();
let resizeSaveTimer = null;

const MIN_WINDOW_SIZE = Object.freeze({ width: 360, height: 560 });
const MAX_WINDOW_SIZE = Object.freeze({ width: 2400, height: 1600 });
const RATE_LIMIT_CONFIRM_DELAY_MS = 3 * 60 * 1000;
const GUARDED_USAGE_POLL_MS = 5 * 60 * 1000;
const RATE_LIMIT_TEMP_PREFIX = 'codex-switcher-rate-';

let rateLimitCache = normalizeRateLimitCache({});
let rateLimitRefreshing = false;
let rateLimitRefreshPromise = null;
let rateLimitConfirmationTimer = null;
let handoffMonitorTimer = null;
let handoffExecutionPromise = null;
let guardedUsagePollTimer = null;
let guardedHandoffBackgroundEnabled = false;
let appIsQuitting = false;
let autoUpdater;
let remoteController;

// A second process must not write the same vault or sweep another probe home.
const primaryInstance = app.requestSingleInstanceLock();
if (!primaryInstance) app.quit();
else app.on('second-instance', () => showMainWindow());

function assertSupportedPlatform() {
  if (!isMac && !isWindows) throw new Error('This hardened build currently supports macOS and Windows only.');
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function ensureDirs() {
  await fs.mkdir(STORE_ROOT, { recursive: true, mode: 0o700 });
  await fs.mkdir(CODEX_HOME, { recursive: true, mode: 0o700 });
}

async function ensureCodexCompatibility() {
  configCompatibility = await ensureFileCredentialStore(CODEX_HOME);
  return configCompatibility;
}

async function writeAtomic(filePath, bytes) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const tmp = `${filePath}.tmp-${crypto.randomUUID()}`;
  try {
    await fs.writeFile(tmp, bytes, { mode: 0o600 });
    await fs.rename(tmp, filePath);
  } finally {
    await fs.rm(tmp, { force: true }).catch(() => {});
  }
}

function normalizeIndex(index) {
  const normalized = index && typeof index === 'object' ? index : {};
  normalized.version = 3;
  normalized.activeId = normalized.activeId || null;
  normalized.accounts = Array.isArray(normalized.accounts)
    ? normalized.accounts.map((account) => ({ ...(account || {}), shortcut: account?.shortcut || null }))
    : [];
  normalized.pendingLogin = normalized.pendingLogin || null;
  return normalized;
}

async function readIndex() {
  try {
    return normalizeIndex(JSON.parse(await fs.readFile(INDEX_PATH, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeIndex({});
    throw error;
  }
}

async function writeIndex(index) {
  const normalized = normalizeIndex(index);
  await writeAtomic(INDEX_PATH, Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8'));
}

function normalizeSettings(settings) {
  const normalized = settings && typeof settings === 'object' ? settings : {};
  normalized.version = 1;
  normalized.windowPreset = WINDOW_PRESETS[normalized.windowPreset] ? normalized.windowPreset : 'standard';
  normalized.launchOnLogin = Boolean(normalized.launchOnLogin);
  normalized.rememberLastWindowSize = Boolean(normalized.rememberLastWindowSize);
  normalized.usageTracking = Boolean(normalized.usageTracking);
  normalized.guardedHandoff = normalizeHandoffSettings(normalized.guardedHandoff);
  const width = Number(normalized.lastWindowSize?.width);
  const height = Number(normalized.lastWindowSize?.height);
  normalized.lastWindowSize = Number.isFinite(width) && Number.isFinite(height)
    ? {
        width: Math.min(MAX_WINDOW_SIZE.width, Math.max(MIN_WINDOW_SIZE.width, Math.round(width))),
        height: Math.min(MAX_WINDOW_SIZE.height, Math.max(MIN_WINDOW_SIZE.height, Math.round(height))),
      }
    : null;
  return normalized;
}

async function readSettings() {
  try {
    return normalizeSettings(JSON.parse(await fs.readFile(SETTINGS_PATH, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeSettings({});
    throw error;
  }
}

async function writeSettings(settings) {
  const normalized = normalizeSettings(settings);
  await writeAtomic(SETTINGS_PATH, Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8'));
}

function publicSettings(settings) {
  const normalized = normalizeSettings(settings);
  return {
    windowPreset: normalized.windowPreset,
    launchOnLogin: normalized.launchOnLogin,
    rememberLastWindowSize: normalized.rememberLastWindowSize,
    lastWindowSize: normalized.lastWindowSize,
    usageTracking: normalized.usageTracking,
    guardedHandoff: normalized.guardedHandoff,
    windowPresets: WINDOW_PRESETS,
  };
}

function applyLaunchOnLogin(enabled) {
  if (!isMac && !isWindows) return;
  app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
}

async function getSettings() {
  return publicSettings(await readSettings());
}

async function setSettings(changes = {}) {
  return queueOperation(async () => {
    const settings = await readSettings();
    if (changes.windowPreset !== undefined) {
      if (!WINDOW_PRESETS[changes.windowPreset]) throw new Error('Unknown window size preset.');
      settings.windowPreset = changes.windowPreset;
    }
    if (changes.launchOnLogin !== undefined) settings.launchOnLogin = Boolean(changes.launchOnLogin);
    if (changes.rememberLastWindowSize !== undefined) settings.rememberLastWindowSize = Boolean(changes.rememberLastWindowSize);
    if (changes.usageTracking !== undefined) settings.usageTracking = Boolean(changes.usageTracking);
    if (changes.guardedHandoff !== undefined) {
      const accountIds = (await readIndex()).accounts.map((account) => account.id);
      settings.guardedHandoff = normalizeHandoffSettings(changes.guardedHandoff, accountIds);
    }
    if (changes.windowPreset !== undefined) {
      const preset = WINDOW_PRESETS[settings.windowPreset];
      settings.lastWindowSize = { width: preset.width, height: preset.height };
    }
    await writeSettings(settings);
    if (changes.guardedHandoff !== undefined) {
      configureGuardedUsagePolling(settings.guardedHandoff.enabled);
      const journal = await readHandoffJournal();
      if (!settings.guardedHandoff.enabled && journal.phase === 'queued') {
        await writeHandoffJournal({ ...journal, phase: 'cancelled', updatedAt: new Date().toISOString(), message: 'Guarded handoff was turned off.' });
        stopHandoffMonitor();
        await emitHandoff();
      } else if (settings.guardedHandoff.enabled) {
        await evaluateGuardedHandoff();
      }
    }
    applyLaunchOnLogin(settings.launchOnLogin);
    if (mainWindow && changes.windowPreset !== undefined) {
      const preset = WINDOW_PRESETS[settings.windowPreset];
      mainWindow.setSize(preset.width, preset.height);
      mainWindow.center();
    }
    return publicSettings(settings);
  });
}

function normalizeUsage(usage) {
  const normalized = usage && typeof usage === 'object' ? usage : {};
  const byAccount = normalized.byAccount && typeof normalized.byAccount === 'object' ? normalized.byAccount : {};
  return {
    version: 1,
    openCount: Number.isFinite(Number(normalized.openCount)) ? Number(normalized.openCount) : 0,
    switchCount: Number.isFinite(Number(normalized.switchCount)) ? Number(normalized.switchCount) : 0,
    importCount: Number.isFinite(Number(normalized.importCount)) ? Number(normalized.importCount) : 0,
    reauthCount: Number.isFinite(Number(normalized.reauthCount)) ? Number(normalized.reauthCount) : 0,
    byAccount,
    firstTrackedAt: normalized.firstTrackedAt || null,
    lastActivityAt: normalized.lastActivityAt || null,
  };
}

async function readUsage() {
  try {
    return normalizeUsage(JSON.parse(await fs.readFile(USAGE_PATH, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeUsage({});
    throw error;
  }
}

async function writeUsage(usage) {
  await writeAtomic(USAGE_PATH, Buffer.from(`${JSON.stringify(normalizeUsage(usage), null, 2)}\n`, 'utf8'));
}

async function recordUsage(kind, accountId = null) {
  const settings = await readSettings();
  if (!settings.usageTracking) return;
  const usage = await readUsage();
  const now = new Date().toISOString();
  usage.firstTrackedAt ||= now;
  usage.lastActivityAt = now;
  if (kind === 'open') usage.openCount += 1;
  if (kind === 'switch') usage.switchCount += 1;
  if (kind === 'import') usage.importCount += 1;
  if (kind === 'reauth') usage.reauthCount += 1;
  if (accountId) {
    const accountUsage = usage.byAccount[accountId] && typeof usage.byAccount[accountId] === 'object'
      ? usage.byAccount[accountId]
      : {};
    accountUsage[kind] = (Number(accountUsage[kind]) || 0) + 1;
    accountUsage.lastActivityAt = now;
    usage.byAccount[accountId] = accountUsage;
  }
  await writeUsage(usage);
}

async function getUsage() {
  const settings = await readSettings();
  if (!settings.usageTracking) return { enabled: false, openCount: 0, switchCount: 0, importCount: 0, reauthCount: 0, byAccount: {}, firstTrackedAt: null, lastActivityAt: null, hasData: false };
  const usage = await readUsage();
  return { enabled: true, ...usage, hasData: Boolean(usage.firstTrackedAt) };
}

async function clearUsage() {
  await fs.rm(USAGE_PATH, { force: true });
  return getUsage();
}

async function readHandoffJournal() {
  try {
    return normalizeHandoffJournal(JSON.parse(await fs.readFile(HANDOFF_PATH, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeHandoffJournal({});
    throw error;
  }
}

async function writeHandoffJournal(journal) {
  const normalized = normalizeHandoffJournal(journal);
  await writeAtomic(HANDOFF_PATH, Buffer.from(`${JSON.stringify(normalized, null, 2)}\n`, 'utf8'));
  return normalized;
}

async function publicHandoffState() {
  const [journal, index, settings] = await Promise.all([readHandoffJournal(), readIndex(), readSettings()]);
  const account = (id) => {
    const match = index.accounts.find((item) => item.id === id);
    return match ? { id: match.id, displayName: match.displayName } : null;
  };
  return {
    phase: journal.phase,
    source: account(journal.sourceId),
    target: account(journal.targetId),
    trigger: journal.trigger,
    createdAt: journal.createdAt,
    updatedAt: journal.updatedAt,
    completedAt: journal.completedAt,
    errorCode: journal.errorCode,
    message: journal.message,
    enabled: settings.guardedHandoff.enabled,
    continuationMode: 'reopen_only',
    waitsForCodexToClose: journal.phase === 'queued',
  };
}

async function emitHandoff() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
  mainWindow.webContents.send('handoff:updated', await publicHandoffState());
}

async function readRateLimitCache() {
  try {
    return normalizeRateLimitCache(JSON.parse(await fs.readFile(RATE_LIMITS_PATH, 'utf8')));
  } catch (error) {
    if (error.code === 'ENOENT') return normalizeRateLimitCache({});
    throw error;
  }
}

async function writeRateLimitCache(cache) {
  rateLimitCache = normalizeRateLimitCache(cache);
  await writeAtomic(RATE_LIMITS_PATH, Buffer.from(`${JSON.stringify(rateLimitCache, null, 2)}\n`, 'utf8'));
}

async function publicRateLimits() {
  const index = await readIndex();
  return publicRateLimitState(rateLimitCache, {
    refreshing: rateLimitRefreshing,
    accountIds: index.accounts.map((account) => account.id),
  });
}

async function emitRateLimits() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('rate-limits:updated', await publicRateLimits());
}

async function cleanupRateLimitHome(tempHome) {
  const tempRoot = path.resolve(os.tmpdir());
  const target = path.resolve(tempHome);
  if (path.dirname(target) !== tempRoot || !path.basename(target).startsWith(RATE_LIMIT_TEMP_PREFIX)) {
    throw Object.assign(new Error('Refusing to clean an unexpected usage-check directory.'), { code: 'USAGE_CHECK_FAILED' });
  }
  let lastError = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw Object.assign(new Error('The temporary usage-check directory could not be removed.'), { code: 'USAGE_CHECK_FAILED', cause: lastError });
}

async function probeSavedAccount(account, index) {
  const useLiveHome = !index.pendingLogin && index.activeId === account.id && await exists(AUTH_PATH);
  if (useLiveHome) {
    assertSavedIdentity(account.identity, deriveIdentity(await readCurrentAuth()));
    let result, failure;
    try { result = await readRateLimits({ codexHome: CODEX_HOME }); }
    catch (error) { if (error.code === 'APP_SERVER_STOP_FAILED') throw error; failure = error; }
    const refreshedAuth = await readCurrentAuth();
    assertSavedIdentity(account.identity, deriveIdentity(refreshedAuth));
    await writeAtomic(accountBlobPath(account.id), protect(refreshedAuth));
    account.identity = { ...account.identity, ...deriveIdentity(refreshedAuth) };
    account.lastSavedAt = new Date().toISOString();
    if (failure) throw failure;
    return result;
  }

  let protectedAuth;
  try {
    protectedAuth = await fs.readFile(accountBlobPath(account.id));
  } catch (error) {
    if (error.code === 'ENOENT') throw Object.assign(new Error('Saved login missing.'), { code: 'ACCOUNT_CREDENTIAL_MISSING' });
    throw error;
  }
  const auth = unprotect(protectedAuth);
  JSON.parse(auth.toString('utf8'));
  assertSavedIdentity(account.identity, deriveIdentity(auth));

  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), RATE_LIMIT_TEMP_PREFIX));
  let cleanup = true;
  try {
    await fs.writeFile(path.join(tempHome, 'auth.json'), auth, { mode: 0o600 });
    await fs.writeFile(path.join(tempHome, 'config.toml'), 'cli_auth_credentials_store = "file"\n', { mode: 0o600 });
    let result, failure;
    try { result = await readRateLimits({ codexHome: tempHome, sqliteHome: tempHome }); }
    catch (error) {
      if (error.code === 'APP_SERVER_STOP_FAILED') { cleanup = false; throw error; }
      failure = error;
    }
    cleanup = false;
    const refreshedAuth = await fs.readFile(path.join(tempHome, 'auth.json'));
    if (!refreshedAuth.equals(auth)) {
      const actualIdentity = deriveIdentity(refreshedAuth);
      // A failed quota request can still rotate refresh credentials. Retain
      // the private staging copy if identity validation or encryption fails.
      cleanup = false;
      assertSavedIdentity(account.identity, actualIdentity);
      try { await writeAtomic(accountBlobPath(account.id), protect(refreshedAuth)); }
      catch { throw Object.assign(new Error('Refreshed credentials could not be encrypted. A private usage-check directory was retained for recovery.'), { code: 'PERSIST_FAILED' }); }
      account.identity = { ...account.identity, ...actualIdentity };
      account.lastSavedAt = new Date().toISOString();
    }
    cleanup = true;
    if (failure) throw failure;
    return result;
  } finally {
    if (cleanup) await cleanupRateLimitHome(tempHome);
  }
}

async function runRateLimitRefreshPass({ confirm = false } = {}) {
  const index = await readIndex();
  const next = normalizeRateLimitCache(rateLimitCache);
  const validIds = new Set(index.accounts.map((account) => account.id));
  for (const accountId of Object.keys(next.accounts)) {
    if (!validIds.has(accountId)) delete next.accounts[accountId];
  }

  for (const account of index.accounts) {
    const previous = next.accounts[account.id] || null;
    try {
      const checkedAt = new Date().toISOString();
      const snapshot = snapshotFromResult(await probeSavedAccount(account, index), checkedAt);
      if (confirm) snapshot.confirmedAt = checkedAt;
      next.accounts[account.id] = snapshot;
    } catch (error) {
      next.accounts[account.id] = {
        ...(previous || { checkedAt: null, confirmedAt: null, fiveHour: null, weekly: null, rateLimitReachedType: null }),
        status: 'error',
        error: normalizeError(error),
      };
    }
  }

  const completedAt = new Date().toISOString();
  next.checkedAt = completedAt;
  if (confirm) {
    next.confirmedAt = completedAt;
    next.confirmationPendingUntil = null;
  } else if (index.accounts.length) {
    next.confirmationPendingUntil = new Date(Date.now() + RATE_LIMIT_CONFIRM_DELAY_MS).toISOString();
  }
  await writeIndex(index);
  await writeRateLimitCache(next);
  await emitRateLimits();
  if (confirm) await evaluateGuardedHandoff();

  if (!confirm && index.accounts.length) {
    if (rateLimitConfirmationTimer) clearTimeout(rateLimitConfirmationTimer);
    rateLimitConfirmationTimer = setTimeout(() => {
      rateLimitConfirmationTimer = null;
      refreshRateLimits({ confirm: true }).catch(() => {});
    }, RATE_LIMIT_CONFIRM_DELAY_MS);
  }
}

async function refreshRateLimits({ confirm = false } = {}) {
  if (rateLimitRefreshPromise) return rateLimitRefreshPromise.then(() => publicRateLimits());
  rateLimitRefreshing = true;
  await emitRateLimits();
  const task = queueOperation(() => runRateLimitRefreshPass({ confirm }));
  rateLimitRefreshPromise = task;
  try {
    await task;
  } finally {
    rateLimitRefreshing = false;
    rateLimitRefreshPromise = null;
    await emitRateLimits();
  }
  return publicRateLimits();
}

function scheduleWindowSizeSave() {
  if (resizeSaveTimer) clearTimeout(resizeSaveTimer);
  resizeSaveTimer = setTimeout(() => {
    resizeSaveTimer = null;
    queueOperation(async () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      const [width, height] = mainWindow.getSize();
      const settings = await readSettings();
      settings.lastWindowSize = { width, height };
      await writeSettings(settings);
    }).catch(() => {});
  }, 250);
}

function protect(bytes) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable for the current user.');
  return safeStorage.encryptString(Buffer.from(bytes).toString('base64'));
}

function unprotect(bytes) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('OS credential encryption is unavailable for the current user.');
  const plainB64 = safeStorage.decryptString(bytes);
  return Buffer.from(plainB64, 'base64');
}

function accountBlobPath(id) {
  return path.join(STORE_ROOT, `${id}.secure`);
}

function queueOperation(fn) {
  const run = operationQueue.then(fn, fn);
  operationQueue = run.catch(() => {});
  return run;
}

async function readCurrentAuth() {
  const bytes = await fs.readFile(AUTH_PATH);
  JSON.parse(bytes.toString('utf8'));
  return bytes;
}

function assertReauthIdentity(expected = {}, actual = {}) {
  assertSavedIdentity(expected, actual);
}

async function importCurrentAccount(displayName) {
  return queueOperation(async () => {
    assertSupportedPlatform();
    await ensureDirs();
    await ensureCodexCompatibility();

    const auth = await readCurrentAuth();
    const identity = deriveIdentity(auth);
    assertSavedIdentity(identity, identity);
    const index = await readIndex();

    if (index.pendingLogin?.mode === 'reauth') {
      throw new Error('A re-authentication is pending. Use Complete re-auth instead of Import.');
    }

    const existing = index.accounts.find((account) => identityMatches(account.identity, identity));
    if (existing) {
      await writeAtomic(accountBlobPath(existing.id), protect(auth));
      existing.identity = { ...existing.identity, ...identity };
      if (displayName) existing.displayName = String(displayName).slice(0, 60);
      existing.lastAuthenticatedAt = new Date().toISOString();
      index.activeId = existing.id;
      index.pendingLogin = null;
      await writeIndex(index);
      registerShortcuts(publicState(index));
      updateTrayMenu().catch(() => {});
      recordUsage('import', existing.id).catch(() => {});
      return publicState(index, `Updated the existing saved account ${existing.displayName}.`);
    }

    const id = crypto.randomUUID();
    await writeAtomic(accountBlobPath(id), protect(auth));
    index.accounts.push({
      id,
      displayName: String(displayName || identity.email || 'Account').slice(0, 60),
      identity,
      createdAt: new Date().toISOString(),
      lastAuthenticatedAt: new Date().toISOString(),
    });
    index.activeId = id;
    index.pendingLogin = null;
    await writeIndex(index);
    registerShortcuts(publicState(index));
    updateTrayMenu().catch(() => {});
    recordUsage('import', id).catch(() => {});
    return publicState(index);
  });
}

async function saveActiveCredential(index) {
  if (!index.activeId || !(await exists(AUTH_PATH))) return;
  const account = index.accounts.find((a) => a.id === index.activeId);
  if (!account) return;
  const auth = await readCurrentAuth();
  assertSavedIdentity(account.identity, deriveIdentity(auth));
  await writeAtomic(accountBlobPath(account.id), protect(auth));
  account.identity = { ...account.identity, ...deriveIdentity(auth) };
  account.lastSavedAt = new Date().toISOString();
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'ignore',
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    if (options.capture) {
      child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    }
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) resolve(options.capture ? stdout.trim() : undefined);
      else reject(new Error((stderr || stdout || `${command} exited with ${code}`).trim()));
    });
  });
}

async function closeCodex() {
  if (isMac) {
    try {
      await run('/usr/bin/osascript', ['-e', 'tell application "Codex" to quit']);
    } catch {
      await run('/usr/bin/pkill', ['-x', 'Codex']).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 700));
    return;
  }

  if (isWindows) {
    const script = `
$ErrorActionPreference = 'Stop'
$pkg = Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Select-Object -First 1
$install = if ($pkg) { $pkg.InstallLocation } else { $null }

function Get-CodexPackageProcesses {
  $items = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ieq 'ChatGPT.exe' -or $_.Name -ieq 'codex.exe' })

  if ($install) {
    return @($items | Where-Object {
      $_.ExecutablePath -and
      $_.ExecutablePath.StartsWith($install, [System.StringComparison]::OrdinalIgnoreCase)
    })
  }

  return @($items | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath -like '*\\WindowsApps\\OpenAI.Codex_*'
  })
}

$owned = @(Get-CodexPackageProcesses)
if ($owned.Count -eq 0) { exit 0 }

$shells = @($owned |
  Where-Object { $_.Name -ieq 'ChatGPT.exe' } |
  ForEach-Object { Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } |
  Where-Object { $_ -and $_.MainWindowHandle -ne 0 })

foreach ($p in $shells) {
  try { $null = $p.CloseMainWindow() } catch {}
}

Start-Sleep -Milliseconds 700

$remaining = @(Get-CodexPackageProcesses)
foreach ($p in $remaining) {
  Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
}

for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Milliseconds 150
  if (@(Get-CodexPackageProcesses).Count -eq 0) { exit 0 }
}

[Console]::Error.Write('Timed out waiting for the Codex package process group to stop.')
exit 1
`;
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { capture: true });
    return;
  }

  assertSupportedPlatform();
}

async function openCodex() {
  if (isMac) {
    await run('/usr/bin/open', ['-a', 'Codex']);
    return;
  }

  if (isWindows) {
    const script = `
$ErrorActionPreference = 'Stop'
$pkg = Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Select-Object -First 1

if ($pkg) {
  Start-Process explorer.exe -ArgumentList 'shell:AppsFolder\\${WINDOWS_CODEX_AUMID}'
  exit 0
}

$app = Get-StartApps |
  Where-Object { $_.AppID -like 'OpenAI.Codex*!App' -or $_.Name -eq 'Codex' } |
  Select-Object -First 1

if ($app) {
  Start-Process explorer.exe -ArgumentList ("shell:AppsFolder\\" + $app.AppID)
  exit 0
}

$startMenus = @(
  "$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs",
  "$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs"
)

$shortcut = Get-ChildItem -Path $startMenus -Filter '*Codex*.lnk' -Recurse -ErrorAction SilentlyContinue |
  Select-Object -First 1

if ($shortcut) {
  Start-Process $shortcut.FullName
  exit 0
}

[Console]::Error.Write('Could not locate the registered Codex desktop app.')
exit 1
`;
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { capture: true });
    return;
  }

  assertSupportedPlatform();
}

async function isCodexRunning() {
  if (isMac) {
    try {
      await run('/usr/bin/pgrep', ['-x', 'Codex']);
      return true;
    } catch {
      return false;
    }
  }

  if (isWindows) {
    const script = `
$pkg = Get-AppxPackage -Name OpenAI.Codex -ErrorAction SilentlyContinue | Select-Object -First 1
$install = if ($pkg) { $pkg.InstallLocation } else { $null }
$items = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -ieq 'ChatGPT.exe' -or $_.Name -ieq 'codex.exe' })
if ($install) {
  $items = @($items | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($install, [System.StringComparison]::OrdinalIgnoreCase) })
} else {
  $items = @($items | Where-Object { $_.ExecutablePath -and $_.ExecutablePath -like '*\\WindowsApps\\OpenAI.Codex_*' })
}
if ($items.Count -gt 0) { [Console]::Out.Write('1') } else { [Console]::Out.Write('0') }
`;
    return (await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { capture: true })) === '1';
  }

  assertSupportedPlatform();
  return true;
}

async function waitForCodexRunning(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isCodexRunning()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function prepareLogin(mode, accountId = null) {
  return queueOperation(async () => {
    assertSupportedPlatform();
    await ensureDirs();
    await ensureCodexCompatibility();

    const index = await readIndex();
    if (index.pendingLogin) throw new Error('Another account sign-in flow is already pending. Complete or cancel it first.');

    let target = null;
    if (mode === 'reauth') {
      target = index.accounts.find((account) => account.id === accountId);
      if (!target) throw new Error('Account not found.');
    }

    await closeCodex();

    let original = null;
    try {
      if (await exists(AUTH_PATH)) {
        original = await readCurrentAuth();
        await writeAtomic(BACKUP_PATH, protect(original));
        await saveActiveCredential(index);
      }

      await fs.rm(AUTH_PATH, { force: true });
      index.pendingLogin = {
        mode,
        accountId: target?.id || null,
        startedAt: new Date().toISOString(),
      };
      await writeIndex(index);
    } catch (error) {
      if (original) await writeAtomic(AUTH_PATH, original).catch(() => {});
      await openCodex().catch(() => {});
      throw error;
    }

    let warning = null;
    try {
      await openCodex();
    } catch (error) {
      warning = `Local login was prepared, but Codex could not be reopened automatically: ${error.message}`;
    }

    updateTrayMenu().catch(() => {});
    return publicState(index, warning);
  });
}

async function prepareNewAccount() {
  return prepareLogin('new');
}

async function prepareReauth(accountId) {
  return prepareLogin('reauth', accountId);
}

async function completeReauth() {
  return queueOperation(async () => {
    assertSupportedPlatform();
    await ensureDirs();
    await ensureCodexCompatibility();

    const index = await readIndex();
    if (index.pendingLogin?.mode !== 'reauth' || !index.pendingLogin.accountId) {
      throw new Error('No account re-authentication is pending.');
    }

    const target = index.accounts.find((account) => account.id === index.pendingLogin.accountId);
    if (!target) throw new Error('The account being re-authenticated no longer exists.');

    const auth = await readCurrentAuth();
    const identity = deriveIdentity(auth);
    assertReauthIdentity(target.identity, identity);

    await writeAtomic(accountBlobPath(target.id), protect(auth));
    target.identity = { ...target.identity, ...identity };
    target.lastAuthenticatedAt = new Date().toISOString();
    index.activeId = target.id;
    index.pendingLogin = null;
    await writeIndex(index);
    updateTrayMenu().catch(() => {});
    recordUsage('reauth', target.id).catch(() => {});
    return publicState(index, `${target.displayName} was re-authenticated successfully.`);
  });
}

async function cancelPendingLogin() {
  return queueOperation(async () => {
    assertSupportedPlatform();
    await ensureDirs();
    await ensureCodexCompatibility();

    const index = await readIndex();
    if (!index.pendingLogin) return publicState(index);

    const active = index.accounts.find((account) => account.id === index.activeId);
    if (!active) {
      index.pendingLogin = null;
      await writeIndex(index);
      updateTrayMenu().catch(() => {});
      return publicState(index, 'Pending sign-in was cleared. No saved active account was available to restore.');
    }

    const activeAuth = unprotect(await fs.readFile(accountBlobPath(active.id)));
    JSON.parse(activeAuth.toString('utf8'));

    await closeCodex();
    await writeAtomic(AUTH_PATH, activeAuth);
    index.pendingLogin = null;
    await writeIndex(index);
    updateTrayMenu().catch(() => {});

    let warning = null;
    try {
      await openCodex();
    } catch (error) {
      warning = `Pending sign-in was cancelled and ${active.displayName} was restored, but Codex could not be reopened automatically: ${error.message}`;
    }

    updateTrayMenu().catch(() => {});
    return publicState(index, warning);
  });
}

async function switchAccountNow(targetId, { closeRunningCodex = true } = {}) {
    assertSupportedPlatform();
    await ensureDirs();
    await ensureCodexCompatibility();

    const index = await readIndex();
    const target = index.accounts.find((a) => a.id === targetId);
    if (!target) throw new Error('Account not found.');
    if (!index.pendingLogin && index.activeId === targetId) return publicState(index);

    const targetCipher = await fs.readFile(accountBlobPath(targetId));
    const targetAuth = unprotect(targetCipher);
    JSON.parse(targetAuth.toString('utf8'));
    assertSavedIdentity(target.identity, deriveIdentity(targetAuth));

    if (closeRunningCodex) {
      await closeCodex();
    } else if (await isCodexRunning()) {
      throw Object.assign(new Error('Codex is running; guarded handoff will not close it.'), { code: 'HANDOFF_CODEX_RUNNING' });
    }

    let original = null;
    try {
      // Recheck immediately before touching credentials. The guarded path is
      // intentionally incapable of closing Codex if it reappears.
      if (!closeRunningCodex && await isCodexRunning()) {
        throw Object.assign(new Error('Codex restarted before the handoff could begin.'), { code: 'HANDOFF_CODEX_RUNNING' });
      }
      if (await exists(AUTH_PATH)) {
        original = await readCurrentAuth();
        await writeAtomic(BACKUP_PATH, protect(original));
      }

      // During a pending new-login/reauth flow, auth.json may belong to an
      // uncommitted account. The previously active account was already saved
      // before the local auth file was cleared, so do not overwrite its vault.
      if (!index.pendingLogin) await saveActiveCredential(index);

      await writeAtomic(AUTH_PATH, targetAuth);
      index.activeId = targetId;
      index.pendingLogin = null;
      target.identity = { ...target.identity, ...deriveIdentity(targetAuth) };
      target.lastSwitchedAt = new Date().toISOString();
      await writeIndex(index);
      recordUsage('switch', target.id).catch(() => {});
    } catch (error) {
      if (original) await writeAtomic(AUTH_PATH, original).catch(() => {});
      await openCodex().catch(() => {});
      throw error;
    }

    let warning = null;
    try {
      await openCodex();
    } catch (error) {
      warning = `Account switched successfully, but Codex could not be reopened automatically: ${error.message}`;
    }

    const state = publicState(index, warning);
    publishState(mainWindow, state);
    updateTrayMenu().catch(() => {});
    return state;
}

async function switchAccount(targetId) {
  return queueOperation(() => switchAccountNow(targetId));
}

function stopHandoffMonitor() {
  if (handoffMonitorTimer) clearInterval(handoffMonitorTimer);
  handoffMonitorTimer = null;
}

function configureGuardedUsagePolling(enabled) {
  if (guardedUsagePollTimer) clearInterval(guardedUsagePollTimer);
  guardedUsagePollTimer = null;
  guardedHandoffBackgroundEnabled = Boolean(enabled);
  if (!enabled) return;
  guardedUsagePollTimer = setInterval(() => {
    refreshRateLimits({ confirm: false }).catch(() => {});
  }, GUARDED_USAGE_POLL_MS);
}

function startHandoffMonitor() {
  if (handoffMonitorTimer) return;
  handoffMonitorTimer = setInterval(() => {
    executeQueuedHandoff().catch(() => {});
  }, 15000);
  setTimeout(() => executeQueuedHandoff().catch(() => {}), 1000);
}

async function queueGuardedHandoff(decision) {
  const previous = await readHandoffJournal();
  if (['queued', 'switching', 'verifying'].includes(previous.phase)) return previous;
  const now = new Date().toISOString();
  const journal = await writeHandoffJournal({
    version: 1,
    id: crypto.randomUUID(),
    phase: 'queued',
    sourceId: decision.sourceId,
    targetId: decision.targetId,
    trigger: decision.trigger,
    createdAt: now,
    updatedAt: now,
    lastCompletedAt: previous.lastCompletedAt,
    message: 'Waiting for Codex to close before switching.',
  });
  await emitHandoff();
  startHandoffMonitor();
  return journal;
}

async function evaluateGuardedHandoff() {
  const [index, settings, journal] = await Promise.all([readIndex(), readSettings(), readHandoffJournal()]);
  const decision = chooseHandoff({
    accounts: index.accounts,
    activeId: index.activeId,
    rateLimits: rateLimitCache.accounts,
    settings: settings.guardedHandoff,
    journal,
  });
  if (decision.status === 'ready') await queueGuardedHandoff(decision);
  return decision;
}

async function failGuardedHandoff(journal, code, message) {
  const failed = await writeHandoffJournal({
    ...journal,
    phase: 'failed',
    updatedAt: new Date().toISOString(),
    errorCode: code,
    message,
  });
  stopHandoffMonitor();
  await emitHandoff();
  return failed;
}

async function executeQueuedHandoff() {
  if (handoffExecutionPromise) return handoffExecutionPromise;
  handoffExecutionPromise = queueOperation(async () => {
    let journal = await readHandoffJournal();
    if (journal.phase !== 'queued') {
      stopHandoffMonitor();
      return publicHandoffState();
    }
    const [index, settings] = await Promise.all([readIndex(), readSettings()]);
    if (!settings.guardedHandoff.enabled) {
      journal = await writeHandoffJournal({ ...journal, phase: 'cancelled', updatedAt: new Date().toISOString(), message: 'Guarded handoff was turned off.' });
      stopHandoffMonitor();
      await emitHandoff();
      return publicHandoffState();
    }
    const decision = chooseHandoff({
      accounts: index.accounts,
      activeId: index.activeId,
      rateLimits: rateLimitCache.accounts,
      settings: settings.guardedHandoff,
      journal: { ...journal, phase: 'idle' },
    });
    if (decision.status !== 'ready' || decision.sourceId !== journal.sourceId || decision.targetId !== journal.targetId) {
      return failGuardedHandoff(journal, 'HANDOFF_REVALIDATION_FAILED', 'Usage or account eligibility changed before the switch. Refresh usage to try again.');
    }
    if (await isCodexRunning()) return publicHandoffState();

    journal = await writeHandoffJournal({ ...journal, phase: 'switching', updatedAt: new Date().toISOString(), message: 'Switching accounts.' });
    await emitHandoff();
    try {
      const switchedState = await switchAccountNow(journal.targetId, { closeRunningCodex: false });
      if (switchedState.warning || !(await waitForCodexRunning())) {
        throw Object.assign(new Error('Codex did not reopen on the destination account.'), { code: 'HANDOFF_REOPEN_FAILED' });
      }
      journal = await writeHandoffJournal({ ...journal, phase: 'verifying', updatedAt: new Date().toISOString(), message: 'Verifying the reopened account.' });
      await emitHandoff();

      const nextIndex = await readIndex();
      const target = nextIndex.accounts.find((account) => account.id === journal.targetId);
      if (!target || nextIndex.activeId !== target.id) throw Object.assign(new Error('The destination account did not become active.'), { code: 'HANDOFF_VERIFY_FAILED' });
      const liveIdentity = deriveIdentity(await readCurrentAuth());
      if (!identityMatches(target.identity, liveIdentity)) throw Object.assign(new Error('The reopened account identity did not match the destination.'), { code: 'HANDOFF_VERIFY_FAILED' });

      const completedAt = new Date().toISOString();
      journal = await writeHandoffJournal({
        ...journal,
        phase: 'continuationReady',
        updatedAt: completedAt,
        completedAt,
        lastCompletedAt: completedAt,
        errorCode: null,
        message: 'Codex reopened on the destination account. Continue the previous task when ready; no new turn was submitted.',
      });
      stopHandoffMonitor();
      await emitHandoff();
      return publicHandoffState();
    } catch (error) {
      const current = await readIndex().catch(() => null);
      if (current?.activeId === journal.targetId && current.accounts.some((account) => account.id === journal.sourceId)) {
        // Recovery follows the same no-close contract. If Codex is already
        // running, leave it untouched and surface the failed journal instead.
        await switchAccountNow(journal.sourceId, { closeRunningCodex: false }).catch(() => {});
      }
      const code = ['HANDOFF_VERIFY_FAILED', 'HANDOFF_REOPEN_FAILED'].includes(error?.code) ? error.code : 'HANDOFF_SWITCH_FAILED';
      return failGuardedHandoff(journal, code, 'The guarded handoff failed. The source account was restored when possible.');
    }
  });
  try {
    return await handoffExecutionPromise;
  } finally {
    handoffExecutionPromise = null;
  }
}

async function cancelGuardedHandoff() {
  return queueOperation(async () => {
    const journal = await readHandoffJournal();
    if (journal.phase !== 'queued') return publicHandoffState();
    await writeHandoffJournal({ ...journal, phase: 'cancelled', updatedAt: new Date().toISOString(), message: 'Queued handoff cancelled.' });
    stopHandoffMonitor();
    await emitHandoff();
    return publicHandoffState();
  });
}

async function acknowledgeGuardedHandoff() {
  return queueOperation(async () => {
    const journal = await readHandoffJournal();
    if (!['continuationReady', 'failed', 'cancelled'].includes(journal.phase)) return publicHandoffState();
    await writeHandoffJournal({ ...journal, phase: 'completed', updatedAt: new Date().toISOString(), message: null, errorCode: null });
    await emitHandoff();
    return publicHandoffState();
  });
}

async function recoverGuardedHandoff() {
  const journal = await readHandoffJournal();
  if (journal.phase === 'queued') {
    startHandoffMonitor();
    return;
  }
  if (!['switching', 'verifying'].includes(journal.phase)) return;
  const index = await readIndex();
  const now = new Date().toISOString();
  if (index.activeId === journal.targetId) {
    await writeHandoffJournal({ ...journal, phase: 'continuationReady', updatedAt: now, completedAt: now, lastCompletedAt: now, message: 'Recovered after restart. Verify the destination account in Codex before continuing.' });
  } else {
    await writeHandoffJournal({ ...journal, phase: 'failed', updatedAt: now, errorCode: 'HANDOFF_RECOVERY_REQUIRED', message: 'A previous handoff stopped before verification. Review the active account before continuing.' });
  }
}

async function removeAccount(id) {
  return queueOperation(async () => {
    const index = await readIndex();
    if (index.activeId === id) throw new Error('Switch to another account before removing the active account.');
    if (index.pendingLogin?.accountId === id) throw new Error('Complete or cancel this account re-authentication before removing it.');
    index.accounts = index.accounts.filter((a) => a.id !== id);
    await fs.rm(accountBlobPath(id), { force: true });
    await writeIndex(index);
    registerShortcuts(publicState(index));
    return publicState(index);
  });
}

function defaultShortcutForIndex(index) {
  return `Control+Alt+${index + 1}`;
}

function isValidAccelerator(value) {
  const parts = String(value || '').split('+').filter(Boolean);
  const key = parts.pop();
  const modifiers = new Set(['Control', 'Alt', 'Shift', 'Command', 'Super']);
  return parts.length > 0 && parts.every((part) => modifiers.has(part)) && key && !modifiers.has(key) && /^[A-Za-z0-9]+$/.test(key);
}

function accountHealth(account) {
  const timestamps = [account.lastAuthenticatedAt, account.lastSavedAt, account.createdAt]
    .filter(Boolean)
    .map((value) => ({ value, timestamp: new Date(value).getTime() }))
    .filter((item) => Number.isFinite(item.timestamp))
    .sort((left, right) => right.timestamp - left.timestamp);
  const updatedAt = timestamps[0]?.value || null;
  if (!updatedAt) return { level: 'unknown', label: 'Unknown', updatedAt: null };
  const timestamp = new Date(updatedAt).getTime();
  if (!Number.isFinite(timestamp)) return { level: 'unknown', label: 'Unknown', updatedAt: null };
  const ageDays = Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
  if (ageDays <= 7) return { level: 'fresh', label: 'Fresh', updatedAt, ageDays };
  if (ageDays <= 30) return { level: 'aging', label: 'Aging', updatedAt, ageDays };
  return { level: 'stale', label: 'Stale', updatedAt, ageDays };
}

function registerShortcuts(state) {
  for (const accelerator of registeredAccelerators) {
    try { globalShortcut.unregister(accelerator); } catch {}
  }
  registeredAccelerators = new Set();
  const used = new Set();
  const failures = [];
  state.accounts.forEach((account, index) => {
    const accelerator = account.shortcut || defaultShortcutForIndex(index);
    if (used.has(accelerator)) {
      failures.push(account.displayName);
      return;
    }
    try {
      const registered = globalShortcut.register(accelerator, async () => {
        const latest = await getState();
        const target = latest.accounts.find((item) => item.id === account.id);
        if (target && (!target.isActive || latest.pendingLogin)) switchAccount(target.id).catch(() => {});
      });
      if (registered) {
        used.add(accelerator);
        registeredAccelerators.add(accelerator);
      } else failures.push(account.displayName);
    } catch { failures.push(account.displayName); }
  });
  return failures;
}

async function setAccountShortcut(id, accelerator) {
  return queueOperation(async () => {
    assertSupportedPlatform();
    const index = await readIndex();
    const target = index.accounts.find((account) => account.id === id);
    if (!target) throw new Error('Account not found.');
    if (!isValidAccelerator(accelerator)) throw new Error('Use a valid shortcut with at least one modifier key.');
    const duplicate = index.accounts.some((account, accountIndex) => account.id !== id && (account.shortcut || defaultShortcutForIndex(accountIndex)) === accelerator);
    if (duplicate) throw new Error('That shortcut is already assigned to another saved account.');
    target.shortcut = accelerator;
    await writeIndex(index);
    const failures = registerShortcuts(publicState(index));
    const warning = failures.includes(target.displayName) ? `Saved the shortcut, but ${prettyAccelerator(accelerator)} is already in use by another app.` : null;
    updateTrayMenu().catch(() => {});
    return publicState(index, warning);
  });
}

function prettyAccelerator(accelerator) {
  return String(accelerator).replaceAll('Control', 'Ctrl').replaceAll('Super', 'Win').replaceAll('+', ' + ');
}

/**
 * Read-only view of the login Codex is using right now. Used by the renderer
 * to tell you which account is live without waiting for a switch.
 */
async function getLiveAccount() {
  try {
    const identity = deriveIdentity(await readCurrentAuth());
    return { present: true, email: identity.email || null, planType: identity.planType || null };
  } catch {
    return { present: false, email: null, planType: null };
  }
}

function publicState(index, warning = null) {
  const normalized = normalizeIndex(index);
  const pendingTarget = normalized.pendingLogin?.accountId
    ? normalized.accounts.find((account) => account.id === normalized.pendingLogin.accountId)
    : null;

  return {
    activeId: normalized.activeId,
    warning,
    pendingLogin: normalized.pendingLogin
      ? {
          mode: normalized.pendingLogin.mode,
          accountId: normalized.pendingLogin.accountId || null,
          accountName: pendingTarget?.displayName || null,
          startedAt: normalized.pendingLogin.startedAt || null,
        }
      : null,
    configCompatibility: configCompatibility.changed
      ? { changed: true, backupPath: configCompatibility.backupPath || null }
      : { changed: false, backupPath: null },
    accounts: normalized.accounts.map((a) => ({
      id: a.id,
      displayName: a.displayName,
      email: a.identity?.email || null,
      planType: a.identity?.planType || null,
      shortcut: a.shortcut || null,
      isActive: a.id === normalized.activeId,
      isPendingReauth: normalized.pendingLogin?.mode === 'reauth' && normalized.pendingLogin.accountId === a.id,
      lastSwitchedAt: a.lastSwitchedAt || null,
      lastAuthenticatedAt: a.lastAuthenticatedAt || null,
      health: accountHealth(a),
    })),
  };
}

async function getState() {
  return publicState(await readIndex());
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

async function updateTrayMenu() {
  if (!tray) return;
  const state = await getState();
  const accountItems = state.accounts.length
    ? state.accounts.map((account) => ({
        label: `${account.isActive ? '✓ ' : ''}${account.displayName}`,
        enabled: !account.isActive || Boolean(state.pendingLogin),
        click: () => switchAccount(account.id).then(updateTrayMenu).catch(() => {}),
      }))
    : [{ label: 'No saved accounts', enabled: false }];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open account switcher', click: showMainWindow },
    { type: 'separator' },
    { label: 'Switch account', submenu: accountItems },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]));
}

function createTray() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="4" fill="#a3adff"/><path d="M5 4.5h6v2H7v1h3.5v2H7v2.5H5z" fill="#171a21"/></svg>';
  tray = new Tray(nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`));
  tray.setToolTip(APP_NAME);
  tray.on('click', showMainWindow);
  updateTrayMenu().catch(() => {});
}

function installNetworkDeny() {
  const filter = { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] };
  session.defaultSession.webRequest.onBeforeRequest(filter, (_details, cb) => cb({ cancel: true }));
}

function hardenNavigation(win) {
  const appUrl = pathToFileURL(path.join(__dirname, 'ui', 'index.html')).href;
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== appUrl) event.preventDefault();
  });
}

function createWindow(settings) {
  const preset = WINDOW_PRESETS[settings.windowPreset] || WINDOW_PRESETS.standard;
  const remembered = settings.rememberLastWindowSize && settings.lastWindowSize;
  const size = remembered || preset;
  mainWindow = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: 360,
    minHeight: 560,
    title: APP_NAME,
    backgroundColor: '#111111',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  hardenNavigation(mainWindow);
  mainWindow.on('resize', scheduleWindowSizeSave);
  mainWindow.on('close', (event) => {
    if (!appIsQuitting && guardedHandoffBackgroundEnabled) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

function installIpc() {
  remoteController = new RemoteController({ app, safeStorage, notify: event => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('remote:event', event);
  } });
  const remoteHandler = (channel, handler) => ipcMain.handle(channel, async (event, ...args) => {
    if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return { ok: false, error: { code: 'FORBIDDEN', message: 'This window cannot manage server accounts.' } };
    try { return { ok: true, value: await handler(...args) }; }
    catch (error) {
      // Only deliberate public errors may cross IPC. OS errors can contain
      // local paths or server output and are not renderer response fields.
      const publicCodes = new Set(['INVALID_HOST', 'ARGUMENTS', 'SERVER_EXISTS', 'BUSY', 'LOCAL_KEYCHAIN', 'VAULT_KEY_MISSING', 'HELPER_UPDATE', 'SSH_HOST_KEY', 'SSH_AUTH', 'HELPER_MISSING', 'SSH_FAILED', 'SSH_TIMEOUT', 'CANCELLED', 'REMOTE_PROTOCOL', 'LOGIN_CODE_UNAVAILABLE']);
      const serverError = require('./server/errors').publicError(error);
      return { ok: false, error: publicCodes.has(error.code) ? { code: error.code, message: error.message } : serverError };
    }
  });
  remoteHandler('remote:servers', () => remoteController.list());
  remoteHandler('remote:add', value => remoteController.add(value));
  remoteHandler('remote:remove', host => remoteController.remove(host));
  remoteHandler('remote:snapshot', host => remoteController.snapshot(host));
  remoteHandler('remote:install', host => remoteController.install(host));
  remoteHandler('remote:mutate', (host, method, label) => remoteController.mutate(host, method, label));
  remoteHandler('remote:cancel', host => remoteController.cancel(host));
  remoteHandler('remote:copy-code', host => { clipboard.writeText(remoteController.currentDeviceCode(host)); return true; });
  remoteHandler('remote:unlock', (host, passphrase) => remoteController.unlock(host, passphrase));
  remoteHandler('remote:copy-vault-key', host => remoteController.copyVaultKey(host, value => clipboard.writeText(value)));
  remoteHandler('remote:open-login', () => shell.openExternal('https://auth.openai.com/codex/device'));
  ipcMain.handle('state:get', getState);
  ipcMain.handle('state:live', getLiveAccount);
  ipcMain.handle('account:import-current', (_event, name) => importCurrentAccount(name));
  ipcMain.handle('account:prepare-new', () => prepareNewAccount());
  ipcMain.handle('account:prepare-reauth', (_event, id) => prepareReauth(id));
  ipcMain.handle('account:complete-reauth', () => completeReauth());
  ipcMain.handle('account:cancel-pending', () => cancelPendingLogin());
  ipcMain.handle('account:switch', (_event, id) => switchAccount(id));
  ipcMain.handle('account:remove', (_event, id) => removeAccount(id));
  ipcMain.handle('account:set-shortcut', (_event, id, accelerator) => setAccountShortcut(id, accelerator));
  ipcMain.handle('settings:get', getSettings);
  ipcMain.handle('settings:set', (_event, changes) => setSettings(changes));
  ipcMain.handle('usage:get', getUsage);
  ipcMain.handle('usage:clear', clearUsage);
  ipcMain.handle('rate-limits:get', publicRateLimits);
  ipcMain.handle('rate-limits:refresh', () => refreshRateLimits({ confirm: false }));
  ipcMain.handle('handoff:get', publicHandoffState);
  ipcMain.handle('handoff:cancel', cancelGuardedHandoff);
  ipcMain.handle('handoff:acknowledge', acknowledgeGuardedHandoff);
  ipcMain.handle('codex:open', () => openCodex());
  ipcMain.handle('folder:open-store', () => shell.openPath(app.getPath('userData')));
  ipcMain.handle('update:get', () => autoUpdater?.getStatus() || { supported: isMac, enabled: false, state: 'idle', currentVersion: app.getVersion(), availableVersion: null, percent: null, checkedAt: null, error: null });
  ipcMain.handle('update:check', () => autoUpdater?.checkForUpdates());
  ipcMain.handle('update:download', () => autoUpdater?.downloadUpdate());
  ipcMain.handle('update:install', () => {
    appIsQuitting = true;
    return autoUpdater?.installUpdate();
  });
}

app.whenReady().then(async () => {
  if (!primaryInstance) return;
  assertSupportedPlatform();
  await ensureDirs();
  await ensureCodexCompatibility();
  rateLimitCache = await readRateLimitCache();
  // Never sweep abandoned probe homes: a failed persistence/child shutdown
  // may have deliberately retained the newest credential copy there.
  await recoverGuardedHandoff();
  const settings = await readSettings();
  configureGuardedUsagePolling(settings.guardedHandoff.enabled);
  applyLaunchOnLogin(settings.launchOnLogin);
  installNetworkDeny();
  installIpc();
  createWindow(settings);
  autoUpdater = createAutoUpdater({
    supported: isMac,
    packaged: app.isPackaged,
    onStatus: (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:status', status);
    },
  });
  createTray();
  registerShortcuts(await getState());
  recordUsage('open').catch(() => {});
  setTimeout(() => refreshRateLimits({ confirm: false }).catch(() => {}), 600);
  if (isMac && app.isPackaged) setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 10_000);
});

app.on('will-quit', () => {
  appIsQuitting = true;
  if (rateLimitConfirmationTimer) clearTimeout(rateLimitConfirmationTimer);
  if (guardedUsagePollTimer) clearInterval(guardedUsagePollTimer);
  stopHandoffMonitor();
  autoUpdater?.dispose();
  remoteController?.dispose();
  globalShortcut.unregisterAll();
});
app.on('before-quit', () => { appIsQuitting = true; });
app.on('window-all-closed', () => {
  if (!guardedHandoffBackgroundEnabled) app.quit();
});
