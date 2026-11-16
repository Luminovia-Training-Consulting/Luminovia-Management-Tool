# Creating, reviewing and merging pull requests

> Status verified on 16 November 2026: all three `main` rulesets are active. Every change requires a PR, including maintenance-App changes. Maintainers/admins may bypass review through a PR only; nobody can bypass the 14 mandatory CI/security checks or up-to-date testing. The maintenance App has no rule exception. [Live rules](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules).

This guide explains how a change is accepted. Setup and local development are covered in [CONTRIBUTING](../CONTRIBUTING.md) and [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md); reports start with the [issue guide](ISSUE_GUIDE.md). Please write new pull requests and contribution discussions in English. The product interface remains bilingual in German and English.

The contribution guides were delivered through [PR #6](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/6) (`18ce633`), and the separate local GitHub preview launcher through [PR #7](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/7) (`5f89986`). Those historical merges did not themselves activate server-side rules; all three protection policies are now active, as recorded in [GitHub administration](GITHUB_WORKFLOW.md). The source catalogue [labels.json](../.github/labels.json) now contains 35 managed labels; nine original GitHub labels are also preserved.

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

Choose every area that is materially affected. The original area labels remain available: `area:frontend`, `area:backend`, `area:database`, `area:auth`, `area:files`, `area:finance`, `area:courses`, `area:devops` and `area:github`. Additional areas provide more specific classifications:

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
| `area:api`           | API and RPC contracts and integration clients           |
| `area:security`      | Authorization, protected data and security hardening    |
| `area:performance`   | Loading, query budgets, caching and runtime performance |
| `area:accessibility` | Keyboard access, accessible controls and WCAG checks    |
| `area:design`        | Luminovia branding, layout and visual design            |

A documentation change receives `area:docs` and any relevant documented area; general contribution rules also use `area:github`. A test does not need every label used by the whole system. A feature with a migration should include the product and technical areas it actually changes. The 35 managed labels comprise eight types, 24 areas and three risk levels; additional original GitHub labels do not replace a required category. Add new managed labels to the shared catalogue before applying them. [Metadata operation and historical rechecks](GITHUB_WORKFLOW.md#labels-and-metadata-validation).

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

Every change to `main` requires a pull request. Ordinary contributors and the maintenance App need at least one independent approval, approval of the latest push and resolved review conversations. Self-approval does not count; new changes dismiss stale approvals. Maintainers and administrators may bypass review requirements while merging a PR. They cannot push directly to `main` or bypass required checks. The maintenance App has no exception.

All 14 mandatory checks must pass for the current revision and the PR must be up to date with `main`:

- `Build`, `Typecheck`, `Lint`, `Formatting` and `Code quality` check compilation, rules, style and actual source connections.
- `Tests and coverage` runs unit/component tests with complete frontend source coverage reporting and enforced thresholds.
- `verify` runs the complete real application/SQL/API/browser/PWA/maintenance suites; `Actual isolated selfhost image compatibility` checks real runtime behaviour and retained data.
- `PR metadata` checks required labels.
- `CodeQL (javascript-typescript)`, `CodeQL (python)`, `CodeQL (actions)`, `Dependency review` and the generated `CodeQL` findings check enforce the security gates. See [CI_QUALITY](CI_QUALITY.md).

Missing, pending or failed required checks block merges for everyone. A newer main revision requires updating the PR and obtaining current test evidence again. The live server rules enforce this; source JSON alone is not proof of activation.

Daily maintenance uses a signed separate branch and a PR labelled `type:dependencies`, `area:devops` and `risk:high`. Requesting native auto-merge queues the PR until its independent review and required checks are satisfied. The [operational setup status](GITHUB_WORKFLOW.md#activation-still-pending) distinguishes implemented source from tested App permissions and a real workflow run.

## Merge and publication

Review the description, labels, tests and open conversations before merging. Use the regular PR merge operation or native auto-merge. GitHub enforces all mandatory checks even when a maintainer or administrator uses the PR-only review exception; direct branch updates are prohibited.

A merge can start the existing development release process. Its immutable `cms-dev-*` packages and hosted migration checks remain separate. Production operation, real data, SMTP, DNS and risky maintenance need the appropriate separate approvals. Claim a hosted installation only when actual operational evidence exists.

Signed annotated `milestone/*` tags identify verified historical development states. They are not PR labels or a promise of a Semver or production version. Do not move existing tags; create tags only on the intended commit.

After merging, update the issue resolution when needed and track remaining tasks separately. A new task must not silently expand the original acceptance criteria or be described as already completed.
