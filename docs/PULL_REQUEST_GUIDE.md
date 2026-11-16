# Creating, reviewing and merging pull requests

> Live policy verified on 16 November 2026: all 15 checks and signatures are mandatory without CI/history bypass. Only `CarinaSchoppe` (user `29256704`) has a personal PR-only review exception; Maintain/Admin roles and the App have none. The native controller remains prepared until its own exact-source CI, merge and default-branch execution. [Current rules and delivery status](GITHUB_WORKFLOW.md#rules-for-main).

This guide explains how a change is accepted. Setup and local development are covered in [CONTRIBUTING](../CONTRIBUTING.md) and [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md); reports start with the [issue guide](ISSUE_GUIDE.md). Please write new pull requests and contribution discussions in English. The product interface remains bilingual in German and English.

The contribution guides were delivered through [PR #6](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/6) (`18ce633`), and the separate local GitHub preview launcher through [PR #7](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/7) (`5f89986`). Historical guide merges do not prove current controller delivery. The source catalogue [labels.json](../.github/labels.json) contains 36 managed labels; nine original GitHub labels are also preserved.

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

A documentation change receives `area:docs` and any relevant documented area; general contribution rules also use `area:github`. A test does not need every label used by the whole system. A feature with a migration should include the product and technical areas it actually changes. The 36 managed labels comprise eight types, 24 areas, three risk levels and the independent `merge:hold` pause; additional original GitHub labels do not replace a required category. Add new managed labels to the shared catalogue before applying them. [Metadata operation and historical rechecks](GITHUB_WORKFLOW.md#labels-and-metadata-validation).

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

The active ordinary review path requires an independent approval of the exact current head, latest-push approval and resolved conversations. A changed head invalidates earlier approval. All 15 required checks must pass against the applicable current base; neither people nor Apps have a check or history/signature bypass. [Exact contexts and producer Apps](GITHUB_WORKFLOW.md#required-checks-and-native-auto-merge).

Only `CarinaSchoppe` (immutable user ID `29256704`) may use the personal PR-only review exception when performing a native PR merge. It does not follow the PR author or a repository role, and grants no direct-main write or required-check bypass. Maintain/Admin roles, ordinary writers and the maintenance App have no review exception. The automatic controller still requires the ordinary reviewed path for every candidate, including Carina-authored work.

The prepared [verified native controller](AUTO_MERGE.md) requires independent current-head approval and GitHub's native `clean` state for **all** candidates. A human author's role grants the App no exemption. The reviewer must have current writer/admin authority and be independent of the author and any proven source pusher. Actual source pushes are bound to the exact CI check suite; a workflow actor, retry/reopen event or commit email is not push authority. Missing push evidence grants no exemption; contradictory evidence blocks the candidate.

Keep unfinished work as a draft or add `merge:hold`; the required metadata check also rejects the hold. A passing scanner job does not replace the generated CodeQL findings check, and a preview package is not a hosted acceptance result. The complete list includes build/type/lint/format/connectivity, unit coverage, full application/native compatibility, PR metadata, PR preview package and the separate security outcomes.

Repository auto-merge availability and prepared source do not prove that this controller has reached main. Its own exact-source CI, merge and successful default-branch execution remain required. Historical work-log results are revision-specific and cannot certify a new head.

Daily maintenance follows the same protected PR process: a signed separate branch, `type:dependencies`, `area:devops` and `risk:high` labels, independent review and all 15 current checks. Native auto-merge grants no App or role exception. PR22/main `319ab69f` provides the publisher source; [protected maintenance operation](GITHUB_WORKFLOW.md#protected-daily-maintenance) distinguishes it from actual token/workflow acceptance and explains existing-PR and diagnostic cleanup behavior.

## Merge and publication

Use GitHub's native PR merge path after the applicable review, current-base checks and signature requirements pass. The controller submits the expected head SHA and `merge_method: merge`; it does not PATCH the main ref or force an update. Native merging may create a commit different from the synthetic test merge, so there is no exact-test-merge-SHA guarantee. A refused or unconfirmed merge must not be described as completed.

The controller requests missing current-main verification separately. It does not publish a release, install a package, change hosting or authorise production, real data, SMTP, DNS or risky maintenance. Follow the separate owning workflows and deployment runbook, and claim publication or installation only from actual evidence. This documentation change does not claim that release or installation switches have been changed.

Signed annotated `milestone/*` tags identify verified historical development states. They are not PR labels or a promise of a Semver or production version. Do not move existing tags; create tags only on the intended commit.

After merging, update the issue resolution when needed and track remaining tasks separately. A new task must not silently expand the original acceptance criteria or be described as already completed.

The gated [PR preview package and deployment record](PR_PREVIEWS.md) provides an owned, locally runnable application preview after the complete checks. Its artifact URL is not a hosted portal URL.
