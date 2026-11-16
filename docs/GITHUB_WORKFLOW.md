# GitHub administration and contribution workflow

Start with [CONTRIBUTING](../CONTRIBUTING.md), the [issue guide](ISSUE_GUIDE.md), [pull-request guide](PULL_REQUEST_GUIDE.md) and [documentation index](README.md). The public Luminovia Website repository is a separate read-only brand reference.

<a id="rules-for-main"></a>

## Active rule layers

The user's final instruction is precise: **Maintain and Repository-admin accounts may merge through PRs without another person's review; CI and signatures remain mandatory.** Source configurations under `.github/rulesets/` record the live readback. Committing JSON does not activate a rule: the [server rules](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules) are authoritative. Activation at 02:33 UTC and strengthening at 02:45 UTC on 16 November 2026 supersede earlier disabled-rule and unrestricted-human-bypass snapshots. This documentation integration makes no server change.

| Layer                 | Live ID    | Source                                           | Exceptions                                                                                                                                                                  |
| --------------------- | ---------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| History and integrity | `27315671` | [history.json](../.github/rulesets/history.json) | None.                                                                                                                                                                       |
| PRs and review        | `27329000` | [review.json](../.github/rulesets/review.json)   | Maintain (`RepositoryRole:2`) and Repository admin (`RepositoryRole:5`) through PRs only; private maintenance App `5776881` with `always` for scoped technical maintenance. |
| Verified checks       | `27329142` | [checks.json](../.github/rulesets/checks.json)   | Only private maintenance App `5776881` with `always`; no human-role bypass.                                                                                                 |

All three rulesets are active. The history layer preserves deletion protection, non-fast-forward protection, valid signatures, the existing deployment rule (with an empty environment list) and code-quality errors. A maintainer review exception does not bypass this separate layer or CI. Ordinary contributors still require independent approval, current last-push approval and the other configured review conditions. A PR-only exception requires a PR; it also bypasses the other conditions within that particular review ruleset.

The actual GitHub rule UI displayed **Maintain** and **Repository admin**, while the corresponding API returned IDs `2` and `5`. The official REST schema supports `RepositoryRole` with `bypass_mode: pull_request` but does not publish a numeric built-in-role table. [REST schema](https://docs.github.com/en/rest/repos/rules?apiVersion=2026-03-10#update-a-repository-ruleset), [rule layering](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets#about-rule-layering), [documented schema gap](https://github.com/github/rest-api-description/issues/7111).

## Required checks and Auto-Merge

The first 13 of 14 required contexts are bound to GitHub Actions integration `15368`:

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

The fourteenth, generated `CodeQL` finding check, is bound to integration `57789`. Successful scanner jobs alone do not satisfy that separately generated findings result. All 14 remain compulsory for human merges.

Checks require an up-to-date base and are not waived on branch creation. CodeQL and Dependency Review are required merge checks; their separate relationship to development publication is described in [CI_QUALITY](CI_QUALITY.md). The release job continues to use its explicit `ci.yml` dependencies, and the development installer requires successful exact-main CI. The earlier PR11 direct merge while checks ran proved the former configuration, not a bypass of the current required-check rule. Passing a scan is not a claim that all warnings have disappeared.

Repository `allow_auto_merge` is enabled. Auto-Merge is selected per suitable PR and waits for the active rules; it is not an approval or a test bypass. For the reviewed exact head:

```bash
gh pr merge NUMBER --repo Luminovia-Training-Consulting/Luminovia-Management-Tool \
  --auto --merge --match-head-commit EXACT_HEAD_SHA
```

Use the actual PR number and full head SHA. Maintainer review exceptions do not turn failed or missing CI checks into success. Never disable checks to make a merge finish.

<a id="activation-still-pending"></a>

## Current enforcement and maintenance path

The legacy fragment above remains for previously published links. Review and check enforcement are now **active**, as confirmed by both ruleset details and the effective-main endpoint. The three source JSON files were synchronized to that readback without a remote mutation.

The earlier actual [protected-branch probe](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43755067933) showed the standard token's bot-user bypass was insufficient. The private maintenance App is a different integration (`5776881`, selected installation `182397724`); the active rules now grant that exact App bypass. GitHub Actions `15368` identifies the required check producer, not the maintenance bypass actor.

Actual App registration, scoped configuration and the protected token/signature proof are recorded below. They do not establish that the new main-only workflow has been delivered or run. This task records the live exception without expanding App permissions. Preserve the repository-scoped short-lived-token path, successful full verification and signed/base-bound promotion checks; do not substitute a broadly privileged personal token or assume standard `GITHUB_TOKEN` now bypasses the rules. Earlier disabled-state entries in historical work logs describe their recorded time.

Read-only checks, using an authenticated account with access:

```bash
gh api repos/Luminovia-Training-Consulting/Luminovia-Management-Tool/rulesets
gh api repos/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules/branches/main
gh api repos/Luminovia-Training-Consulting/Luminovia-Management-Tool/rulesets/27315671
```

The effective branch endpoint returns active rules; inspect the individual ruleset to see its bypass actors. Organisation-wide administration was not available with the existing token in the earlier audit; no organisation or other repository policy change is claimed. See GitHub's [ruleset and bypass documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository) and [rules API](https://docs.github.com/en/rest/repos/rules).

## Repository-scoped maintenance App

The user approved the private **Luminovia Portal Maintenance** App and completed GitHub's Sudo authentication. Actual configuration:

- Slug `luminovia-portal-maintenance`, App ID `5776881`.
- Installation `182397724`, selected repository `1458712437` only: `Luminovia-Training-Consulting/Luminovia-Management-Tool`.
- Repository `contents: write`, `actions: write`, mandatory `metadata: read`; no additional administration, workflow-file, organisation, OAuth or webhook permissions.
- Private key in encrypted environment secret `MAINTENANCE_APP_PRIVATE_KEY`; non-secret environment variable `MAINTENANCE_APP_ID`.
- Environment `maintenance-signing` permits the exact **main branch only**, not arbitrary branches or tags. There is no repository-wide App-key secret.
- Privileged jobs verify exact repository, main ref, App ID and App slug; ordinary job tokens stay read-only. App tokens are scoped to this one repository and automatically revoked.

A first unconsumed App-key download was replaced and explicitly revoked with the user's approval. The remaining key was authenticated and protected outside Git. No laptop SSH key was changed, and no key material or private storage path belongs in this documentation.

The normal Actions bot cannot obtain the dedicated App's rule exception. The earlier protected-bot attempt [43755067933](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43755067933) failed and its temporary rule/branch were removed. A broad human-role exception is not a substitute for the App.

## Actual proof and remaining workflow gate

A real repository-only App token passed the actual temporary-branch signature helper under required review and an intentionally absent check. An independent signature rule had **no bypass**. GitHub verified commit `003a597c90b98c964df25aa8f5d148bf7b2d233e` as `verified: true`, `reason: valid`. The equivalent direct human write was rejected. Main stayed exactly `9c2103b`; all owned temporary rules, branches and the token were cleaned. [Machine-readable evidence](maintenance-app-protected-probe.json).

The three live rules have subsequently been activated and read back with the user's maintainer-only review correction. **The new App workflow still needs the tested product merge and its actual main-only workflow probe.** Registration, a configured secret and a local App-token proof do not establish that the new main workflow has run. If an older maintenance run cannot promote under the tightened rules, preserve its diagnostics and rerun the new workflow after the merge; do not restore a CI/signature bypass.

After the new workflow reaches main:

```bash
gh workflow run daily-maintenance.yml \
  --repo Luminovia-Training-Consulting/Luminovia-Management-Tool \
  --ref main -f signature_probe_only=true
```

Observe the actual run and its cleanup. Candidate and combined verification precede maintenance promotion; exact-main application and retained-data checks still gate the development release. This mechanism is not production deployment approval. [Maintenance controls](HOSTINGER_AUTOMATIC_UPDATES.md).

<a id="labels-and-historical-prs"></a>

## Labels and metadata validation

[labels.json](../.github/labels.json) contains 36 managed labels. Nine original GitHub labels remain available. Each PR needs exactly one `type:*`, exactly one `risk:*` and at least one `area:*`. Additional labels outside those three namespaces are allowed; unknown values in the three managed categories are rejected. See [label selection](PULL_REQUEST_GUIDE.md#pull-request-labels).

The [metadata workflow](../.github/workflows/pr-metadata.yml) responds to changes on open PRs through the ordinary `pull_request` event. It explicitly checks out `refs/heads/main` from this repository, so current labels are checked against the current shared catalogue rather than an obsolete contribution snapshot. It never checks out or executes contribution code, installs dependencies or uses secrets. Permissions remain only `contents: read` and `pull-requests: read`; no elevated event is needed. Repository, PR number and live head identity are validated; titles, bodies and labels remain data. Its regression tests are discovered automatically by `./portal test`:

The [metadata workflow](../.github/workflows/pr-metadata.yml) also responds to label changes. It reads the current labels, checks repository/PR/head identity and treats all text as data. It installs no dependencies and requests only `contents: read` and `pull-requests: read`. Its regressions are discovered by `./portal test`:

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
| `milestone/m4-cbw-templates`        | `b9cdcc89758451bc8258f3a9f173e95ee1a23736` | Building-block templates, avatars and comments; PR #4.                                 |
| `milestone/m5-system-audit`         | `bb322746d3cf18b1a0f1eae0eaa96450d26e26cd` | Functional and performance corrections; PR #5.                                         |
| `milestone/m6-connected-operations` | `dc8e9a7e65c96076038bf7067791676578d121d4` | Taxonomy, availability, lifecycle/capacity, dashboard, notifications and audit; PR #8. |

These tags are development acceptance markers, not production approval or semantic versions. Do not move or replace published tags. The existing `cms-dev-*` tags belong to immutable development releases after successful main CI; pushing a `milestone/*` tag does not trigger those release jobs. [Changelog](../CHANGELOG.md) records user-visible changes; [roadmap](../ROADMAP.md) records remaining work.

## Public and private reports

Use English for new issues, pull requests and contributor-facing documentation. Application interfaces remain German/English and authored content retains its language. Use the [issue chooser](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/issues/new/choose) for ordinary bugs, features and questions. Blank issues are disabled in that UI in favour of structured forms; this is not an Issue API access restriction.

Private vulnerability reporting is enabled; follow [SECURITY](../SECURITY.md). Secret Scanning and Push Protection were separately enabled and read back in the earlier quality task; private reporting alone would not enable them. No new App, key, paid service, invitation, real email or hosting/production change was made in this documentation task.
