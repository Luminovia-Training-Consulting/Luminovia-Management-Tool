# Creating, reviewing and merging pull requests

> Status read back on 16 November 2026 after 02:33 UTC: review and required-check rules are active. Maintainers and administrators may bypass independent review through a PR, but must wait for all nine required checks against the current base. The maintenance App has a separate `always` exception. [Current rule and App delivery status](GITHUB_WORKFLOW.md#activation-still-pending).

This guide explains how a change is accepted. Setup and local development are covered in [CONTRIBUTING](../CONTRIBUTING.md) and [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md); reports start with the [issue guide](ISSUE_GUIDE.md). Please write new pull requests and contribution discussions in English. The product interface remains bilingual in German and English.

The contribution guides were delivered through [PR #6](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/6) (`18ce633`), and the separate local GitHub preview launcher through [PR #7](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/7) (`5f89986`). These historical merges did not themselves activate server-side review rules; the current live activation is described below. The source catalogue [labels.json](../.github/labels.json) now contains 30 managed labels; nine original GitHub labels are also preserved.

## Branch and title

Create a branch from the current `main`; external contributors use a fork. Keep each pull request focused on one related problem. Agent branches start with `codex/`. An early draft is useful when you need feedback before the implementation is ready for review.

Choose a title that describes the outcome, such as `fix: keep accepted fee when editing a course` or `docs: explain private file permissions`. A prefix helps readers but does not replace a label. Commits should be signed and clearly describe their changes.

## Pull request description

Complete the pull request template. Describe the concrete problem and the resulting behaviour. Link the issue with `Closes #123` when its goal is fully met; otherwise use `Refs #123`.

List the checks you actually ran, including commands and results. State when a check was not run and explain why. Adding a test does not prove that it passed. Distinguish local checks, CI, native Supabase verification and actual hosted acceptance.

For visible changes, include fictional desktop and mobile screenshots covering German and English, light and dark themes. For database changes, explain migrations, existing data, RLS/grants and recovery. Keep published migrations unchanged; add another migration for new changes.

## Pull request labels

Every pull request needs **exactly one type label**, **at least one area label** and **exactly one risk label**. `PR metadata` validates these categories. Existing general GitHub labels remain available; `bug` or `documentation` alone does not satisfy the pull request categories.

| Type                | Use                                                                                  |
| ------------------- | ------------------------------------------------------------------------------------ |
| `type:fix`          | Correct a defect in delivered behaviour                                              |
| `type:feature`      | Add new product behaviour                                                            |
| `type:docs`         | Update guides or reference documentation                                             |
| `type:refactor`     | Improve structure while preserving intended behaviour                                |
| `type:tests`        | Improve tests without changing product behaviour                                     |
| `type:maintenance`  | Maintain runtime, build or repository tooling                                        |
| `type:security`     | Coordinate a security fix; never use a public PR as the initial vulnerability report |
| `type:dependencies` | Update reviewed dependencies                                                         |

Choose every area that is materially affected. The original area labels remain available: `area:frontend`, `area:backend`, `area:database`, `area:auth`, `area:files`, `area:finance`, `area:courses`, `area:devops` and `area:github`. Ten additional areas provide more specific classifications:

| Area                 | Use                                                     |
| -------------------- | ------------------------------------------------------- |
| `area:chat`          | Messages, course/interest groups and Realtime           |
| `area:knowledge`     | Wiki, forum and knowledge management                    |
| `area:calendar`      | Events, availability, blocked time and time zones       |
| `area:notifications` | Inbox, notices and delivery preferences                 |
| `area:profiles`      | Profiles, qualifications and lecturer directory         |
| `area:clients`       | Client accounts, organisations and business contacts    |
| `area:pwa`           | Installation, service worker, offline state and updates |
| `area:testing`       | QA, regressions, browser and permission checks          |
| `area:docs`          | Guides, API references and operational documentation    |
| `area:taxonomy`      | Topics, tools, programming languages and hierarchies    |

A documentation change receives `area:docs` and any relevant documented area; general contribution rules also use `area:github`. A test does not need every label used by the whole system. A feature with a migration should include the product and technical areas it actually changes. The 30 managed labels comprise eight types, 19 areas and three risk levels; additional original GitHub labels do not replace a required category.

| Risk          | Meaning                                                                                             |
| ------------- | --------------------------------------------------------------------------------------------------- |
| `risk:low`    | A narrowly scoped change with limited impact, such as a corrected guide                             |
| `risk:medium` | Changed behaviour or several connected components with bounded effects                              |
| `risk:high`   | Permissions, authentication, money, migrations, data loss/recovery or similarly significant effects |

For example, a documentation correction can use `type:docs`, `area:github`, `risk:low`. A booking fix with a migration may need `type:fix`, `area:backend`, `area:database`, `area:courses`, `risk:high`. A label does not authorise deployment or replace verification.

External contributors usually cannot manage labels. Suggest the appropriate values in your description and a maintainer will apply them. Until then, `PR metadata` may report missing labels. Update the classification when scope or risk changes. Pull requests by `CarinaSchoppe` also need the required labels.

## Required evidence

| Change             | Relevant evidence                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| Bug fix            | Reproducible failure, meaningful regression test and corrected failure path                           |
| UI/form            | Component/browser checks, keyboard and mobile use, DE/EN, loading/error/empty states                  |
| API/permissions    | Real calls by separate accounts, allowed and denied access, revoked permissions and existing sessions |
| Database/booking   | Fresh and retained data, constraints/RLS/grants, atomic failures and real concurrency                 |
| Files/avatars      | Versions, scanning, bytes, permissions/revocation, failed requests and cache lifecycle                |
| Runtime/deployment | Targeted process/configuration checks, retained data, safe recovery and existing operator boundaries  |
| Documentation      | Working links, accurate commands and clear separation of tested and pending work                      |

Run targeted checks during development. The complete local acceptance command is `./portal test`. CI also requires the separate native Supabase verification. Use fictional data and do not publish raw traces, credentials or private database/file backups.

Use `./portal github test` for an independent test of current `main`. `./portal github` instead starts a separate persistent preview on `5373`/`563xx`; it changes neither normal development nor the PR branch. A passing check of `main` does not prove acceptance of a different PR head. See [preview, persistence and migration controls](GITHUB_LOCAL_PREVIEW.md).

## Review rules for `main`

The active contributor rules require a pull request and at least one approval from another authorised person. Self-approval does not count as independent review; new changes dismiss old approvals. Approval of the latest push must come from someone other than its pusher. Resolve review conversations before merging and address feedback against current code.

Maintainers and administrators have a role-based `pull_request` exception on the review rule. They may bypass independent review when merging a PR, including their own PR. This exception does not allow direct pushes to `main` or bypass the separate required-check rule. Ordinary write access alone grants no review exception. GitHub may require an explicit bypass action in the merge dialog.

All nine required checks must pass against the current base:

- `Build`, `Typecheck`, `Lint`, `Formatting` and `Code quality` check compilation, rules, style and actual source connections.
- `Tests and coverage` runs unit/component tests with complete frontend source coverage reporting and enforced thresholds.
- `verify` runs the complete real application/SQL/API/browser/PWA/maintenance suites; `Actual isolated selfhost image compatibility` checks real runtime behaviour and retained data.
- `PR metadata` checks required labels. CodeQL analyses security patterns in a separate workflow; it is not one of these nine required statuses. See [CI_QUALITY](CI_QUALITY.md).

If main changes, update the PR as required and wait for checks against the current base. The history ruleset's Maintainer/Admin `always` exception does not override the separate active review/check rules. The maintenance App, integration `5776881`, has its own `always` exception on those two rules. Server-side activation and that exception do not prove the App workflow is already delivered on main; see the [current rule and App delivery status](GITHUB_WORKFLOW.md#activation-still-pending).

## Merge and publication

Maintainers and administrators can merge a PR without an independent approval through their review exception once the nine required checks and current-base requirement are satisfied. Check the description, labels, tests and unresolved conversations first. Pending operational approvals remain separate from repository merge eligibility.

A merge can start the existing development release process. Its immutable `cms-dev-*` packages and hosted migration checks remain separate. Production operation, real data, SMTP, DNS and risky maintenance need the appropriate separate approvals. Claim a hosted installation only when actual operational evidence exists.

Signed annotated `milestone/*` tags identify verified historical development states. They are not PR labels or a promise of a Semver or production version. Do not move existing tags; create tags only on the intended commit.

After merging, update the issue resolution when needed and track remaining tasks separately. A new task must not silently expand the original acceptance criteria or be described as already completed.
