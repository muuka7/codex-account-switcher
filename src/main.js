const { app, BrowserWindow, ipcMain, safeStorage, session, globalShortcut, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { ensureFileCredentialStore } = require('./codex-config');

const APP_NAME = 'Codex Account Switcher';
const CODEX_HOME = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
const AUTH_PATH = path.join(CODEX_HOME, 'auth.json');
const STORE_ROOT = path.join(app.getPath('userData'), 'vault');
const INDEX_PATH = path.join(app.getPath('userData'), 'accounts.json');
const BACKUP_PATH = path.join(app.getPath('userData'), 'last-auth-backup.secure');
const WINDOWS_CODEX_AUMID = 'OpenAI.Codex_2p2nqsd0c76g0!App';
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

let mainWindow;
let operationQueue = Promise.resolve();
let configCompatibility = { changed: false, backupPath: null };

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

async function readIndex() {
  try {
    return JSON.parse(await fs.readFile(INDEX_PATH, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return { version: 1, activeId: null, accounts: [] };
    throw error;
  }
}

async function writeIndex(index) {
  await writeAtomic(INDEX_PATH, Buffer.from(`${JSON.stringify(index, null, 2)}\n`, 'utf8'));
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

function deriveIdentity(authBytes) {
  try {
    const auth = JSON.parse(authBytes.toString('utf8'));
    const token = auth?.tokens?.id_token || auth?.tokens?.access_token;
    if (!token || !token.includes('.')) return {};
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = JSON.parse(Buffer.from(payload.padEnd(Math.ceil(payload.length / 4) * 4, '='), 'base64').toString('utf8'));
    const nested = decoded?.['https://api.openai.com/auth'] || {};
    return {
      email: decoded.email || nested.email || null,
      accountId: nested.chatgpt_account_id || null,
      planType: nested.chatgpt_plan_type || null,
    };
  } catch {
    return {};
  }
}

async function importCurrentAccount(displayName) {
  return queueOperation(async () => {
    assertSupportedPlatform();
    await ensureDirs();
    await ensureCodexCompatibility();
    const auth = await readCurrentAuth();
    const identity = deriveIdentity(auth);
    const index = await readIndex();
    const id = crypto.randomUUID();
    await writeAtomic(accountBlobPath(id), protect(auth));
    index.accounts.push({
      id,
      displayName: String(displayName || identity.email || 'Account').slice(0, 60),
      identity,
      createdAt: new Date().toISOString(),
    });
    index.activeId = id;
    await writeIndex(index);
    return publicState(index);
  });
}

async function saveActiveCredential(index) {
  if (!index.activeId || !(await exists(AUTH_PATH))) return;
  const account = index.accounts.find((a) => a.id === index.activeId);
  if (!account) return;
  const auth = await readCurrentAuth();
  await writeAtomic(accountBlobPath(account.id), protect(auth));
  account.identity = { ...account.identity, ...deriveIdentity(auth) };
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

async function switchAccount(targetId) {
  return queueOperation(async () => {
    assertSupportedPlatform();
    await ensureDirs();
    await ensureCodexCompatibility();

    const index = await readIndex();
    const target = index.accounts.find((a) => a.id === targetId);
    if (!target) throw new Error('Account not found.');
    if (index.activeId === targetId) return publicState(index);

    const targetCipher = await fs.readFile(accountBlobPath(targetId));
    const targetAuth = unprotect(targetCipher);
    JSON.parse(targetAuth.toString('utf8'));

    await closeCodex();

    let original = null;
    try {
      if (await exists(AUTH_PATH)) {
        original = await readCurrentAuth();
        await writeAtomic(BACKUP_PATH, protect(original));
      }

      await saveActiveCredential(index);
      await writeAtomic(AUTH_PATH, targetAuth);

      index.activeId = targetId;
      target.identity = { ...target.identity, ...deriveIdentity(targetAuth) };
      target.lastSwitchedAt = new Date().toISOString();
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
      warning = `Account switched successfully, but Codex could not be reopened automatically: ${error.message}`;
    }

    return publicState(index, warning);
  });
}

async function removeAccount(id) {
  return queueOperation(async () => {
    const index = await readIndex();
    if (index.activeId === id) throw new Error('Switch to another account before removing the active account.');
    index.accounts = index.accounts.filter((a) => a.id !== id);
    await fs.rm(accountBlobPath(id), { force: true });
    await writeIndex(index);
    return publicState(index);
  });
}

function publicState(index, warning = null) {
  return {
    activeId: index.activeId,
    warning,
    configCompatibility: configCompatibility.changed
      ? { changed: true, backupPath: configCompatibility.backupPath || null }
      : { changed: false, backupPath: null },
    accounts: index.accounts.map((a) => ({
      id: a.id,
      displayName: a.displayName,
      email: a.identity?.email || null,
      planType: a.identity?.planType || null,
      isActive: a.id === index.activeId,
      lastSwitchedAt: a.lastSwitchedAt || null,
    })),
  };
}

async function getState() {
  return publicState(await readIndex());
}

function installNetworkDeny() {
  const filter = { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] };
  session.defaultSession.webRequest.onBeforeRequest(filter, (_details, cb) => cb({ cancel: true }));
}

function hardenNavigation(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('file://')) event.preventDefault();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 420,
    height: 560,
    minWidth: 380,
    minHeight: 480,
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
  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
}

function registerShortcuts() {
  for (let i = 1; i <= 9; i += 1) {
    globalShortcut.register(`Control+Alt+${i}`, async () => {
      const state = await getState();
      const account = state.accounts[i - 1];
      if (account && !account.isActive) switchAccount(account.id).catch(() => {});
    });
  }
}

function installIpc() {
  ipcMain.handle('state:get', getState);
  ipcMain.handle('account:import-current', (_event, name) => importCurrentAccount(name));
  ipcMain.handle('account:switch', (_event, id) => switchAccount(id));
  ipcMain.handle('account:remove', (_event, id) => removeAccount(id));
  ipcMain.handle('codex:open', () => openCodex());
  ipcMain.handle('folder:open-store', () => shell.openPath(app.getPath('userData')));
}

app.whenReady().then(async () => {
  assertSupportedPlatform();
  await ensureDirs();
  await ensureCodexCompatibility();
  installNetworkDeny();
  installIpc();
  createWindow();
  registerShortcuts();
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
