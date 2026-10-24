# Remote desktop integration and verification

Objective: install and exercise the repository's Linux helper on the selected SSH server, expose its accounts, quotas and reset windows in the desktop app, enroll a second account with the user's browser participation, test a supervised account switch, review safety, and produce locally signed macOS builds with GitHub CI evidence.

## Completed changes

Status: verified on 24 October 2026. Version 0.3.0 is a development candidate;
this work did not publish a release or merge the integration branch.

| Area | Result |
| --- | --- |
| Server selection | **Accounts on** switches between this computer and SSH servers; **Servers…** discovers aliases/includes and supports saved manual hosts without editing SSH config |
| Installation | Desktop and CLI install the same source-only Linux helper as the SSH user, with pinned dependencies and atomic release selection |
| Account management | Save the current login, enroll another through official device login, re-authenticate, refresh saved usage, switch explicitly and recover interrupted transactions |
| Usage | Live daemon readings stay separate from saved accounts when workspace identity is unavailable; all reported quota pools, durations, observation times and reset windows are retained |
| Clipboard and vault access | **Copy code** copies only an active sign-in code; separate **Terminal access…** and **Unlock vault…** controls support the shared CLI/desktop vault |
| Packaging | Packaged helper allowlisting, native SSH tests on Windows/macOS, and a local signed/notarized preview command cover the new distribution paths |

The terminal CLI uses the installed helper directly or
`npm run server -- --host dev-server <command>` from this checkout. See [Linux and SSH accounts](LINUX-SERVER.md)
for commands, prerequisites, passphrase handling and recovery. Earlier prebuilt
research is historical context; this implementation extends the existing repo.

## Architecture

- Discovery reads local SSH config and saved server metadata without network access. Selecting a host performs an explicit OpenSSH connection with host-key verification and batch authentication. The renderer has no network access.
- A versioned JSON-lines protocol runs over SSH stdio. The helper accepts a fixed method set; credential contents, tokens and raw Codex/server errors are never response fields. Allowlisted metadata includes account identity and server storage paths. The desktop main process owns SSH children and applies byte, time and concurrency limits.
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
| Account switching | Supervised A→B→A, runtime identity and usage verified after reconnect | Verified A→B→A through the installed signed app; independent server Codex runtime confirmed each identity, percentage and reset window; original restored |
| Safety/code review | Regression tests plus a separate source-review pass and fixes | 71 local tests and 25 selected tests on the actual Linux server passed; both npm audits clean; recovery, alias-key races, copying, stopped daemons and terminal interoperability covered |
| Signed macOS app | Developer ID, hardened runtime, notarization and runtime launch checks | Commit 21bbb949e58c passed both architectures, signatures, notarization, matching DMG/ZIP and packaged-runtime verification; signed app installed and exercised, including real clipboard copy/cancel |
| Public source/CI | Pushed reviewed branch/PR and exact-commit check results | PR #25; commit 21bbb949e58c passed validation, CodeQL, dependency review and macOS/Windows packaging jobs. CodeRabbit skipped the draft; this is not an independent bot review |

### Verification provenance and limits

- Runtime/build source: `21bbb949e58cfa82b93e1fd2d102fcf578af51b2`.
- Documentation verification record: `3318ed0fef1e3acdb9bfb3766222b1305cc1e76c`;
  validation, CodeQL, dependency review and both native packaging jobs passed
  for that commit too. Later documentation edits do not change the installed runtime.
- Source and review: [PR #25](https://github.com/muuka7/codex-account-switcher/pull/25).
- The 25 Linux tests are a selected server/process/socket/quota/SSH suite, not
  an additional full desktop suite. Windows packaging and transport were checked
  in CI; an interactive Windows account-switch test was not performed.
- Real account switching was exercised through the signed Mac desktop and
  independently checked with the Linux Codex runtime. Vault-key copying and
  existing-passphrase unlocking were covered with synthetic tests; the real
  terminal-access dialog was inspected without exporting its key.
- The round trip restored the original account, left no pending recovery or
  probe directories, and released the operation lock. Disposable login
  cancellation retained both saved accounts and an unchanged live-auth hash.
- The native arm64 candidate was installed and launched; both server cards and
  reset windows were visible after reconnecting the switcher. Previous installed
  copies were retained for rollback. Signing a preview does not publish it or
  prove a distributed auto-update upgrade was tested.

## Safety review changes

Source review and regression tests addressed these failure modes:

- Preserve rotated credentials even when a subsequent usage request fails;
  retain private recovery copies if encryption, identity checks or owned-process
  shutdown cannot complete. Startup no longer sweeps possible recovery homes.
- Stop helper-owned native process groups before deleting staging data, and
  bound SSH child shutdown and protocol input/output sizes.
- Serialize protected-key creation by server installation ID, so aliases for
  the same installation cannot replace each other's key. Verify an existing
  vault passphrase before protecting it locally.
- Restrict main-process IPC callers, protocol methods, public metadata and
  packaged helper files. Keys travel through SSH stdin; token-bearing responses
  and raw server errors do not reach the renderer.
- Finish the live WebSocket close handshake before returning, handle a stopped
  daemon without launching a replacement, and respect native Unix socket path
  limits. Fix Windows SSH include path traversal and exercise it in native CI.

This is a targeted implementation review and behavioral verification, not an
independent security audit. The earlier [prebuilt-tool safety review](REMOTE-SERVER-SAFETY-REVIEW.md)
has a different scope and should not be read as a review of this implementation.

## Limits to preserve

No passphrases or account tokens in chat, CLI arguments, environment variables or logs. Stored keys and tokens never appear in renderer state; an explicitly entered vault passphrase is cleared from its input immediately upon submission. Clipboard access is write-only and requires the specific user action for either a one-time code or a full vault key. No public App Server listener, disabled SSH host-key checks, root installation, model warmup, credit redemption or automatic cross-account turn submission. Native processes can bypass the helper's lock; process checks are not a global launch gate. Busy-host switching stays blocked until the user arranges a maintenance window.

## Work log

Entries below are chronological observations; setup blockers and pending checks
in earlier entries were resolved by the later entries and evidence above.

- 2026-10-24: Revalidated the clean public repository and current server. The helper is not installed; the current login exists and several Codex runtimes are active. Local signing/notarization tooling is already in the repository. Created a dedicated integration branch.
- 2026-10-24: Installed the source-only helper as the ordinary SSH user. Read current daemon usage through the same bounded SSH transport the desktop uses. Confirmed all quota durations and reset timestamps survive response filtering. File credential storage is not explicitly enabled, so switching remains gated.
- 2026-10-24: Implemented the desktop context selector, discovered/manual server management, installation, live and saved account panels, browser device login, reauthentication, recovery and supervised switch controls. The renderer receives sanitized metadata; the main process owns SSH and protected keys.
- 2026-10-24: Reviewed credential recovery, process shutdown, request validation, archive allowlisting and protected-key creation. Fixed token loss after failed desktop probes, startup deletion of potential recovery homes, native descendants outliving helper wrappers, unbounded SSH child cleanup and concurrent aliases replacing the same installation key. Added regression coverage.
- 2026-10-24: Signing preflight passed identity, notarization and GitHub checks. The Mac initially had less than 200 MiB free. Inspected about 9.4 GiB of regenerable development caches and old release outputs, then removed exactly the four locations approved by the user. The free-space signing gate now passes. App launch and signed packaging remain unverified.
- 2026-10-24: Both first-candidate architectures passed local signing/notarization and full DMG/ZIP signature verification. Installed the signed app while preserving the previous installed copy. Verified current-account import, unchanged live auth and mode 0600 encrypted vault; user completed second-account enrollment. Existing Codex processes remain untouched.
- 2026-10-24: Added requested one-time-code copying with a specific main-process operation and accessible copied feedback. Added explicit terminal-key copying and existing-vault unlocking to keep CLI and desktop workflows interoperable. Fixed Windows SSH include path handling and added native CI transport/configuration checks. These changes await the next signed build and real UI checks.

- 2026-10-24: Updated the actual Linux helper to commit 21bbb949e58c and matched all 14 source-file hashes. All 25 selected Linux tests passed. Enabled explicit file credential storage during a verified quiet window, preserving the original config in a private timestamped backup. Reconnecting desktop runtimes were detected and correctly blocked account changes until the user disabled connections.
- 2026-10-24: Refreshed both saved accounts, switched A→B→A through the signed desktop, and independently launched the server’s native Codex runtime to confirm each selected account and all quota/reset windows. Second-account reset timestamps matched exactly; original-account resets differed by only 1–3 seconds between observations. No model request was submitted. Original account restored, no pending recovery or probe homes.
- 2026-10-24: Verified **Copy code** using a real disposable device-login flow: clicked the button, observed accessible copied feedback, pasted into an offline local field to confirm the exact displayed code, cleared it and cancelled without enrolling an account. Confirmed two saved accounts, unchanged live-auth hash, no probe homes and released lock. Inspected terminal-access guidance without exporting the actual vault key.
- 2026-10-24: The final runtime candidate at commit 21bbb949e58c passed complete local signing/notarization and DMG/ZIP/runtime/archive checks on x64 and arm64. The native Apple Silicon app is installed with previous copies retained for rollback. These verification notes are a later documentation-only change.
