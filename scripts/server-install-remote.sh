set -eu
umask 077
test "$(id -u)" -ne 0 || { echo 'Use an unprivileged SSH account for the helper.' >&2; exit 1; }
command -v node >/dev/null && command -v npm >/dev/null || { echo 'Node.js 20+ and npm must be available in the SSH login shell.' >&2; exit 1; }
node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)'
task_store="$HOME/.local/share/codex-account-switcher"
mkdir -p "$task_store/releases"
test ! -L "$task_store" && test ! -L "$task_store/releases" || { echo 'Refusing symlinked install directories.' >&2; exit 1; }
chmod 700 "$task_store" "$task_store/releases"
task_stage=$(mktemp -d "$task_store/releases/build-XXXXXXXX")
tar -xf - --no-same-owner -C "$task_stage"
mv "$task_stage/server/package.json" "$task_stage/package.json"
mv "$task_stage/server/package-lock.json" "$task_stage/package-lock.json"
npm ci --prefix "$task_stage" --omit=dev --ignore-scripts --no-audit --no-fund
node "$task_stage/src/server/cli.js" --help >/dev/null
task_link="$task_store/.app-$(basename "$task_stage")"
ln -s "$task_stage" "$task_link"
mv -Tf "$task_link" "$task_store/app"
echo 'Helper ready. Run the local CLI with --host, or on this server:'
echo "node \"$task_store/app/src/server/cli.js\" doctor"
