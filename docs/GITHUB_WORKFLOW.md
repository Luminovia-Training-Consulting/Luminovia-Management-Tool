# GitHub administration and contribution workflow

Start with [CONTRIBUTING](../CONTRIBUTING.md), the [issue guide](ISSUE_GUIDE.md), [pull-request guide](PULL_REQUEST_GUIDE.md) and [documentation index](README.md). The public Luminovia Website repository is a separate read-only brand reference. Develop and test locally by default; successful tests or merges do not authorise deployment or release publication.

<a id="rules-for-main"></a>

## Active rule layers

All three `main` rulesets were read back as **active** on 16 November 2026. Maintainers and repository administrators may merge through PRs without another person's review; checks and signatures remain mandatory. Source configurations under `.github/rulesets/` record the live readback. Committing JSON does not activate a rule: the [server rules](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules) are authoritative. This documentation correction makes no server change.

| Layer                 | Live ID    | Source                                           | Exceptions                                                                                |
| --------------------- | ---------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| History and integrity | `27315671` | [history.json](../.github/rulesets/history.json) | None.                                                                                     |
| PRs and review        | `27329000` | [review.json](../.github/rulesets/review.json)   | Maintain (`RepositoryRole:2`) and Repository admin (`RepositoryRole:5`) through PRs only. |
| Verified checks       | `27329142` | [checks.json](../.github/rulesets/checks.json)   | None.                                                                                     |

The history layer preserves deletion protection, non-fast-forward protection, valid signatures, the existing deployment rule with an empty environment list and code-quality errors. A human review exception does not bypass this separate layer or CI. Ordinary contributors and the maintenance App still require independent approval, current last-push approval and the other configured review conditions. A PR-only exception requires a PR and applies only within its review ruleset. No identity may skip mandatory checks through a bypass actor. Administrators retain permission to edit repository settings; these rules govern normal push and merge operations.

The actual GitHub rule UI displayed **Maintain** and **Repository admin**, while the corresponding API returned IDs `2` and `5`. The official REST schema supports `RepositoryRole` with `bypass_mode: pull_request` but does not publish a numeric built-in-role table. [REST schema](https://docs.github.com/en/rest/repos/rules?apiVersion=2026-03-10#update-a-repository-ruleset), [rule layering](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets#about-rule-layering), [documented schema gap](https://github.com/github/rest-api-description/issues/7111).

## Required checks and Auto-Merge

Fourteen of the **15 required contexts** are bound to GitHub Actions integration `15368`:

- Build
- Typecheck
- Lint
- Formatting
- Code quality
- Tests and coverage
- verify
- Actual isolated selfhost image compatibility
- PR metadata
- CodeQL (javascript-typescript)
- CodeQL (python)
- CodeQL (actions)
- Dependency review
- PR preview package

The remaining generated `CodeQL` findings check is bound to integration `57789`. Successful scanner jobs alone do not satisfy that separately generated result. All 15 are compulsory for every identity. The preview-package job validates a downloadable local source package; it does not establish a hosted preview or approve publishing a deployment record.

Checks require an up-to-date base and are not waived on branch creation. CodeQL and Dependency Review are required merge checks. Passing a scan is not a claim that every warning has disappeared. [CI_QUALITY](CI_QUALITY.md) explains the separate coverage, application, retained-data and security evidence.

Repository `allow_auto_merge` is enabled. Native Auto-Merge waits for the active requirements; it is not an approval or a bypass. Use it only within the task's authorised merge scope, preserving coordinated holds and `merge:hold`. For a reviewed exact head, the command is:

```bash
gh pr merge NUMBER --repo Luminovia-Training-Consulting/Luminovia-Management-Tool \
  --auto --merge --match-head-commit EXACT_HEAD_SHA
```

Use the actual PR number and full head SHA. Never disable checks to make a merge finish. A successful merge remains separate from deployment or release approval.

<a id="activation-still-pending"></a>

## Current enforcement and maintenance path

The legacy fragment above remains for published links. Rule activation is **complete**. Readback of the effective-main endpoint and the individual rulesets confirmed no history/check bypasses and only the two PR-only human review exceptions. Earlier disabled-rule, unrestricted-human-bypass and maintenance-App-exception entries describe their recorded time.

The private maintenance App (`5776881`, selected installation `182397724`) has **no review or check exception**. GitHub Actions `15368` and CodeQL `57789` identify check producers, not bypass actors. Old direct-main promotion must fail closed under the current rules. Do not restore an App exception, use a broadly privileged personal token or dispatch a pre-merge main run as a substitute for PR acceptance.

Replacement maintenance must use a separate signed PR and satisfy its normal review and exact-head checks. App registration, configured credentials and a local signing proof do not establish actual workflow delivery or execution. Consult the owning maintenance PR and [maintenance runbook](HOSTINGER_AUTOMATIC_UPDATES.md) for revision-specific evidence before operating that workflow. This correction does not trigger a maintenance probe or change its permissions.

Read-only checks, using an authenticated account with access:

```bash
gh api repos/Luminovia-Training-Consulting/Luminovia-Management-Tool/rulesets
gh api repos/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules/branches/main
gh api repos/Luminovia-Training-Consulting/Luminovia-Management-Tool/rulesets/27315671
gh api repos/Luminovia-Training-Consulting/Luminovia-Management-Tool/rulesets/27329000
gh api repos/Luminovia-Training-Consulting/Luminovia-Management-Tool/rulesets/27329142
```

The effective branch endpoint returns active rules; inspect each ruleset for its bypass actors. Organisation-wide administration was not available with the existing token in the earlier audit; no organisation or other repository policy change is claimed. See GitHub's [ruleset and bypass documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository) and [rules API](https://docs.github.com/en/rest/repos/rules).

## PR preview packages and deployment records

After complete quality, coverage, application and native acceptance, PRs produce a seven-day source package for a complete local preview. A separate trusted default-branch publisher updates GitHub Deployments using actual current PR, workflow and artifact metadata. Contribution code receives no write token or hosting secrets. The deployment URL opens the downloadable package; successful publication does not claim a hosted website. Closed, superseded and expired previews become inactive. The packaged launcher uses owned local database identities and distinct ports. See [PR previews](PR_PREVIEWS.md) for permissions, local operation and first activation.

<a id="labels-and-historical-prs"></a>

## Labels and metadata validation

[labels.json](../.github/labels.json) contains 36 managed labels. Nine original GitHub labels remain available. Each PR needs exactly one `type:*`, exactly one `risk:*` and at least one `area:*`. Additional labels outside those three namespaces are allowed; unknown values in the three managed categories are rejected. See [label selection](PULL_REQUEST_GUIDE.md#pull-request-labels).

The [metadata workflow](../.github/workflows/pr-metadata.yml) responds to changes on open PRs through the ordinary `pull_request` event. It explicitly checks out `refs/heads/main` from this repository, so current labels are checked against the current shared catalogue rather than an obsolete contribution snapshot. It never checks out or executes contribution code, installs dependencies or uses secrets. Permissions remain only `contents: read` and `pull-requests: read`; no elevated event is needed. Repository, PR number and live head identity are validated; titles, bodies and labels remain data. Its regression tests are discovered automatically by `./portal test`:

```bash
node --test scripts/runtime-pr-metadata.test.mjs scripts/runtime-documentation.test.mjs
```

Closed PR label changes do not run this gate. For an explicit historical check, dispatch this workflow from `main` with a positive `pull_request_number`, for example:

```bash
gh workflow run pr-metadata.yml --ref main -f pull_request_number=6
```

The manual run reads current GitHub labels and records the actual PR head, including for a closed temporary-base fixture. It does not rerun application acceptance, replace historical SHA-bound results or invent a green status on an old failed run. A new managed label must be added to the shared catalogue before use. External contributors can suggest labels in the description; a maintainer applies them. Workflow changes themselves still need review.

External authors normally cannot label a PR. Include proposed labels in the description; a Maintainer applies them. Missing metadata must not be concealed behind an invented successful status. Workflow changes also need review because normal PR workflows execute the proposed source.

All eleven original PRs (#1–#11) were initially read back and classified. During parallel work the repository grew to 19 PRs and five new area labels plus `merge:hold`. The source catalogue now includes those actual live labels so the existing validator accepts the current classifications. Labels and their meanings are preserved; a stop label is not removed merely to make a PR mergeable.

The 36 managed entries are eight types, 24 areas, three risk levels and `merge:hold`; the latter is a review stop, not permission or a replacement for those categories. Keep it until its stated concern is addressed. The five specific areas cover API contracts, security, performance, accessibility and design. Classify actual diffs and preserve existing accurate labels; historical/current audits and check results are in [WORKLOG](WORKLOG.md) and [QA_RESULTS](QA_RESULTS.md).

## Git tags and development packages

Labels classify issues and PRs; Git tags identify immutable commits. Existing signed annotated development milestones include:

| Tag                                 | Accepted merge commit                      | Scope                                                                                  |
| ----------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `milestone/m3-accounts-commission`  | `00db7c9630dbf413000feab7ec7e0c2f56cb5b3a` | Accounts, profiles, clients and revenue allocation; PR #3.                             |
| M4 building-block checkpoint        | `b9cdcc89758451bc8258f3a9f173e95ee1a23736` | Building-block templates, avatars and comments; PR #4.                                 |
| `milestone/m5-system-audit`         | `bb322746d3cf18b1a0f1eae0eaa96450d26e26cd` | Functional and performance corrections; PR #5.                                         |
| `milestone/m6-connected-operations` | `dc8e9a7e65c96076038bf7067791676578d121d4` | Taxonomy, availability, lifecycle/capacity, dashboard, notifications and audit; PR #8. |

These tags are development acceptance markers, not production approval or semantic versions. Do not move or replace published tags. The existing `cms-dev-*` tags belong to immutable development releases after successful main CI; pushing a `milestone/*` tag does not trigger those release jobs. [Changelog](../CHANGELOG.md) records user-visible changes; [roadmap](../ROADMAP.md) records remaining work.

## Public and private reports

Use English for new issues, pull requests and contributor-facing documentation. Application interfaces remain German/English and authored content retains its language. Use the [issue chooser](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/issues/new/choose) for ordinary bugs, features and questions. Blank issues are disabled in that UI in favour of structured forms; this is not an Issue API access restriction.

Private vulnerability reporting is enabled; follow [SECURITY](../SECURITY.md). Secret Scanning and Push Protection were separately enabled and read back in the earlier quality task; private reporting alone would not enable them. No new App, key, paid service, invitation, real email or hosting/production change was made in this documentation task.
