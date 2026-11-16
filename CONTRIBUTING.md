# Contributing to Luminovia Portal

> Status verified on 16 November 2026: all three `main` rulesets are active. Every change requires a PR, including maintenance-App changes. Maintainers/admins may bypass review through a PR only; nobody can bypass the 15 mandatory CI/security checks or up-to-date testing. The maintenance App has no rule exception. [Live rules](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/rules).

Welcome! This guide explains how to turn an idea or bug report into a tested, reviewable change. **Use English for issues, pull requests and contributor-facing documentation.** Application interface changes must provide both German and English strings; authored course content keeps its original language.

The portal is a React/TypeScript PWA backed by Supabase. The [implementation plan](docs/IMPLEMENTATION_PLAN.md) retains the full product scope. A working development version is not production approval.

## Find the right starting point

| Goal                                                   | Start here                                                                                                                                                        |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Report a bug, ask a question or suggest an improvement | [Issue guide](docs/ISSUE_GUIDE.md) and the appropriate [issue form](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/issues/new/choose) |
| Change code or documentation                           | This guide, then the [pull request guide](docs/PULL_REQUEST_GUIDE.md)                                                                                             |
| Understand the architecture, data model and tests      | [Developer guide](docs/DEVELOPER_GUIDE.md), [architecture](docs/ARCHITECTURE.md) and [test plan](docs/TEST_PLAN.md)                                               |
| Start the local system or troubleshoot startup         | [Local development](docs/LOCAL_DEVELOPMENT.md)                                                                                                                    |
| Report a possible vulnerability                        | [Private reporting](docs/ISSUE_GUIDE.md#reporting-security-vulnerabilities); do not publish exploit details                                                       |

## 1. Read the current project state

Read the [work log](docs/WORKLOG.md), [implementation plan](docs/IMPLEMENTATION_PLAN.md), [project instructions](AGENTS.md) and authoritative [master specification](docs/UNIVERSAL_MASTER_PROMPT.txt). Search existing issues and ongoing work before opening an issue or PR. Larger feature changes should start with an issue describing the problem, desired outcome and acceptance criteria.

Preserve working code and previously delivered migrations. The public Luminovia Website repository is a brand reference and is outside this repository's change scope.

## 2. Use your own branch

External contributors should fork the repository and create a branch in their fork. Contributors with write access may create a branch in this repository. Agent work uses the `codex/` prefix; other examples include `fix/short-description`, `feature/short-description` and `docs/short-description`.

```bash
git clone https://github.com/YOUR_GITHUB_NAME/Luminovia-Management-Tool.git
cd Luminovia-Management-Tool
git remote add upstream https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool.git
git fetch upstream
git switch -c fix/short-description upstream/main
```

Keep each branch focused on one coherent change. Use meaningful, signed commits such as `fix: preserve invoice version on download` or `docs: explain local startup`. Credentials, real customer names and real personal or customer data must not appear in public documentation, filenames, UI examples, commits, screenshots or test fixtures. Use customer-neutral terminology and clearly fictional organisations; configure actual customers privately in the application.

## 3. Develop and verify locally

[LOCAL_DEVELOPMENT](docs/LOCAL_DEVELOPMENT.md) lists the supported prerequisites: Linux, the Node version pinned in `.node-version`, npm, Docker Engine and Compose. Complete verification also requires Python 3, `flock` and the official `age`/`age-keygen` tools. Use the lockfile; do not run an unreviewed `audit fix --force`.

```bash
./portal start
./portal test
./portal stop
```

`start` runs the real local system and preserves its data. `test` uses separate temporary data to check components, database permissions, APIs, browsers and the built PWA. `stop` shuts down the managed development services without deleting their data. Tests do not reset the normal development database. First startup downloads images and needs enough RAM for the services and malware scanner.

During development, run focused checks such as `npm test`, `npm run test:coverage`, `npm run lint` and `npm run typecheck` after installing dependencies. The [CI and coverage guide](docs/CI_QUALITY.md) explains checks, reports and thresholds. `./portal test` is the canonical complete acceptance command. Understand a check's target and resources before running it, and do not publish unredacted private test artifacts.

## 4. Preserve the domain contracts

- **Permissions:** The database and API decide access. Test other accounts, revoked permissions and rejected requests; hiding a button is insufficient.
- **Schedules and fees:** Show a confirmed booking only after the database transaction succeeds. Accepted schedules and commercial agreements remain immutable snapshots.
- **Database:** Add migrations instead of rewriting delivered files. Verify RLS, grants, constraints, concurrency and retained data together with the API and UI.
- **Interface:** Include DE/EN text, loading, error and empty states. Check keyboard use, mobile layouts, and light/dark themes. Screenshots must contain fictional data only.
- **Documentation:** Update affected guides and API descriptions. Record actual changes, executed checks and remaining limits in the work log.

Tests should demonstrate changed behavior and relevant failure paths. A useful regression test fails before the fix and passes afterwards. Match the evidence to the change's risk and explicitly identify checks that were not run.

## 5. Open a pull request

Open a PR against `main` and complete the template in English. Use a draft while the change is not ready for review. Explain the problem, resulting behavior, actual test evidence and risks. Link the issue: `Closes #123` closes it on merge, while `Refs #123` only associates it.

Every PR needs exactly one `type:*` label, at least one `area:*` label and exactly one `risk:*` label. See [pull request labels](docs/PULL_REQUEST_GUIDE.md#pull-request-labels) for values, examples and responsibilities. External contributors usually cannot set labels: suggest them in the description and a maintainer will apply them.

## Review and merge

Changes to `main` require a pull request. Ordinary contributors and the maintenance App need an independent approving review, approval of the latest push and resolved review conversations. New pushes dismiss stale approvals; self-approval is insufficient. Maintainers and administrators may bypass the review rules when merging a PR, but cannot push directly to `main` or bypass its required checks.

All 15 mandatory checks must pass for the current revision, and the PR must be up to date with `main`. These include Build, Typecheck, Lint, Formatting, Code quality, Tests and coverage, `verify`, `Actual isolated selfhost image compatibility`, `PR metadata`, the three CodeQL language analyses, Dependency review and the generated CodeQL findings check. [CI_QUALITY](docs/CI_QUALITY.md) explains their scopes. Missing, pending or failed required checks block every merger, including administrators and the maintenance App.

Daily maintenance publishes a signed change on a separate branch and opens a PR labelled `type:dependencies`, `area:devops` and `risk:high`. Native auto-merge waits for the same checks and independent review; it grants no exception. App permission setup and actual workflow delivery must be verified separately from the already active rules. See [current operational status](docs/GITHUB_WORKFLOW.md#activation-still-pending).

A merge may trigger the existing **development release automation**. The release job and VPS installer still require their own successful exact-main checks and immutable-package validation. Production installation, risky migrations, and changes to hosting, DNS or real data require the relevant separate authorization. A GitHub merge does not replace that operational approval.

## Tags and releases

Labels classify issues and PRs. Git tags identify a particular commit. The signed M3 accounts/commission, M4 building-block and M5 system-audit checkpoints identify accepted development revisions; they do not imply a complete product or production release.

Existing `cms-dev-*` tags belong to development release automation. Do not move or replace published tags. Maintainers attach new milestone/version tags to the exact verified commit; a PR label does not create a Git tag.

## License and collaboration

The repository uses GNU GPLv3. Preserve existing license and provenance notices; bundled fonts and brand assets retain their respective notices. Discuss technical disagreements factually, explain decisions and respond respectfully to feedback.
