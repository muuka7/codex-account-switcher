const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { discoverSshHosts, validHost } = require('./ssh-hosts');
const { atomicWrite, readPrivate, fail } = require('./security');

class Servers {
  constructor(home = os.homedir()) { this.home = home; this.file = path.join(home, '.config/codex-account-switcher/servers.json'); }
  validate(server) {
    if (!validHost(server.alias) || (!validHost(server.hostname) && net.isIP(server.hostname) !== 6)) throw fail('INVALID_HOST', 'Use a valid SSH alias, hostname or IP address.');
    if (server.user && !/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/.test(server.user)) throw fail('ARGUMENTS', 'The SSH user contains unsupported characters.');
    if (server.port && (!/^\d+$/.test(String(server.port)) || Number(server.port) < 1 || Number(server.port) > 65535)) throw fail('ARGUMENTS', 'SSH port must be between 1 and 65535.');
  }
  async saved() {
    const bytes = await readPrivate(this.file, { missing: true });
    if (!bytes) return [];
    let data; try { data = JSON.parse(bytes); } catch { throw fail('INVALID_DATA', 'The local server list is invalid.'); }
    if (!Array.isArray(data) || data.length > 100) throw fail('INVALID_DATA', 'The local server list is invalid.');
    data.forEach(s => this.validate(s)); return data;
  }
  async list() {
    const discovered = await discoverSshHosts({ home: this.home }), saved = await this.saved();
    const discoveredByAlias = new Map(discovered.hosts.map(h => [h.alias, h]));
    const hosts = saved.map(s => ({ ...(s.manual ? s : discoveredByAlias.get(s.alias) || s), alias: s.alias, saved: true, manual: Boolean(s.manual), status: 'not-checked' }));
    for (const h of discovered.hosts) if (!saved.some(s => s.alias === h.alias)) hosts.push({ ...h, saved: false });
    return { ...discovered, hosts };
  }
  async add(alias, { address, user, port } = {}) {
    const saved = await this.saved();
    const server = { alias, hostname: address || alias, user: user || null, port: port || null, manual: Boolean(address || user || port), saved: true };
    this.validate(server);
    if (saved.some(s => s.alias === alias)) throw fail('SERVER_EXISTS', 'That server is already saved. Remove its local entry before replacing it.');
    saved.push(server); await atomicWrite(this.file, JSON.stringify(saved, null, 2)); return this.list();
  }
  async remove(alias) {
    if (!validHost(alias)) throw fail('INVALID_HOST', 'Use a concrete server alias.');
    const saved = await this.saved();
    await atomicWrite(this.file, JSON.stringify(saved.filter(s => s.alias !== alias), null, 2));
    return this.list();
  }
  async connection(alias) {
    const saved = (await this.saved()).find(s => s.alias === alias);
    if (!saved?.manual) return { destination: alias, args: [] };
    const args = [];
    if (saved.user) args.push('-l', saved.user);
    if (saved.port) args.push('-p', String(saved.port));
    return { destination: saved.hostname, args };
  }
}

module.exports = { Servers };
