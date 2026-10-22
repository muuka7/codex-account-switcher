#!/usr/bin/env bash
# Run only after the maintainer changes visibility. This script cannot do so.
set -euo pipefail
repo=${1:-muuka7/codex-account-switcher}
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo 'Expected owner/repository.' >&2; exit 1; }
test "$(gh api "repos/$repo" --jq .visibility)" = public || {
  echo 'Repository is private. Change visibility separately before applying public-only protections.' >&2
  exit 1
}

gh api --method PUT "repos/$repo/private-vulnerability-reporting"
gh api --method PUT "repos/$repo/automated-security-fixes"
gh api --method PATCH "repos/$repo" --input - <<'JSON'
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
JSON
gh api --method PUT "repos/$repo/branches/main/protection" --input - <<'JSON'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Validate", "Package smoke (macos-latest)", "Package smoke (windows-latest)", "Analyze JavaScript", "Review dependency changes"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {"dismiss_stale_reviews": true, "required_approving_review_count": 0},
  "required_conversation_resolution": true,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
echo 'Public protections applied. Verify the first CI and CodeQL runs before merging.'
