# Public readiness: 0.2.2 candidate

Status on 22 October 2026: source findings addressed; native packaging and the
first signed distribution remain separate verification gates. The repository
has not been made public and no new release has been published.

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
- The release workflow requires actual signing/notarization, uploads a draft,
  downloads and checks the assets, and only then publishes. Temporary Actions
  copies are deleted after publication with one-day retention as a fallback.
- Update checks never download automatically. Download and installation each
  require explicit action, and normal quitting does not install an update.
- Current docs use illustrative host aliases and paths; packaged docs are
  allowlisted. Signing keys, vault files and local connection metadata are
  ignored by Git. Existing release signing status is clearly labeled.
- Workflow action versions are pinned to upstream commit SHAs. Dependabot
  continues to maintain dependencies and action references.

## Evidence

Local validation uses Node.js 24: all 43 behavioral tests pass, syntax and shell
checks pass, actionlint passes, and both npm audits report zero vulnerabilities.
Secret scans are repeated on the publication candidate. The earlier exposure
review found no secret matches in the then-current 50 commits or retained logs
from 132 Actions runs; those findings are scoped to that snapshot.

The local native macOS build could not complete because the developer volume
has insufficient free space (ENOSPC). Do not treat unit tests or artifact
fixtures as proof of a successful installer build. CI packaging jobs are the
next gate, followed by a signed release on properly provisioned runners.

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
   It permits a solo maintainer to merge a checked PR without a separate
   approving reviewer; increase that count when another maintainer is available.
5. Verify these settings and the first public CodeQL/PR checks in GitHub.
   Public-only settings cannot be verified in the current private Free repo.

## Before distributing the next macOS release

Configure the five Apple secrets listed in RELEASING.md. None were configured
when this candidate was prepared. Run the release workflow only for the matching
new tag. Verify Developer ID signatures, notarization/stapling, downloaded asset
checksums, and a real update from a previously signed build. Existing v0.2.1 and
older installers are unsigned and cannot establish that update trust chain.
Windows remains explicitly unsigned with manual updates.

A clean dependency audit and secret scan are useful evidence, not a guarantee
that all unknown vulnerabilities or private information have been eliminated.
