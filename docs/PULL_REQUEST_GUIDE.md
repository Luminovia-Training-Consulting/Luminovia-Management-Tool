# Creating, reviewing and merging pull requests

> Status on 16 November 2026: Maintainers and administrators have a permanent `always` bypass for direct merges. Additional review/check rules for ordinary contributors are prepared but remain disabled until the maintenance App path is proven. [Current activation status](GITHUB_WORKFLOW.md#activation-still-pending).

This guide explains change acceptance. [CONTRIBUTING](../CONTRIBUTING.md) and [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md) cover setup and development; reports start with the [issue guide](ISSUE_GUIDE.md).

The contribution infrastructure was delivered in [PR #6](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/6) (`18ce633`); the separate local GitHub preview launcher followed in [PR #7](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/7) (`5f89986`). These merges do not activate the pending server-side review rules. The [labels.json](../.github/labels.json) catalogue contains 30 managed labels, with nine original GitHub labels retained separately.

## Branch and title

Create a separate branch from current `main`; external contributors use a fork. A PR addresses one coherent problem. Agent branches begin with `codex/`. Open an early draft when business feedback is useful before the implementation is ready for review.

Choose a title describing the result, such as `fix: keep accepted fee when editing a course` or `docs: explain private file permissions`. Prefixes aid scanning but do not replace labels. Commits should be signed and explain the change meaningfully.

## Description

Complete the PR template. Lead with the concrete problem and resulting behaviour. Use `Closes #123` only when the issue's goal is fully met; otherwise use `Refs #123`.

List executed commands and results. Say “not run” and explain why when evidence is missing. Writing tests does not establish that they passed. Distinguish local, CI, native Supabase and actual hosted acceptance.

For visible changes, provide fictional desktop/mobile screenshots covering DE/EN and light/dark where relevant. For database changes, describe migrations, retained data, RLS/grants and recovery. Preserve published migration files; deliver the new behaviour in an additional migration.

## Labels for pull requests

Each PR needs **exactly one type label**, **at least one area label** and **exactly one risk label**. `PR metadata` validates this classification. Existing general GitHub labels remain available, but `bug` or `documentation` alone do not satisfy the PR categories.

| Type                | Use                                                              |
| ------------------- | ---------------------------------------------------------------- |
| `type:fix`          | Correct delivered behaviour                                      |
| `type:feature`      | Add business functionality                                       |
| `type:docs`         | Change guides or references                                      |
| `type:refactor`     | Improve structure while preserving intended behaviour            |
| `type:tests`        | Improve tests independently of a business change                 |
| `type:maintenance`  | Maintain runtime, build or repository infrastructure             |
| `type:security`     | Coordinated security correction; never initial public disclosure |
| `type:dependencies` | Update reviewed dependencies                                     |

Choose all materially affected areas. The original area labels remain available: `area:frontend`, `area:backend`, `area:database`, `area:auth`, `area:files`, `area:finance`, `area:courses`, `area:devops` and `area:github`. Ten additional areas provide more precise classification:

| Area                 | Use                                                     |
| -------------------- | ------------------------------------------------------- |
| `area:chat`          | Messages, course/interest groups and Realtime           |
| `area:knowledge`     | Wiki, forum and knowledge management                    |
| `area:calendar`      | Sessions, availability, blockouts and time zones        |
| `area:notifications` | Inbox, notices and delivery preferences                 |
| `area:profiles`      | Profiles, qualifications and lecturer directory         |
| `area:clients`       | Client accounts, organisations and business contacts    |
| `area:pwa`           | Installation, service worker, offline state and updates |
| `area:testing`       | QA, regressions, browser and permission checks          |
| `area:docs`          | Guides, API references and operational documentation    |
| `area:taxonomy`      | Topics, tools, programming languages and hierarchy      |

Documentation changes use `area:docs` plus the documented business area where appropriate; general contribution rules also use `area:github`. A test does not need every label used by the whole system. A feature with a migration should include the affected business and technical areas. The 30 managed labels comprise eight types, 19 areas and three risk levels; original GitHub labels do not replace a required category.

| Risk          | Classification                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `risk:low`    | Narrow change with limited effects, such as a corrected guide                                  |
| `risk:medium` | Changed behaviour or connected components with bounded effects                                 |
| `risk:high`   | Permissions, Auth, money, migrations, data loss/recovery or similarly substantial consequences |

For example, a contribution-guide correction can use `type:docs`, `area:docs`, `area:github`, `risk:low`. A booking correction with a migration can require `type:fix`, `area:backend`, `area:database`, `area:courses`, `risk:high`. Labels grant no deployment approval and replace no validation.

External authors usually lack label permissions. Suggest values in the description so a maintainer can apply them. Until then, `PR metadata` may report missing labels. Update classification when scope or risk changes. PRs authored by `CarinaSchoppe` also need the required labels.

## Required evidence

| Change             | Relevant evidence                                                                                  |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| Bug fix            | Reproducible failure, meaningful regression test and corrected failure path                        |
| UI/form            | Component/browser checks, keyboard/mobile, DE/EN and loading/empty/error states                    |
| API/permission     | Real requests from separate accounts, allowed/denied access, revocation and retained sessions      |
| Database/booking   | Fresh and retained data, constraints/RLS/grants, atomic failure and real concurrency               |
| Files/avatars      | Version/scan/byte checks, authorisation/revocation, failed requests and cache lifecycle            |
| Runtime/deployment | Focused process/configuration checks, retained-data upgrade, safe recovery and operator boundaries |
| Documentation      | Resolving links, accurate commands and clear distinction between verified and pending work         |

Run appropriate focused checks during development. `./portal test` is the complete local acceptance command. CI additionally runs the separate native Supabase acceptance. Use fictional data and never publish raw traces, credentials or private database/file backups.

Use `./portal github test` for an independent test of current main. `./portal github` instead starts a separate persistent preview on `5373`/`563xx`; it does not modify ordinary development or the PR branch. A successful main test does not accept a different PR head. [Preview, persistence and migration planning](GITHUB_LOCAL_PREVIEW.md).

## Review policy for `main`

The normal process uses a PR and approval from at least one other authorised reviewer. Self-approval is not independent review. Under the prepared policy, new commits dismiss earlier approvals and the latest push must be approved by someone other than its pusher. Resolve review conversations and answer questions against current source before merging. These describe the intended process and prepared rule configuration; the additional server-side review/check rules remain disabled until the maintenance App integration is proven.

Maintainers and administrators have a permanent role-based `always` bypass and can merge directly at any time, including with pending reviews or checks. This replaces the earlier personal PR-only bypass. The exception follows the acting person, not the PR author; ordinary write permission alone does not grant it. GitHub may require an explicit bypass action in the merge dialog.

Checks still execute and provide traceable results:

- `Build`, `Typecheck`, `Lint`, `Formatting` and `Code quality` verify compilation, rules, style and actual source connections.
- `Tests and coverage` runs unit/component tests with complete frontend source accounting and thresholds.
- `verify` runs the complete real application/SQL/API/browser/PWA/maintenance checks; `Actual isolated selfhost image compatibility` verifies actual runtime and retained-data upgrades.
- `PR metadata` validates required labels; CodeQL analyses security patterns. See [CI_QUALITY](CI_QUALITY.md).

A maintainer can deliberately merge earlier. That does not turn failures green or publish an unchecked development update: release publication waits for the gates explicitly defined in `ci.yml`, while Security runs separately. Independent review and green current checks remain the intended process for ordinary contributions. [Actual enforcement status](GITHUB_WORKFLOW.md#activation-still-pending).

## Merge and release

Maintainers and administrators can merge using their configured `always` bypass. In the normal process, they inspect the description, labels, validation and unresolved conversations first. An early merge remains an explicit decision; failed checks or pending operational approvals must not be represented as passed.

A merge can trigger the existing development release workflow. Its immutable `cms-dev-*` packages and hosted migration checks remain separate. Production operations, real data, SMTP, DNS and risky maintenance need their appropriate separate approvals. Claim hosted installation only with actual operational evidence.

Signed annotated `milestone/*` tags identify accepted historical development checkpoints. They are not PR labels and do not promise a semantic-version or production release. Never move published tags; create new ones only on the intended verified commit.

After merging, update issue closure where necessary and record remaining work separately. New work must not silently expand the original acceptance criteria or appear already complete.
