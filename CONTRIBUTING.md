# Contributing

Thanks for helping improve Codex Account Switcher. This app handles local
authentication files, so a small, security-conscious change is better than a
large speculative one.

## Before opening a pull request

- Work from an up-to-date `main` branch and use a focused branch such as
  `feat/short-description` or `fix/short-description`.
- Never commit `auth.json`, encrypted vault files, screenshots containing
  account data, tokens, logs with credentials, or signing identities.
- Keep account data on the owning machine. A new network request, telemetry path, credential
  reader, or external navigation path needs explicit maintainer and security
  review.
- Update the README, `SECURITY.md`, `CHANGELOG.md`, or release notes when
  behavior, threat boundaries, or user-facing workflows change.

## Required checks

Run these from the repository root:

```bash
nvm use
npm ci
npm run lint
npm test
npm audit --audit-level=moderate
npm ci --prefix server --ignore-scripts
npm audit --prefix server --audit-level=moderate
```

For packaging changes, also run the native build on the affected platform:

```powershell
npm run pack:win
```

```bash
npm run pack:mac
```

CI runs syntax checks, behavioral tests, desktop/server dependency audits, and native packaging smoke checks on macOS and Windows. Ad-hoc smoke builds are not published. Release builds additionally verify macOS signing/notarization and round-trip download checksums before publishing. The release verifier requires both architecture ZIPs and matching update metadata.

## Pull request review guidelines

Every PR should explain what changed, why it changed, how it was tested, and
which platforms were exercised. Reviewers should check:

1. **Credential safety** — no secrets are logged, returned to the renderer,
   written in plaintext, or included in errors, screenshots, fixtures, or test
   data. Credential replacement remains atomic and rollback-safe.
2. **Electron boundaries** — keep `nodeIntegration` disabled,
   `contextIsolation` and sandboxing enabled, IPC methods narrow and validated,
   external navigation denied, and the renderer free of direct filesystem or
   process access.
3. **Network and privacy** — no unapproved HTTP, WebSocket, analytics,
   crash-reporting, or account-data collection paths. Opt-in local usage data
   must remain local and contain no credential material.
4. **Destructive actions** — removing accounts, clearing local data, and
   re-authentication must be explicit and confirmed. Switching should preserve
   the active credential before replacement.
5. **Cross-platform behavior** — test the affected flow on macOS and Windows
   where applicable, including fresh install, existing profiles, and failure or
   cancellation paths.
6. **Usability and accessibility** — check keyboard navigation, focus restore,
   reduced window sizes, light/dark themes, readable status feedback, and
   labels for icon-only controls.
7. **Supply chain and release impact** — review dependency changes, workflow
   permissions, action versions, packaging output, and checksum behavior.

Maintainers may request a second security-focused review for changes to
`src/main.js`, `src/preload.js`, `src/codex-config.js`, packaging configuration,
or GitHub Actions workflows.

## Reporting a vulnerability

Do not open a public issue or PR for a vulnerability. Follow the private
reporting process in [`SECURITY.md`](SECURITY.md).
