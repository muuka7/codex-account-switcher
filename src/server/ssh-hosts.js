const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { fail } = require('./security');

function tokens(line) {
  const out = []; let token = '', quote = null, escaped = false;
  for (const c of line) {
    if (escaped) { token += c; escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (quote) { if (c === quote) quote = null; else token += c; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '#') break;
    if (/\s/.test(c)) { if (token) { out.push(token); token = ''; } }
    else token += c;
  }
  if (token) out.push(token);
  return out;
}
function validHost(host) { return typeof host === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,252}$/.test(host); }
function globRegex(pattern) { return new RegExp(`^${pattern.replace(/[.+^${}()|\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\[/g, '\\[').replace(/\]/g, '\\]')}$`); }

async function expand(pattern, base, home) {
  if (pattern.startsWith('~/')) pattern = path.join(home, pattern.slice(2));
  const full = path.resolve(base, pattern);
  if (!/[?*]/.test(full)) return [full];
  let paths = ['/'];
  for (const part of full.split('/').filter(Boolean)) {
    const next = [];
    for (const parent of paths) {
      if (!/[?*]/.test(part)) { next.push(path.join(parent, part)); continue; }
      let names; try { names = await fs.readdir(parent); } catch { continue; }
      for (const name of names.sort()) if (globRegex(part).test(name)) next.push(path.join(parent, name));
    }
    paths = next.slice(0, 128);
  }
  return paths;
}

async function discoverSshHosts({ home = os.homedir(), configPath = path.join(home, '.ssh/config') } = {}) {
  const entries = [], warnings = [], files = new Set();
  const base = path.join(home, '.ssh'); let section = ['*']; let conditional = false;
  async function read(file, depth) {
    if (depth > 8 || files.size >= 128) { warnings.push('Some SSH includes were skipped because discovery reached its limit.'); return; }
    if (files.has(file)) return;
    files.add(file);
    let source;
    try {
      const stat = await fs.stat(file); if (!stat.isFile() || stat.size > 1024 * 1024) return;
      source = await fs.readFile(file, 'utf8');
    } catch (error) { if (error.code !== 'ENOENT') warnings.push('An SSH config include could not be read.'); return; }
    for (const line of source.split(/\r?\n/)) {
      const words = tokens(line.replace(/^(\s*[a-zA-Z]+)\s*=\s*/, '$1 '));
      const directive = words.shift()?.toLowerCase(); if (!directive) continue;
      if (directive === 'include') {
        // Discovery never evaluates Match exec, ProxyCommand, hostnames or SSH
        // itself. Conditional includes are skipped rather than executed.
        if (conditional) { warnings.push('Conditional SSH includes need normal SSH resolution when connecting.'); continue; }
        for (const pattern of words) for (const included of await expand(pattern, base, home)) await read(included, depth + 1);
      } else if (directive === 'host') {
        section = words; conditional = false;
        for (const alias of words) if (validHost(alias)) entries.push({ alias, source: file });
      } else if (directive === 'match') { conditional = true; section = []; }
      else if (!conditional && ['hostname', 'user', 'port'].includes(directive) && words[0]) {
        entries.push({ patterns: [...section], directive, value: words[0] });
      }
    }
  }
  await read(configPath, 0);
  const aliases = [...new Set(entries.filter(e => e.alias).map(e => e.alias))];
  const matches = (patterns, alias) => {
    let positive = false;
    for (const p of patterns) {
      if (p.startsWith('!')) { if (globRegex(p.slice(1)).test(alias)) return false; }
      else if (globRegex(p).test(alias)) positive = true;
    }
    return positive;
  };
  return { hosts: aliases.map(alias => {
    const host = { alias, hostname: alias, user: null, port: null, source: entries.find(e => e.alias === alias).source, status: 'not-checked' };
    const seen = new Set();
    for (const e of entries) if (e.directive && matches(e.patterns, alias) && !seen.has(e.directive)) {
      seen.add(e.directive); host[e.directive === 'hostname' ? 'hostname' : e.directive] = e.value;
    }
    return host;
  }), warnings: [...new Set(warnings)], note: 'Discovered locally; no servers were contacted. OpenSSH resolves actual connection settings.' };
}

function remoteCommand(script, args) {
  const quote = value => `'${String(value).replace(/'/g, "'\\''")}'`;
  if (script && (!path.posix.isAbsolute(script) || /[\r\n\0]/.test(script))) throw fail('INVALID_PATH', 'A custom remote helper path must be absolute.');
  const target = script ? quote(script) : '"$HOME/.local/share/codex-account-switcher/app/src/server/cli.js"';
  return `node -- ${target} ${args.map(quote).join(' ')}`;
}

module.exports = { discoverSshHosts, validHost, remoteCommand, tokens };
