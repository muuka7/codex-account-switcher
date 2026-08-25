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

## First use

1. Open the official Codex app and sign into the first account normally.
2. Confirm the local Codex `auth.json` exists.
3. Start Codex Account Switcher. It first ensures Codex is configured to use file-backed credentials, backing up an existing `config.toml` before any required change.
4. Name the current account (for example `Personal`) and choose **Import**.
5. In the official Codex app, sign out and sign into the second account once.
6. Import it with a different name (for example `Work`).
7. Thereafter choose **Switch** or use `Control + Option/Alt + 1–9`. The switcher closes Codex, saves the latest active credential into its encrypted vault, activates the selected account, and reopens Codex.

## Important security notes

The live Codex `auth.json` must remain readable by Codex while an account is active. This application encrypts saved inactive profile copies; it cannot protect the live credential from malware already running as your OS user.

Do not use the switcher to bypass organizational access policy or account controls. If two organizations require strict data separation, separate OS user accounts provide a stronger boundary.

See `SECURITY.md` for the full threat model.

## Upstream

This project retains MIT attribution and is a private derivative inspired primarily by `GboyCode/CodexAuth`, with UX ideas informed by `ZOONGG/codex-swap-account`. See `NOTICE.md`.
