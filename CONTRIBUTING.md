# Contributing to Luminovia Portal

> Status on 16 November 2026: Maintainers and administrators have a permanent `always` bypass for direct merges. The additional review/check rules for ordinary contributors are prepared but remain disabled until the maintenance App path is proven. [Current activation status](docs/GITHUB_WORKFLOW.md#activation-still-pending).

This guide explains how an idea or bug report becomes a traceable, tested change. Project documentation is written in English. Issues and discussions in German or English are welcome; application interface changes require both German and English strings. Authored course material and other user content retain their original language.

The Portal is a React/TypeScript PWA backed by Supabase. The complete product scope remains in the [implementation plan](docs/IMPLEMENTATION_PLAN.md) and [roadmap](ROADMAP.md). A working development version does not constitute production approval.

## Choose a starting point

| Task                                                   | Starting point                                                                                                                                                    |
| ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Report a bug, ask a question or propose an improvement | [Issue guide](docs/ISSUE_GUIDE.md) and the appropriate [issue form](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/issues/new/choose) |
| Change code or documentation                           | This guide, followed by the [pull request guide](docs/PULL_REQUEST_GUIDE.md)                                                                                      |
| Understand architecture, data and tests                | [Developer guide](docs/DEVELOPER_GUIDE.md), [architecture](docs/ARCHITECTURE.md) and [test plan](docs/TEST_PLAN.md)                                               |
| Start the local system or investigate startup errors   | [Local development](docs/LOCAL_DEVELOPMENT.md)                                                                                                                    |
| Report a possible vulnerability                        | [Private reporting process](docs/ISSUE_GUIDE.md#reporting-security-issues); do not publish exploit details                                                        |

## 1. Read the existing state

Read the [work log](docs/WORKLOG.md), [implementation plan](docs/IMPLEMENTATION_PLAN.md), [project instructions](AGENTS.md) and authoritative [master specification](docs/UNIVERSAL_MASTER_PROMPT.txt). Search existing issues and active pull requests before opening another. Describe substantial business changes in an issue first, including the problem, intended outcome and acceptance criteria.

Preserve working code and already delivered migrations. The public Luminovia website is a brand reference and is outside this repository's change scope.

## 2. Use a separate branch

External contributors create a fork and work on a branch there. Contributors with repository write access can use a branch in this repository. Agent branches use `codex/`; other suitable examples are `fix/short-description`, `feature/short-description` and `docs/short-description`.

```bash
git clone https://github.com/YOUR_GITHUB_NAME/Luminovia-Management-Tool.git
cd Luminovia-Management-Tool
git remote add upstream https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool.git
git fetch upstream
git switch -c fix/short-description upstream/main
```

Keep each branch focused on one coherent change. Use meaningful, signed commits, such as `fix: preserve invoice version on download` or `docs: explain local startup`. Credentials and real personal/customer data must never appear in commits, screenshots or test fixtures.

## 3. Develop and verify locally

[LOCAL_DEVELOPMENT](docs/LOCAL_DEVELOPMENT.md) contains the complete prerequisites: Linux, the Node version pinned in `.node-version`, npm and Docker Engine/Compose. Full verification also requires Python 3, `flock` and the official `age`/`age-keygen` tools. Install the locked dependency versions; do not run an unreviewed `audit fix --force`.

```bash
./portal start
./portal test
./portal stop
```

`start` runs the real local system and preserves its data. `test` uses a separate temporary dataset to verify components, database permissions, APIs, browsers and the built PWA. `stop` stops the managed development environment while retaining data. Testing does not reset an ordinary development database. The first start downloads images and needs sufficient RAM for the services and malware scanner.

Use focused checks during development, such as `npm test`, `npm run test:coverage`, `npm run lint` and `npm run typecheck`, once local dependencies are installed. The [CI and coverage guide](docs/CI_QUALITY.md) explains checks, reports and thresholds. `./portal test` is the full acceptance command. Understand each command's target and resource requirements before executing it; never publish raw private test artifacts.

## 4. Preserve business and security contracts

- **Permissions:** Database and API checks authorise access. Test separate accounts, revoked permissions and rejected requests; hiding a button does not enforce a boundary.
- **Scheduling and fees:** Confirm bookings only after the database transaction succeeds. Accepted sessions and commercial terms remain immutable snapshots.
- **Database:** Add migrations rather than editing delivered ones. Verify RLS, grants, constraints, concurrency and retained data together with API and UI behaviour.
- **Interface:** Add DE/EN strings plus loading, error and empty states. Check keyboard use, mobile layouts and light/dark themes. Use fictional screenshot data only.
- **Documentation:** Update affected guides and API references. Record actual changes, executed checks and remaining limitations in the work log.

Tests should demonstrate the changed behaviour and relevant failure paths. A useful regression test fails before the correction and passes afterwards. Scale validation to the risk and explicitly identify checks that were not run.

## 5. Open a pull request

Target `main` and complete the template. Use a draft while work is not ready for review. Describe the problem, resulting behaviour, actual validation and risks. Link the issue: `Closes #123` closes it after merge; `Refs #123` records a relationship without closing it.

Each PR needs exactly one `type:*` label, at least one `area:*` label and exactly one `risk:*` label. Available values, examples and responsibilities are in the [PR guide](docs/PULL_REQUEST_GUIDE.md#labels-for-pull-requests). External contributors usually cannot set labels: suggest them in the description so a maintainer can apply them.

## Review and merge

The contribution process uses pull requests into `main`. Ordinary contributions should receive at least one independent approval; new changes invalidate earlier approval under the prepared review policy. Resolve review discussions and keep CI green. These are process requirements: the additional server-side review/check rules are currently disabled, as stated above.

Maintainers and administrators have an explicit role-based `always` bypass and can merge directly, including when reviews or checks are pending or failing. This replaces the earlier Carina-only PR bypass. Ordinary write access does not grant bypass. The exception belongs to the acting person; GitHub may require an explicit bypass action. Business review and traceable validation remain the recommended process.

Build, Typecheck, Lint, Formatting, Code quality and Tests and coverage run alongside `verify`, `Actual isolated selfhost image compatibility` and `PR metadata`. [CI_QUALITY](docs/CI_QUALITY.md) explains their boundaries, separate CodeQL analysis and Dependabot. A ruleset JSON file or role bypass does not prove that a disabled review/check rule is enforced.

Direct maintainer merging does not bypass release acceptance: the development release automation waits for all of its CI gates. Failed checks do not produce an accepted installation package. The existing daily maintenance path remains unchanged until the separate App integration is proven; no fictional bot bypass is assumed.

Merging can trigger the existing development release automation. Production installation, risky migrations and changes to hosting, DNS or real data still require the appropriate separate authorisation. A GitHub merge does not replace operational approval.

## Tags and releases

Labels classify issues and PRs. Git tags identify specific commits. Signed annotated tags such as `milestone/m3-accounts-commission`, `milestone/m4-cbw-templates`, `milestone/m5-system-audit` and `milestone/m6-connected-operations` identify accepted development milestones, without claiming complete product scope or production approval.

Existing `cms-dev-*` tags belong to development release automation. Never move or replace published tags. Maintainers associate new milestone/version tags with the actual verified commit; applying a PR label does not create a Git tag.

## Licence and collaboration

This repository uses GNU GPLv3. Retain existing licence and provenance notices; bundled fonts and brand assets have their own applicable notices. Discuss technical disagreements respectfully, explain decisions and respond constructively to feedback.
