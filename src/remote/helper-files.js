// A positive allowlist: source archives must never sweep up local credentials,
// temporary files, fixtures or another tool's state from a directory tree.
module.exports = Object.freeze([
  'src/server/accounts.js', 'src/server/cli.js', 'src/server/security.js',
  'src/server/processes.js', 'src/server/servers.js', 'src/server/ssh-hosts.js',
  'src/server/live-usage.js', 'src/server/device-login.js', 'src/server/rpc.js',
  'src/server/errors.js', 'src/server/public-data.js',
  'src/codex-app-server.js', 'src/rate-limits.js', 'src/owned-process.js',
  'server/package.json', 'server/package-lock.json',
  'LICENSE', 'NOTICE.md', 'licenses/Apache-2.0.txt', 'docs/LINUX-SERVER.md',
]);
