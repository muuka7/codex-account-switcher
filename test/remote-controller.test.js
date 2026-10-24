const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { RemoteController } = require('../src/remote/controller');

async function setup(t, transport) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'switcher-controller-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const storageKey = crypto.randomBytes(32);
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString(value) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', storageKey, iv); return Buffer.concat([iv, c.update(value), c.final(), c.getAuthTag()]); },
    decryptString(bytes) { const d = crypto.createDecipheriv('aes-256-gcm', storageKey, bytes.subarray(0, 12)); d.setAuthTag(bytes.subarray(-16)); return Buffer.concat([d.update(bytes.subarray(12, -16)), d.final()]).toString(); },
  };
  return { controller: new RemoteController({ app: { getPath: () => dir }, safeStorage, transport }), dir, safeStorage };
}
const doctor = { platform: 'linux', protocol: 1, installationId: '11223344-1122-3344-5566-112233445566', vaultExists: false };

test('concurrent aliases use one persisted encrypted installation key', async t => {
  const { controller } = await setup(t);
  const [first, second] = await Promise.all([controller.key(doctor, { create: true }), controller.key(doctor, { create: true })]);
  assert.equal(first, second); assert.match(first, /^[a-f0-9]{64}$/);
  const encrypted = await fs.readFile(controller.keyFile(doctor.installationId));
  assert.ok(!encrypted.includes(Buffer.from(first)));
  assert.equal(await controller.key({ ...doctor, vaultExists: true }), first);
});

test('existing remote vaults never receive a replacement key and insecure storage fails closed', async t => {
  const { controller, safeStorage } = await setup(t);
  await assert.rejects(controller.key({ ...doctor, vaultExists: true }, { create: true }), { code: 'VAULT_KEY_MISSING' });
  safeStorage.getSelectedStorageBackend = () => 'basic_text';
  await assert.rejects(controller.key(doctor, { create: true }), { code: 'LOCAL_KEYCHAIN' });
});

test('key is durable before import and a lost response reuses it without replaying import', async t => {
  let controller, seen;
  const setupResult = await setup(t, async (_host, method, _params, options) => {
    if (method === 'doctor') return doctor;
    if (method === 'import') {
      seen = options.secret;
      assert.equal(await controller.key(doctor), seen);
      throw Object.assign(new Error('lost response'), { code: 'SSH_FAILED' });
    }
  });
  controller = setupResult.controller;
  await assert.rejects(controller.mutate('server', 'import', 'personal'), { code: 'SSH_FAILED' });
  assert.equal(await controller.key(doctor), seen); assert.equal(controller.operations.size, 0);
});
