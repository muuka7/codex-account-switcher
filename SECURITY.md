# Security model

This application is intentionally narrow: it switches the local authentication state used by the official Codex desktop app on macOS and Windows.

## Supported versions

The headless Linux helper uses a separate passphrase-encrypted vault (scrypt and
AES-256-GCM), never a plaintext fallback for inactive accounts. Its `live` command
uses the owning daemon's private socket. Inactive refresh and switching refuse
running Codex processes and require supervised maintenance with automatic
reconnections disabled; process scanning alone cannot prevent an external client
from starting between checks. See [Linux security and recovery](docs/LINUX-SERVER.md).

The latest tagged release and the current `main` branch receive security fixes.
Older release lines are not maintained unless a release note says otherwise.

## Security guarantees

- Saved account credentials are encrypted with Electron `safeStorage`, which uses macOS Keychain-backed protection on macOS and Windows DPAPI-backed protection on Windows.
- The renderer has `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`, and `webSecurity: true`.
- The renderer is denied all HTTP(S) and WebSocket requests.
- External navigation and popup windows are denied.
- The UI receives only non-secret account metadata and sanitized rate-limit data (remaining percentage, window duration, reset time, freshness, and error category).
- Credential files are written atomically with restrictive local file modes where supported by the platform.
- Before saving a live credential, both its account/workspace and email must match the saved profile. A different or unidentified login is rejected without replacing the snapshot. This also applies before and after active-account usage checks.
- Before switching away, the matching current `auth.json` is written back into its encrypted profile so rotated refresh tokens are preserved.
- Guarded handoff never closes a running Codex process. It queues until Codex is no longer running, then revalidates confirmed capacity and account eligibility before switching.
- Automatic destinations are restricted to accounts the user explicitly enables with the same continuity-group label. The destination identity is checked after reopening; verification failure attempts to restore the source account.
- The handoff journal contains account identifiers, phase, timestamps, trigger, and sanitized errors only. It does not contain prompts, thread history, command output, or credentials.
- An OS-encrypted rollback backup is made before replacing the active credential.
- Electron runtime features not required by the app are disabled using Electron Fuses during packaging.

## Usage checks

Usage refreshes contact Codex services through the bundled Codex App Server.
The renderer remains network-denied. An inactive account is decrypted only in
the main process, copied into a unique temporary Codex home for the request, and
removed after the App Server exits. If Codex rotates that account's credentials,
the refreshed snapshot is accepted only after its account identity matches and
is then encrypted back into the vault. Tokens and raw App Server output are not
sent to the renderer or written to the usage cache.

## Update trust boundary

Packaged macOS builds check this repository's GitHub Releases on startup and
roughly every four hours through electron-updater in the main process. Those
requests disclose normal connection metadata to GitHub (and its download
infrastructure); account tokens, email addresses and conversation content are
not included by the switcher. The renderer remains network-denied.

A check never downloads or installs an update. Download requires the user's
explicit action, and installation requires **Install and restart**; quitting
normally does not install a downloaded update. Downgrades are disabled. Update
payload hashes are checked by the updater; macOS's native update mechanism
requires a compatible code signature. This trust depends on the maintainer's
GitHub account and Apple signing identity. Checksums alone are not independent
proof of authorship. The repository does not embed a GitHub access token.

macOS release signing and notarization use the maintainer's local Keychain.
GitHub builds Windows and checks both uploaded macOS architectures against the
expected Apple team before automatic publication. Source/hash receipts bind the
assets to the tagged commit and verification run. Apple private keys and
notarization credentials are not installed on GitHub runners.

Existing v0.2.1 and earlier release assets are unsigned and cannot bootstrap a
trusted auto-update chain. The first signed/notarized version must be installed
manually, after verifying its published signing status. Windows updates remain
manual and Windows installers remain unsigned.

## Explicitly out of scope

This application does not:

- host an OpenAI login page;
- request or store an OpenAI password;
- request or store TOTP/2FA seeds;
- inspect browser cookies;
- read Codex conversation/session history;
- parse prompts, project files, or Codex logs;
- provide analytics, telemetry, crash reporting, automatic turn submission,
  automatic approvals, or guaranteed task restoration.


## Threat boundary

The application runs as the signed-in OS user. Malware or another process already executing with the same user's privileges may still be able to read the live plaintext Codex `auth.json` while Codex is using it. The encrypted profile vault primarily protects inactive saved profiles at rest and prevents accidental plaintext duplication.

For maximum separation between unrelated organizations, use separate OS user accounts instead of a credential switcher.

## Reporting

Do not attach real `auth.json` files, tokens, cookies, passwords, TOTP seeds, or screenshots containing secrets to GitHub issues or pull requests.

Please report suspected vulnerabilities privately through [GitHub Security
Advisories](https://github.com/muuka7/codex-account-switcher/security/advisories/new).
Include the affected version or commit, operating system, reproduction steps,
impact, and a suggested fix if you have one. Redact credentials and other
personal data from all evidence. If private reporting is unavailable, contact
the repository owner through their GitHub profile and do not publish the issue
until a fix or mitigation has been coordinated.

The maintainer will acknowledge reports when practical, investigate privately,
and publish a release note when a fix is available. Please allow reasonable
time for triage before public disclosure.
