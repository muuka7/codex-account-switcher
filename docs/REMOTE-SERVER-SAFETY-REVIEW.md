# Safety review of prebuilt Codex account managers

Reviewed: 21 October 2026. Scope: targeted source review, not a full security audit or deployment approval.

## Decision

Do not deploy `xjoker/codex-switch` against the live shared `/home/developer/.codex` with its default behavior. The previous suggestion to disable daemon restarting was incomplete: it prevents an interruption but does not synchronize the account held by running Codex processes or prevent competing credential writes.

Prefer an isolated, usage-only evaluation of `ccswap` first because its reviewed implementation avoids refreshing the active account's token. This is a narrow safety advantage, not a claim that the entire application is safer or audited. Switching under either tool should initially require all clients using the affected home to be stopped and automatic reconnection controlled.

No tool was installed or executed, no server configuration was changed, and no account was switched during this review.

## Source scope

- `xjoker/codex-switch`: stable tag `v20261001.5.0`, source reference `629d3b6c26036d1bd46898591a1a5e64544bc045`. Reviewed credential writing, profile transactions, usage/refresh requests, login, daemon restart handling, installer, updater, configuration, selected logging paths and refresh-persistence test source.
- `errhythm/ccswap`: commit `d6fc99cf2bc5eff9f8ad2e8eadd50bb84da845dd`, dated 18 October 2026. Limited comparison of `codex.py`, `codex_usage.py` and README behavior.
- `Loongphy/codex-auth`: prior documentation review only; no source-level safety rating is assigned here.

The release metadata was inspected, but downloaded binaries and their attestations were not independently verified. Dependencies were not exhaustively audited and upstream tests were not executed. Findings describe inspected paths and residual risks, not confirmed exploitation or a malware determination.

## Findings

### High operational risk: the shared login can change while existing runtimes remain active

`cmd_use` replaces the live auth after tool-owned locking, without requiring running Codex clients to exit. The command then attempts a managed-daemon restart. Disabling that restart leaves the existing daemon's account unchanged; enabling it interrupts attached work. Independently launched stdio App Servers are not covered by this daemon-restart path.

A shared home can be used by multiple App Servers. A mixed runtime/file identity is therefore an integration concern: different sessions may retain different logins, and an older process may later persist credentials. The tool's private lock coordinates its own clients; it does not establish that native Codex processes participate in the same transaction.

Restart failure is reported as a warning after the auth has changed. The explicit-alias JSON command can still return `ok: true`, so success does not prove every runtime adopted the new account. Same-account token changes can also change the auth hash used to decide whether restarting is needed.

Sources: [switch command](https://github.com/xjoker/codex-switch/blob/v20261001.5.0/src/commands/profile.rs#L36), [profile switch](https://github.com/xjoker/codex-switch/blob/v20261001.5.0/src/profile.rs#L1215), [restart logic](https://github.com/xjoker/codex-switch/blob/v20261001.5.0/src/app_server.rs#L78), [default and interruption note](https://github.com/xjoker/codex-switch/blob/v20261001.5.0/src/config.rs#L101).

### High credential exposure if the server user is compromised: inactive accounts are plaintext

Saved profiles are serialized JSON under `~/.codex-switch/profiles/<alias>/auth.json`. Unix writes use private directory/file permissions, `0700`/`0600`, and atomic replacement. These are good protections against other ordinary Linux users, but the snapshots are not encrypted. Processes running as the same OS user, including coding agents with sufficient filesystem access, can read all saved accounts. Root can also read them.

Auth backups contain credential bytes too. Removing a profile archives it into `deleted-profiles`, retaining recoverable credentials. Removal is not revocation. Backup and export practices must account for those copies. A stale backup also cannot undo refresh-token rotation at OpenAI.

This is a material change from this local project's OS-encrypted inactive snapshots. Separate homes under one Linux user do not provide a security boundary between accounts. Different Linux users provide a stronger boundary when needed.

Sources: [profile paths and archive deletion](https://github.com/xjoker/codex-switch/blob/v20261001.5.0/src/profile.rs#L19), [private atomic writer](https://github.com/xjoker/codex-switch/blob/v20261001.5.0/src/auth.rs#L185), [credential serialization and backups](https://github.com/xjoker/codex-switch/blob/v20261001.5.0/src/auth.rs#L745).

### Medium operational risk: viewing usage can rotate and write credentials

The `list` path can automatically save an untracked live account. Usage fetching can proactively rotate an expiring token and persist the replacement to the saved profile and, when applicable, live auth. A dashboard refresh should therefore not be described as read-only.

The implementation has meaningful defenses: identity checks, conditional token replacement, failure reporting, and recovery tests for competing tool requests. Nevertheless, its own lock does not serialize a request with every native Codex runtime or another host using a copied login. Concurrent native-client rotation remains an integration risk to test, not an observed failure in this review. Network/process failure after server-side rotation can also require signing in again.

Sources: [list auto-tracking](https://github.com/xjoker/codex-switch/blob/v20261001.5.0/src/commands/profile.rs#L73), [proactive usage refresh](https://github.com/xjoker/codex-switch/blob/v20261001.5.0/src/usage/api.rs#L1080), [token persistence](https://github.com/xjoker/codex-switch/blob/v20261001.5.0/src/profile.rs#L443), [upstream recovery tests](https://github.com/xjoker/codex-switch/blob/v20261001.5.0/tests/test_refresh_persistence.rs).

### Medium supply-chain risk: first-install provenance verification can be skipped

The installer checks the archive checksum. It verifies GitHub build provenance if supported `gh` tooling and a bundle are available, but can otherwise continue with a warning. `CS_REQUIRE_PROVENANCE=1` makes missing provenance support/bundle fatal. Checksum and archive from the same release do not independently establish trusted authorship.

The self-updater is stricter: it requires provenance verification and constrains source ref and digest. The first-install path constrains repository/workflow but does not pin those same source fields. Provenance establishes build origin; it does not establish that the source or dependencies are benign.

Use a reviewed, pinned release and installer with a pinned archive digest; require provenance and verify its source ref/digest before giving it credentials. Avoid executing a moving `latest` installer as the first step. A user-level install is sufficient; do not give the account manager root access.

Sources: [installer verification](https://github.com/xjoker/codex-switch/blob/v20261001.5.0/scripts/install.sh#L28), [download/checksum path](https://github.com/xjoker/codex-switch/blob/v20261001.5.0/scripts/install.sh#L330), [stricter updater](https://github.com/xjoker/codex-switch/blob/v20261001.5.0/src/update.rs#L499).

## Other behavior that affects a pilot

- Default usage and refresh destinations in the inspected code are OpenAI/ChatGPT endpoints. `CS_USAGE_URL` and `CS_TOKEN_URL` can override them; proxies and custom certificate roots also affect credential traffic. Treat these settings as trusted inputs. No unexpected third-party credential destination was identified in the reviewed defaults; this is not an exhaustive outbound-traffic audit. [Usage URL](https://github.com/xjoker/codex-switch/blob/v20261001.5.0/src/usage/api.rs#L303), [token URL](https://github.com/xjoker/codex-switch/blob/v20261001.5.0/src/auth.rs#L76).
- Usage calls use ChatGPT backend endpoints directly, introducing compatibility uncertainty beyond the documented App Server method. This review does not determine contractual acceptability.
- `warmup` submits a real model request containing `ping`; it is not a quota-only check and may consume capacity. Leave it unused in a monitoring pilot. Reset-card redemption is also an action, not a read. [Warmup request](https://github.com/xjoker/codex-switch/blob/v20261001.5.0/src/warmup.rs#L660).
- Login is implemented by the tool itself and a newly enrolled login is activated. Account enrollment is not necessarily passive. [Login activation](https://github.com/xjoker/codex-switch/blob/v20261001.5.0/src/commands/login.rs#L21).
- Switching may rewrite a selected non-OpenAI model provider to `openai`. Include configuration in rollback planning if custom providers are used. [Provider rewrite](https://github.com/xjoker/codex-switch/blob/v20261001.5.0/src/profile.rs#L380).
- Positive safeguards include alias validation, private atomic files, tool-level OS locks, policy checks, identity checks and sanitized token-refresh error handling. These reduce specific failure modes without solving runtime ownership.

## Alternative assessment

`ccswap` explicitly avoids refreshing the currently active Codex account. Before refreshing an inactive snapshot, it holds its own switch lock, rechecks the live identity, and refuses to consume the refresh token when the live auth holds that token. This is a better starting behavior for usage monitoring on a server where native Codex remains active.

Its switch path still writes the live auth under a tool-owned lock without stopping Codex. Its stored accounts are also file-based. A session using a previously active account can remain alive after a file switch, so even its inactive-account test is not proof that no process holds a token. Do not infer a general safety endorsement from the narrower refresh protection.

Sources: [active-refresh avoidance and token checks](https://github.com/errhythm/ccswap/blob/d6fc99cf2bc5eff9f8ad2e8eadd50bb84da845dd/src/claude_swap/codex.py#L724), [switch implementation](https://github.com/errhythm/ccswap/blob/d6fc99cf2bc5eff9f8ad2e8eadd50bb84da845dd/src/claude_swap/codex.py#L394).

## Proposed safe evaluation

1. Review and pin the exact distributed version before installation. The inspected ccswap source commit is not proof that a particular PyPI artifact contains identical code.
2. Begin under a separate Linux user with independent test logins and storage. For behavioral tests that do not require security separation, fresh temporary homes are adequate; merely copying the live server login into one can still share its refresh-token lineage.
3. Evaluate usage display first. Leave automatic account selection, background switching, warmup and reset redemption off. Confirm failure/stale states are clear.
4. Test token expiry, credential persistence, file permissions and restart/reconnect behavior with disposable sessions. Verify identities in the actual desktop-owned and CLI runtimes, not just in the selected auth file.
5. Only then consider the real accounts. Keep a manual switch procedure that stops every client using the home, controls automatic restarts, preserves current credentials, switches once, and verifies the identity after reconnecting.
6. Use one account manager as the credential owner. Do not let several switchers or copied login snapshots independently manage the same session tokens.

Prebuilt remains the preferred direction. The change is to validate it in isolation and choose based on credential behavior, rather than treating a successful install or a daemon restart as sufficient safety evidence.
