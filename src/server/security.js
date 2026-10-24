const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);

function fail(code, message) { return Object.assign(new Error(message), { code }); }

async function privateDirectory(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (process.getuid && stat.uid !== process.getuid())) {
    throw fail('UNSAFE_PATH', 'The data directory must be a directory owned by your user, without a symlink.');
  }
  await fs.chmod(dir, 0o700);
}

async function readPrivate(file, { missing = false } = {}) {
  let handle;
  try {
    handle = await fs.open(file, require('node:fs').constants.O_RDONLY | require('node:fs').constants.O_NOFOLLOW);
    const stat = await handle.stat();
    if (!stat.isFile() || (process.getuid && (stat.uid !== process.getuid() || (stat.mode & 0o077)))) {
      throw fail('UNSAFE_PATH', 'A private file has unsafe ownership or permissions. Expected mode 0600.');
    }
    if (stat.size > 8 * 1024 * 1024) throw fail('INVALID_DATA', 'The private file is too large.');
    return await handle.readFile();
  } catch (error) {
    if (missing && error.code === 'ENOENT') return null;
    throw error;
  } finally { await handle?.close(); }
}

async function atomicWrite(file, bytes) {
  await privateDirectory(path.dirname(file));
  const temp = `${file}.tmp-${crypto.randomUUID()}`;
  let handle;
  try {
    handle = await fs.open(temp, 'wx', 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close(); handle = null;
    await fs.rename(temp, file);
    if (process.platform !== 'win32') {
      const dir = await fs.open(path.dirname(file), 'r');
      try { await dir.sync(); } finally { await dir.close(); }
    }
  } finally {
    await handle?.close();
    await fs.rm(temp, { force: true });
  }
}

async function encrypt(value, passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 12) throw fail('PASSPHRASE_REQUIRED', 'Use a vault passphrase of at least 12 characters.');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = await scrypt(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  try {
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('codex-switcher-server:v1'));
    const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.from(JSON.stringify({ version: 1, salt: salt.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }));
  } finally { key.fill(0); }
}

async function decrypt(bytes, passphrase) {
  let key;
  try {
    const v = JSON.parse(bytes);
    if (v.version !== 1 || typeof passphrase !== 'string') throw new Error();
    const salt = Buffer.from(v.salt, 'base64'), iv = Buffer.from(v.iv, 'base64'), tag = Buffer.from(v.tag, 'base64');
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16) throw new Error();
    key = await scrypt(passphrase, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const cipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('codex-switcher-server:v1')); cipher.setAuthTag(tag);
    const clear = Buffer.concat([cipher.update(Buffer.from(v.data, 'base64')), cipher.final()]);
    try { return JSON.parse(clear); } finally { clear.fill(0); }
  } catch { throw fail('VAULT_LOCKED', 'The passphrase is incorrect or the vault is damaged. No files were changed.'); }
  finally { key?.fill(0); }
}

async function withLock(root, callback) {
  await privateDirectory(root);
  const lock = path.join(root, 'operation.lock');
  let handle;
  try { handle = await fs.open(lock, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw fail('BUSY', 'Another management operation holds the lock. If it crashed, inspect operation.lock and verify its process has exited before removing that lock.');
    throw error;
  }
  try {
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
    return await callback();
  } finally { await handle.close(); await fs.unlink(lock); }
}

function identity(auth) {
  const token = auth?.tokens?.id_token;
  if (typeof auth?.tokens?.access_token !== 'string' || !token) throw fail('INVALID_AUTH', 'A ChatGPT file login is required. API-key-only logins are not supported.');
  let claims;
  try { claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url')); } catch { throw fail('INVALID_AUTH', 'The ChatGPT login has invalid identity metadata.'); }
  const nested = claims['https://api.openai.com/auth'] || {};
  const accountId = auth.tokens.account_id || nested.chatgpt_account_id;
  const email = claims.email || nested.email;
  if (typeof accountId !== 'string' || !accountId || typeof email !== 'string' || !email) throw fail('INVALID_AUTH', 'The login must identify both the account/workspace and email.');
  return { accountId, email, planType: typeof nested.chatgpt_plan_type === 'string' ? nested.chatgpt_plan_type : null };
}
function sameIdentity(a, b) { return Boolean(a && b && typeof a.accountId === 'string' && a.accountId && a.accountId === b.accountId && typeof a.email === 'string' && a.email && typeof b.email === 'string' && a.email.toLowerCase() === b.email.toLowerCase()); }
function hash(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }

module.exports = { fail, privateDirectory, readPrivate, atomicWrite, encrypt, decrypt, withLock, identity, sameIdentity, hash };
