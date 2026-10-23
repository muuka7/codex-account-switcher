# Public readiness: 0.2.2 candidate

Status on 23 October 2026: source findings addressed; both native packaging smoke
checks passed. The first signed distribution remains a separate verification
gate. Visibility and GitHub protections are managed separately from publishing
installers; no signed candidate release has been published.

## Fixed in the candidate

- Live and saved credentials must match both account/workspace and email before
  a vault snapshot is replaced. Checks bracket an active usage request, and
  switching/re-authentication use the same identity rule. Missing identity fails
  closed. A single-instance lock protects desktop writes and probe cleanup.
- Electron is pinned to 44.9.3; vulnerable transitive packages were refreshed.
  Both the complete desktop tree and minimal server manifest audit clean.
- CI runs syntax checks, behavioral tests and dependency audits. Native macOS
  and Windows packaging smoke jobs validate installer output without publishing.
- macOS produces Intel and Apple Silicon DMGs and ZIPs. Build hooks bundle the
  correct Codex runtime for each target; downloads match committed lockfile
  integrity, and the upstream Apache license is included. Release validation
  requires the bundled runtimes, both ZIPs and correct metadata hashes.
- macOS releases build locally with Keychain credentials. GitHub builds Windows
  and independently checks the uploaded macOS signatures and notarization.
  Publication is automatic after source/hash receipts and downloaded checksums
  pass. Draft Release assets avoid Actions installer artifact storage; Apple
  signing keys and notarization credentials stay off GitHub.
- Update checks never download automatically. Download and installation each
  require explicit action, and normal quitting does not install an update.
- Current docs use illustrative host aliases and paths; packaged docs are
  allowlisted. Signing keys, vault files and local connection metadata are
  ignored by Git. Existing release signing status is clearly labeled.
- Workflow action versions are pinned to upstream commit SHAs. Dependabot
  continues to maintain dependencies and action references.

## Evidence

Local validation uses Node.js 24: all 50 behavioral tests pass, syntax and shell
checks pass, actionlint passes, and both npm audits report zero vulnerabilities.
The seven release-pipeline tests cover modified assets, source/team/run binding,
published-release protection and signing/notarization failure handling. They do
not substitute for the pending signed distribution run.
A repeated Gitleaks scan of 53 reachable commits found no secret matches. The earlier exposure
review found no secret matches in the then-current 50 commits or retained logs
from 132 Actions runs; those findings are scoped to that snapshot.

GitHub [CI run 39854567595](https://github.com/muuka7/codex-account-switcher/actions/runs/39854567595)
passed clean-install validation and both native macOS/Windows packaging jobs
for implementation commit `50e628a`. macOS verification covered both Intel and
Apple Silicon ZIP/DMG outputs, update metadata integrity and the bundled target
runtimes. Windows verification covered the installer and bundled runtime.
A later documentation/release-allowlist change does not alter those binaries.

The local macOS attempt was blocked by insufficient disk space (ENOSPC);
GitHub's native build supplied the missing packaging evidence. These ad-hoc
smoke builds are not Developer ID signed or notarized and were not published.
A signed distribution/update test still requires local notarization credentials
and sufficient build space on the signing Mac.

## At the visibility change

1. Confirm the exact candidate commit has green Validate and both native
   Package smoke jobs. Re-run CodeQL once the repository is public.
2. Review history, tags, release assets and Actions logs. Generalizing current
   documents does not rewrite older commits: the earlier server notes retain
   non-secret original aliases, usernames and paths in history. Decide whether
   that ordinary deployment metadata is acceptable before publication; no
   history rewrite or force-push is performed by this preparation.
3. Change visibility only after the maintainer has made that decision.
4. Run `bash scripts/configure-public-repo.sh` with an administrator login.
   It refuses private repos and never changes visibility. It enables private
   vulnerability reporting, secret scanning/push protection, security updates,
   and main protection requiring PRs, current checks and resolved conversations.
   The owner selected zero required approvals to permit merging checked PRs
   independently. Required PRs, passing checks and administrator enforcement
   remain enabled. The existing write collaborator retains legitimate access.
   Set `REQUIRED_APPROVALS=1` to require another reviewer when desired.
5. Verify these settings and the first public CodeQL/PR checks in GitHub.
   Public-only settings must be applied and read back after changing visibility.

## Before distributing the next macOS release

Run the local setup and preflight in RELEASING.md. A valid Developer ID identity
for team `XV69GQQN2L` is available on the maintainer's Mac. The configured
`codex-account-switcher-notary` profile has been enrolled and verified. Build
space remains below the 8 GiB preflight minimum; the owner has deferred builds.
No Apple GitHub Secrets are required.
Use `npm run release:mac` only from the matching clean, pushed source. Verify
Developer ID signatures, notarization/stapling, downloaded asset
checksums, and a real update from a previously signed build. Existing v0.2.1 and
older installers are unsigned and cannot establish that update trust chain.
Windows remains explicitly unsigned with manual updates.

A clean dependency audit and secret scan are useful evidence, not a guarantee
that all unknown vulnerabilities or private information have been eliminated.
