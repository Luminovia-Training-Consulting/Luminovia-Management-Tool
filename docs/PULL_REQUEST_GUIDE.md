# Creating, reviewing and merging pull requests

> Status on 16 November 2026: the history, review and required-check rules are active. Maintainers and repository administrators have a **PR-only review exception**; required CI and commit signatures remain mandatory. Auto-merge is enabled and remains subject to those requirements. [Current rules and operational evidence](GITHUB_WORKFLOW.md).

This guide explains how a change is accepted. Setup and local development are covered in [CONTRIBUTING](../CONTRIBUTING.md) and [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md); reports start with the [issue guide](ISSUE_GUIDE.md). Please write new pull requests and contribution discussions in English. The product interface remains bilingual in German and English.

The contribution guides were delivered through [PR #6](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/6) (`18ce633`), and the separate local GitHub preview launcher through [PR #7](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/7) (`5f89986`). The source catalogue [labels.json](../.github/labels.json) now contains 35 managed labels; nine original GitHub labels are also preserved. The [documentation index](README.md) links current architecture, feature guides, test evidence and operations.

## Branch and title

Create a branch from the current `main`; external contributors use a fork. Keep each pull request focused on one related problem. Agent branches start with `codex/`. An early draft is useful when you need feedback before the implementation is ready for review.

Choose a title that describes the outcome, such as `fix: keep accepted fee when editing a course` or `docs: explain private file permissions`. A prefix helps readers but does not replace a label. Commits must be signed and clearly describe their changes.

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

Choose every area that is materially affected. The original area labels remain available: `area:frontend`, `area:backend`, `area:database`, `area:auth`, `area:files`, `area:finance`, `area:courses`, `area:devops` and `area:github`. The following areas provide more specific classifications; the final five describe API, security, performance, accessibility and design changes:

| Area                 | Use                                                         |
| -------------------- | ----------------------------------------------------------- |
| `area:chat`          | Messages, course/interest groups and Realtime               |
| `area:knowledge`     | Wiki, forum and knowledge management                        |
| `area:calendar`      | Events, availability, blocked time and time zones           |
| `area:notifications` | Inbox, notices and delivery preferences                     |
| `area:profiles`      | Profiles, qualifications and lecturer directory             |
| `area:clients`       | Client accounts, organisations and business contacts        |
| `area:pwa`           | Installation, service worker, offline state and updates     |
| `area:testing`       | QA, regressions, browser and permission checks              |
| `area:docs`          | Guides, API references and operational documentation        |
| `area:taxonomy`      | Topics, tools, programming languages and hierarchies        |
| `area:api`           | Public interfaces, RPC contracts, OpenAPI and compatibility |
| `area:security`      | Permission boundaries, privacy and input validation         |
| `area:performance`   | Concrete query-cost, loading or caching changes             |
| `area:accessibility` | Keyboard, focus, screen-reader and contrast work            |
| `area:design`        | Brand, layout, typography and colour system                 |

A documentation change receives `area:docs` and any relevant documented area; general contribution rules also use `area:github`. A test does not need every label used by the whole system. A feature with a migration should include the product and technical areas it actually changes. The 35 managed labels comprise eight types, 24 areas and three risk levels; additional original GitHub labels do not replace a required category.

Apply the five additional areas based on the actual diff. Use `area:api` for changed interface contracts or documented RPC/OpenAPI functions; `area:backend` still describes server implementation. Add `area:security` to the affected area for actual protection or permission changes. It is not a second type label: a `type:feature` can change security boundaries, while `type:security` identifies a coordinated security fix as the main purpose.

`area:performance` requires a concrete change to query, loading or cache behaviour; an incidental index or an existing full-system test is insufficient. `area:accessibility` identifies actual keyboard, focus, screen-reader or contrast work. `area:design` describes visible design changes; a theme contrast fix can need both labels. Preserve existing labels when they remain accurate. Select labels for the reviewable scope, not to use every available category.

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

Ordinary contributors need a pull request and at least one approval from another authorised person. Self-approval does not count as independent review; new changes invalidate old approvals. Approval of the latest push must come from someone other than its author. Resolve review conversations before merging and address feedback against current code. The review rule is active.

Maintainers and repository administrators have a role-based **PR-only exception to review** (`pull_request`, repository roles 2 and 5). They may merge a PR without another person's approval, but must still satisfy required CI and commit signatures. This exception does not authorise a direct push to `main` or bypass the required-check rule. Ordinary write access alone receives no review exception. The exception follows the person performing the merge, not the PR author.

The active check rule requires all nine GitHub Actions checks, bound to the expected Actions App (`15368`) and an up-to-date base:

- `Build`, `Typecheck`, `Lint`, `Formatting` and `Code quality` check compilation, rules, style and actual source connections.
- `Tests and coverage` runs unit/component tests with complete frontend source coverage reporting and enforced thresholds.
- `verify` runs the complete real application/SQL/API/browser/PWA/maintenance suites; `Actual isolated selfhost image compatibility` checks real runtime behaviour and retained data.
- `PR metadata` checks required labels.

The history rule has no bypass actors and preserves required signatures, deletion protection and non-fast-forward protection. The separate private maintenance App (`5776881`) has only the documented technical review/check exception for its controlled workflow; it has no signature/history exception. Maintainer/Admin roles are not bypass actors in the check or history rules. See [GITHUB_WORKFLOW](GITHUB_WORKFLOW.md) for the active configuration, App scope and actual operational evidence.

[CI_QUALITY](CI_QUALITY.md) explains the checks, full-source V8 coverage and enforced thresholds. The separate CodeQL Security workflow analyses security patterns; its findings and reviewed baseline are documented in [CODE_SCANNING_TRIAGE](CODE_SCANNING_TRIAGE.md). A successful scanner job does not mean every finding has been resolved. Coverage, SQL, Edge and browser checks remain distinct evidence rather than an invented combined coverage percentage.

## Merge and publication

Review the description, labels, exact-commit checks and open conversations before merging. Maintainers and administrators may use their PR-only review exception after the required checks pass; other contributors need the independent approval as well. Signatures remain required for everyone. Auto-merge is enabled, but it waits for the applicable requirements rather than bypassing them. A changed PR head needs its own current checks.

A merge can start the existing development release process. Its immutable `cms-dev-*` packages and hosted migration checks remain separate. Production operation, real data, SMTP, DNS and risky maintenance need the appropriate separate approvals. Claim a hosted installation only when actual operational evidence exists.

Signed annotated `milestone/*` tags identify verified historical development states. They are not PR labels or a promise of a Semver or production version. Do not move existing tags; create tags only on the intended commit.

After merging, update the issue resolution when needed and track remaining tasks separately. A new task must not silently expand the original acceptance criteria or be described as already completed.
