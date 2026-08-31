# Usage monitoring and account handoff learnings

This note captures the findings from implementing multi-account Codex usage
visibility. Account cards show remaining five-hour and weekly capacity,
server-provided reset times, manual refresh, and a delayed confirmation read.
The guarded-handoff policy is implemented; continuation remains supervised.

## What Codex exposes

Codex App Server provides `account/rateLimits/read`. The response contains two
usage windows:

- `primary`: the short rolling window, currently observed as 300 minutes
  (five hours).
- `secondary`: the longer rolling window, currently observed as 10,080 minutes
  (one week).

Each window can provide `usedPercent`, `windowDurationMins`, and `resetsAt`.
`resetsAt` is an epoch timestamp and must be converted to the user's local
timezone for display. The response can also provide `rateLimitReachedType`.

The official protocol reference is the [Codex App Server documentation](https://learn.chatgpt.com/docs/app-server).

## Multiple-account checks

The saved accounts can be checked without switching the account used by the
running desktop app:

1. Read the selected account's normal live Codex home.
2. Decrypt an inactive account snapshot in the Electron main process using the
   existing OS-backed `safeStorage` vault.
3. Copy only that snapshot into a newly created temporary Codex home.
4. Set both `CODEX_HOME` and `CODEX_SQLITE_HOME` to that temporary home before
   starting a separate App Server process.
5. Query `account/rateLimits/read` and discard the temporary home afterward.

The inactive probe must never replace the live `%USERPROFILE%/.codex/auth.json`
or share the live SQLite state. If the App Server refreshes the temporary
credentials, the refreshed snapshot may be saved back only after checking that
its decoded account identity still matches the expected saved account. Tokens
must never be written to logs or returned to the renderer.

This approach only checks accounts that have already been saved and
authenticated locally. It cannot discover or query an arbitrary account without
its credentials.

## Refresh behavior

A single read should be treated as a point-in-time reading, not as a permanent
cache. In validation, a second fresh read after a 3-minute gap changed the
active account's five-hour percentage while its weekly percentage stayed the
same. The other account's five-hour reset timestamp also moved between reads.

The implemented usage panel:

- shows the query timestamp;
- refreshes on demand and once when the switcher opens;
- performs a second confirmation read three minutes after the first pass;
- shows the server-provided reset time, not a locally calculated estimate;
- distinguishes “unknown/stale” from “0% used”;
- uses `rateLimitReachedType` and request failures as separate status states.

## Guarded handoff policy

Guarded handoff is deliberately narrower than forceful automatic switching:

1. Poll while the switcher is running in the tray and require a recent
   confirmation read showing the five-hour limit is exhausted.
2. Consider only accounts explicitly enabled in the source account's exact
   continuity group.
3. Exclude stale, unconfirmed, weekly-exhausted, below-reserve, and cooling-down
   destinations; choose the remaining account with the most five-hour capacity.
4. Queue the handoff while Codex is running. The switcher does not close Codex;
   the user closes it after reaching a safe point.
5. Revalidate usage and policy, journal the transaction, preserve the source
   credential, activate the destination, and reopen Codex.
6. Verify the live identity. On failure, restore the source when possible and
   require attention.
7. Report that continuation is ready without submitting a new turn.

The sidecar App Server can list persisted threads, but its runtime view reports
desktop-owned threads as `notLoaded`; it cannot authoritatively prove that the
desktop process is idle. The policy therefore treats process exit as the safe
boundary. This is intentionally fail-closed.

Codex App Server supports `thread/resume`, but cross-account thread portability
and desktop navigation are not guaranteed by the protocol. The switcher relies
on Codex's normal restart restoration, shows a supervised continuation state,
and never starts a new turn. Guaranteed task restoration remains out of scope.

## Handoff journal and recovery

The local journal records only source and destination IDs, trigger, phase,
timestamps, completion cooldown, and sanitized errors. Transaction phases are
`queued`, `switching`, `verifying`, and `continuationReady`. If the switcher
restarts during a transaction, it compares the saved active account with the
journal and surfaces either a continuation-ready or recovery-required state;
it never guesses by switching again.

## Safety requirements

- Keep inactive credentials encrypted with the existing OS-backed vault.
- Keep all probe homes under a uniquely named temporary directory and remove
  them after the App Server exits.
- Do not print, persist, or expose access tokens, refresh tokens, or decoded
  credential contents.
- Verify account identity before storing any refreshed credential snapshot.
- Record only sanitized telemetry: account label, query time, percentages,
  window duration, reset time, and error category.
- Never use Codex's own Logout action as part of a background usage check.
- Preserve the current active snapshot before an actual handoff because refresh
  token rotation can otherwise be lost.
