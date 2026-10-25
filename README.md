# Codex Account Switcher

Codex account switcher for macOS and Windows, with a headless Linux helper over SSH.

## Goals

- Keep multiple Codex account credentials saved locally without repeated logout/login.
- Protect inactive account profiles with OS-backed encryption (macOS Keychain via Electron `safeStorage`; Windows DPAPI via Electron `safeStorage`).
- Preserve the latest active credential before every switch so refresh-token rotation is not lost.
- Keep the renderer offline and prevent the switcher from inspecting Codex conversations, project files, or browser cookies. Usage refreshes contact Codex services through the bundled Codex runtime.

## Current scope

A headless Linux CLI is available for SSH host discovery, saved server shortcuts,
encrypted account storage, live daemon usage and supervised account switching.
Start with `npm run server -- servers`. See [Linux and SSH setup](docs/LINUX-SERVER.md).
The 0.3.0 development desktop adds **Accounts on** and **Servers…** controls for
SSH discovery, manual server setup, helper installation, live quota/reset
readings, account enrollment through official browser device login, and
supervised switching. See the Linux guide for quiet-server requirements and
shared desktop/terminal vault access and recovery requirements.

For the completed feature summary, architecture, safety fixes and tested build
provenance, see [Remote desktop integration and verification](docs/REMOTE-DESKTOP-IMPLEMENTATION.md).

### Manage accounts on an SSH server

1. Open **Servers…**, choose a discovered SSH alias, or add a hostname, user and
   port manually. Connect as the ordinary Linux user who runs Codex.
2. Choose **Set up server helper** (or **Update helper**) to install the helper
   without sudo. Existing server logins and vaults are preserved.
3. Choose **Save current login** to save the server's existing account, then
   **Add account** for another account. **Copy code** copies the one-time code
   for the official browser sign-in; enrollment leaves the current login selected.
4. Use **Refresh live usage** while working. To refresh saved accounts or switch,
   finish work, disconnect desktop SSH connections and terminal Codex sessions,
   stop any remaining server Codex daemon, and prevent automatic reconnects
   throughout the operation. The server must explicitly use
   `cli_auth_credentials_store = "file"`.
5. Choose **Refresh saved usage** or confirm **Switch to this account**. After a
   switch, reconnect Codex and verify its actual account before continuing work.

**Terminal access…** lets you explicitly copy the desktop-created vault key for
the CLI's hidden passphrase prompt. **Unlock vault…** accepts an existing CLI
passphrase. The vault key unlocks every saved account on that server; keep it out
of commands, environment variables and logs. Full commands and recovery steps
are in the [Linux guide](docs/LINUX-SERVER.md).

### Local desktop behavior

The desktop supports macOS and Windows. It expects Codex authentication at `~/.codex/auth.json` / `%USERPROFILE%\.codex\auth.json` (or `$CODEX_HOME/auth.json`). The official Codex runtime remains responsible for authentication.

Each saved account card can show the remaining five-hour and weekly capacity
reported by Codex, together with the server-provided reset time. A refresh reads
each account in isolation and automatically performs a confirmation read three
minutes later.

Guarded handoff is an opt-in policy for confirmed five-hour exhaustion. It
selects the same-group eligible account with the most short-window capacity,
then queues the switch until Codex has been closed by the user. It never closes
Codex on its own, never submits a continuation turn, and never approves a
pending action. After destination verification, Codex reopens for supervised
continuation.

Current Codex releases may use an OS/native credential store by default. To make `auth.json` switching authoritative, the local desktop switcher ensures the top-level `config.toml` setting contains:

```toml
cli_auth_credentials_store = "file"
```

If `config.toml` already exists and needs changing, the switcher creates a timestamped `config.toml.codex-switcher-backup-*` copy before modifying it.
The Linux helper requires this setting explicitly and does not change the server's config.

## Install

Prebuilt installers for both platforms are attached to each entry on the
[Releases page](https://github.com/muuka7/codex-account-switcher/releases):

| Download | Platform |
| --- | --- |
| `CodexAccountSwitcher-<version>-arm64.dmg` | macOS, Apple Silicon |
| `CodexAccountSwitcher-<version>-x64.dmg` | macOS, Intel |
| `CodexAccountSwitcher-Setup-<version>-x64.exe` | Windows 10/11, 64-bit |

Check what you downloaded against `SHA256SUMS.txt` before installing.
**Existing v0.2.1 and earlier assets are unsigned.** Signing/notarization and
macOS auto-update are configured for the next release; they are not a claim
about those existing downloads. macOS release builds use the maintainer's local
Keychain; GitHub verifies signatures, notarization and downloaded assets before
publication. Until that verified release exists, use the source for development
or follow the signing status recorded on each release.

A signed macOS release checks GitHub for updates automatically. Download and
**Install and restart** each require an explicit action; closing the app does
not install a downloaded update. Install the first signed version manually.

Windows releases are not currently code-signed, so SmartScreen may show
"Windows protected your PC". Choose **More info**, then **Run anyway**.

## Development

```bash
nvm use
npm ci
npm run lint
npm test
npm start
```

Use Node.js 24 (see `.nvmrc`) for desktop development and builds; the minimum is 22.12.0. Commit lockfile changes with dependency updates. The standalone Linux helper supports Node.js 20+ through its separate manifest.

## Build

macOS:

```bash
npm run pack:mac
```

Windows:

```powershell
npm run pack:win
```

The macOS build targets Intel and Apple Silicon DMGs plus the ZIP payloads used
by auto-update. The Windows build targets an x64 NSIS installer. Electron Fuse
hardening is applied to both packaged executables.

Each command builds for its native platform. Releases use the maintainer's Mac for signed macOS builds and GitHub Actions for Windows. `npm run release:mac` uploads verified macOS assets and starts the workflow; publication is automatic after both platforms pass verification. See [RELEASING.md](RELEASING.md).

Apple signing and notarization credentials stay in the local Keychain; no Apple GitHub Secrets are required. Run `npm run release:setup` and `npm run release:doctor` on the signing Mac. For an ad-hoc local packaging check, run `npm run pack:mac -- -c.mac.forceCodeSigning=false -c.mac.identity=- -c.mac.notarize=false`. That output is for validation only; it is not a distribution-trusted installer.

## The interface

The switcher is a single screen, because the common case is opening it for a few
seconds to pick an account.

- **Account cards** — one per saved account, showing its name, email, plan,
  credential freshness, keyboard shortcut, and remaining five-hour and weekly
  capacity. Each card carries its own
  **Switch** button. The **⋯** menu holds **Re-authenticate…**,
  **Change shortcut…** and **Remove account…**.
- **The active account** is the only card that is tinted, lifted and marked with
  a coloured rail, so the account Codex is using right now reads at a glance.
- **Freshness dot** — green if the saved snapshot was refreshed within a week,
  amber within a month, red beyond. A stale snapshot is the usual reason a
  switch fails; re-authenticate that account.
- **Banners** — a warning banner takes over the top of the screen while a
  sign-in is pending, and an accent banner appears when Codex is signed in to an
  account the switcher has not saved.
- **Settings** (the gear) — theme, per-account shortcuts, launch size,
  open-at-login, local activity counts and the safety notes.
- **Usage refresh** — choose **Refresh usage** to check every saved account.
  The findings and safety requirements for later automatic handoff are
  documented in [Usage monitoring and account handoff learnings](docs/USAGE-MONITORING.md).
  Guarded handoff can use only a recent confirmation read.
- **Guarded handoff** — opt in from Settings, enable individual accounts, and
  give accounts the same continuity-group name. While enabled, the switcher
  stays in the tray and checks usage every five minutes. A queued handoff waits
  until Codex exits, preserves the source login, switches, verifies the
  destination identity, and reopens Codex. Continuation remains supervised.

The window follows the operating system's light/dark setting;
**Settings → Appearance** can pin it to one or the other. The renderer remains
network-denied; only the main-process usage refresh starts Codex App Server.

## First use

1. Open the official Codex app and sign into the first account normally.
2. Confirm the local Codex `auth.json` exists.
3. Start Codex Account Switcher. It ensures Codex is configured to use file-backed credentials, backing up an existing `config.toml` before any required change.
4. The switcher offers to **Save the account Codex is signed in to**. Choose **Save this account**, name it (for example `Personal`), and choose **Encrypt and save**.
5. To add another account, choose **Add another account**. **Do not use Codex's Logout action** — the dialog explains why.
6. Choose **Open Codex sign-in**. The switcher saves the current account into its encrypted vault, closes Codex, removes only the local live `auth.json`, and reopens the official Codex sign-in screen.
7. Sign into the additional account normally in Codex. The switcher watches for the completed sign-in and shows the address it found.
8. Return to the switcher, give the account a name (for example `Work`), and choose **Save account**.
9. Thereafter choose **Switch** on a card, or use `Control + Option/Alt + 1–9`. The switcher closes Codex, saves the latest active credential into its encrypted vault, activates the selected account, and reopens Codex.

Switching does not ask for confirmation: it is reversible, and switching back
restores the previous account. Removing an account does ask, because it deletes
an encrypted snapshot permanently.

## Re-authenticating a saved account

If a saved account becomes invalid or was previously logged out:

1. Open that account's **⋯** menu, choose **Re-authenticate…**, and confirm.
2. The switcher preserves the currently active saved account, removes only the live local login, and opens the official Codex sign-in screen.
3. Sign into the requested account normally in Codex.
4. Return to the switcher and choose **Finish re-authentication** in the banner at the top of the screen.

The switcher checks the local account identity where possible before replacing the saved encrypted snapshot.

## Important security notes

The live Codex `auth.json` must remain readable by Codex while an account is active. This application encrypts saved inactive profile copies; it cannot protect the live credential from malware already running as your OS user.

Do not use the switcher to bypass organizational access policy or account controls. If two organizations require strict data separation, separate OS user accounts provide a stronger boundary.

See `SECURITY.md` for the full threat model and private vulnerability-reporting
instructions.

## Upstream

This project retains MIT attribution and is a derivative inspired primarily by `GboyCode/CodexAuth`, with UX ideas informed by `ZOONGG/codex-swap-account`. See `NOTICE.md`.

## Public launch

See [Public readiness](docs/PUBLIC-READINESS.md) for validation results and the
remaining GitHub settings and signed-release checks.
