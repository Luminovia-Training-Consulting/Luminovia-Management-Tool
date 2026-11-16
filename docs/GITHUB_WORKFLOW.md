# GitHub administration and contribution workflow

> Status verified on 16 November 2026: all three `main` rulesets are active. Every change requires a PR, including maintenance-App changes. Maintainers/admins may bypass review through a PR only; nobody can bypass the 14 mandatory CI/security checks or up-to-date testing. The maintenance App has no rule exception. [Live rules](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules).

Contributors should start with [CONTRIBUTING](../CONTRIBUTING.md), the [issue guide](ISSUE_GUIDE.md) and the [pull request guide](PULL_REQUEST_GUIDE.md). This page explains the administrative sources and the boundaries of rule exceptions. Public contribution guidance and new contribution discussions use English; the product interface remains German and English.

## Rules for `main`

The JSON files under `.github/rulesets/` are snapshots of the configuration read back from GitHub. Files alone do not activate protection; the [server-side rules](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules) are authoritative. All three policies are active:

| Rule                          | Source                                           | Enforcement and exceptions                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch Protection             | [history.json](../.github/rulesets/history.json) | Signatures, deletion/force-push restrictions and existing deployment/code-quality rules. No bypass actors.                                                                  |
| Main pull requests and review | [review.json](../.github/rulesets/review.json)   | PR, one independent approval, latest-push approval and resolved conversations. Only human repository roles `maintain` (ID 2) and `admin` (ID 5) have `pull_request` bypass. |
| Main verified checks          | [checks.json](../.github/rulesets/checks.json)   | All 14 required application/native, quality/coverage, metadata and security checks; strict up-to-date testing. No bypass actors.                                            |

The human review exception applies to the person performing a PR merge. It does not permit direct pushes or skipped, failed or pending mandatory checks. Ordinary write access and the maintenance App receive no review exception. The App must satisfy independent approval, latest-push approval and conversation resolution before GitHub can merge its PR. No identity, including an administrator or the App, can bypass the required-check rules. Administrators retain permission to edit repository settings; the current rules govern normal push and merge operations.

The App's previous `always` exceptions were removed from both review and check rules and the effective rules were read back. The GitHub Actions integration 15368 and CodeQL integration 57789 identify the required checks' producers, not bypass actors. CI and coverage details are in [CI_QUALITY](CI_QUALITY.md).

## Activation still pending

**Rule activation is complete.** This section tracks the separate operational delivery of PR-based maintenance, not a reason to disable protection.

The existing private **Luminovia Portal Maintenance** App has integration ID 5776881 and selected installation 182397724. The protected `maintenance-signing` environment already contains the App ID and private-key secret and restricts deployment to `main`. After explicit user confirmation, both the App registration and installation grant `contents/actions/pull_requests: write`. The installation remains limited to the single Luminovia-Management-Tool repository. Requesting a permission in a workflow does not grant it to the installation. Successful short-lived token creation and actual PR workflow execution remain acceptance steps; no completed App publication is claimed here.

The new publisher validates the tested dependency-only patch, creates or reuses its deterministic separate branch, verifies the signed commit and exact parent, and opens or reuses the matching PR. It applies `type:dependencies`, `area:devops` and `risk:high`, then requests native auto-merge. The App token starts normal PR CI without the extra workflow approval associated with a `GITHUB_TOKEN`-created PR. Native auto-merge still waits for independent review and every required check. If GitHub already reports the PR clean and ready, the publisher may use the regular PR merge endpoint with the exact expected head SHA; all native protections still apply. It cannot change `main` directly or substitute a pre-merge main workflow dispatch for PR checks.

While another open same-repository `codex/daily-maintenance-*` PR carries the maintenance marker, the publisher refuses to open a second update PR and reports `maintenance_existing_pr_requires_resolution`. It does not rewrite or close reviewed or human-edited PRs. If main has advanced and the existing PR is outdated, a maintainer closes it; the next daily scan retests and regenerates the candidate against actual current main. Strict up-to-date CI prevents an old-base merge.

The former standard-token direct-main path is rejected by the active rules. Keep that failure closed until the PR workflow is delivered and tested. An unchanged daily run may still retry verification of an already merged, unreleased main revision; that operation does not publish a candidate or change the branch. Do not restore App bypasses to make old promotion code work.

References: [rulesets and exceptions](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository), [Rules API](https://docs.github.com/en/rest/repos/rules), [workflow token events](https://docs.github.com/en/actions/concepts/security/github_token).

## Labels and metadata validation

[labels.json](../.github/labels.json) is the shared catalogue of managed labels used by local and CI validation. The nine existing GitHub standard labels are preserved. Every PR needs exactly one `type:*`, exactly one `risk:*` and at least one `area:*`. Other labels may be added; unknown values within these three categories are rejected. The [pull request guide](PULL_REQUEST_GUIDE.md#pull-request-labels) explains how to choose them.

The [metadata workflow](../.github/workflows/pr-metadata.yml) also responds to label changes. It reads current labels, verifies the repository, PR number and commit identity, and treats text as data. It installs no dependencies and requests only `contents: read` and `pull-requests: read`. Its eight regression tests are discovered automatically by `./portal test`:

```bash
node --test scripts/runtime-pr-metadata.test.mjs scripts/runtime-documentation.test.mjs
```

External contributors can suggest labels in the description; a maintainer applies them. Missing labels must not be bypassed by inventing a green status. Workflow changes themselves need review because ordinary PR workflows execute the proposed source version.

## Git tags and development packages

Labels classify issues and pull requests. Git tags identify an immutable source revision. These signed annotated tags name already merged development milestones:

| Tag                                | Actual merge commit                        | Meaning                                                               |
| ---------------------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| `milestone/m3-accounts-commission` | `00db7c9630dbf413000feab7ec7e0c2f56cb5b3a` | Accounts, profiles, clients and revenue sharing; PR #3.               |
| `milestone/m4-cbw-templates`       | `b9cdcc89758451bc8258f3a9f173e95ee1a23736` | Building-block templates, avatars and comments; PR #4.                |
| `milestone/m5-system-audit`        | `bb322746d3cf18b1a0f1eae0eaa96450d26e26cd` | System review and concrete functional/performance corrections; PR #5. |

These tags are not production approvals or new Semver releases. They do not change existing `cms-dev-*` release tags. Current workflows publish development packages after successful main CI; pushing these `milestone/*` tags does not start those release jobs. Do not move or replace published tags.

## Public and private reports

Bug reports and feature requests start with the [issue chooser](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/issues/new/choose). Blank issues are disabled in favour of the forms. This is a setting of the chooser interface, not a technical restriction on the issue API.

GitHub private vulnerability reporting is enabled and linked from [SECURITY](../SECURITY.md). Enabling it does not automatically enable Secret Scanning or other paid services. No people were invited, messages sent, or hosting/production settings changed as part of this administration work.
