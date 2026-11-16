# GitHub administration and contribution workflow

Start with [CONTRIBUTING](../CONTRIBUTING.md), the [issue guide](ISSUE_GUIDE.md) and [pull request guide](PULL_REQUEST_GUIDE.md). Public contribution guidance and new discussions use English; the application interface remains German and English. The public Luminovia Website repository is a separate read-only brand reference.

<a id="rules-for-main"></a>

## Active rule layers

All three `main` rulesets were read back as **active** on 16 November 2026. Source configurations under `.github/rulesets/` mirror that readback. Committing JSON does not activate a rule: the [server rules](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules) are authoritative. Earlier disabled-rule, unrestricted-human-bypass and App-exception snapshots describe their recorded time. This reconciliation changes no server settings.

| Layer                 | Live ID    | Source                                           | Exceptions                                                                                |
| --------------------- | ---------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| History and integrity | `27315671` | [history.json](../.github/rulesets/history.json) | None.                                                                                     |
| PRs and review        | `27329000` | [review.json](../.github/rulesets/review.json)   | Maintain (`RepositoryRole:2`) and Repository admin (`RepositoryRole:5`) through PRs only. |
| Verified checks       | `27329142` | [checks.json](../.github/rulesets/checks.json)   | None.                                                                                     |

The history layer preserves deletion protection, non-fast-forward protection, valid signatures, the existing deployment rule with an empty environment list and code-quality errors. The review layer requires a PR, one independent approval, current last-push approval and resolved conversations. New pushes dismiss old approvals; code-owner review is not required. The PR-only role exception applies within the review layer, so a maintainer or administrator can merge their own PR without a separate approving review. It grants neither direct-main push permission nor a required-check or history exception. Ordinary Write access has no review exception. Administrators retain permission to edit settings; these rules govern normal push and merge operations.

## Required checks and merge controls

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

The remaining generated `CodeQL` findings check is bound to integration `57789`. Successful scanner jobs alone do not satisfy that separate findings result. All fifteen checks are compulsory for every identity, require an up-to-date base and are not waived on branch creation. [CI quality](CI_QUALITY.md) explains the separate unit, application, retained-data and security evidence. A successful scan does not establish that all findings are fixed.

Repository `allow_auto_merge` is enabled. Native Auto-Merge waits for applicable requirements; use it only within the task's authorized merge scope. Preserve coordinated holds and `merge:hold`, and verify the exact current head and base before merging. A maintainer review exception does not make missing or failed checks pass. Do not disable checks to make a merge finish. No collaborator or repository role was added by this reconciliation.

<a id="activation-still-pending"></a>

## Current enforcement and maintenance path

The legacy fragment above is retained for published links; rule activation is complete. Required-check and history/signature rules have no bypass actors. The review rule has only the two human PR-only role exceptions. Maintenance App `5776881` has no review, check or history exception. GitHub Actions `15368` and CodeQL `57789` identify check producers, not bypass actors.

Current main contains daily component discovery, candidate verification and a promotion helper. These files do not prove that direct-main promotion can succeed under today's rules. It must fail closed if protection prevents it; do not restore an App exception or substitute a broadly privileged personal token. A replacement path must use a signed PR with the applicable review and exact-head checks. App registration or historical token/signature tests do not establish source delivery or successful operation under the current policy. See the [maintenance runbook](HOSTINGER_AUTOMATIC_UPDATES.md) for revision-specific evidence.

Read-only checks, using an authenticated account with access:

```bash
gh api repos/Luminovia-Training-Consulting/Luminovia-Management-Tool/rulesets
gh api repos/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules/branches/main
gh api repos/Luminovia-Training-Consulting/Luminovia-Management-Tool/rulesets/27315671
gh api repos/Luminovia-Training-Consulting/Luminovia-Management-Tool/rulesets/27329000
gh api repos/Luminovia-Training-Consulting/Luminovia-Management-Tool/rulesets/27329142
```

The effective branch endpoint returns active rules; inspect individual rulesets for bypass actors. See GitHub's [ruleset documentation](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository) and [rules API](https://docs.github.com/en/rest/repos/rules). This repository readback makes no claim about organization-wide rules or other repositories.

## Local work and publication status

Develop and verify locally by default. The user has requested explicit manual publication. That implementation is proposed in open [PR #27](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/27); it is not yet merged and is not installed by this documentation reconciliation.

Current `main` still runs CI for PRs and main pushes, publishes a development release after its explicit quality/coverage/application/selfhost dependencies pass, and records local PR-preview artifacts through a separate trusted publisher. The separate Security outcomes are required for PR merging but are not added to the release job's `needs` by the ruleset. The existing VPS installer independently requires successful exact-main CI. A merge can therefore trigger the existing development publication path until the replacement is delivered. Passing tests or merging provides no new authorization for publication, production operations or risky data changes. Do not dispatch a publication or deployment while reviewing this guidance.

## PR preview packages and deployment records

After complete quality, coverage, application and native acceptance, PRs produce a seven-day source package for a complete local preview. A separate trusted default-branch publisher updates GitHub Deployments using actual current PR, workflow and artifact metadata. Contribution code receives no write token or hosting secrets. The deployment URL opens the downloadable package; successful publication does not claim a hosted website. Closed, superseded and expired previews become inactive. The packaged launcher uses owned local database identities and distinct ports. Current main publishes these metadata records automatically; the requested explicit-publication replacement remains pending in PR #27. See [PR previews](PR_PREVIEWS.md) for permissions, local operation and first activation.

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

## Git tags and development packages

Labels classify issues and PRs; Git tags identify immutable commits. Existing signed annotated development milestones include:

| Tag                                 | Accepted merge commit                      | Scope                                                                                  |
| ----------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------- |
| `milestone/m3-accounts-commission`  | `00db7c9630dbf413000feab7ec7e0c2f56cb5b3a` | Accounts, profiles, clients and revenue allocation; PR #3.                             |
| `milestone/m4-cbw-templates`        | `b9cdcc89758451bc8258f3a9f173e95ee1a23736` | Building-block templates, avatars and comments; PR #4.                                 |
| `milestone/m5-system-audit`         | `bb322746d3cf18b1a0f1eae0eaa96450d26e26cd` | Functional and performance corrections; PR #5.                                         |
| `milestone/m6-connected-operations` | `dc8e9a7e65c96076038bf7067791676578d121d4` | Taxonomy, availability, lifecycle/capacity, dashboard, notifications and audit; PR #8. |

These tags are development acceptance markers, not production approval or semantic versions. Do not move or replace published tags. Current `main` publishes immutable `cms-dev-*` development releases after successful main CI; pushing a `milestone/*` tag does not trigger those release jobs. The manual-only replacement is requested but remains pending in PR #27. [Changelog](../CHANGELOG.md) records user-visible changes; [roadmap](../ROADMAP.md) records remaining work.

## Public and private reports

Use English for new issues, pull requests and contributor-facing documentation. Application interfaces remain German/English and authored content retains its language. Use the [issue chooser](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/issues/new/choose) for ordinary bugs, features and questions. Blank issues are disabled in that UI in favour of structured forms; this is not an Issue API access restriction.

Private vulnerability reporting is enabled; follow [SECURITY](../SECURITY.md). Secret Scanning and Push Protection were separately enabled and read back in the earlier quality task; private reporting alone would not enable them. No new App, key, paid service, invitation, real email or hosting/production change was made in this documentation task.
