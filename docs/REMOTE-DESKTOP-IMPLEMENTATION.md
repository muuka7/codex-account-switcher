# Remote desktop integration and verification

Objective: install and exercise the repository's Linux helper on the selected SSH server, expose its accounts, quotas and reset windows in the desktop app, enroll a second account with the user's browser participation, test a supervised account switch, review safety, and produce locally signed macOS builds with GitHub CI evidence.

## Architecture

- Discovery reads local SSH config and saved server metadata without network access. Selecting a host performs an explicit OpenSSH connection with host-key verification and batch authentication. The renderer has no network access.
- A versioned JSON-lines protocol runs over SSH stdio. The helper accepts a fixed method set; credentials, tokens, paths and raw Codex/server errors are never response fields. The desktop main process owns SSH children and applies byte, time and concurrency limits.
- The server retains saved ChatGPT credentials in its encrypted vault. The desktop generates a per-installation vault key and protects it with Electron safeStorage; it sends that key through SSH stdin. Stored keys never appear in IPC responses. Explicit terminal access can copy a verified key directly from the main process to the clipboard. A user-entered existing vault passphrase briefly occupies a password input, which is cleared on submission; verification precedes local encrypted persistence. Preserve the existing key/passphrase or re-enroll if it is lost.
- Live daemon usage remains distinct from saved-file selection when the protocol cannot prove a workspace identity. Every displayed reading retains its observation time, window duration, reset time and source. Inactive-account refreshes may rotate tokens and require stopped clients in this version.
- Device login uses official Codex App Server in a private staging home. Only the official verification URL, one-time code and completion state reach the UI. Enrollment does not switch the active server login.
- Switching is an explicit maintenance operation: stop affected runtimes, preserve the source, validate the target, journal and replace atomically, then restart/reconnect and verify the owning runtime. There is no arbitrary-process termination or automatic continuation.
- Packaged apps carry a source-only helper archive with pinned server dependencies and a public protocol version. Installation runs as the SSH user without sudo, daemon restarts or changes to the live login.

## Required evidence

| Requirement | Evidence needed | Current state |
| --- | --- | --- |
| Server discovery/addition and selection in desktop | Real app interaction and saved-host reload | Verified with computer use in development and the installed signed app; manual test entry saved/reloaded then removed |
| Install helper on chosen Linux user | Installed manifest, version/doctor and permissions | Source archive installed successfully; protocol/manifest and live usage read over actual SSH |
| Import current server account | Encrypted vault, unchanged live auth, visible account card | Verified through the installed signed app; auth hash unchanged, encrypted vault mode 0600, no plaintext tokens in vault/cache |
| Quota/reset display accurate | Timestamped app view compared with independent server CLI read | Verified against independent live CLI read; all quota durations/reset timestamps retained and local-time display checked |
| Second-account enrollment | User-completed browser login, second encrypted account, original login unchanged | User completed official browser device login; second account is visible and original file selection remains active |
| Account switching | Supervised A→B→A, runtime identity and usage verified after reconnect | Pending; needs a quiet server window |
| Safety/code review | Regression tests plus a separate source-review pass and fixes | 71 tests passed; both npm audits clean; recovery, alias-key races, copying, stopped daemons and terminal interoperability covered; final UI/build pass pending |
| Signed macOS app | Developer ID, hardened runtime, notarization and runtime launch checks | First candidate passed both architectures, signatures, notarization and matching DMG/ZIP verification; installed and exercised. Copy/access changes need a rebuilt candidate |
| Public source/CI | Pushed reviewed branch/PR and exact-commit check results | Draft PR #25; first candidate passed validation, CodeQL, dependency review and both native packaging jobs |

## Limits to preserve

No passphrases or account tokens in chat, CLI arguments, environment variables or logs. Stored keys and tokens never appear in renderer state; an explicitly entered vault passphrase is cleared from its input immediately upon submission. Clipboard access is write-only and requires the specific user action for either a one-time code or a full vault key. No public App Server listener, disabled SSH host-key checks, root installation, model warmup, credit redemption or automatic cross-account turn submission. Native processes can bypass the helper's lock; process checks are not a global launch gate. Busy-host switching stays blocked until the user arranges a maintenance window.

## Work log

- 2026-10-24: Revalidated the clean public repository and current server. The helper is not installed; the current login exists and several Codex runtimes are active. Local signing/notarization tooling is already in the repository. Created a dedicated integration branch.
- 2026-10-24: Installed the source-only helper as the ordinary SSH user. Read current daemon usage through the same bounded SSH transport the desktop uses. Confirmed all quota durations and reset timestamps survive response filtering. File credential storage is not explicitly enabled, so switching remains gated.
- 2026-10-24: Implemented the desktop context selector, discovered/manual server management, installation, live and saved account panels, browser device login, reauthentication, recovery and supervised switch controls. The renderer receives sanitized metadata; the main process owns SSH and protected keys.
- 2026-10-24: Reviewed credential recovery, process shutdown, request validation, archive allowlisting and protected-key creation. Fixed token loss after failed desktop probes, startup deletion of potential recovery homes, native descendants outliving helper wrappers, unbounded SSH child cleanup and concurrent aliases replacing the same installation key. Added regression coverage.
- 2026-10-24: Signing preflight passed identity, notarization and GitHub checks. The Mac initially had less than 200 MiB free. Inspected about 9.4 GiB of regenerable development caches and old release outputs, then removed exactly the four locations approved by the user. The free-space signing gate now passes. App launch and signed packaging remain unverified.
- 2026-10-24: Both first-candidate architectures passed local signing/notarization and full DMG/ZIP signature verification. Installed the signed app while preserving the previous installed copy. Verified current-account import, unchanged live auth and mode 0600 encrypted vault; user completed second-account enrollment. Existing Codex processes remain untouched.
- 2026-10-24: Added requested one-time-code copying with a specific main-process operation and accessible copied feedback. Added explicit terminal-key copying and existing-vault unlocking to keep CLI and desktop workflows interoperable. Fixed Windows SSH include path handling and added native CI transport/configuration checks. These changes await the next signed build and real UI checks.
