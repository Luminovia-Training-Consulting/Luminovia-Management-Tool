# GitHub administration and contribution workflow

Contributors should start with [CONTRIBUTING](../CONTRIBUTING.md), the [issue guide](ISSUE_GUIDE.md) and the [pull request guide](PULL_REQUEST_GUIDE.md). This page describes the administrative sources, effective protection and merge exceptions.

## Rules for `main`

The JSON files in `.github/rulesets/` mirror the repository configuration. Committing JSON does not activate a rule: the [server rules](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules) are authoritative. The current instruction supersedes the earlier personal PR-only exception: **Maintainers and Administrators may merge directly at any time and bypass rules when necessary.**

Read back through the authenticated GitHub API on 16 November 2026:

| Ruleset                                   | Source                                           | Effective state                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Branch Protection, `27315671`             | [history.json](../.github/rulesets/history.json) | Active on the default branch: signed commits, deletion and force-push protection, existing deployment/code-quality rules. The deployment environment list is empty; this does not establish a deployment approval gate. Repository roles `maintain` (ID 2) and `admin` (ID 5) have `always` bypass. |
| Main pull requests and review, `27329000` | [review.json](../.github/rulesets/review.json)   | Disabled, prepared for PRs, one independent approval, last-push approval and resolved conversations. Both privileged roles retain `always` bypass.                                                                                                                                                  |
| Main verified checks, `27329142`          | [checks.json](../.github/rulesets/checks.json)   | Disabled, prepared for the complete application, native selfhost compatibility, metadata and six build/quality/coverage checks. Both privileged roles retain `always` bypass.                                                                                                                       |

`always` applies to the acting account's actual Maintainer/Admin role, independently of PR authorship, reviews or pending/failed checks. GitHub may require an explicit bypass action. Ordinary Write access has no such exception. No collaborators or repository roles were added in this documentation task.

Bypassing a merge rule does not make a failing test successful. The development release and automatic VPS installer still require the successful full `ci.yml` workflow; the separate Security workflow supplies additional analysis and is not a release gate. [CI quality](CI_QUALITY.md) explains this distinction.

## Activation still pending

The additional review/check rules remain disabled because enabling them without the proven maintenance-token path would block the existing signed daily direct promotion using the standard `GITHUB_TOKEN`. Main's active history protection and the Maintainer/Admin exceptions already apply. **Independent review and required status checks are contribution policy, but are not currently enforced by those two disabled server rules.**

The earlier actual [protected-branch probe](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43755067933) showed that a bot-user exception did not reliably bypass the temporary PR/missing-check rules for the standard token. The temporary rules and branches were removed. GitHub Actions App `15368` identifies the expected check producer, not an assumed bypass identity.

The earlier inventory found the private **Luminovia Portal Maintenance** App, integration `5776881`, with selected installation `182397724` and `contents/actions: write`. Its exact repository selection and a working installation-token promotion have not been proved by this task. Required variables/secrets and the App workflow are not confirmed fully configured on current main.

Before activating the additional rules, coordinate the existing App work, verify its exact repository scope and short-lived token, run a protected signed-promotion test, deliver the App workflow with the precise App exception, then activate and read back the rules. Preserve Maintainer/Admin `always`. Do not replace the standard token with a broadly privileged personal token or claim an untested bot bypass.

Read-only checks, using an authenticated account with access:

```bash
gh api repos/Luminovia-Training-Consulting/Luminovia-Management-Tool/rulesets
gh api repos/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules/branches/main
gh api repos/Luminovia-Training-Consulting/Luminovia-Management-Tool/rulesets/27315671
```

The effective branch endpoint returns active rules; inspect the individual ruleset to see its bypass actors. Organisation-wide administration was not available with the existing token in the earlier audit; no organisation or other repository policy change is claimed. See GitHub's [ruleset and bypass documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository) and [rules API](https://docs.github.com/en/rest/repos/rules).

## Labels and metadata validation

[labels.json](../.github/labels.json) contains 30 managed labels. Nine original GitHub labels remain available. Each PR needs exactly one `type:*`, exactly one `risk:*` and at least one `area:*`. Additional unprefixed labels are allowed; unknown values in the three managed categories are rejected. See [label selection](PULL_REQUEST_GUIDE.md#labels-for-pull-requests).

The [metadata workflow](../.github/workflows/pr-metadata.yml) also responds to label changes. It reads the current labels, checks repository/PR/head identity and treats all text as data. It installs no dependencies and requests only `contents: read` and `pull-requests: read`. Its regressions are discovered by `./portal test`:

```bash
node --test scripts/runtime-pr-metadata.test.mjs scripts/runtime-documentation.test.mjs
```

External authors normally cannot label a PR. Include proposed labels in the description; a Maintainer applies them. Missing metadata must not be concealed behind an invented successful status. Workflow changes also need review because normal PR workflows execute the proposed source.

All eleven existing PRs (#1–#11), including open #10, were read back during this task and already had the required categories. Their existing labels are preserved. Updating descriptions in the catalogue does not rename or remove those classifications.

## Git tags and development packages

Labels classify issues and PRs; Git tags identify immutable commits. Existing signed annotated development milestones include:

| Tag                                 | Accepted merge commit                      | Scope                                                                                  |
| ----------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `milestone/m3-accounts-commission`  | `00db7c9630dbf413000feab7ec7e0c2f56cb5b3a` | Accounts, profiles, clients and revenue allocation; PR #3.                             |
| `milestone/m4-cbw-templates`        | `b9cdcc89758451bc8258f3a9f173e95ee1a23736` | Building-block templates, avatars and comments; PR #4.                                 |
| `milestone/m5-system-audit`         | `bb322746d3cf18b1a0f1eae0eaa96450d26e26cd` | Functional and performance corrections; PR #5.                                         |
| `milestone/m6-connected-operations` | `dc8e9a7e65c96076038bf7067791676578d121d4` | Taxonomy, availability, lifecycle/capacity, dashboard, notifications and audit; PR #8. |

These tags are development acceptance markers, not production approval or semantic versions. Do not move or replace published tags. The existing `cms-dev-*` tags belong to immutable development releases after successful main CI; pushing a `milestone/*` tag does not trigger those release jobs. [Changelog](../CHANGELOG.md) records user-visible changes; [roadmap](../ROADMAP.md) records remaining work.

## Public and private reports

Use the [issue chooser](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/issues/new/choose) for ordinary bugs, features and questions. Blank issues are disabled in that UI in favour of structured forms; this is not an Issue API access restriction.

Private vulnerability reporting is enabled; follow [SECURITY](../SECURITY.md). Secret Scanning and Push Protection were separately enabled and read back in the earlier quality task; private reporting alone would not enable them. No new App, key, paid service, invitation, real email or hosting/production change was made in this documentation task.
