# GitHub administration and contribution workflow

> Reviewed server snapshot on 16 November 2026 at 15:08:47 UTC (17 November in Australia/Brisbane): all three `main` rulesets are active. Every change requires a PR, including maintenance-App changes. Only `CarinaSchoppe` (`User:29256704`) has a personal PR-only review exception (`bypass_mode: pull_request`). No repository role, other user, bot or App has that exception. All fifteen required checks and the separate history/signature rules remain mandatory. Live server rules are authoritative and may later differ. [Live rules](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules).

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

## Reviewed rule layers

The JSON files under `.github/rulesets/` preserve the verified 16 November 2026 15:08:47 UTC server readback: all three rulesets active, no history/check bypass, and only `CarinaSchoppe` (`User:29256704`) with `bypass_mode: pull_request` in the review rule. The readback covered rulesets `27315671` (history), `27329000` (review) and `27329142` (checks) through the read-only GitHub Rules API. It matched the committed configuration; no server rule was changed. The review layer contains only its pull-request rule. Committing JSON does not activate protection; later [server-side rules](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules) remain authoritative. The reviewed layers are:

| Rule                          | Source                                           | Enforcement and exceptions                                                                                                                              |
| ----------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch Protection             | [history.json](../.github/rulesets/history.json) | Signatures, deletion/force-push restrictions and existing deployment/code-quality rules. No bypass actors.                                              |
| Main pull requests and review | [review.json](../.github/rulesets/review.json)   | PR, one independent approval, latest-push approval and resolved conversations. Only `CarinaSchoppe` (User 29256704) has personal `pull_request` bypass. |
| Main verified checks          | [checks.json](../.github/rulesets/checks.json)   | All 15 required application/native, quality/coverage, metadata and security checks; strict up-to-date testing. No bypass actors.                        |

The personal review exception applies only when `CarinaSchoppe` performs a PR merge. It does not permit direct pushes or skipped, failed or pending mandatory checks. Repository-role membership, other contributors and the maintenance App receive no review exception. The App must satisfy independent approval, latest-push approval and conversation resolution before GitHub can merge its PR. No identity, including `CarinaSchoppe`, an administrator or the App, can bypass the history or required-check rules. Administrators retain permission to edit repository settings; the current rules govern normal push and merge operations.

The `PR preview package` job follows quality, coverage, runtime/Edge and isolated SQL acceptance. The source-derived profile uses explicit documentation-only verification, two independent SQL workers for ordinary UI work, or full native/application acceptance for sensitive/unknown changes. Sensitive PRs run system/SQL/API and all desktop/mobile/PWA stages on separate freshly owned stacks; the preview gate requires both phase results to succeed. Main/manual/local complete acceptance retains its original single-stack sequence. Main/manual always uses full acceptance, with independent jobs in parallel; selector failure cannot skip the required gates. It is now also a required Actions check, so all 15 PR checks must finish successfully before a merge. The main-only release job and separate preview-metadata workflow are not substituted for these PR checks.

The App's previous `always` exceptions were removed from both review and check rules and the effective rules were read back. The GitHub Actions integration 15368 and CodeQL integration 57789 identify the required checks' producers, not bypass actors. CI and coverage details are in [CI_QUALITY](CI_QUALITY.md).

<a id="activation-still-pending"></a>

## Maintenance delivery and operational verification

**Rule activation is complete.** This section tracks the separate operational delivery of PR-based maintenance, not a reason to disable protection.

The maintenance workflow uses the private **Luminovia Portal Maintenance** App and the protected `maintenance-signing` environment. Its source requests repository-scoped `contents/actions/pull_requests: write` permissions and creates short-lived tokens; a workflow declaration does not prove that installation access or secrets are currently configured. The earlier authorised App setup is historical operational evidence. Check the actual installation, token creation and PR workflow result before relying on unattended maintenance. This documentation audit read branch rules only and did not inspect credentials, change App access or execute publication.

The new publisher validates the tested dependency-only patch, creates or reuses its deterministic separate branch, verifies the signed commit and exact parent, and opens or reuses the matching PR. It applies `type:dependencies`, `area:devops` and `risk:high`, then requests native auto-merge. The App token starts normal PR CI without the extra workflow approval associated with a `GITHUB_TOKEN`-created PR. Native auto-merge still waits for independent review and every required check. If GitHub already reports the PR clean and ready, the publisher may use the regular PR merge endpoint with the exact expected head SHA; all native protections still apply. It cannot change `main` directly or substitute a pre-merge main workflow dispatch for PR checks.

While another open same-repository `codex/daily-maintenance-*` PR carries the maintenance marker, the publisher refuses to open a second update PR and reports `maintenance_existing_pr_requires_resolution`. It does not rewrite or close reviewed or human-edited PRs. If main has advanced and the existing PR is outdated, a maintainer closes it; the next daily scan retests and regenerates the candidate against actual current main. Strict up-to-date CI prevents an old-base merge.

After protected delivery, the manual diagnostic can verify the App against real GitHub endpoints without merging a candidate:

```sh
gh workflow run daily-maintenance.yml --ref main -f signature_probe_only=true
```

It creates a signed temporary branch and labelled draft PR, confirms their identity, closes the draft and deletes its branch. It never enables auto-merge or calls the merge endpoint for the diagnostic. Acceptance requires confirmed cleanup and unchanged main; unknown or edited resources remain visible for inspection. Normal PR CI may start for the probe commit, independently of the already required full source acceptance.

The former standard-token direct-main path is rejected by the active rules. Keep that failure closed until the PR workflow is delivered and tested. An unchanged daily scan skips privileged publication entirely. A deliberately absent release does not trigger another main CI run; the former retry-main command and its Actions-write token scope have been removed. Publication requires its own explicit approval under the local-first delivery policy. Do not restore App bypasses to make old promotion code work.

References: [rulesets and exceptions](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository), [Rules API](https://docs.github.com/en/rest/repos/rules), [workflow token events](https://docs.github.com/en/actions/concepts/security/github_token).

## PR preview packages and deployment records

After the bounded quality, coverage, runtime/Edge and PostgreSQL PR suite, PRs produce a seven-day source package for a complete local preview. The manifest states the actual source-derived profile. Only the full profile claims native/browser/retained-data acceptance; that unchanged suite always runs on main/manual and sensitive PRs. All existing required context names and successful-job requirements remain intact. The artifact remains available without a Deployment record. Only an authorised manual `PR preview deployments` dispatch on `main` with `action=publish`, the exact `run_id` and `run_attempt` asks the trusted default-branch publisher to create metadata. Its default `action=cleanup` deactivates stale/closed/expired records without publishing a new one; no PR event or schedule runs that cleanup automatically. Contribution code receives no write token or hosting secrets. The deployment URL opens the downloadable package; successful publication does not claim a hosted website. The packaged launcher uses owned local database identities and distinct ports. See [PR previews](PR_PREVIEWS.md) for permissions and local operation.

<a id="labels-and-historical-prs"></a>

## Labels and metadata validation

[labels.json](../.github/labels.json) contains 36 managed entries: eight types, 24 areas, three risk levels and `merge:hold`. It is the shared catalogue used by local and CI validation. The stop signal grants no permission and does not replace categories or checks; preserve it until its stated concern is addressed. The nine existing GitHub standard labels are preserved. Every PR needs exactly one `type:*`, exactly one `risk:*` and at least one `area:*`. Other labels may be added; unknown values within these three categories are rejected. The [pull request guide](PULL_REQUEST_GUIDE.md#pull-request-labels) explains how to choose them.

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

These tags are not production approvals or new Semver releases. They do not change existing `cms-dev-*` release tags. Development packages require the explicit manual publication inputs and complete verification described above; successful automatic main CI alone does not publish one. Pushing `milestone/*` tags does not start release jobs. Do not move or replace published tags.

## Public and private reports

Bug reports and feature requests start with the [issue chooser](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/issues/new/choose). Blank issues are disabled in favour of the forms. This is a setting of the chooser interface, not a technical restriction on the issue API.

Private vulnerability reporting is linked from [SECURITY](../SECURITY.md). It, Secret Scanning and Push Protection were enabled and read back in earlier administration tasks; their current settings were not re-read during this documentation audit. Private reporting alone does not enable the other controls. No people were invited, messages sent, or hosting/production settings changed as part of this administration work.
