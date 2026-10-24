set -eu
umask 077
test "$(id -u)" -ne 0 || { echo 'Use an unprivileged SSH account for the helper.' >&2; exit 1; }
command -v node >/dev/null && command -v npm >/dev/null || { echo 'Node.js 20+ and npm must be available in the SSH login shell.' >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)'
task_store="$HOME/.local/share/codex-account-switcher"
mkdir -p "$task_store/releases"
test ! -L "$task_store" && test ! -L "$task_store/releases" || { echo 'Refusing symlinked install directories.' >&2; exit 1; }
chmod 700 "$task_store" "$task_store/releases"
node - "$task_store" <<'NODE'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const file = path.join(process.argv[2], 'installation.json');
try { fs.writeFileSync(file, JSON.stringify({ id: crypto.randomUUID(), version: 1 }), { flag: 'wx', mode: 0o600 }); }
catch (error) { if (error.code !== 'EEXIST') throw error; }
NODE
task_stage=$(mktemp -d "$task_store/releases/build-XXXXXXXX")
tar -xzf - --no-same-owner -C "$task_stage"
mv "$task_stage/server/package.json" "$task_stage/package.json"
mv "$task_stage/server/package-lock.json" "$task_stage/package-lock.json"
npm ci --prefix "$task_stage" --omit=dev --ignore-scripts --no-audit --no-fund
node "$task_stage/src/server/cli.js" --help >/dev/null
task_link="$task_store/.app-$(basename "$task_stage")"
ln -s "$task_stage" "$task_link"
mv -Tf "$task_link" "$task_store/app"
echo 'Helper ready. Run the local CLI with --host, or on this server:'
echo "node \"$task_store/app/src/server/cli.js\" doctor"
