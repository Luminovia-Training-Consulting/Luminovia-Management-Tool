# GitHub administration and contribution workflow

Contributors should start with [CONTRIBUTING](../CONTRIBUTING.md), the [issue guide](ISSUE_GUIDE.md) and the [pull request guide](PULL_REQUEST_GUIDE.md). This page explains the administrative sources and the boundaries of rule exceptions. Public contribution guidance and new contribution discussions use English; the product interface remains German and English.

## Rules for `main`

The JSON files under `.github/rulesets/` reflect the repository configuration that was actually read back from GitHub. Files alone do not activate a rule; the [server-side rules](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules) are authoritative. The current instruction replaces the earlier personal PR-only exception: **maintainers and administrators may merge directly at any time and bypass rules when necessary.**

| Rule                          | Source                                           | Current status                                                                                                                                                                                         |
| ----------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Branch Protection             | [history.json](../.github/rulesets/history.json) | Active: signatures, deletion/force-push restrictions and existing deployment/code-quality rules. Existing `always` exceptions for repository roles `maintain` (ID 2) and `admin` (ID 5) are preserved. |
| Main pull requests and review | [review.json](../.github/rulesets/review.json)   | Prepared but still disabled: PR, one independent approval, latest-push approval and resolved conversations. Both roles have `always` instead of the earlier personal PR-only exception.                |
| Main verified checks          | [checks.json](../.github/rulesets/checks.json)   | Prepared but still disabled: complete application, native selfhost compatibility, metadata and the new build/quality/coverage checks; both roles have `always`.                                        |

`always` applies to the person acting with an actual Maintainer/Admin role, regardless of the PR author, self-review or pending/failed checks. GitHub may require an explicit bypass action in its interface. A maintainer merge still starts checks; it does not make them artificially pass. Automatic publication and VPS installation still wait for the successful complete `ci.yml` run; the separate Security workflow provides additional analysis and is not another release gate. Ordinary write access does not receive this bypass. No additional people were invited or roles assigned.

## Activation still pending

The additional review/check rules (IDs 27329000/27329142) remain deliberately disabled. Activating them without verification would block the existing signed daily direct promotion using the standard `GITHUB_TOKEN`. The Maintainer/Admin exception in the active rule already applies; the additional requirements for other contributors are **not yet enforced server-side**.

The earlier real test [43755067933](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43755067933) showed that a bot-user exception does not reliably bypass the temporary PR/missing-check rule for the standard token. Its temporary rules and branches were removed. The general GitHub Actions App 15368 remains the verified source of status checks, not an assumed bypass identity.

The latest inventory confirmed that the private **Luminovia Portal Maintenance** App exists, with integration ID 5776881, a `selected` installation 182397724 and `contents/actions: write`. The earlier general statement that no App exists is outdated. This task did not prove the exact selected repository scope or a working installation-token promotion; the required repository variables/secrets and App workflow have not been confirmed as fully configured on current main.

Before later activation: coordinate the existing App setup, verify its actual repository scope and short-lived token, execute the protected signing/promotion test, adopt the App workflow and precise App exception together, and only then activate and read back the additional rules. Maintainer/Admin `always` remains in place. No App, private key or paid feature was newly registered for this CI task.

Effective main rules and repository roles were read through REST/GraphQL; the existing token could not list organisation-wide rules. This configuration does not claim to change other repositories or the organisation.

References: [rulesets and exceptions](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository), [Rules API](https://docs.github.com/en/rest/repos/rules). Checks and coverage are explained in [CI_QUALITY](CI_QUALITY.md).

## Labels and metadata validation

[labels.json](../.github/labels.json) is the shared catalogue of managed labels used by local and CI validation. The nine existing GitHub standard labels are preserved. Every PR needs exactly one `type:*`, exactly one `risk:*` and at least one `area:*`. Other labels may be added; unknown values within these three categories are rejected. The [pull request guide](PULL_REQUEST_GUIDE.md#pull-request-labels) explains how to choose them.

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

| Tag                                | Actual merge commit                        | Meaning                                                               |
| ---------------------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| `milestone/m3-accounts-commission` | `00db7c9630dbf413000feab7ec7e0c2f56cb5b3a` | Accounts, profiles, clients and revenue sharing; PR #3.               |
| `milestone/m4-cbw-templates`       | `b9cdcc89758451bc8258f3a9f173e95ee1a23736` | Building-block templates, avatars and comments; PR #4.                |
| `milestone/m5-system-audit`        | `bb322746d3cf18b1a0f1eae0eaa96450d26e26cd` | System review and concrete functional/performance corrections; PR #5. |

These tags are not production approvals or new Semver releases. They do not change existing `cms-dev-*` release tags. Current workflows publish development packages after successful main CI; pushing these `milestone/*` tags does not start those release jobs. Do not move or replace published tags.

## Public and private reports

Bug reports and feature requests start with the [issue chooser](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/issues/new/choose). Blank issues are disabled in favour of the forms. This is a setting of the chooser interface, not a technical restriction on the issue API.

GitHub private vulnerability reporting is enabled and linked from [SECURITY](../SECURITY.md). Enabling it does not automatically enable Secret Scanning or other paid services. No people were invited, messages sent, or hosting/production settings changed as part of this administration work.
