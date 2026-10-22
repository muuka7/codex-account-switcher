#!/usr/bin/env node
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { ServerAccounts, validLabel } = require('./accounts');
const { validHost, remoteCommand } = require('./ssh-hosts');
const { Servers } = require('./servers');
const { fail } = require('./security');

const HELP = `Codex Account Switcher — Linux server CLI

  servers                       Discover local ~/.ssh/config aliases; no network calls
  servers add <alias>            Save an SSH alias locally; no remote changes
  servers add <name> --address <host> --user <user> [--port <port>]
  servers remove <alias>         Forget a saved server; never edit SSH config
  connect                       Pick an SSH server interactively
  doctor                        Check this Linux host without unlocking the vault
  list                          Show saved accounts and cached usage
  live                          Read usage from the existing Codex daemon
  import-current <label>        Encrypt a copy of this server's current login
  login <label>                 Enroll through official Codex device login, in isolation
  reauth <label>                Renew a saved account; Codex clients must be stopped
  refresh                       Refresh all saved accounts; Codex clients must be stopped
  switch <label>                Manually select an account; Codex clients must be stopped
  recover                       Resolve an interrupted credential transaction

Options: --host <SSH alias> --remote-script <absolute remote path> --json
         --store <directory> --codex-home <directory> --binary <Codex path>
         --passphrase-fd <number> (automation only; never put a passphrase in arguments)

Examples:
  node src/server/cli.js servers
  node src/server/cli.js --host skillBased-muuka list
  node src/server/cli.js --host skillBased-muuka live

Install the server helper first with: bash scripts/install-server.sh <SSH alias>
`;

function parseArgs(argv) {
  const options = {}, args = [], values = new Set(['host', 'remote-script', 'store', 'codex-home', 'binary', 'passphrase-fd', 'address', 'user', 'port']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') options.json = true;
    else if (a === '--help' || a === '-h') options.help = true;
    else if (a.startsWith('--') && values.has(a.slice(2))) {
      if (!argv[i + 1] || argv[i + 1].startsWith('--')) throw fail('ARGUMENTS', `Missing value for ${a}.`);
      options[a.slice(2)] = argv[++i];
    } else if (a.startsWith('-')) throw fail('ARGUMENTS', 'Unknown option. Run --help for usage.');
    else args.push(a);
  }
  return { options, args };
}

function clean(text) { return String(text ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '').slice(0, 500); }

async function secret(prompt) {
  if (!process.stdin.isTTY) throw fail('TTY_REQUIRED', 'Use an interactive terminal for the vault passphrase, or provide --passphrase-fd.');
  process.stderr.write(prompt);
  return new Promise((resolve, reject) => {
    const input = process.stdin, wasRaw = input.isRaw; let value = '';
    input.setRawMode(true); input.resume();
    const finish = (error) => {
      input.off('data', onData); input.setRawMode(Boolean(wasRaw)); input.pause(); process.stderr.write('\n');
      error ? reject(error) : resolve(value);
    };
    const onData = chunk => {
      for (const c of chunk.toString('utf8')) {
        if (c === '\u0003' || c === '\u0004') return finish(fail('CANCELLED', 'Cancelled.'));
        if (c === '\r' || c === '\n') return finish();
        if (c === '\u007f' || c === '\b') value = value.slice(0, -1);
        else if (c >= ' ' && value.length < 1024) value += c;
      }
    };
    input.on('data', onData);
  });
}

async function passphrase(options, manager) {
  if (options['passphrase-fd'] !== undefined) {
    if (!/^\d+$/.test(options['passphrase-fd'])) throw fail('ARGUMENTS', 'The passphrase file descriptor must be a number.');
    const value = fs.readFileSync(Number(options['passphrase-fd']), 'utf8');
    if (value.length > 4096) throw fail('ARGUMENTS', 'Passphrase input is too large.');
    return value.replace(/\r?\n$/, '');
  }
  const value = await secret('Server vault passphrase (hidden): ');
  let exists = true; try { await fsp.access(manager.vaultPath); } catch { exists = false; }
  if (!exists && value !== await secret('Confirm new passphrase: ')) throw fail('PASSPHRASE_MISMATCH', 'The passphrases did not match.');
  return value;
}

function usageLines(usage) {
  if (!usage) return ['  Usage unknown. Run refresh with clients stopped, or live for the running daemon.'];
  const result = [];
  for (const bucket of usage.buckets || []) for (const [kind, w] of [['primary', bucket.primary], ['secondary', bucket.secondary]]) if (w) {
    const duration = w.windowDurationMins === 300 ? '5h' : w.windowDurationMins === 10080 ? 'week' : `${w.windowDurationMins}m`;
    const reset = w.resetsAt === null ? 'reset unknown' : `resets ${new Date(w.resetsAt * 1000).toLocaleString()}`;
    result.push(`  ${clean(bucket.name || bucket.id)} / ${kind} (${duration}): ${w.remainingPercent}% left; ${reset}`);
  }
  if (usage.checkedAt) result.push(`  Checked ${clean(usage.checkedAt)}${usage.stale ? ' — stale' : ''}`);
  if (usage.error) result.push(`  ${clean(usage.error)}`);
  return result;
}

function print(value, json) {
  if (json) { console.log(JSON.stringify(value)); return; }
  if (value.hosts) {
    value.hosts.forEach((h, i) => console.log(`${i + 1}. ${clean(h.alias)}${h.saved ? ' [saved]' : ''}  ${clean(h.user || '(SSH default user)')}@${clean(h.hostname)}${h.port ? `:${clean(h.port)}` : ''}  [not checked]`));
    if (!value.hosts.length) console.log('No concrete SSH aliases found. Add a Host entry to ~/.ssh/config, then run servers again.');
    console.log(value.note); for (const w of value.warnings) console.log(clean(w));
  } else if (value.scope === 'existing-daemon') {
    console.log(`Live daemon on ${os.hostname()}: ${clean(value.account?.email || 'identity unavailable')}`);
    console.log(usageLines(value).join('\n')); console.log(value.note);
  } else if (value.accounts) {
    console.log(`Server: ${clean(value.host)}  ·  ${clean(value.codexHome)}`);
    if (value.recoveryRequired) console.log('Recovery required: run recover before modifying credentials.');
    if (!value.accounts.length) console.log('No accounts saved. Use import-current <label>, or login <label>.');
    for (const a of value.accounts) {
      console.log(`\n${a.isSelected ? '* ' : '  '}${clean(a.label)}  ${clean(a.identity.email)}  ${clean(a.identity.planType || '')}`);
      console.log(usageLines(a.usage).join('\n'));
    }
    console.log('\n* Selected in the live auth file; independently running sessions may differ.');
  } else {
    console.log(`Server: ${clean(value.host)} (${clean(value.platform)})\nCodex: ${clean(value.codexVersion || 'not found on PATH')}\nCodex home: ${clean(value.codexHome)}\nAccount store: ${clean(value.root)}\nVault: ${value.vaultExists ? 'present; locked' : 'not created'}\nCodex processes: ${value.running.map(p => p.pid).join(', ') || 'none'}`);
  }
}

async function remote(host, args, options) {
  if (!validHost(host)) throw fail('INVALID_HOST', 'Use a concrete SSH alias or hostname without shell syntax.');
  if (options['passphrase-fd'] !== undefined) throw fail('ARGUMENTS', 'For remote passphrase automation, invoke the helper through SSH directly. --host uses an interactive remote terminal.');
  const forwarded = [...args];
  for (const key of ['store', 'codex-home', 'binary']) if (options[key]) forwarded.push(`--${key}`, options[key]);
  if (options.json) forwarded.push('--json');
  const connection = await new Servers().connection(host);
  await new Promise((resolve, reject) => {
    const child = spawn('ssh', ['-tt', ...connection.args, '--', connection.destination, remoteCommand(options['remote-script'], forwarded)], { stdio: 'inherit' });
    child.once('error', () => reject(fail('SSH_FAILED', 'OpenSSH could not start.')));
    child.once('close', code => code === 0 ? resolve() : reject(fail('SSH_FAILED', 'SSH or the remote helper failed. If the helper is missing, run scripts/install-server.sh for this host.')));
  });
}

async function main(argv = process.argv.slice(2)) {
  const { options, args } = parseArgs(argv);
  if (options.help) { console.log(HELP); return; }
  const command = args[0] || 'list';
  if (command === 'servers') {
    const servers = new Servers(); let result;
    if (args[1] === 'add') result = await servers.add(args[2], options);
    else if (args[1] === 'remove') result = await servers.remove(args[2]);
    else if (args[1] && args[1] !== 'list') throw fail('ARGUMENTS', 'Use servers, servers add or servers remove.');
    else result = await servers.list();
    print(result, options.json); return;
  }
  if (command === 'connect') {
    if (!process.stdin.isTTY) throw fail('TTY_REQUIRED', 'Use an interactive terminal to select a server, or pass --host.');
    const found = await new Servers().list(); print(found, false);
    const readline = require('node:readline/promises');
    const input = readline.createInterface({ input: process.stdin, output: process.stdout });
    let selected; try { selected = await input.question('Server number, or SSH alias/hostname: '); } finally { input.close(); }
    if (/^\d+$/.test(selected.trim()) && !found.hosts[Number(selected) - 1]) throw fail('ARGUMENTS', 'Choose a listed server number or enter an SSH alias/hostname.');
    const host = found.hosts[Number(selected) - 1]?.alias || selected.trim();
    await remote(host, ['list'], options); return;
  }
  if (options.host) { await remote(options.host, args.length ? args : ['list'], options); return; }
  if (process.platform !== 'linux') throw fail('LINUX_REQUIRED', 'Run the account helper on Linux, or choose a server with connect / --host.');
  const manager = new ServerAccounts({ root: options.store, codexHome: options['codex-home'], binary: options.binary, progress: message => { if (!options.json) process.stderr.write(`${clean(message)}\n`); } });
  let result;
  if (command === 'list') result = await manager.cached();
  else if (command === 'doctor') result = await manager.doctor();
  else if (command === 'live') result = await manager.live();
  else if (['import-current', 'login', 'reauth', 'switch', 'refresh', 'recover'].includes(command)) {
    if (['import-current', 'login', 'reauth', 'switch'].includes(command) && !args[1]) throw fail('ARGUMENTS', `An account label is required for ${command}.`);
    if (['import-current', 'login', 'reauth', 'switch'].includes(command)) validLabel(args[1]);
    const password = await passphrase(options, manager);
    if (command === 'import-current') result = await manager.importCurrent(args[1], password);
    if (command === 'login') result = await manager.login(args[1], password);
    if (command === 'reauth') result = await manager.reauth(args[1], password);
    if (command === 'switch') result = await manager.switchAccount(args[1], password);
    if (command === 'refresh') result = await manager.refresh(password);
    if (command === 'recover') result = await manager.recover(password);
  } else throw fail('ARGUMENTS', 'Unknown command. Run --help for usage.');
  print(result, options.json);
}

if (require.main === module) main().catch(error => {
  // Do not print arbitrary parser/process/server errors: those can contain
  // configuration fragments, endpoint responses or credential data.
  const safe = ['ARGUMENTS', 'INVALID_HOST', 'INVALID_PATH', 'LINUX_REQUIRED', 'TTY_REQUIRED', 'CANCELLED', 'PASSPHRASE_MISMATCH', 'SSH_FAILED', 'UNSAFE_PATH', 'INVALID_DATA', 'PASSPHRASE_REQUIRED', 'VAULT_LOCKED', 'BUSY', 'INVALID_AUTH', 'INVALID_LABEL', 'PROCESS_CHECK_FAILED', 'CODEX_RUNNING', 'UNSAFE_SOCKET', 'LIVE_USAGE_TIMEOUT', 'LIVE_USAGE_UNAVAILABLE', 'RECOVERY_REQUIRED', 'FILE_STORE_REQUIRED', 'UNSUPPORTED_CONFIG', 'ACCOUNT_EXISTS', 'SERVER_EXISTS', 'NO_LOGIN', 'LOGIN_FAILED', 'IDENTITY_MISMATCH', 'USAGE_UNAVAILABLE', 'LIVE_AUTH_CHANGED', 'UNSAVED_LOGIN', 'ACCOUNT_NOT_FOUND', 'WORKSPACE_RESTRICTED', 'PERSIST_FAILED'];
  safe.push('UNSUPPORTED_AUTH');
  const message = safe.includes(error.code) ? error.message : 'The operation failed. Credential or raw server details were withheld. Check file permissions, connectivity and Codex availability.';
  if (process.argv.includes('--json')) console.error(JSON.stringify({ error: { code: safe.includes(error.code) ? error.code : 'OPERATION_FAILED', message } }));
  else console.error(`${safe.includes(error.code) ? error.code : 'OPERATION_FAILED'}: ${clean(message)}`);
  process.exitCode = 1;
});

module.exports = { main, parseArgs, clean, usageLines };
