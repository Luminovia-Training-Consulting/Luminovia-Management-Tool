# Creating, reviewing and merging pull requests

> Reviewed server snapshot on 16 November 2026 at 15:08:47 UTC (17 November in Australia/Brisbane): Only `CarinaSchoppe` (`User:29256704`) has a personal PR-only review exception (`bypass_mode: pull_request`). No repository role, other user, bot or App has that exception. All fifteen required checks and the separate history/signature rules remain mandatory. Live server rules are authoritative and may later differ. [Reviewed rule configuration](GITHUB_WORKFLOW.md#active-rule-layers).

This guide explains how a change is accepted. Setup and local development are covered in [CONTRIBUTING](../CONTRIBUTING.md) and [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md); reports start with the [issue guide](ISSUE_GUIDE.md). Please write new pull requests and contribution discussions in English. The product interface remains bilingual in German and English.

The contribution guides were delivered through [PR #6](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/6) (`18ce633`), and the separate local GitHub preview launcher through [PR #7](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/7) (`5f89986`). These historical merges did not themselves activate server-side review rules; the current live activation is described below. The source catalogue [labels.json](../.github/labels.json) now contains 36 managed labels; nine original GitHub labels are also preserved.

The native controller and continuous read-only probe remain prepared; a manual metadata-access proof does not establish their default-branch execution.

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

A documentation change receives `area:docs` and any relevant documented area; general contribution rules also use `area:github`. A test does not need every label used by the whole system. A feature with a migration should include the product and technical areas it actually changes. The 36 managed labels comprise eight types, 24 areas, three risk levels and the `merge:hold` stop signal; nine original GitHub labels remain available. `merge:hold` records a maintainer review stop. Preserve it until the stated concern is addressed; it grants no permission and does not replace required checks. Additional labels do not replace a required category. Add a new managed label to the shared catalogue before applying it. See [metadata operation and historical rechecks](GITHUB_WORKFLOW.md#labels-and-metadata-validation).

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

Run targeted checks during development. The complete local acceptance command is `./portal test`. CI selects a conservative `docs`, `standard` or `full` profile from the actual changed paths. Full acceptance includes independent system, browser/PWA and native retained-data checks; a reduced profile does not claim those stages ran. Use fictional data and do not publish raw traces, credentials or private database/file backups.

Use `./portal github test` for an independent test of current `main`. `./portal github` instead starts a separate persistent preview on `5373`/`563xx`; it changes neither normal development nor the PR branch. A passing check of `main` does not prove acceptance of a different PR head. See [preview, persistence and migration controls](GITHUB_LOCAL_PREVIEW.md).

## Review rules for `main`

Every change to `main` requires a pull request. Only CarinaSchoppe's immutable personal account (`User:29256704`, `bypass_mode: pull_request`) has a review exception. Every other user, including maintainers and administrators, and every App needs at least one independent approval, approval of the latest push and resolved review conversations. Self-approval does not count; new changes dismiss stale approvals. The exception follows the executing Carina account; PR authorship, pusher identity and repository roles transfer no authority. Nobody may push directly to `main` or bypass mandatory checks or signatures.

All fifteen required checks must pass against the current base:

- `Build`, `Typecheck`, `Lint`, `Formatting` and `Code quality` check compilation, rules, style and actual source connections.
- `Tests and coverage` runs unit/component tests with complete frontend source coverage reporting and enforced thresholds.
- `verify` runs the selected profile: documentation validation for `docs`, bounded runtime/Edge/dependency guards for `standard`, or the real system/SQL/API/maintenance phase for `full`. `Isolated browser acceptance` runs desktop/mobile/PWA work on a separate stack for full-profile PRs.
- `Actual isolated selfhost image compatibility` runs the applicable PostgreSQL checks and, for `full`, the native runtime/retained-data rehearsal. A successful reduced-profile check explicitly records the stages it did not run.
- `PR metadata` checks required labels against trusted current-main code.
- `PR preview package` requires all applicable quality, coverage, system, browser and native jobs to succeed and records the selected profile. The additional browser job is enforced through this required package gate; it is not a sixteenth required context. Package availability does not claim a hosted portal or complete-product acceptance.
- `CodeQL (javascript-typescript)`, `CodeQL (python)` and `CodeQL (actions)` run the separate language-specific security analyses; `Dependency review` rejects newly introduced vulnerable dependencies.
- The generated `CodeQL` finding check evaluates the uploaded security findings separately from successful scanner execution.

Fourteen statuses are bound to GitHub Actions integration `15368`; the generated `CodeQL` status is bound to integration `57789`. All fifteen are required for merging. See [CI_QUALITY](CI_QUALITY.md).

If main changes, update the PR as required and wait for checks against the current base. The required-check and history/signature rulesets have no bypass actors. The reviewed source ruleset grants only `CarinaSchoppe` (`User:29256704`) the personal PR-only exception within that layer. No App has a review or required-check exception. Historical App-token tests grant no current merge authority; see the [current rule configuration](GITHUB_WORKFLOW.md#active-rule-layers).

The prepared [verified native controller](AUTO_MERGE.md) requires independent current-head approval and GitHub's native `clean` state for **all** candidates. A human author's role grants the App no exemption. The reviewer must have current writer/admin authority and be independent of the author and any proven source pusher. Actual source pushes are bound to the exact CI check suite; a workflow actor, retry/reopen event or commit email is not push authority. Missing push evidence grants no exemption; contradictory evidence blocks the candidate.

Keep unfinished work Draft and disable queued native auto-merge while held. The proposed metadata validator rejects `merge:hold`, but accepted Main38 does not yet enforce that label; it is a coordination marker until delivery. Changing to Ready must start fresh full system, browser and native acceptance through `ready_for_review`. A passing scanner job does not replace the generated CodeQL findings check, and a preview package is not a hosted acceptance result. The complete list includes build/type/lint/format/connectivity, unit coverage, full application/native compatibility, PR metadata, PR preview package and the separate security outcomes.

Repository auto-merge availability and prepared source do not prove that this controller has reached main. Its own exact-source CI, merge and successful default-branch execution remain required. Historical [QA records](QA_RESULTS.md) are revision-specific and cannot certify a new head or base.

Daily maintenance follows the same protected PR process: a signed separate branch, `type:dependencies`, `area:devops` and `risk:high` labels, independent review and all 15 current checks. Native auto-merge grants no App or role exception. PR22/main `319ab69f` provides the publisher source; [protected maintenance operation](GITHUB_WORKFLOW.md#protected-daily-maintenance) distinguishes it from actual token/workflow acceptance and explains existing-PR and diagnostic cleanup behavior.

## Merge and publication

Review the description, labels, tests and open conversations before merging. Use the regular PR merge operation or native auto-merge. GitHub enforces all mandatory checks and signatures. The contribution workflow requires PRs and the reviewed personal-only approval policy; verify the actual review-layer activation described above rather than assuming that committing its snapshot activates it.

The separate Security outcomes are required for PR merge eligibility. Release publication still follows the explicit dependencies in `ci.yml`; the ruleset does not add them as release-job dependencies.

The accepted local-first controls from [PR #27](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/27) are present. Use `./portal check` for fast local quality, coverage and build checks, followed by `./portal test` for complete isolated acceptance. A merge does not publish a release or PR deployment metadata. An authorized maintainer must dispatch `Portal checks` on `main` with `publish_release=true` and the exact current `main` SHA in `expected_commit`. Ordinary checks and daily-maintenance verification do not publish releases. PR deployment metadata has its own manual-only publication and cleanup workflow; the verified local artifact remains downloadable without a record. See [PR previews](PR_PREVIEWS.md). Production operation, real data, SMTP, DNS and risky maintenance need the appropriate separate authorization. Claim a hosted installation only when actual operational evidence exists.

Signatures remain mandatory for every actor. Native repository Auto-Merge is available and waits for applicable requirements; enable it only within the task's authorized merge scope, preserving coordinated holds and `merge:hold`.

Signed annotated `milestone/*` tags identify verified historical development states. They are not PR labels or a promise of a Semver or production version. Do not move existing tags; create tags only on the intended commit.

After merging, update the issue resolution when needed and track remaining tasks separately. A new task must not silently expand the original acceptance criteria or be described as already completed.

## Current catalogue and historical metadata checks

The read-only metadata workflow executes only this repository's current main code and catalogue, including for fork PRs. It does not execute proposed contribution code, install dependencies or use write credentials. Automatic checks apply to open PR events; closed PR label edits do not restart this gate. Add new managed labels to the shared catalogue before applying them.

A deliberate historical check can be dispatched from main with a positive PR number. It re-reads current labels and records the actual historical head, without rerunning or rewriting its past application acceptance. See [metadata operation](GITHUB_WORKFLOW.md#labels-and-metadata-validation) and [the executed repair evidence](PR_CI_REPAIR_20261116.md).

The gated [PR preview package and deployment record](PR_PREVIEWS.md) provides an owned, locally runnable application preview after the applicable checks; its manifest identifies their scope. Its artifact URL is not a hosted portal URL.
