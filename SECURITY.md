# Security model

This application is intentionally narrow: it switches the local authentication state used by the official Codex desktop app on macOS and Windows.

## Security guarantees

- Saved account credentials are encrypted with Electron `safeStorage`, which uses macOS Keychain-backed protection on macOS and Windows DPAPI-backed protection on Windows.
- The renderer has `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and `webSecurity: true`.
- The renderer is denied all HTTP(S) and WebSocket requests.
- External navigation and popup windows are denied.
- The UI receives only non-secret account metadata (display name, email/plan claims when locally derivable, active status).
- Credential files are written atomically with restrictive local file modes where supported by the platform.
- Before switching away, the current `auth.json` is written back into its encrypted profile so rotated refresh tokens are preserved.
- An OS-encrypted rollback backup is made before replacing the active credential.
- Electron runtime features not required by the app are disabled using Electron Fuses during packaging.

## Explicitly out of scope

This application does not:

- host an OpenAI login page;
- request or store an OpenAI password;
- request or store TOTP/2FA seeds;
- inspect browser cookies;
- call OpenAI APIs itself;
- read Codex conversation/session history;
- parse prompts, project files, or Codex logs;
- provide analytics, quota estimation, telemetry, crash reporting, or automatic updates.

## Threat boundary

The application runs as the signed-in OS user. Malware or another process already executing with the same user's privileges may still be able to read the live plaintext Codex `auth.json` while Codex is using it. The encrypted profile vault primarily protects inactive saved profiles at rest and prevents accidental plaintext duplication.

For maximum separation between unrelated organizations, use separate OS user accounts instead of a credential switcher.

## Reporting

Do not attach real `auth.json` files, tokens, cookies, passwords, TOTP seeds, or screenshots containing secrets to GitHub issues or pull requests.
