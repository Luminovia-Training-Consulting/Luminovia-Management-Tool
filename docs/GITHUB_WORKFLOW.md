# GitHub administration and contribution workflow

Start with [CONTRIBUTING](../CONTRIBUTING.md), the [issue guide](ISSUE_GUIDE.md), [pull-request guide](PULL_REQUEST_GUIDE.md) and [documentation index](README.md). The public Luminovia Website repository is a separate read-only brand reference.

## Active rule layers

The user's final instruction is precise: **Maintain and Repository-admin accounts may merge through PRs without another person's review; CI and signatures remain mandatory.** Source configurations under `.github/rulesets/` match the live rules read back after applying that correction.

| Layer                 | Live ID    | Source                                           | Exceptions                                                                                                                                             |
| --------------------- | ---------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| History and integrity | `27315671` | [history.json](../.github/rulesets/history.json) | None.                                                                                                                                                  |
| PRs and review        | `27329000` | [review.json](../.github/rulesets/review.json)   | Maintain (`RepositoryRole:2`) and Repository admin (`RepositoryRole:5`) through PRs only; private maintenance App `5776881` for technical maintenance. |
| Verified checks       | `27329142` | [checks.json](../.github/rulesets/checks.json)   | Only private maintenance App `5776881`; no human-role bypass.                                                                                          |

All three rulesets are active. The history layer preserves deletion protection, non-fast-forward protection, valid signatures, the existing deployment rule and code-quality errors. A maintainer review exception does not bypass this separate layer or CI. Ordinary contributors still require independent approval, current last-push approval and the other configured review conditions. A PR-only exception requires a PR; it also bypasses the other conditions within that particular review ruleset.

The actual GitHub rule UI displayed **Maintain** and **Repository admin**, while the corresponding API returned IDs `2` and `5`. The official REST schema supports `RepositoryRole` with `bypass_mode: pull_request` but does not publish a numeric built-in-role table. [REST schema](https://docs.github.com/en/rest/repos/rules?apiVersion=2026-03-10#update-a-repository-ruleset), [rule layering](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/about-rulesets#about-rule-layering), [documented schema gap](https://github.com/github/rest-api-description/issues/7111).

## Required checks and Auto-Merge

All nine required contexts are bound to GitHub Actions integration `15368`:

- Build
- Typecheck
- Lint
- Formatting
- Code quality
- Tests and coverage
- verify
- Actual isolated selfhost image compatibility
- PR metadata

Checks require an up-to-date base and are not waived on branch creation. Independent CodeQL and Dependency Review are additional security signals; their exact publication relationship is described in [CI_QUALITY](CI_QUALITY.md). Passing a scan is not a claim that all warnings have disappeared.

Repository `allow_auto_merge` is enabled. Auto-Merge is selected per suitable PR and waits for the active rules; it is not an approval or a test bypass. For the reviewed exact head:

```bash
gh pr merge NUMBER --repo Luminovia-Training-Consulting/Luminovia-Management-Tool \
  --auto --merge --match-head-commit EXACT_HEAD_SHA
```

Use the actual PR number and full head SHA. Maintainer review exceptions do not turn failed or missing CI checks into success. Never disable checks to make a merge finish.

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

## Labels and historical PRs

The managed catalogue contains **35 labels**: eight types, 24 areas and three risk levels; nine original GitHub labels are preserved. The five new areas cover API contracts, security, performance, accessibility and design. Each PR needs exactly one `type:*`, exactly one `risk:*` and at least one relevant `area:*`. Add areas from the actual diff and preserve existing labels. Status labels and inflated label counts are not substitutes for review or tests.

The [PR guide](PULL_REQUEST_GUIDE.md) explains classification. Historical/current label audits and actual check results are recorded in [WORKLOG](WORKLOG.md) and [QA_RESULTS](QA_RESULTS.md).
