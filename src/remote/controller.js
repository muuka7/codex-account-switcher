const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Servers } = require('../server/servers');
const { atomicWrite, readPrivate, privateDirectory } = require('../server/security');
const { validHost } = require('../server/ssh-hosts');
const { request, classifySsh, sshError } = require('./ssh-client');

// The renderer receives account metadata and progress only. Vault keys are
// generated, encrypted, read and sent to SSH entirely in the main process.
class RemoteController {
  constructor({ app, safeStorage, notify = () => {}, servers = new Servers(), transport = request }) {
    this.app = app; this.safeStorage = safeStorage; this.notify = notify;
    this.servers = servers; this.transport = transport; this.operations = new Map();
    this.keyPromises = new Map();
    this.deviceCodes = new Map();
    this.keysRoot = path.join(app.getPath('userData'), 'server-keys');
  }
  async list() { return this.servers.list(); }
  async add(value) {
    if (!value || typeof value !== 'object' || Object.keys(value).some(k => !['alias', 'address', 'user', 'port'].includes(k))) throw sshError('ARGUMENTS', 'Enter a server alias and optional SSH connection settings.');
    return this.servers.add(value.alias, value);
  }
  async remove(host) {
    this.host(host);
    if (this.operations.has(host)) throw sshError('BUSY', 'Wait for this server operation to finish.');
    // Removing a shortcut never deletes the server vault or its protected key.
    return this.servers.remove(host);
  }
  host(host) { if (!validHost(host)) throw sshError('INVALID_HOST', 'Choose a concrete server alias.'); }
  async call(host, method, params = {}, options = {}) {
    this.host(host);
    return this.transport(host, method, params, { servers: this.servers, ...options });
  }
  async doctor(host) {
    const result = await this.call(host, 'doctor');
    if (result.platform !== 'linux' || result.protocol !== 1 || !result.installationId) throw sshError('HELPER_UPDATE', 'Set up or update the Linux server helper before continuing.');
    return result;
  }
  keyFile(id) {
    if (!/^[a-f0-9-]{36}$/.test(id || '')) throw sshError('HELPER_UPDATE', 'The server installation identifier is invalid.');
    return path.join(this.keysRoot, `${id}.secure`);
  }
  availableEncryption() {
    if (!this.safeStorage.isEncryptionAvailable() || this.safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw sshError('LOCAL_KEYCHAIN', 'Operating system credential encryption is unavailable. Unlock your Keychain before saving server accounts.');
  }
  async key(doctor, { create = false } = {}) {
    const id = doctor.installationId;
    // Different SSH aliases can resolve to the same installation. Serialize
    // creation by installation ID so one alias cannot replace another's key.
    if (this.keyPromises.has(id)) return this.keyPromises.get(id);
    const pending = this.loadKey(doctor, { create }); this.keyPromises.set(id, pending);
    try { return await pending; } finally { this.keyPromises.delete(id); }
  }
  async loadKey(doctor, { create = false } = {}) {
    this.availableEncryption();
    const file = this.keyFile(doctor.installationId);
    const bytes = await readPrivate(file, { missing: true });
    if (bytes) {
      try {
        const key = this.safeStorage.decryptString(bytes);
        if (typeof key !== 'string' || key.length < 12 || key.length > 1024) throw new Error();
        return key;
      } catch { throw sshError('LOCAL_KEYCHAIN', 'The protected server key could not be unlocked on this computer.'); }
    }
    if (!create || doctor.vaultExists) throw sshError('VAULT_KEY_MISSING', 'This computer has no key for the existing server vault. Use the computer or terminal that created it; no server credentials were changed.');
    // Persist before any remote mutation so a lost SSH response is recoverable.
    const key = crypto.randomBytes(32).toString('hex');
    await privateDirectory(this.keysRoot);
    await atomicWrite(file, this.safeStorage.encryptString(key));
    return key;
  }
  async snapshot(host) {
    const doctor = await this.doctor(host);
    const [stateResult, liveResult] = await Promise.allSettled([this.call(host, 'state'), this.call(host, 'live')]);
    let keyAvailable = false;
    if (doctor.vaultExists) { try { await this.call(host, 'unlock', {}, { secret: await this.key(doctor) }); keyAvailable = true; } catch {} }
    return {
      doctor, state: stateResult.status === 'fulfilled' ? stateResult.value : null,
      stateError: stateResult.status === 'rejected' ? stateResult.reason.message : null,
      live: liveResult.status === 'fulfilled' ? liveResult.value : null,
      liveError: liveResult.status === 'rejected' ? liveResult.reason.message : null,
      keyAvailable, busy: this.operations.get(host)?.method || null,
    };
  }
  async exclusive(host, method, work) {
    this.host(host);
    if (this.operations.has(host)) throw sshError('BUSY', 'Another operation is active on this server.');
    const controller = new AbortController(); this.operations.set(host, { method, controller });
    try { return await work(controller.signal); }
    finally { this.operations.delete(host); this.deviceCodes.delete(host); }
  }
  async mutate(host, method, label) {
    if (!['import', 'refresh', 'switch', 'recover', 'login', 'reauth'].includes(method)) throw sshError('ARGUMENTS', 'Unsupported server operation.');
    return this.exclusive(host, method, async signal => {
      const doctor = await this.doctor(host);
      const secret = await this.key(doctor, { create: ['import', 'login'].includes(method) });
      await this.call(host, method, label === undefined ? {} : { label }, {
        secret, signal, onEvent: event => {
          if (event.kind === 'device-code') this.deviceCodes.set(host, event.userCode);
          this.notify({ host, method, ...event });
        },
      });
      return this.snapshot(host);
    });
  }
  cancel(host) {
    this.host(host); const operation = this.operations.get(host);
    if (operation && ['login', 'reauth', 'install'].includes(operation.method)) { this.deviceCodes.delete(host); operation.controller.abort(); }
  }
  currentDeviceCode(host) {
    this.host(host);
    const code = this.deviceCodes.get(host), method = this.operations.get(host)?.method;
    if (!['login', 'reauth'].includes(method) || !/^[A-Za-z0-9-]{4,32}$/.test(code || '')) throw sshError('LOGIN_CODE_UNAVAILABLE', 'There is no active sign-in code to copy.');
    return code;
  }
  async unlock(host, passphrase) {
    if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 1024) throw sshError('PASSPHRASE_REQUIRED', 'Use the existing vault passphrase of at least 12 characters.');
    return this.exclusive(host, 'unlock', async () => {
      this.availableEncryption();
      const doctor = await this.doctor(host);
      if (!doctor.vaultExists) throw sshError('NO_LOGIN', 'This server does not have a vault yet.');
      // Verification decrypts on the server and returns public metadata only.
      // Do not persist an unverified passphrase or mutate server credentials.
      await this.call(host, 'unlock', {}, { secret: passphrase });
      await privateDirectory(this.keysRoot);
      await atomicWrite(this.keyFile(doctor.installationId), this.safeStorage.encryptString(passphrase));
      return this.snapshot(host);
    });
  }
  async copyVaultKey(host, writeClipboard) {
    return this.exclusive(host, 'copy-key', async () => {
      const doctor = await this.doctor(host), secret = await this.key(doctor);
      await this.call(host, 'unlock', {}, { secret });
      writeClipboard(secret);
      // The IPC response must never contain the vault key.
      return true;
    });
  }
  dispose() { for (const [host] of this.operations) this.cancel(host); }
  async install(host) {
    return this.exclusive(host, 'install', async signal => {
      const root = path.resolve(__dirname, '../..');
      const script = await fs.readFile(path.join(root, 'scripts/server-install-remote.sh'), 'utf8');
      let archive = path.join(process.resourcesPath || '', 'server-helper.tar.gz'), temporary;
      try {
        if (!this.app.isPackaged) {
          temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'switcher-install-'));
          archive = await require('../../scripts/bundle-server').createHelperArchive(path.join(temporary, 'helper.tar.gz'));
        }
        const connection = await this.servers.connection(host), payload = await fs.readFile(archive);
        await new Promise((resolve, reject) => {
          const child = spawn('ssh', ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=2', ...connection.args, '--', connection.destination, script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
          let stderr = '', done = false;
          const finish = error => {
            if (done) return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort);
            if (error) { child.kill('SIGTERM'); const reap = setTimeout(() => child.kill('SIGKILL'), 2000); reap.unref?.(); child.once('close', () => clearTimeout(reap)); }
            error ? reject(error) : resolve();
          };
          const abort = () => finish(sshError('CANCELLED', 'Setup was cancelled. Reconnect to check the helper installation.'));
          const timer = setTimeout(() => finish(sshError('SSH_TIMEOUT', 'Server setup timed out. Reconnect to check its installation.')), 5 * 60 * 1000);
          child.stdout.on('data', () => {});
          child.stderr.on('data', bytes => { if (stderr.length < 32768) stderr += bytes.toString().slice(0, 32768 - stderr.length); });
          child.stdin.on('error', () => {}); child.once('error', () => finish(sshError('SSH_FAILED', 'OpenSSH could not start.')));
          child.once('close', code => finish(code === 0 ? null : classifySsh(stderr)));
          signal.addEventListener('abort', abort, { once: true });
          child.stdin.end(payload); if (signal.aborted) abort();
        });
        return this.snapshot(host);
      } finally { if (temporary) await fs.rm(temporary, { recursive: true, force: true }); }
    });
  }
}
module.exports = { RemoteController };
