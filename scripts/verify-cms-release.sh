#!/usr/bin/env bash
# Check authenticated GitHub metadata, not artifacts from the triggering run.
# Exit 3 means the exact revision is not eligible for publication.
set -euo pipefail

[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]]
[[ "$GH_REPO" == Luminovia-Training-Consulting/Luminovia-Management-Tool ]]

require_current_main() {
  local current
  current="$(gh api "repos/$GH_REPO/branches/main" --jq '.commit.sha')" || return 1
  [[ "$current" =~ ^[0-9a-f]{40}$ ]] || return 1
  if [[ "$current" != "$TARGET_SHA" ]]; then
    printf '%s\n' 'The target is no longer current main.' >&2
    exit 3
  fi
}

require_current_main
# Branch rules own approval policy. Also require an exact merged PR, not just
# a green direct push to main.
pulls="$(gh api --paginate --slurp "repos/$GH_REPO/commits/$TARGET_SHA/pulls?per_page=100")" || exit 1
merged="$(jq -r --arg repo "$GH_REPO" --arg sha "$TARGET_SHA" '
  any(.[][]; .base.repo.full_name == $repo and .base.ref == "main"
    and .state == "closed" and (.merged_at | type) == "string" and .merge_commit_sha == $sha)
' <<< "$pulls")" || exit 1
if [[ "$merged" != true ]]; then
  printf '%s\n' 'No merged pull request matches the current main target.' >&2
  exit 3
fi

for workflow in ci.yml security.yml; do
  runs="$(gh api "repos/$GH_REPO/actions/workflows/$workflow/runs?branch=main&event=push&head_sha=$TARGET_SHA&per_page=100")" || exit 1
  state="$(jq -r --arg repo "$GH_REPO" --arg sha "$TARGET_SHA" --arg path ".github/workflows/$workflow" '
    [.workflow_runs[] | select(.head_sha == $sha and .head_branch == "main" and .event == "push"
      and .path == $path and .repository.full_name == $repo and .head_repository.full_name == $repo)]
    | sort_by(.created_at, .id) | last // {}
    | if .status == "completed" then (.conclusion // "missing") else (.status // "missing") end
  ' <<< "$runs")" || exit 1
  if [[ "$state" != success ]]; then
    printf '%s did not pass for %s (%s).\n' "$workflow" "$TARGET_SHA" "$state" >&2
    exit 3
  fi
done

require_current_main