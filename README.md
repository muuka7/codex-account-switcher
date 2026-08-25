# Codex Account Switcher

Private, local-only macOS account switcher for the Codex desktop app.

## Goals

- Keep multiple Codex account credentials saved locally without repeated logout/login.
- Protect inactive account profiles with macOS Keychain-backed encryption.
- Preserve the latest active credential before every switch so refresh-token rotation is not lost.
- Keep the switcher itself offline and unable to inspect Codex conversations, project files, or browser cookies.

## Current scope

Version 0.1 is intentionally macOS-first. It expects Codex authentication at `~/.codex/auth.json` (or `$CODEX_HOME/auth.json`) and the desktop application to be named `Codex`.

## Development

```bash
npm install
npm run lint
npm start
```

For deterministic installation in CI, commit the generated `package-lock.json` after the first trusted local `npm install`, then use `npm ci` thereafter.

## Build

```bash
npm run pack:mac
```

The build targets Intel and Apple Silicon DMGs and applies Electron Fuse hardening during packaging.

Code signing and Apple notarization are intentionally not preconfigured because they require the private repository owner's Apple Developer identity and credentials. Configure signing/notarization before distributing the app outside your own development machine.

## First use

1. Open the official Codex app and sign into the first account normally.
2. Open Codex Account Switcher, name the account (for example `Personal`) and choose **Import**.
3. In the official Codex app, sign into the second account once.
4. Import it with a different name (for example `Work`).
5. Thereafter choose **Switch** or use `Control + Option + 1–9`. The switcher closes Codex, saves the latest active credential into its encrypted vault, activates the selected account, and reopens Codex.

## Important security notes

The live `~/.codex/auth.json` must remain readable by Codex while an account is active. This application encrypts saved inactive profile copies; it cannot protect the live credential from malware already running as your macOS user.

Do not use the switcher to bypass organizational access policy or account controls. If two organizations require strict data separation, separate macOS user accounts provide a stronger boundary.

See `SECURITY.md` for the full threat model.

## Upstream

This project retains MIT attribution and is a private derivative inspired primarily by `GboyCode/CodexAuth`, with UX ideas informed by `ZOONGG/codex-swap-account`. See `NOTICE.md`.
