# GitHub administration and contribution workflow

> Recorded server snapshot on 16 November 2026 at 06:42:36 UTC: all three `main` rulesets were active. That configuration required every change through a PR, including maintenance-App changes. Only `CarinaSchoppe` (`User:29256704`) had a personal PR-only review exception (`bypass_mode: pull_request`); no repository role, other user, bot or App had that exception. All fifteen required checks and the separate history/signature rules were mandatory. The later operating readback below records the discrepancy. [Live rules](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules) remain authoritative.

> Operating readback on 16 November 2026 at 12:16:58 UTC: review ruleset `27329000` is `disabled`; its stored personal `User:29256704` entry still has `bypass_mode: pull_request`. This is stored configuration in a disabled layer. Checks `27329142` and history `27315671` remain active and unchanged, with fifteen strict required contexts and no bypass actors. Read-only evaluation of the active branch rules rejects the absent review layer with `native-policy`. Native merging under this policy remains blocked pending user clarification and reconciliation with the intended active source policy. This documentation changes neither server settings nor that source policy.

Contributors should start with [CONTRIBUTING](../CONTRIBUTING.md), the [issue guide](ISSUE_GUIDE.md) and the [pull request guide](PULL_REQUEST_GUIDE.md). This page explains the administrative sources and the boundaries of rule exceptions. Public contribution guidance and new contribution discussions use English; the product interface remains German and English.

Current publication policy: use `./portal check` for fast local feedback and
`./portal test` for complete local acceptance. Ordinary PR/main activity keeps
its GitHub quality/security checks but creates no automatic deployment record or
CMS release. Releases require an authorised manual `Portal checks` dispatch on
`main`, `publish_release=true`, the exact current `main` SHA in `expected_commit`
and every existing release gate. PR metadata publication/cleanup is manual-only;
see [PR_PREVIEWS](PR_PREVIEWS.md). The existing VPS polling timer is unchanged.

<a id="rules-for-main"></a>

<a id="active-rule-layers"></a>

The JSON files under `.github/rulesets/` preserve the verified 16 November 2026 06:42:36 UTC server snapshot: all three rulesets active, no history/check bypass, and only `CarinaSchoppe` (`User:29256704`) with `bypass_mode: pull_request` in the review rule. The review layer contains only its pull-request rule. Committing JSON does not activate protection; later [server-side rules](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules) remain authoritative. The reviewed layers are:

| Layer                    | Ruleset ID | Source                                           | Recorded exceptions                                                                        |
| ------------------------ | ---------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| History and integrity    | `27315671` | [history.json](../.github/rulesets/history.json) | None: signatures, deletion/force-update restrictions and the existing history rules apply. |
| Pull requests and review | `27329000` | [review.json](../.github/rulesets/review.json)   | Only `CarinaSchoppe` (`User:29256704`) through PRs. No role or App exception.              |
| Required verification    | `27329142` | [checks.json](../.github/rulesets/checks.json)   | None: strict current-base checks apply to humans and Apps.                                 |

Under that recorded active policy, the sole personal review exception follows `CarinaSchoppe` (immutable user ID `29256704`) when performing a native PR merge, not the PR author. It grants no direct-main push, CI bypass or history/signature bypass. Maintain/Admin roles confer no review exception; all other acting accounts need independent current-head approval, latest-push approval and resolved review conversations. The maintenance App uses the ordinary reviewed native path and has no review or check exception.

## Required checks and native auto-merge

All **15** contexts are required. The first 14 below come from GitHub Actions integration `15368`; the generated findings result comes from integration `57789`.

- Build
- Typecheck
- Lint
- Formatting
- Code quality
- Tests and coverage
- verify
- Actual isolated selfhost image compatibility
- PR metadata
- PR preview package
- CodeQL (javascript-typescript)
- CodeQL (python)
- CodeQL (actions)
- Dependency review
- CodeQL — generated findings result, integration `57789`

A successful scan is not a zero-finding report, and a passing unit run is not application/native acceptance. A changed head or base requires applicable current evidence. Native auto-merge availability is enabled; queuing a PR grants no new exception. Do not disable or bypass checks to make a merge finish.

The prepared [native controller](AUTO_MERGE.md) requires independent review and native `clean` mergeability for every candidate, including human Maintain/Admin authors and automated authors. Carina's personal review exception is not inherited by the App, and the controller grants no user, role or actor exception. Actual push provenance comes from the exact CI check suite and source push; workflow actors, retry/reopen events and commit emails cannot supply review authority. Missing evidence grants no exemption, and inconsistent evidence blocks the candidate.

<a id="activation-still-pending"></a>

## Controller delivery still pending

The legacy fragment above remains valid for older links. **Controller delivery remains pending; live review enforcement differs from the recorded active snapshot as noted above.** This prepared narrow follow-up includes main `e88df84c`, the protected PR22 daily-maintenance source and the accepted English/customer-neutral documentation and still requires its own exact-source CI, merge and successful default-branch execution. Source files, repository auto-merge availability and a configured App token do not prove that the controller is running on accepted main.

The existing App `5776881` (`luminovia-portal-maintenance`) remains scoped to this repository. Its existing protected `maintenance-signing` credentials are reused; no new App, permission scope, personal token or server credential is introduced. The standard Actions token reads REST and a fixed GraphQL operation. Only the separate App token may call the native PR merge endpoint or the two main-verification dispatch endpoints. It has no main-ref/force-write route and no native-rule bypass.

The controller submits an expected head SHA to GitHub's native merge endpoint with `merge_method: merge`. GitHub may create a different commit from the synthetic test merge; there is no exact-test-merge-SHA or atomic-base claim. Native strict checks, reviews and signatures remain authoritative. Current main verification is reconciled separately after a confirmed merge and on recovery sweeps; this does not publish or deploy an application.

The successful [read-only proof 43809731348](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43809731348) verified restricted-token access to all 15 check contexts, CodeQL records, the source push and current pusher permission. The probe used signed fictional commit `f7f0bee`; its owned temporary branch was removed. No App/main write occurred. This is metadata-access evidence only, not automatic-merge, controller, release or product acceptance. The final fixed query, including immutable Bot IDs and GraphQL-to-REST Bot login mapping, passed [read-only run 43814730991](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43814730991) using signed fictional fixture `2d0abce`; its owned branch was removed. It performed no App, deployment or main write and adds no native-merge acceptance claim.

Earlier standard-token/ref-promotion probes, role-based review exceptions and historical broad exemptions describe their recorded configurations. They grant no exception under the current rules. The separate maintenance/signature mechanisms must obey their current owning controls; an old signing probe is not review approval.

References: [rulesets and exceptions](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository), [Rules API](https://docs.github.com/en/rest/repos/rules), [native PR merge endpoint](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request), [controller evidence policy](AUTO_MERGE.md). [CI_QUALITY](CI_QUALITY.md) records historical check/coverage evidence; the dated source snapshot and later operating readback above distinguish intended policy from live enforcement.

## Protected daily maintenance

PR22/main `319ab69f` supplies the protected PR-based maintenance source. Branch-rule activation was complete in the recorded 06:42:36 UTC snapshot; the later operating readback above governs current enforcement. Successful App-token creation and actual maintenance workflow execution are separate operational evidence, not a reason to weaken protection. Under the intended active source policy, only `CarinaSchoppe` (`User:29256704`) has the personal PR-only review exception. Maintain/Admin roles and the maintenance App have none; all 15 strict checks and the history/signature rules remain mandatory.

The existing private **Luminovia Portal Maintenance** App has integration ID 5776881 and selected installation 182397724. The protected `maintenance-signing` environment already contains the App ID and private-key secret and restricts deployment to `main`. After explicit user confirmation, both the App registration and installation grant `contents/actions/pull_requests: write`. The installation remains limited to the single Luminovia-Management-Tool repository. Requesting a permission in a workflow does not grant it to the installation. Successful short-lived token creation and actual PR workflow execution remain acceptance steps; no completed App publication is claimed here.

The new publisher validates the tested dependency-only patch, creates or reuses its deterministic separate branch, verifies the signed commit and exact parent, and opens or reuses the matching PR. It applies `type:dependencies`, `area:devops` and `risk:high`, then requests native auto-merge. The App token starts normal PR CI without the extra workflow approval associated with a `GITHUB_TOKEN`-created PR. Under the intended active policy, native auto-merge still waits for independent review and every required check. If GitHub already reports the PR clean and ready, the publisher may use the regular PR merge endpoint with the exact expected head SHA; all native protections still apply. It cannot change `main` directly or substitute a pre-merge main workflow dispatch for PR checks.

While another open same-repository `codex/daily-maintenance-*` PR carries the maintenance marker, the publisher refuses to open a second update PR and reports `maintenance_existing_pr_requires_resolution`. It does not rewrite or close reviewed or human-edited PRs. If main has advanced and the existing PR is outdated, a maintainer closes it; the next daily scan retests and regenerates the candidate against actual current main. Strict up-to-date CI prevents an old-base merge.

After protected delivery, the manual diagnostic can verify the App against real GitHub endpoints without merging a candidate:

```sh
gh workflow run daily-maintenance.yml --ref main -f signature_probe_only=true
```

It creates a signed temporary branch and labelled draft PR, confirms their identity, closes the draft and deletes its branch. It never enables auto-merge or calls the merge endpoint for the diagnostic. Acceptance requires confirmed cleanup and unchanged main; unknown or edited resources remain visible for inspection. Normal PR CI may start for the probe commit, independently of the already required full source acceptance.

The former standard-token direct-main path is rejected by the active rules. Keep that failure closed until the PR workflow is delivered and tested. An unchanged daily scan skips privileged publication entirely. A deliberately absent release does not trigger another main CI run; the former retry-main command and its Actions-write token scope have been removed. Publication requires its own explicit approval under the local-first delivery policy. Do not restore App bypasses to make old promotion code work.

References: [rulesets and exceptions](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository), [Rules API](https://docs.github.com/en/rest/repos/rules), [workflow token events](https://docs.github.com/en/actions/concepts/security/github_token).

## PR preview packages and deployment records

After complete quality, coverage, application and native acceptance, PRs produce a seven-day source package for a complete local preview. The artifact remains available without a Deployment record. Only an authorised manual `PR preview deployments` dispatch on `main` with `action=publish`, the exact `run_id` and `run_attempt` asks the trusted default-branch publisher to create metadata. Its default `action=cleanup` deactivates stale/closed/expired records without publishing a new one; no PR event or schedule runs that cleanup automatically. Contribution code receives no write token or hosting secrets. The deployment URL opens the downloadable package; successful publication does not claim a hosted website. The packaged launcher uses owned local database identities and distinct ports. See [PR previews](PR_PREVIEWS.md) for permissions and local operation.

<a id="labels-and-historical-prs"></a>

## Labels and metadata validation

[labels.json](../.github/labels.json) contains 36 managed entries: eight types, 24 areas, three risk levels and `merge:hold`. It is the shared catalogue used by local and CI validation. The stop signal grants no permission and does not replace categories or checks; preserve it until its stated concern is addressed. The nine existing GitHub standard labels are preserved. Every PR needs exactly one `type:*`, exactly one `risk:*` and at least one `area:*`. Other labels may be added; unknown values within these three categories are rejected. The [pull request guide](PULL_REQUEST_GUIDE.md#pull-request-labels) explains how to choose them. The required metadata gate also rejects `merge:hold`, so the pause applies to native queued merging as well.

The [metadata workflow](../.github/workflows/pr-metadata.yml) responds to changes on open PRs through the ordinary `pull_request` event. It explicitly checks out `refs/heads/main` from this repository, so current labels are checked against the current shared catalogue rather than an obsolete contribution snapshot. It never checks out or executes contribution code, installs dependencies or uses secrets. Permissions remain only `contents: read` and `pull-requests: read`; no elevated event is needed. Repository, PR number and live head identity are validated; titles, bodies and labels remain data. Its regression tests are discovered automatically by `./portal test`:

```bash
node --test scripts/runtime-pr-metadata.test.mjs scripts/runtime-documentation.test.mjs
```

Closed PR label changes do not run this gate. For an explicit historical check, dispatch this workflow from `main` with a positive `pull_request_number`, for example:

```bash
gh workflow run pr-metadata.yml --ref main -f pull_request_number=6
```

The manual run reads current GitHub labels and records the actual PR head, including for a closed temporary-base fixture. It does not rerun application acceptance, replace historical SHA-bound results or invent a green status on an old failed run. A new managed label must be added to the shared catalogue before use. External contributors can suggest labels in the description; a maintainer applies them. Workflow changes themselves still need review.

## Git tags and development packages

Labels classify issues and pull requests. Git tags identify an immutable source revision. These signed annotated tags name already merged development milestones:

| Tag                                 | Accepted merge commit                      | Scope                                                                                  |
| ----------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `milestone/m3-accounts-commission`  | `00db7c9630dbf413000feab7ec7e0c2f56cb5b3a` | Accounts, profiles, clients and revenue allocation; PR #3.                             |
| M4 building-block checkpoint        | `b9cdcc89758451bc8258f3a9f173e95ee1a23736` | Building-block templates, avatars and comments; PR #4.                                 |
| `milestone/m5-system-audit`         | `bb322746d3cf18b1a0f1eae0eaa96450d26e26cd` | Functional and performance corrections; PR #5.                                         |
| `milestone/m6-connected-operations` | `dc8e9a7e65c96076038bf7067791676578d121d4` | Taxonomy, availability, lifecycle/capacity, dashboard, notifications and audit; PR #8. |

These tags are not production approvals or new Semver releases. They do not change existing `cms-dev-*` release tags. Release publication and installation follow their separate owning workflows and operational authorisation; successful main CI or pushing a milestone tag alone is not evidence of a published or installed package. Do not move or replace published tags.

## Public and private reports

Bug reports and feature requests start with the [issue chooser](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/issues/new/choose). Blank issues are disabled in favour of the forms. This is a setting of the chooser interface, not a technical restriction on the issue API.

GitHub private vulnerability reporting is enabled and linked from [SECURITY](../SECURITY.md). Secret Scanning and Push Protection were separately enabled and read back in the earlier quality task; private reporting alone does not enable them. No people were invited, messages sent, or hosting/production settings changed as part of this administration work.
