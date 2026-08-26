# Codex Account Switcher

Private, local-only account switcher for the Codex desktop app on macOS and Windows.

## Goals

- Keep multiple Codex account credentials saved locally without repeated logout/login.
- Protect inactive account profiles with OS-backed encryption (macOS Keychain via Electron `safeStorage`; Windows DPAPI via Electron `safeStorage`).
- Preserve the latest active credential before every switch so refresh-token rotation is not lost.
- Keep the switcher itself offline and unable to inspect Codex conversations, project files, or browser cookies.

## Current scope

Version 0.1 supports macOS and Windows. It expects Codex authentication at `~/.codex/auth.json` / `%USERPROFILE%\.codex\auth.json` (or `$CODEX_HOME/auth.json`). The official Codex desktop app remains responsible for authentication.

Current Codex releases may use an OS/native credential store by default. To make `auth.json` switching authoritative, the switcher ensures the top-level `config.toml` setting contains:

```toml
cli_auth_credentials_store = "file"
```

If `config.toml` already exists and needs changing, the switcher creates a timestamped `config.toml.codex-switcher-backup-*` copy before modifying it.

## Development

```bash
npm install
npm run lint
npm start
```

For deterministic installation in CI, commit the generated `package-lock.json` after the first trusted local `npm install`, then use `npm ci` thereafter.

## Build

macOS:

```bash
npm run pack:mac
```

Windows:

```powershell
npm run pack:win
```

The macOS build targets Intel and Apple Silicon DMGs. The Windows build targets an x64 NSIS installer. Electron Fuse hardening is applied to both packaged executables.

Code signing and notarization are intentionally not preconfigured because they require the private repository owner's signing identities and credentials. Configure signing/notarization before distributing outside your own development machines.

## The interface

The switcher is a single screen, because the common case is opening it for a few
seconds to pick an account.

- **Account cards** — one per saved account, showing its name, email, plan,
  credential freshness and keyboard shortcut. Each card carries its own
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

The window follows the operating system's light/dark setting;
**Settings → Appearance** can pin it to one or the other. Nothing in the
interface reaches the network.

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

See `SECURITY.md` for the full threat model.

## Upstream

This project retains MIT attribution and is a private derivative inspired primarily by `GboyCode/CodexAuth`, with UX ideas informed by `ZOONGG/codex-swap-account`. See `NOTICE.md`.
