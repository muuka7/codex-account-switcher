# Codex accounts on skillBased-muuka

Research date: 21 October 2026. Status: proposal; no server configuration or login changes deployed.

**Safety review update:** Do not trial a switcher directly against the live shared Codex home yet. A targeted source review favors an isolated, usage-only evaluation of ccswap first; disabling xjoker/codex-switch's daemon restart alone is insufficient. See [the safety findings and revised rollout](REMOTE-SERVER-SAFETY-REVIEW.md). The original shortlist below is retained as research context.

## Recommendation

Evaluate a prebuilt tool first. The initial recommendation below focused too early on custom development; existing tools already cover account storage, switching and usage dashboards. The user uses both desktop SSH projects and terminal CLI sessions.

### Prebuilt shortlist — follow-up research

| Tool | Existing capabilities | Relevant limitation |
| --- | --- | --- |
| [xjoker/codex-switch](https://github.com/xjoker/codex-switch) | Linux release binaries, terminal dashboard, quota buckets, device login, JSON output and Codex daemon restart handling | Switching restarts a running Codex daemon by default; configure `[use] restart_app_server = false` during initial evaluation. Maintainer baseline is Codex 0.159.2; newer versions are accepted but not fully verified. |
| [errhythm/ccswap](https://github.com/errhythm/ccswap) | Installable Python package, Linux terminal dashboard, saved Codex accounts, usage/reset/credit views and manual switching | Writes the selected login and asks for a Codex restart; it does not terminate Codex processes. Linux account storage is file-based. |
| [Loongphy/codex-auth](https://github.com/Loongphy/codex-auth) | npm package, device login, account switching, remaining percentages, reset times, live terminal view and JSON output | Standard Codex clients need restarting; seamless switching uses a separate Codex fork/experimental app integration. Usage refresh directly accesses ChatGPT backend endpoints. |

The closest initial feature match was **xjoker/codex-switch**. After source review, **ccswap** is the preferred candidate for an isolated monitoring evaluation because it avoids refreshing the active account's token. Neither is cleared for unattended switching on the live shared home. The xjoker stable release inspected was [v20261001.5.0](https://github.com/xjoker/codex-switch/releases/tag/v20261001.5.0), which includes Linux amd64 binaries matching the server architecture.

No candidate has been installed or tested against this server. First validate usage visibility, credential refresh persistence and the desktop SSH reconnect behavior on Codex 0.162.0. A daemon restart is not proof that every separately launched stdio App Server or CLI session has reloaded credentials.

Useful documented commands after installation:

```text
codex-switch tui
codex-switch list -f
codex-switch doctor

ccswap codex list
ccswap codex usage
ccswap tui

codex-auth list --live
codex-auth login --device-auth
```

Only add custom code if a trial demonstrates a specific unmet requirement, such as controlling server accounts inside the existing Electron UI. The architecture and delivery sequence below are retained as a fallback design, not the recommended starting project.

### Custom fallback

A small Linux account manager could be usable from both a terminal command and this Electron switcher over SSH. One server-owned account store and switch lock would serve both interfaces.

Start with usage visibility, then add explicit account switching. Keep the existing `/home/muuka/.codex` runtime home for the initial version so existing history and configuration remain in place. A switch applies to that shared runtime home; it cannot independently change just one chat.

## What was verified

Read-only SSH inspection found:

- Linux x86_64, signed in as `muuka`.
- Codex CLI `0.162.0`, installed under Node `v22.21.1` through NVM.
- `/home/muuka/.codex/auth.json` exists, uses ChatGPT authentication, and has mode `0600`.
- Three running Codex App Server processes explicitly use `CODEX_HOME=/home/muuka/.codex`; one listens on the default Unix socket.
- The usual Linux switcher locations inspected do not exist. This was not an exhaustive search for account backups or custom tools.
- Node, Python, systemctl and tmux are available. A persistent user service was not tested.

The local project already implements isolated usage probes and an encrypted account vault. Its runtime is pinned to Codex `0.136.0`, and its supported runtime targets and application lifecycle functions cover macOS/Windows. It has no SSH backend. Its current rate-limit normalization selects one bucket and recognizes exactly 300-minute and 10,080-minute windows, which is too narrow for a general server account view.

A bounded `account/rateLimits/read` probe through the existing remote control socket timed out after 25 seconds. No live percentages were verified. The timeout does not establish whether the cause is proxy transport, client handshake, or server behavior. It is an implementation investigation item.

No login was switched, no daemon was restarted, no credentials were copied off the server, and no model turn was submitted. The probe only requested initialization and usage data; normal Codex authentication may refresh credentials internally.

## Supported building blocks

Codex documents `account/read` for identity and `account/rateLimits/read` for quota snapshots. Prefer `rateLimitsByLimitId` when present, preserve all buckets, and fall back to `rateLimits`. Windows report `usedPercent`, duration and reset time. Display remaining capacity as `max(0, min(100, 100 - usedPercent))`; missing values remain unknown. See [App Server](https://learn.chatgpt.com/docs/app-server).

Codex supports file-backed credentials under `CODEX_HOME`, and device-code login for headless machines. The initial setup should use a separate staging home for each additional login so enrolling an account does not replace the current login. See [authentication](https://learn.chatgpt.com/docs/auth).

`CODEX_HOME` also holds configuration, history and other state. Separate homes therefore require explicit decisions about history, settings and skills. See [advanced configuration](https://learn.chatgpt.com/docs/config-file/config-advanced).

Desktop SSH workflows start the remote App Server using the remote user's login shell. Server credentials matter independently of the Mac login. SSH remains the transport for the proposed manager; no public App Server listener is needed. See [remote connections](https://learn.chatgpt.com/docs/remote-connections).

For manual checks today, `/status` in an active CLI session shows remaining limits. This does not provide an aggregate view of saved accounts. See [usage guidance](https://learn.chatgpt.com/docs/pricing).

## Options

| Approach | Usage across accounts | Desktop SSH and CLI fit | Effort / tradeoff |
| --- | --- | --- | --- |
| Separate `CODEX_HOME` directories with shell wrappers | Needs a small collector; `/status` checks the selected session | Straightforward for CLI; desktop launch mapping needs validation | Smallest starting point; separate history/config; supports concurrent accounts if each runtime stays isolated |
| Server manager with CLI, then SSH support in this Electron app | One collector and consistent account cards | Best fit for switching the current shared server login from either interface | Recommended; moderate work including server lifecycle and credential ownership |
| Private browser dashboard backed by the same manager | Convenient cards and refresh | Works independently of the Electron app | More work for authentication, browser security and service operation; use SSH tunneling or private networking |
| Separate Linux users, each with their own Codex login | Central view requires access scoped to each user | Separate SSH aliases fit desktop connections; CLI uses the chosen user | Stronger separation and concurrent accounts; shared repository permissions, tool installs and chat access need planning |

These are architectural alternatives, not endorsements of an audited third-party package. The existing Electron project provides useful code to extend, but cannot currently be installed headlessly on this server as a working Linux switcher.

API-key billing is a separate option if subscription switching is no longer the goal. It changes billing and entitlement behavior and does not solve the requested multi-account subscription view.

## Proposed first version

### One server helper, two interfaces

Proposed commands, not yet installed:

```text
codex-accounts list
codex-accounts usage --refresh
codex-accounts add work
codex-accounts switch work
codex-accounts doctor
```

The helper exposes a versioned JSON protocol over SSH stdio. The Electron main process invokes it through the existing SSH alias and returns sanitized data to the renderer. SSH host-key checking remains enabled. The terminal CLI uses the same backend and locks.

The UI adds a host selector such as `This Mac` / `skillBased-muuka`. Server cards show account label, identity/workspace, plan when available, all usage buckets and windows, reset times, last successful check, stale/error status, and the selected server account. A running process whose identity has not been rechecked must not be presented as verified on the newly selected account.

### Credential ownership

Keep canonical server sessions on the server. Enroll additional accounts through official device login in a staging home, then verify identity before saving. Use one serialized credential owner per account to avoid independent probes overwriting rotated refresh tokens.

Use a passphrase-encrypted vault unlocked for the management session, with restrictive directory/file permissions. While locked, show cached usage and require unlocking to refresh or switch. Fully unattended polling needs a separate decision about protected key delivery; a key stored beside the encrypted files would not provide the same protection as the current macOS vault. Headless Linux must not silently fall back to Electron's unprotected credential storage.

The live `auth.json` remains readable by Codex. Encryption of inactive snapshots cannot protect it from another process running as `muuka`.

### Usage collection

Read the active account through a compatible runtime connection. Probe inactive accounts sequentially in fresh, private temporary homes with isolated SQLite state and minimal configuration. Do not copy conversations or plugins into probe homes. Preserve any refreshed credentials after matching account and workspace identity, and remove temporary homes when the process exits.

Use manual refresh initially. An unlocked helper can later poll at a proposed five-minute interval with backoff. This is a product default, not an OpenAI-prescribed rate. Return timestamps and sanitized errors. Do not infer remaining messages or tokens from percentages, or treat an elapsed reset timestamp as proof of replenishment. Fetch a fresh snapshot.

Display five-hour/weekly labels only when the reported durations match. Preserve other durations and model-specific buckets. Accounts associated with the same metered workspace may share capacity; do not add their percentages into a pooled balance.

### Shared-home switching

Switching must coordinate desktop-owned App Servers, the shared daemon, and CLI sessions using the same home. A manager lock only coordinates manager clients; it does not stop Codex itself from refreshing credentials or starting another process.

1. Obtain an exclusive switch lock and validate the destination credential.
2. Report affected sessions. Have the user finish work and disconnect/stop the clients using this home. Do not terminate arbitrary Codex processes.
3. Verify that the affected runtimes are stopped, account for automatic daemon/client restarts, and recheck before writing. If restart prevention cannot be established, block the switch and explain the affected client.
4. Preserve the source's latest credential and an encrypted rollback copy. Atomically activate the destination and record a journal entry.
5. Verify destination identity, reconnect the desktop host or relaunch the CLI, then verify the account seen by the resumed runtime. Restore the source or require recovery if verification fails.

Restart/reconnect behavior and cross-account chat restoration require testing. Keeping the same files does not guarantee that every old chat or account-bound connection works under the new identity. The first version should provide supervised continuation without submitting turns or approving actions.

If simultaneous accounts become a requirement, choose independent runtime homes or Linux users. Shared-home switching is intentionally a single selected account for the affected runtimes.

## Delivery sequence

1. **Compatibility spike:** resolve the `0.162.0` control-socket probe timeout and validate a minimal stdio probe. Verify identity and quota reads, refresh-token persistence, and cleanup without interrupting current work.
2. **Server CLI and account store:** enrollment, encryption, locking, usage cache and manual refresh. Validate with two separately authenticated accounts. Test expiry, unknown windows, multiple buckets, SSH failures and interrupted probes.
3. **Explicit switch:** test desktop and CLI together, including automatic restarts, rollback, interruption and reconnect. Block switching when runtime ownership is uncertain.
4. **Desktop SSH interface:** reuse account-card presentation with host-specific state. Test that switching the server leaves the Mac account unchanged.
5. **Optional later work:** polling while unlocked, low-capacity notifications, or a private browser view. Automatic cross-account continuation is outside the initial scope.

The recommended starting deliverable is the server CLI and reliable usage reads. That validates the difficult server behavior before investing in the desktop interface.
