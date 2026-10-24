# Remote desktop integration and verification

Objective: install and exercise the repository's Linux helper on the selected SSH server, expose its accounts, quotas and reset windows in the desktop app, enroll a second account with the user's browser participation, test a supervised account switch, review safety, and produce locally signed macOS builds with GitHub CI evidence.

## Architecture

- Discovery reads local SSH config and saved server metadata without network access. Selecting a host performs an explicit OpenSSH connection with host-key verification and batch authentication. The renderer has no network access.
- A versioned JSON-lines protocol runs over SSH stdio. The helper accepts a fixed method set; credentials, tokens, paths and raw Codex/server errors are never response fields. The desktop main process owns SSH children and applies byte, time and concurrency limits.
- The server retains saved ChatGPT credentials in its encrypted vault. The desktop generates a per-installation vault key and protects it with Electron safeStorage; it sends that key only through SSH stdin. The renderer receives no vault key. Re-enrollment is required if that protected key is lost.
- Live daemon usage remains distinct from saved-file selection when the protocol cannot prove a workspace identity. Every displayed reading retains its observation time, window duration, reset time and source. Inactive-account refreshes may rotate tokens and require stopped clients in this version.
- Device login uses official Codex App Server in a private staging home. Only the official verification URL, one-time code and completion state reach the UI. Enrollment does not switch the active server login.
- Switching is an explicit maintenance operation: stop affected runtimes, preserve the source, validate the target, journal and replace atomically, then restart/reconnect and verify the owning runtime. There is no arbitrary-process termination or automatic continuation.
- Packaged apps carry a source-only helper archive with pinned server dependencies and a public protocol version. Installation runs as the SSH user without sudo, daemon restarts or changes to the live login.

## Required evidence

| Requirement | Evidence needed | Current state |
| --- | --- | --- |
| Server discovery/addition and selection in desktop | Real app interaction and saved-host reload | Implemented; real UI verification pending |
| Install helper on chosen Linux user | Installed manifest, version/doctor and permissions | Source archive installed successfully; protocol/manifest and live usage read over actual SSH |
| Import current server account | Encrypted vault, unchanged live auth, visible account card | Pending |
| Quota/reset display accurate | Timestamped app view compared with independent server CLI read | Pending |
| Second-account enrollment | User-completed browser login, second encrypted account, original login unchanged | User interaction needed after UI is ready |
| Account switching | Supervised A→B→A, runtime identity and usage verified after reconnect | Pending; needs a quiet server window |
| Safety/code review | Regression tests plus a separate source-review pass and fixes | 63 full-suite tests plus 3 new SSH regressions passed; both npm audits clean; recovery and alias-key races fixed; final pass pending |
| Signed macOS app | Developer ID, hardened runtime, notarization and runtime launch checks | Signing and notarization credentials verified; blocked by local free space |
| Public source/CI | Pushed reviewed branch/PR and exact-commit check results | Pending |

## Limits to preserve

No passphrases or account tokens in chat, CLI arguments, environment variables, logs or renderer state. No public App Server listener, disabled SSH host-key checks, root installation, model warmup, credit redemption or automatic cross-account turn submission. Native processes can bypass the helper's lock; process checks are not a global launch gate. Busy-host switching stays blocked until the user arranges a maintenance window.

## Work log

- 2026-10-24: Revalidated the clean public repository and current server. The helper is not installed; the current login exists and several Codex runtimes are active. Local signing/notarization tooling is already in the repository. Created a dedicated integration branch.
- 2026-10-24: Installed the source-only helper as the ordinary SSH user. Read current daemon usage through the same bounded SSH transport the desktop uses. Confirmed all quota durations and reset timestamps survive response filtering. File credential storage is not explicitly enabled, so switching remains gated.
- 2026-10-24: Implemented the desktop context selector, discovered/manual server management, installation, live and saved account panels, browser device login, reauthentication, recovery and supervised switch controls. The renderer receives sanitized metadata; the main process owns SSH and protected keys.
- 2026-10-24: Reviewed credential recovery, process shutdown, request validation, archive allowlisting and protected-key creation. Fixed token loss after failed desktop probes, startup deletion of potential recovery homes, native descendants outliving helper wrappers, unbounded SSH child cleanup and concurrent aliases replacing the same installation key. Added regression coverage.
- 2026-10-24: Signing preflight passed identity, notarization and GitHub checks. The Mac initially had less than 200 MiB free. Inspected about 9.4 GiB of regenerable development caches and old release outputs, then removed exactly the four locations approved by the user. The free-space signing gate now passes. App launch and signed packaging remain unverified.
