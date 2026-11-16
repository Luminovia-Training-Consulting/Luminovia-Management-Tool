# Creating, reviewing and merging pull requests

> Reviewed server snapshot on 16 November 2026 at 06:42:36 UTC: Only `CarinaSchoppe` (`User:29256704`) has a personal PR-only review exception (`bypass_mode: pull_request`). No repository role, other user, bot or App has that exception. All fifteen required checks and the separate history/signature rules remain mandatory. Live server rules are authoritative and may later differ. [Reviewed rule configuration](GITHUB_WORKFLOW.md#active-rule-layers).

This guide explains how a change is accepted. Setup and local development are covered in [CONTRIBUTING](../CONTRIBUTING.md) and [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md); reports start with the [issue guide](ISSUE_GUIDE.md). Please write new pull requests and contribution discussions in English. The product interface remains bilingual in German and English.

The contribution guides were delivered through [PR #6](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/6) (`18ce633`), and the separate local GitHub preview launcher through [PR #7](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/7) (`5f89986`). These historical merges did not themselves activate server-side review rules; the current live activation is described below. The source catalogue [labels.json](../.github/labels.json) now contains 36 managed labels; nine original GitHub labels are also preserved.

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

A documentation change receives `area:docs` and any relevant documented area; general contribution rules also use `area:github`. A test does not need every label used by the whole system. A feature with a migration should include the product and technical areas it actually changes. The 36 managed labels comprise eight types, 24 areas, three risk levels and the `merge:hold` stop signal; nine original GitHub labels remain available. `merge:hold` records a maintainer review stop. Preserve it until the stated concern is addressed; it grants no permission and does not replace required checks. Additional labels do not replace a required category. Add a new managed label to the shared catalogue before applying it. See [metadata operation and historical rechecks](GITHUB_WORKFLOW.md#labels-and-metadata-validation).

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

The repository contribution policy requires a pull request and at least one approval from another authorised person. Self-approval does not count as independent review; new changes dismiss old approvals. Approval of the latest push must come from someone other than its pusher. Resolve review conversations before merging and address feedback against current code.

Only `CarinaSchoppe` (`User:29256704`) has a personal `pull_request` exception on the review rule. She may merge a PR, including her own, without an independent approval. This exception does not allow direct pushes to `main` or bypass the separate required-check or history/signature rules. The exception follows the person acting, so another maintainer, administrator, bot or App gains none from a PR's author. GitHub may require an explicit bypass action for Carina. The [GitHub workflow guide](GITHUB_WORKFLOW.md#active-rule-layers) records the exact review conditions.

All fifteen required checks must pass against the current base:

- `Build`, `Typecheck`, `Lint`, `Formatting` and `Code quality` check compilation, rules, style and actual source connections.
- `Tests and coverage` runs unit/component tests with complete frontend source coverage reporting and enforced thresholds.
- `verify` runs the complete real application/SQL/API/browser/PWA/maintenance suites; `Actual isolated selfhost image compatibility` checks real runtime behaviour and retained data.
- `PR metadata` checks required labels against trusted current-main code.
- `PR preview package` creates the gated downloadable source package; package availability does not claim a hosted portal or complete-product acceptance.
- `CodeQL (javascript-typescript)`, `CodeQL (python)` and `CodeQL (actions)` run the separate language-specific security analyses; `Dependency review` rejects newly introduced vulnerable dependencies.
- The generated `CodeQL` finding check evaluates the uploaded security findings separately from successful scanner execution.

Fourteen statuses are bound to GitHub Actions integration `15368`; the generated `CodeQL` status is bound to integration `57789`. All fifteen are required for merging. See [CI_QUALITY](CI_QUALITY.md).

If main changes, update the PR as required and wait for checks against the current base. The required-check and history/signature rulesets have no bypass actors. The review ruleset grants only `CarinaSchoppe` (`User:29256704`) the personal PR-only exception within that layer. No App has a review or required-check exception. Historical App-token tests grant no current merge authority; see the [current rule configuration](GITHUB_WORKFLOW.md#active-rule-layers).

## Merge and publication

Only `CarinaSchoppe` (`User:29256704`) may merge a PR without an independent approval through her personal PR-only exception, including for her own PR, once the fifteen required checks and current-base requirement are satisfied. Other merge actors must satisfy the normal review requirements. Check the description, labels, tests and unresolved conversations first. Pending operational approvals remain separate from repository merge eligibility.

The separate Security outcomes are required for PR merge eligibility. Release publication still follows the explicit dependencies in `ci.yml`; the ruleset does not add them as release-job dependencies.

Current `main` can publish an immutable `cms-dev-*` development package automatically after successful main CI. The requested local-first, manual-only publication path is proposed in [PR #27](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/27), which remains unmerged. Do not claim that replacement is active or trigger publication as part of reviewing documentation. Production operation, real data, SMTP, DNS and risky maintenance need the appropriate separate authorization. Claim a hosted installation only when actual operational evidence exists.

Signatures remain mandatory for every actor. Native repository Auto-Merge is available and waits for applicable requirements; enable it only within the task's authorized merge scope, preserving coordinated holds and `merge:hold`.

Signed annotated `milestone/*` tags identify verified historical development states. They are not PR labels or a promise of a Semver or production version. Do not move existing tags; create tags only on the intended commit.

After merging, update the issue resolution when needed and track remaining tasks separately. A new task must not silently expand the original acceptance criteria or be described as already completed.

The gated [PR preview package and deployment record](PR_PREVIEWS.md) provides an owned, locally runnable application preview after the complete checks. Its artifact URL is not a hosted portal URL.
