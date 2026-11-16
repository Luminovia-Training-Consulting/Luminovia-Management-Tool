# GitHub administration and contribution workflow

Contributors should start with [CONTRIBUTING](../CONTRIBUTING.md), the [issue guide](ISSUE_GUIDE.md) and the [pull request guide](PULL_REQUEST_GUIDE.md). This page describes the administrative sources, effective protection and merge exceptions.

## Rules for `main`

The JSON files in `.github/rulesets/` mirror the actual repository configuration. Committing JSON does not activate a rule: [server rules](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules) are authoritative. **The concurrent activation at 02:33 UTC and extension at 02:45 UTC on 16 November supersede the earlier disabled-rule and unrestricted-human-bypass snapshots.** This documentation task reads and records the live state; it does not weaken or change server settings.

| Ruleset                                   | Source                                           | Effective state after activation                                                                                                                                                                                   |
| ----------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Branch Protection, `27315671`             | [history.json](../.github/rulesets/history.json) | Active: signatures, deletion/force-push protection and existing code-quality/deployment rules. The deployment environment list is empty. No bypass actors are configured: signatures/history apply to every actor. |
| Main pull requests and review, `27329000` | [review.json](../.github/rulesets/review.json)   | Active: PR, one independent approval, last-push approval and resolved conversations. Maintain (role 2)/Admin (role 5) have **PR-only** bypass; maintenance App `5776881` has `always`.                             |
| Main verified checks, `27329142`          | [checks.json](../.github/rulesets/checks.json)   | Active: all 14 required application/native/metadata/build/quality/coverage/security checks and strict current-base verification. Only App `5776881` has `always`; **no human bypass** is configured.               |

Maintainers and Administrators can merge their own PRs without a separate approving reviewer by using the PR-only review exception, but must wait for all 14 required checks on the current source and base. History/signature rules have no bypass actors. Ordinary Write access does not gain either human-role exception. No collaborator or repository role was added by this documentation task.

The development release and automatic VPS installer independently require successful full `ci.yml`. The three language-specific CodeQL analyses, Dependency review and generated CodeQL finding result are required PR merge checks. The first four come from GitHub Actions15368; generated CodeQL comes from Advanced Security57789. The main development release still uses the explicit dependency graph in `ci.yml`; merging and publication have distinct gates. [CI quality](CI_QUALITY.md) explains the gates. The earlier PR11 direct merge during running checks proved the former configuration, not a bypass of today's active required-check rules.

<a id="activation-still-pending"></a>

## Current enforcement and maintenance path

The legacy fragment above remains for previously published links. Review and check enforcement are now **active**, as confirmed by both ruleset details and the effective-main endpoint. The three source JSON files were synchronized to that readback without a remote mutation.

The earlier actual [protected-branch probe](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43755067933) showed the standard token's bot-user bypass was insufficient. The private maintenance App is a different integration (`5776881`, selected installation `182397724`); the active rules now grant that exact App bypass. GitHub Actions `15368` identifies the required check producer, not the maintenance bypass actor.

App registration, key provisioning and protected promotion proof belong to separate ongoing work. This task confirms the live App exception, but does not independently certify that its workflow/token promotion is already delivered on current main. Preserve the repository-scoped short-lived-token path, successful full verification and signed/base-bound promotion checks; do not substitute a broadly privileged personal token or assume standard `GITHUB_TOKEN` now bypasses the rules. Earlier disabled-state entries in historical work logs describe their recorded time.

Read-only checks, using an authenticated account with access:

```bash
gh api repos/Luminovia-Training-Consulting/Luminovia-Management-Tool/rulesets
gh api repos/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules/branches/main
gh api repos/Luminovia-Training-Consulting/Luminovia-Management-Tool/rulesets/27315671
```

The effective branch endpoint returns active rules; inspect the individual ruleset to see its bypass actors. Organisation-wide administration was not available with the existing token in the earlier audit; no organisation or other repository policy change is claimed. See GitHub's [ruleset and bypass documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository) and [rules API](https://docs.github.com/en/rest/repos/rules).

## Labels and metadata validation

[labels.json](../.github/labels.json) contains 36 managed labels. Nine original GitHub labels remain available. Each PR needs exactly one `type:*`, exactly one `risk:*` and at least one `area:*`. Additional labels outside those three namespaces are allowed; unknown values in the three managed categories are rejected. See [label selection](PULL_REQUEST_GUIDE.md#pull-request-labels).

The [metadata workflow](../.github/workflows/pr-metadata.yml) also responds to label changes. It reads the current labels, checks repository/PR/head identity and treats all text as data. It installs no dependencies and requests only `contents: read` and `pull-requests: read`. Its regressions are discovered by `./portal test`:

```bash
node --test scripts/runtime-pr-metadata.test.mjs scripts/runtime-documentation.test.mjs
```

External authors normally cannot label a PR. Include proposed labels in the description; a Maintainer applies them. Missing metadata must not be concealed behind an invented successful status. Workflow changes also need review because normal PR workflows execute the proposed source.

All eleven original PRs (#1–#11) were initially read back and classified. During parallel work the repository grew to 19 PRs and five new area labels plus `merge:hold`. The source catalogue now includes those actual live labels so the existing validator accepts the current classifications. Labels and their meanings are preserved; a stop label is not removed merely to make a PR mergeable.

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

Use English for new issues, pull requests and contributor-facing documentation. Application interfaces remain German/English and authored content retains its language. Use the [issue chooser](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/issues/new/choose) for ordinary bugs, features and questions. Blank issues are disabled in that UI in favour of structured forms; this is not an Issue API access restriction.

Private vulnerability reporting is enabled; follow [SECURITY](../SECURITY.md). Secret Scanning and Push Protection were separately enabled and read back in the earlier quality task; private reporting alone would not enable them. No new App, key, paid service, invitation, real email or hosting/production change was made in this documentation task.
