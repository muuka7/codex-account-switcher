const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { discoverSshHosts, remoteCommand, validHost } = require('../src/server/ssh-hosts');
const { Servers } = require('../src/server/servers');

test('SSH discovery respects includes, first-value precedence, aliases and distinct users without execution', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ssh-discovery-')); t.after(() => fs.rm(home, { recursive: true, force: true }));
  await fs.mkdir(path.join(home, '.ssh', 'conf.d'), { recursive: true });
  await fs.writeFile(path.join(home, '.ssh/config'), `Include conf.d/*\nHost box-root box\n HostName 192.0.2.1\n User root\nHost box-user\n HostName 192.0.2.1\n User muuka\nHost *.internal !excluded\n Port 2222\nMatch exec "touch SHOULD_NOT_RUN"\n HostName invalid\nHost later\n User developer\n`);
  await fs.writeFile(path.join(home, '.ssh/conf.d/a'), 'Host box-user\n User=first-user\nHost included\n HostName "example.test" # comment\nInclude ../config\n');
  const result = await discoverSshHosts({ home });
  assert.deepEqual(result.hosts.map(h => h.alias), ['box-user', 'included', 'box-root', 'box', 'later']);
  assert.equal(result.hosts[0].user, 'first-user');
  assert.equal(result.hosts[0].hostname, '192.0.2.1');
  assert.equal(result.hosts.find(h => h.alias === 'box-root').user, 'root');
  assert.equal(result.hosts.find(h => h.alias === 'later').hostname, 'later');
  assert.equal(result.hosts.find(h => h.alias === 'later').user, 'developer');
  assert.ok(result.hosts.every(h => h.status === 'not-checked'));
});

test('remote command quotes arguments and rejects unsafe SSH destinations', () => {
  assert.equal(validHost('-oProxyCommand=bad'), false);
  assert.equal(validHost('server;touch hacked'), false);
  assert.equal(validHost('skillBased-muuka'), true);
  assert.match(remoteCommand('/home/user/a b/cli.js', ['list', "a'b"]), /'a'\\''b'/);
  assert.throws(() => remoteCommand('relative.js', ['list']), { code: 'INVALID_PATH' });
});

test('saved server shortcuts preserve SSH resolution and manual entries use argument-safe overrides', async t => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'server-list-')); t.after(() => fs.rm(home, { recursive: true, force: true }));
  const servers = new Servers(home);
  await servers.add('existing-alias');
  assert.deepEqual(await servers.connection('existing-alias'), { destination: 'existing-alias', args: [] });
  const result = await servers.add('staging', { address: '192.0.2.10', user: 'developer', port: '2222' });
  assert.equal(result.hosts.length, 2);
  assert.deepEqual(await servers.connection('staging'), { destination: '192.0.2.10', args: ['-l', 'developer', '-p', '2222'] });
  await assert.rejects(servers.add('bad', { address: 'host;rm -rf /' }), { code: 'INVALID_HOST' });
  await assert.rejects(servers.add('bad', { address: 'example.test', port: '-oBad' }), { code: 'ARGUMENTS' });
  await servers.remove('staging');
  assert.equal((await servers.saved()).length, 1);
});
