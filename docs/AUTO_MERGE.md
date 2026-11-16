# Verified automatic merging

The repository enables GitHub's auto-merge capability. The **Verified automatic merge** workflow additionally processes ready pull requests using an explicit complete evidence policy. The complete source evidence policy remains explicit even when native repository rules change. Live required-review and strict required-check rules are active. The required-check catalogue includes all fourteen application, metadata and security checks, including the separately generated CodeQL finding check. They retain the previously approved maintenance App exception; this workflow neither disables rules nor changes their exceptions.

## Complete acceptance

The workflow runs after Portal checks, Security analysis or Pull request metadata completes, on manual dispatch and every fifteen minutes as a recovery sweep. It executes only trusted `main` code, with no PR checkout, package installation, cache restore or artifact execution. Evidence uses the repository's short-lived read-only Actions token. Promotion uses the existing approved App 5776881 (`luminovia-portal-maintenance`), minted only for this repository inside the protected `maintenance-signing` environment with its already configured `MAINTENANCE_APP_ID` and `MAINTENANCE_APP_PRIVATE_KEY`. No key is copied, printed or added to source. The App token is routed only to the exact main-ref update and two workflow-dispatch write endpoints; the pinned token action revokes it afterwards. No new App, permission grant, personal token, Supabase credential or server access is required.

Every candidate must satisfy all of these conditions:

- Open, ready, mergeable PR targeting this repository's current `main`; valid type/area/risk labels and no `merge:hold`. Native `blocked` review status is allowed only when every explicit evidence/review condition below passes, using the existing approved App exception for trusted authors.
- Build, Typecheck, Lint, Formatting, Code quality, Tests and coverage, full `verify`, actual isolated selfhost compatibility and PR metadata succeed.
- All three CodeQL analyses, Dependency review and the separately generated CodeQL finding check succeed. Scanner completion alone is insufficient. Actual analysis records must match the exact signed test-merge commit and report zero findings; a previous same-head finding check cannot approve a new base. Freshness follows the actual CodeQL language jobs, preserving valid targeted Dependency review retries that reuse completed scans.
- Current-head checks come from the expected Apps and the selected workflow's actual check suite. The newest run must pass and identify this PR's exact base/head. Pending, failed, cancelled, neutral or missing required checks block promotion. Additional checks and legacy commit statuses must also pass; only the explicitly inapplicable PR release job may be skipped.
- No outstanding change request. Repository writers and official Dependabot are trusted authors; outside authors need an explicit current-head approval from a writer. This policy does not grant anyone additional repository permissions.
- No other open PR head is contained in the candidate. Such PRs are handled independently first, so a combined branch cannot silently consume another draft or held PR.

## Preserve exactly what was tested

The normal PR merge endpoint conditions only the head SHA and can construct an untested merge if the base moves concurrently. The automation instead promotes GitHub's **exact, verified signed test-merge commit**, after checking its two parents against the observed base and head. A `PATCH` of `refs/heads/main` uses `force: false`. A divergent main update is rejected by GitHub's server-side fast-forward check. There is no force-update fallback, rebase or newly constructed merge tree.

The gate rereads all evidence before applying, then reads the PR back. Main and a PR head are separate Git refs: this is not an atomic comparison of both refs. If an author pushes during promotion, only the previously tested commit is promoted; the newer work remains pending. GitHub may update the PR's merged state asynchronously, so a successful ref write is reported separately from an observed merged PR.

This preserves the existing daily maintenance path without activating unrelated rules. The App uses its existing native exception; all explicit test, security and review guards in this script still apply. If a server rule or missing App permission rejects the ref update, the job fails closed. In particular, GitHub may require additional workflow-file permission for commits changing `.github/workflows`; this task does not broaden the approved App. Such PRs retain the ordinary authorised maintainer merge path after the same checks.

GitHub documents [non-forced reference updates](https://docs.github.com/en/rest/git/refs#update-a-reference), [indirect PR merges](https://docs.github.com/en/pull-requests/reference/pull-request-merges), and [workflow-run security](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).

## Main verification and recovery

The approved App can trigger ordinary push workflows. Every sweep also reconciles the exact-main Portal checks and Security analysis runs and explicitly dispatches either missing run. This also supports recovery without assuming that a push event has already been processed. The Portal workflow's `expected_commit` check refuses a racing revision; existing full application/selfhost/release gates still control development-package publication. This script does not publish or deploy an application.

Every apply sweep independently reconciles current-main verification **before inspecting open PRs**. If promotion succeeded but its response was lost, or a dispatch failed after the PR closed, the next sweep can still schedule the missing workflow. Existing runs, including failed runs, are not silently retried or relabelled as successful. Fix the reported cause and use the ordinary documented retry process. Scheduled sweeps do not edit PR branches to resolve stale-base evidence or merge conflicts.

Inspect the Actions log for numeric PR identifiers and bounded reason codes. No PR title/body, credentials, private API response or customer data is printed. A draft or `merge:hold` pauses a candidate; a stale base requires an ordinary reviewed branch update and new acceptance.

## Local verification

```bash
node --test scripts/runtime-pr-auto-merge.test.mjs
```

For a read-only real inspection, use an existing authorised GitHub token in `GH_TOKEN`, set `GITHUB_REPOSITORY` to this repository, and run `node scripts/pr-auto-merge.mjs`. The CLI is read-only unless `--apply` is explicitly supplied. Never paste tokens into committed scripts, command text, screenshots or documentation.

The live isolated proof is [PR #14](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/14), targeting a temporary fixture branch. It proved verified-signature promotion, GitHub's eventual merged-state readback and rejection of a divergent target with HTTP 422. All four owned fixture branches were removed. It did not modify `main` or application data, and does not substitute for this implementation's own complete PR acceptance.
