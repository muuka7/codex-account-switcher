const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const TOML = require('smol-toml');
const { readRateLimits } = require('../codex-app-server');
const { allBucketsFromResult } = require('../rate-limits');
const { codexProcesses, requireQuiet } = require('./processes');
const { liveUsage } = require('./live-usage');
const { deviceLogin } = require('./device-login');
const { publicState } = require('./public-data');
const { fail, privateDirectory, readPrivate, atomicWrite, encrypt, decrypt, withLock, identity, sameIdentity, hash } = require('./security');

function validLabel(label) {
  if (typeof label !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(label)) throw fail('INVALID_LABEL', 'Use an account label of 1–64 letters, digits, dots, underscores or hyphens.');
}

function probeEnvironment(home) {
  if (Object.keys(process.env).some(name => /^(?:CODEX_(?:ACCESS_TOKEN$|API_KEY$|AUTH_|WIF_|WORKLOAD_|MANAGED_|REQUIREMENTS_)|OPENAI_(?:API_KEY$|WIF_|WORKLOAD_))/.test(name) && process.env[name])) {
    throw fail('UNSUPPORTED_AUTH', 'An external or managed authentication environment is active. File-login probes do not override that environment. Use the owning Codex daemon for live usage.');
  }
  // Do not inherit API keys, external ChatGPT tokens, development endpoint
  // overrides, SQLite locations or project-level configuration into probes.
  const env = { HOME: os.homedir(), PATH: process.env.PATH || '', CODEX_HOME: home, CODEX_SQLITE_HOME: home };
  for (const name of ['LANG', 'LC_ALL', 'SSL_CERT_FILE', 'CODEX_CA_CERTIFICATE', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NO_PROXY']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return env;
}

class ServerAccounts {
  constructor({ root = path.join(os.homedir(), '.local/share/codex-account-switcher'), codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), binary = 'codex', scanner = codexProcesses, readLimits = readRateLimits, progress = () => {} } = {}) {
    this.root = path.resolve(root); this.codexHome = path.resolve(codexHome);
    this.vaultPath = path.join(this.root, 'accounts.vault');
    this.statePath = path.join(this.root, 'state.json');
    this.authPath = path.join(this.codexHome, 'auth.json');
    this.binary = binary; this.scanner = scanner; this.readLimits = readLimits; this.progress = progress;
    if (this.root === this.codexHome || this.codexHome.startsWith(`${this.root}${path.sep}`)) throw fail('UNSAFE_PATH', 'Keep the account store separate from the live Codex home.');
  }

  async load(passphrase, create = false) {
    const bytes = await readPrivate(this.vaultPath, { missing: true });
    if (!bytes && !create) throw fail('NO_LOGIN', 'No accounts are saved yet. Use import-current <label> or login <label>.');
    if (!bytes) return { version: 1, accounts: [], pending: null };
    const vault = await decrypt(bytes, passphrase);
    if (vault.version !== 1 || !Array.isArray(vault.accounts) || vault.accounts.length > 100) throw fail('INVALID_DATA', 'The vault format is invalid.');
    for (const account of vault.accounts) {
      validLabel(account.label);
      if (typeof account.id !== 'string' || !sameIdentity(identity(account.auth), account.identity)) throw fail('INVALID_DATA', 'A saved account identity does not match its credentials.');
    }
    return vault;
  }

  async save(vault, passphrase) {
    await atomicWrite(this.vaultPath, await encrypt(vault, passphrase));
    // This cache contains display metadata only. It is never authoritative for
    // switching and no credential bytes are passed to the CLI/renderer.
    await atomicWrite(this.statePath, JSON.stringify({ version: 1, recoveryRequired: Boolean(vault.pending), accounts: vault.accounts.map(a => ({ id: a.id, label: a.label, identity: a.identity, savedAt: a.savedAt, usage: a.usage || null })) }));
  }

  async cached() {
    const data = await readPrivate(this.statePath, { missing: true });
    let state = { version: 1, accounts: [], recoveryRequired: false };
    if (data) { try { state = JSON.parse(data); } catch { throw fail('INVALID_DATA', 'The display cache is invalid. Unlock the vault with refresh to rebuild it.'); } }
    let live = null;
    try { const bytes = await this.liveAuth(); if (bytes) live = identity(JSON.parse(bytes)); } catch { /* Missing/invalid live login is shown as unknown, not as a saved selection. */ }
    return publicState({ ...state, host: os.hostname(), codexHome: this.codexHome, accounts: (Array.isArray(state.accounts) ? state.accounts : []).filter(a => a && typeof a === 'object').map(a => ({ ...a, isSelected: Boolean(live && sameIdentity(a.identity, live)) })) });
  }

  async liveAuth() { return readPrivate(this.authPath, { missing: true }); }

  async requireFileStore() {
    let config;
    try { config = TOML.parse(await fs.readFile(path.join(this.codexHome, 'config.toml'), 'utf8')); }
    catch { throw fail('FILE_STORE_REQUIRED', 'Set top-level cli_auth_credentials_store = "file" in the server Codex config before switching. The helper never changes that config.'); }
    if (config.cli_auth_credentials_store !== 'file') throw fail('FILE_STORE_REQUIRED', 'Switching requires an explicit top-level cli_auth_credentials_store = "file".');
    if (config.profile || config.forced_login_method === 'api' || (config.model_provider && config.model_provider !== 'openai')) throw fail('UNSUPPORTED_CONFIG', 'Shared-home switching currently requires the default OpenAI provider without a selected config profile or forced API login.');
    return config;
  }

  async syncLive(vault) {
    const bytes = await this.liveAuth();
    if (!bytes) return null;
    let auth; try { auth = JSON.parse(bytes); } catch { throw fail('INVALID_AUTH', 'The live auth file is invalid. It was not replaced.'); }
    const info = identity(auth);
    const saved = vault.accounts.find(a => sameIdentity(a.identity, info));
    if (saved) { saved.auth = auth; saved.savedAt = new Date().toISOString(); }
    return { bytes, info, saved };
  }

  async transaction(passphrase, fn, { create = false, recovery = false } = {}) {
    return withLock(this.root, async () => {
      const vault = await this.load(passphrase, create);
      if (vault.pending && !recovery) throw fail('RECOVERY_REQUIRED', 'A credential transaction was interrupted. Stop Codex clients, then run recover.');
      this.interrupted = false;
      const defer = () => { this.interrupted = true; };
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, defer);
      try { return await fn(vault); }
      finally { for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(signal, defer); }
    });
  }

  checkInterrupted() { if (this.interrupted) throw fail('CANCELLED', 'Stopped after preserving the current credential transaction.'); }

  add(vault, label, auth) {
    validLabel(label); const info = identity(auth);
    if (vault.accounts.length >= 100) throw fail('INVALID_DATA', 'This vault has reached its 100-account limit.');
    if (vault.accounts.some(a => a.label === label || sameIdentity(a.identity, info))) throw fail('ACCOUNT_EXISTS', 'That label or account/workspace is already saved.');
    vault.accounts.push({ id: crypto.randomUUID(), label, identity: info, auth, savedAt: new Date().toISOString(), usage: null });
  }

  async importCurrent(label, passphrase) {
    return this.transaction(passphrase, async vault => {
      const auth = await this.liveAuth();
      if (!auth) throw fail('NO_LOGIN', 'No file-backed server login was found. Use login to enroll an account.');
      let value; try { value = JSON.parse(auth); } catch { throw fail('INVALID_AUTH', 'The live login is invalid.'); }
      this.add(vault, label, value); await this.save(vault, passphrase);
      return this.cached();
    }, { create: true });
  }

  async tempHome() {
    const base = path.join(this.root, 'probes'); await privateDirectory(base);
    const home = await fs.mkdtemp(path.join(base, 'probe-')); await fs.chmod(home, 0o700);
    await atomicWrite(path.join(home, 'config.toml'), 'cli_auth_credentials_store = "file"\n');
    return home;
  }

  async login(label, passphrase, { replace = false, onCode, signal } = {}) {
    validLabel(label);
    return this.transaction(passphrase, async vault => {
      const existing = vault.accounts.find(a => a.label === label);
      if (existing && !replace) throw fail('ACCOUNT_EXISTS', 'That label is already saved. Use reauth to renew its login.');
      if (replace && !existing) throw fail('ACCOUNT_NOT_FOUND', 'That account label is not saved.');
      let live;
      if (replace) { await requireQuiet(this.scanner); live = await this.syncLive(vault); if (live?.saved?.id === existing.id) await this.requireFileStore(); }
      const home = await this.tempHome();
      let cleanup = true;
      const loginAbort = new AbortController(), cancelLogin = () => loginAbort.abort();
      for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(name, cancelLogin);
      signal?.addEventListener('abort', cancelLogin, { once: true });
      if (signal?.aborted) cancelLogin();
      try {
        await deviceLogin({ binary: this.binary, home, env: probeEnvironment(home), signal: loginAbort.signal,
          onCode: onCode || (code => this.progress(`Open ${code.verificationUrl} and enter code ${code.userCode}`)),
        });
        const auth = JSON.parse(await readPrivate(path.join(home, 'auth.json')));
        if (replace) {
          if (!sameIdentity(existing.identity, identity(auth))) throw fail('IDENTITY_MISMATCH', 'Sign in to the same account/workspace when re-authenticating.');
          existing.auth = auth; existing.savedAt = new Date().toISOString(); existing.usage = null;
          if (live?.saved?.id === existing.id) vault.pending = { kind: 'refresh', targetId: existing.id, beforeHash: hash(live.bytes), afterHash: hash(Buffer.from(JSON.stringify(auth))) };
        } else this.add(vault, label, auth);
        if (vault.pending) {
          await this.save(vault, passphrase);
          await this.replaceLive(Buffer.from(JSON.stringify(auth)), vault.pending.beforeHash);
          vault.pending = null;
        }
        await this.save(vault, passphrase); return this.cached();
      } catch (error) {
        if (error.code === 'APP_SERVER_STOP_FAILED') cleanup = false;
        else if (!['IDENTITY_MISMATCH', 'LOGIN_FAILED', 'CANCELLED', 'ACCOUNT_EXISTS'].includes(error.code)) {
          const staged = await readPrivate(path.join(home, 'auth.json'), { missing: true }).catch(() => null);
          if (staged) { cleanup = false; throw fail('PERSIST_FAILED', 'The new login could not be saved. Preserve the private staging directory for recovery.'); }
        }
        throw error;
      } finally {
        for (const name of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.off(name, cancelLogin);
        signal?.removeEventListener('abort', cancelLogin);
        if (cleanup) await fs.rm(home, { recursive: true, force: true });
      }
    }, { create: true });
  }

  async probe(account, persist) {
    const home = await this.tempHome();
    let result, failure, cleanup = true;
    try {
      await atomicWrite(path.join(home, 'auth.json'), JSON.stringify(account.auth));
      try { result = await this.readLimits({ codexHome: home, sqliteHome: home, cwd: home, env: probeEnvironment(home), runtime: { binaryPath: this.binary, pathDir: null } }); }
      catch (error) {
        if (error.code === 'APP_SERVER_STOP_FAILED') { cleanup = false; throw error; }
        failure = error;
      }
      // Even an unsuccessful usage read may have rotated credentials. Rescue
      // them before cleanup, and before deciding whether the operation failed.
      cleanup = false;
      const refreshed = JSON.parse(await readPrivate(path.join(home, 'auth.json')));
      if (!sameIdentity(account.identity, identity(refreshed))) throw fail('IDENTITY_MISMATCH', 'Codex returned credentials for a different account. A private recovery copy was retained.');
      account.auth = refreshed; account.savedAt = new Date().toISOString();
      try { await persist(); }
      catch { cleanup = false; throw fail('PERSIST_FAILED', 'Refreshed credentials could not be encrypted into the vault. A private recovery copy remains under the store probes directory. Stop Codex and preserve that directory for recovery.'); }
      cleanup = true;
      if (failure) throw failure;
      const buckets = allBucketsFromResult(result);
      if (!buckets.length) throw fail('USAGE_UNAVAILABLE', 'No quota buckets were returned.');
      account.usage = { checkedAt: new Date().toISOString(), buckets, error: null };
    } finally { if (cleanup) await fs.rm(home, { recursive: true, force: true }); }
  }

  async replaceLive(bytes, expectedHash) {
    await requireQuiet(this.scanner);
    const current = await this.liveAuth();
    if ((current ? hash(current) : null) !== expectedHash) throw fail('LIVE_AUTH_CHANGED', 'The live login changed during the operation. It was not overwritten.');
    await atomicWrite(this.authPath, bytes);
    await requireQuiet(this.scanner);
  }

  async refresh(passphrase) {
    return this.transaction(passphrase, async vault => {
      await requireQuiet(this.scanner);
      probeEnvironment(this.codexHome);
      const live = await this.syncLive(vault);
      if (live?.saved) await this.requireFileStore();
      for (const account of vault.accounts) {
        this.checkInterrupted();
        this.progress(`Refreshing ${account.label}…`);
        await requireQuiet(this.scanner);
        let failure;
        const isLive = live?.saved?.id === account.id;
        try {
          await this.probe(account, async () => {
            if (isLive) vault.pending = { kind: 'refresh', targetId: account.id, beforeHash: hash(live.bytes), afterHash: hash(Buffer.from(JSON.stringify(account.auth))) };
            await this.save(vault, passphrase);
          });
        } catch (error) { failure = error; account.usage = { ...(account.usage || {}), error: 'Usage could not be refreshed. Try again or re-authenticate.' }; }
        if (['IDENTITY_MISMATCH', 'APP_SERVER_STOP_FAILED', 'PERSIST_FAILED'].includes(failure?.code)) throw failure;
        await this.save(vault, passphrase);
        if (isLive) {
          await this.replaceLive(Buffer.from(JSON.stringify(account.auth)), hash(live.bytes));
          vault.pending = null; await this.save(vault, passphrase);
        }
        // A mismatched identity must not be silently converted into an ordinary
        // network failure and followed by more credential operations.
      }
      return this.cached();
    });
  }

  async switchAccount(label, passphrase) {
    validLabel(label);
    return this.transaction(passphrase, async vault => {
      await requireQuiet(this.scanner); const config = await this.requireFileStore();
      probeEnvironment(this.codexHome);
      const live = await this.syncLive(vault);
      if (live && !live.saved) throw fail('UNSAVED_LOGIN', 'Save the current server login with import-current before switching.');
      const target = vault.accounts.find(a => a.label === label);
      if (!target) throw fail('ACCOUNT_NOT_FOUND', 'That account label is not saved.');
      if (config.forced_chatgpt_workspace_id && config.forced_chatgpt_workspace_id !== target.identity.accountId) throw fail('WORKSPACE_RESTRICTED', 'The target account does not match the configured workspace restriction.');
      if (live?.saved?.id === target.id) { await this.save(vault, passphrase); return this.cached(); }
      try { await this.probe(target, () => this.save(vault, passphrase)); }
      catch (error) { await this.save(vault, passphrase); throw error; }
      this.checkInterrupted();
      const bytes = Buffer.from(JSON.stringify(target.auth));
      vault.pending = { kind: 'switch', targetId: target.id, beforeHash: live ? hash(live.bytes) : null, afterHash: hash(bytes) };
      await this.save(vault, passphrase);
      await this.replaceLive(bytes, vault.pending.beforeHash);
      vault.pending = null; await this.save(vault, passphrase);
      return this.cached();
    });
  }

  async recover(passphrase) {
    return this.transaction(passphrase, async vault => {
      await requireQuiet(this.scanner);
      if (!vault.pending) return this.cached();
      const p = vault.pending, live = await this.liveAuth(), currentHash = live ? hash(live) : null;
      const target = vault.accounts.find(a => a.id === p.targetId);
      if (!target) throw fail('RECOVERY_REQUIRED', 'The journal target is missing. Preserve the vault for manual recovery.');
      if (currentHash === p.beforeHash && p.kind === 'refresh') {
        await this.requireFileStore(); await this.replaceLive(Buffer.from(JSON.stringify(target.auth)), p.beforeHash);
      } else if (currentHash !== p.afterHash && currentHash !== p.beforeHash) {
        throw fail('LIVE_AUTH_CHANGED', 'The live login differs from both journal states. No credential was overwritten.');
      }
      // An interrupted switch that has not written auth is cancelled; one
      // already written is finalized. Never guess by switching a second time.
      vault.pending = null; await this.save(vault, passphrase); return this.cached();
    }, { recovery: true });
  }

  async doctor() {
    let codexVersion = null;
    try { const { stdout } = await promisify(execFile)(this.binary, ['--version'], { timeout: 5000, maxBuffer: 4096 }); codexVersion = stdout.match(/codex-cli\s+[\d.]+/)?.[0] || null; } catch { /* A missing runtime is a setup state, not a raw child error. */ }
    let installationId = null;
    const installation = await readPrivate(path.join(this.root, 'installation.json'), { missing: true });
    if (installation) { const v = JSON.parse(installation); if (typeof v.id === 'string' && /^[a-f0-9-]{36}$/.test(v.id)) installationId = v.id; }
    let fileStoreReady = false; try { await this.requireFileStore(); fileStoreReady = true; } catch { /* Report setup without changing configuration. */ }
    let helperVersion = null; try { helperVersion = JSON.parse(await fs.readFile(path.join(__dirname, '../../server/build.json'), 'utf8')).version; } catch { /* Development checkout. */ }
    return { host: os.hostname(), platform: process.platform, installationId, helperVersion, codexHome: this.codexHome, root: this.root, vaultExists: Boolean(await readPrivate(this.vaultPath, { missing: true })), running: await this.scanner(), codexVersion, runtimeCommand: this.binary, fileStoreReady };
  }
  live(options) { return liveUsage(this.codexHome, options); }
  reauth(label, passphrase) { return this.login(label, passphrase, { replace: true }); }
}

module.exports = { ServerAccounts, validLabel, probeEnvironment };
