# Linux and SSH accounts

The headless CLI reuses this repository's Codex App Server client and rate-limit normalization. Desktop account cards remain local in this version. The server runs Node.js 20+ and the official Codex CLI; Electron is not installed on the server.

## Find and add servers

From this checkout on your Mac:

```sh
npm run server -- servers
npm run server -- servers add dev-server
npm run server -- connect
```

Discovery reads `~/.ssh/config` and ordinary `Include` files locally. It skips wildcard-only host entries, does not execute `Match exec` or `ProxyCommand`, and does not contact hosts. Conditional includes are reported as a limitation. OpenSSH, rather than this discovery parser, resolves the actual connection settings.

Aliases remain distinct even when they point to the same address. For example, a root alias and a developer alias are separate server choices. Saving an alias adds a local shortcut; it does not edit SSH configuration. A manual server can also be saved:

```sh
npm run server -- servers add staging --address staging.example.com --user developer --port 2222
npm run server -- servers remove staging
```

Manual entries use your normal SSH agent/configuration and host-key verification. The local list lives at `~/.config/codex-account-switcher/servers.json` and contains connection metadata only. Removing an entry does not remove accounts or files from the server.

## Install the helper

Review the source and setup scripts, then run:

```sh
npm run server:install -- dev-server
npm run server -- --host dev-server doctor
```

Setup transfers local source, installs two pinned dependencies from the separate `server/package-lock.json` with package scripts disabled, and selects the completed release. It uses the SSH user, requires no sudo, refuses root installation, and starts no background service or public listener. It does not import accounts, change Codex configuration, restart Codex, or install Electron. This command also accepts saved manual server names.

The executable is selected through `~/.local/share/codex-account-switcher/app`. Older source releases remain under `releases` for manual rollback. The vault and cache are siblings of `app`, so upgrading the helper preserves them. If Node/Codex is installed through NVM, its commands must be available in the SSH login shell.

To use the CLI directly on the server:

```sh
node ~/.local/share/codex-account-switcher/app/src/server/cli.js --help
```

## See usage while working

```sh
npm run server -- --host dev-server live
npm run server -- --host dev-server list
```

`live` connects to the existing Codex daemon's private Unix WebSocket. It asks for account identity and rate limits without copying credentials or starting another Codex process. Normal authentication inside that owning daemon may refresh tokens. Separately launched Codex processes can have different identities; the result is labelled as one daemon's view and is not silently assigned to a saved account/workspace.

`list` displays cached readings for all saved accounts and marks readings older than 30 minutes stale. A selected marker describes the live auth file, not proof that every running client adopted it. Missing quota values remain unknown. Each model/quota bucket retains its reported window duration and reset timestamp. The helper never adds percentages across accounts into a pooled balance.

## Enroll accounts

```sh
npm run server -- --host dev-server import-current personal
npm run server -- --host dev-server login work
```

The first account operation creates a passphrase-encrypted vault and asks you to confirm a new passphrase of at least 12 characters. Subsequent credential operations prompt again. The passphrase is hidden, stays out of shell arguments and persistent settings, and is never sent to the desktop renderer. There is no forgotten-passphrase recovery; preserve an encrypted backup or sign in again.

`import-current` only encrypts a copy of the server's file login. `login` uses the official Codex App Server device-code flow in a private staging home, validates account/workspace and email, and saves it without changing the active login. It prints the official verification URL and one-time code to your terminal. Enable device login for the account/workspace if required and use a current Codex CLI. ChatGPT file logins are supported; API-key-only accounts are outside this first version.

## Desktop controls

Choose a server under **Accounts on**, or open **Servers…** to save an SSH alias or add a hostname, user and port manually. Discovery reads SSH config and includes locally; selecting **Connect** is the first network operation. Root and ordinary-user aliases remain separate. The desktop uses your OpenSSH agent and existing host-key verification; establish an unfamiliar host's trusted key in your terminal first.

**Set up server helper** installs the source-only archive and two pinned dependencies as the SSH user. It preserves existing vaults, live credentials and running Codex processes. Updates use an atomic release symlink. No daemon or public HTTP listener is installed.

The live panel reads the existing daemon and retains every quota pool, duration, observation time and reset timestamp. It stays separate from saved account cards when Codex does not expose the daemon's workspace ID. A selected card describes `auth.json`, which does not prove that every running client adopted that account.

**Save current login** encrypts a snapshot on the server. **Add account** shows the official OpenAI URL and one-time device code; complete sign-in in your browser. The login is staged privately and does not switch the live account. **Refresh saved usage**, **Re-authenticate** and **Switch** enforce the same quiet-server and identity checks as the CLI. After switching, reconnect Codex and confirm the runtime's actual account.

For a new desktop-managed vault, the app generates an installation-specific random key and protects it with macOS Keychain or Windows credential encryption before sending it through SSH stdin. Keys and account tokens are not returned to the renderer. Keep this computer's protected application data: there is no forgotten-key recovery. Removing a saved server shortcut does not delete its vault or protected key. A vault created with a terminal passphrase cannot currently be unlocked by the desktop; use its creating terminal. Conversely, manual credential-changing CLI commands need the desktop-managed vault's key, which the current desktop does not export. Read-only CLI `live` and `list` work with either vault type. Do not create two competing vaults or copy snapshots to work around this limitation.

## Refresh inactive accounts and switch

Before these commands, finish work, disconnect desktop SSH sessions, stop CLI sessions and the Codex daemon, and prevent clients from reconnecting during the operation. `doctor` reports Codex PIDs. The helper does not stop processes for you and conservatively blocks when any same-user Codex process is present, including processes using other homes.

Switching also requires an explicit top-level setting in the server's Codex config:

```toml
cli_auth_credentials_store = "file"
```

The helper reads this setting with a TOML parser; it does not modify it. Shared-home switching currently requires the default OpenAI provider without a selected configuration profile. Existing managed workspace restrictions remain in effect through Codex and the explicit target-workspace check.

```sh
npm run server -- --host dev-server refresh
npm run server -- --host dev-server switch work
npm run server -- --host dev-server reauth work
```

`refresh` checks saved accounts in isolated homes. It preserves rotated credentials even when the subsequent usage request fails, encrypts them before removing the temporary copy, and updates the live login when its own token was rotated. It therefore requires stopped clients. No direct undocumented ChatGPT backend requests, model warmups, credit redemption or automatic switching are implemented by the helper.

`switch` preserves the source's latest live credential, checks the destination through Codex, journals the transaction inside the encrypted vault, rechecks processes and the source file, then atomically selects the destination. It neither restarts Codex nor submits a continuation turn. Reconnect/relaunch the client yourself and verify its actual account. Cross-account chat, plugin and workspace portability is not guaranteed.

`reauth` requires stopped clients and accepts only the same account/workspace and email. If re-authenticating the selected account, it journals replacement of the live login too.

Process scanning and file checks reduce races; they are not a launch gate honored by arbitrary external Codex clients. A client can start in the interval between a process check and the write. This version is intended for supervised maintenance with reconnects disabled, not unattended switching on a busy shared host.

## Recovery and storage

Saved credentials and pending transaction data use scrypt-derived AES-256-GCM encryption in `accounts.vault`. Files/directories use mode `0600`/`0700`. The public `state.json` cache contains labels, identity and usage only. Live `auth.json` remains readable by Codex, and a process with your user permissions can read it or memory from an unlocked operation. Encryption does not separate hostile processes running as the same Linux user.

```sh
npm run server -- --host dev-server recover
```

Recovery requires stopped clients and refuses unfamiliar live state. An unwritten interrupted switch is cancelled; a written one is finalized. A pending refresh can restore the newer encrypted token. It never blindly switches a second time.

The management lock is not stolen automatically. After a crash, inspect `operation.lock` in the account store and verify its recorded process has exited before removing it. If encrypted persistence fails after rotation, the private plaintext recovery copy is retained under `probes/` and an error explains this. Preserve it rather than deleting it or restoring a stale credential. Resolve the storage issue before further credential operations. Ordinary successful probes are removed; there is no automatic sweeping of possible recovery credentials.

SIGINT/SIGTERM/SIGHUP are deferred during credential transactions so in-flight refreshes can be preserved. SIGKILL, machine loss and a network failure after server-side token rotation can still require signing in again. Do not use several account managers or copied login snapshots to independently refresh the same session.

## Options and automation

`--store`, `--codex-home` and `--binary` support isolated testing or custom installations. `--remote-script` overrides the default helper path and must be absolute. `--json` is available on data commands. `--host` uses a remote interactive terminal so OpenSSH and the remote vault can prompt normally.

For non-interactive automation, invoke the helper through SSH directly and supply the passphrase through a dedicated `--passphrase-fd`; never use a command-line or environment-variable passphrase. Automated switching is not recommended. Read-only `live` and cached `list` do not require a vault passphrase.

Run `npm test`, `npm run lint`, `npm run lint:server` and `npm audit --prefix server --omit=dev` before installation. Existing desktop dependencies and behavior are separate from the server's minimal runtime manifest.
