#!/usr/bin/env bash
# Run after an explicitly authorized visibility change. This script never changes visibility.
set -euo pipefail
repo=${1:-muuka7/codex-account-switcher}
approvals=${REQUIRED_APPROVALS:-0}
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo 'Expected owner/repository.' >&2; exit 1; }
[[ "$approvals" =~ ^[0-6]$ ]] || { echo 'REQUIRED_APPROVALS must be between 0 and 6.' >&2; exit 1; }
test "$(gh api "repos/$repo" --jq .visibility)" = public || {
  echo 'Repository is private. Change visibility separately before applying public-only protections.' >&2
  exit 1
}

# Protect source and external workflow execution before enabling the remaining features.
gh api --silent --method PUT "repos/$repo/branches/main/protection" --input - <<JSON
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      {"context": "Validate", "app_id": 15368},
      {"context": "Package smoke (macos-latest)", "app_id": 15368},
      {"context": "Package smoke (windows-latest)", "app_id": 15368},
      {"context": "Analyze JavaScript", "app_id": 15368},
      {"context": "Review dependency changes", "app_id": 15368}
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {"dismiss_stale_reviews": true, "required_approving_review_count": $approvals},
  "required_conversation_resolution": true,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
gh api --silent --method PUT "repos/$repo/actions/permissions/fork-pr-contributor-approval" --input - <<'JSON'
{"approval_policy":"all_external_contributors"}
JSON
gh api --silent --method PUT "repos/$repo/actions/permissions" --input - <<'JSON'
{"enabled":true,"allowed_actions":"selected","sha_pinning_required":true}
JSON
gh api --silent --method PUT "repos/$repo/actions/permissions/selected-actions" --input - <<'JSON'
{"github_owned_allowed":true,"verified_allowed":false,"patterns_allowed":[]}
JSON
gh api --silent --method PUT "repos/$repo/actions/permissions/workflow" --input - <<'JSON'
{"default_workflow_permissions":"read","can_approve_pull_request_reviews":false}
JSON

# Alerting/dependency graph must be enabled before automatic security fixes.
gh api --silent --method PUT "repos/$repo/vulnerability-alerts"
gh api --silent --method PUT "repos/$repo/automated-security-fixes"
gh api --silent --method PUT "repos/$repo/private-vulnerability-reporting"
gh api --silent --method PATCH "repos/$repo" --input - <<'JSON'
{"security_and_analysis":{"secret_scanning":{"status":"enabled"},"secret_scanning_push_protection":{"status":"enabled"}}}
JSON
gh api --silent --method PUT "repos/$repo/immutable-releases"

# Published releases protect their tags already; also prevent changing draft version tags.
ruleset_id=$(gh api "repos/$repo/rulesets" --jq '.[] | select(.name == "Protect release tags" and .source_type == "Repository") | .id')
ruleset_method=POST
ruleset_path="repos/$repo/rulesets"
if [[ -n "$ruleset_id" ]]; then
  [[ "$ruleset_id" =~ ^[0-9]+$ ]] || { echo 'Multiple release tag rulesets found; resolve before updating.' >&2; exit 1; }
  ruleset_method=PUT
  ruleset_path="$ruleset_path/$ruleset_id"
fi
gh api --silent --method "$ruleset_method" "$ruleset_path" --input - <<'JSON'
{
  "name":"Protect release tags",
  "target":"tag",
  "enforcement":"active",
  "bypass_actors":[],
  "conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},
  "rules":[{"type":"update"},{"type":"deletion"}]
}
JSON

# Verify writes rather than assuming that a successful request applied every field.
test "$(gh api "repos/$repo/branches/main/protection" --jq ".enforce_admins.enabled and .required_status_checks.strict and (.required_status_checks.checks | length == 5) and ([.required_status_checks.checks[].app_id] | all(. == 15368)) and (.required_pull_request_reviews.required_approving_review_count == $approvals) and .required_pull_request_reviews.dismiss_stale_reviews and .required_conversation_resolution.enabled and (.allow_force_pushes.enabled == false) and (.allow_deletions.enabled == false)")" = true
test "$(gh api "repos/$repo/actions/permissions" --jq '.enabled and (.allowed_actions == "selected") and .sha_pinning_required')" = true
test "$(gh api "repos/$repo/actions/permissions/selected-actions" --jq '.github_owned_allowed and (.verified_allowed == false) and (.patterns_allowed | length == 0)')" = true
test "$(gh api "repos/$repo/actions/permissions/fork-pr-contributor-approval" --jq '.approval_policy == "all_external_contributors"')" = true
test "$(gh api "repos/$repo/actions/permissions/workflow" --jq '(.default_workflow_permissions == "read") and (.can_approve_pull_request_reviews == false)')" = true
gh api --silent "repos/$repo/vulnerability-alerts"
test "$(gh api "repos/$repo/automated-security-fixes" --jq .enabled)" = true
test "$(gh api "repos/$repo/private-vulnerability-reporting" --jq .enabled)" = true
test "$(gh api "repos/$repo" --jq '(.security_and_analysis.secret_scanning.status == "enabled") and (.security_and_analysis.secret_scanning_push_protection.status == "enabled")')" = true
test "$(gh api "repos/$repo/immutable-releases" --jq .enabled)" = true
test "$(gh api "repos/$repo/rulesets" --jq '[.[] | select(.name == "Protect release tags" and .enforcement == "active" and .target == "tag")] | length == 1')" = true
echo 'Public protections applied and verified. Verify the first public security scans and PR checks.'
