# Contributing to Luminovia Portal

> Live policy verified on 16 November 2026: all 15 required checks and signatures are mandatory, with no CI or history bypass. Only `CarinaSchoppe` (user `29256704`) has a personal PR-only review exception; repository roles and the maintenance App have none. The native automatic-merge controller is prepared and still needs its own exact-source CI, merge and default-branch execution. [Current rules and delivery boundary](docs/GITHUB_WORKFLOW.md#rules-for-main).

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

Keep each branch focused on one coherent change. Use meaningful, signed commits such as `fix: preserve invoice version on download` or `docs: explain local startup`. Credentials and real personal or customer data must not appear in commits, screenshots or test fixtures.

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

Ordinary contributors need an independent current-head approval, resolved conversations, latest-push approval and all 15 current required checks. New changes invalidate earlier approval under the active review policy. No human or App account may bypass the required-check or history/signature rules.

Only `CarinaSchoppe` (immutable user ID `29256704`) has a personal `pull_request` exception in the review ruleset. It applies when that exact user performs a native PR merge, including their own, and grants no direct-main push or early merge before required checks pass. The exception is not attached to the PR author and cannot be inherited by another account or App. Maintain/Admin roles, ordinary write access and the maintenance App grant no review exception.

The prepared [native automatic-merge controller](docs/AUTO_MERGE.md) uses the ordinary reviewed path for **every** PR, including Carina-authored, maintainer/admin and App-authored work: an independent approval of the exact head and native `clean` mergeability. Reviewer independence uses the actual source push bound to the CI check suite, not the workflow actor, retry initiator or commit email. Missing push evidence grants no exception; contradictory evidence blocks the candidate.

All 15 required contexts are listed in [GitHub administration](docs/GITHUB_WORKFLOW.md#required-checks-and-native-auto-merge). They include the complete application/native checks, PR preview package and separate CodeQL findings result. A successful unit run, scanner job or preview artifact does not replace the other gates. Coverage reports describe measured source and do not promise universal bug freedom or 100% whole-system coverage.

Repository auto-merge availability is enabled, but it does not prove that the new controller is delivered. The controller-only source remains prepared until its own exact-source CI, merge and successful default-branch execution are observed. Keep work as a draft or add `merge:hold` to pause it; the required metadata check also rejects the hold. Native merging can create a commit different from the synthetic test merge; the controller makes no exact-test-merge-SHA guarantee.

Daily maintenance uses a signed separate branch and a PR labelled `type:dependencies`, `area:devops` and `risk:high`. Its native auto-merge request waits for independent review and all 15 current checks; the maintenance App has no exception. The [protected maintenance guide](docs/GITHUB_WORKFLOW.md#protected-daily-maintenance) explains deterministic PR reuse, outdated-PR resolution, the non-merging signature diagnostic and the separate workflow-delivery evidence. Source integrated from PR22/main `319ab69f` does not prove that a privileged maintenance run has succeeded.

Merging and successful verification do not themselves authorise release publication, installation, production, SMTP, DNS, risky migrations or real-data changes. Follow the separate owning workflows and [deployment runbook](docs/DEPLOYMENT_RUNBOOK.md); claim a release or installation only from its actual evidence.

## Tags and releases

Labels classify issues and PRs. Git tags identify a particular commit. The signed annotated tags `milestone/m3-accounts-commission`, `milestone/m4-cbw-templates` and `milestone/m5-system-audit` mark accepted development checkpoints; they do not imply a complete product or production release.

Existing `cms-dev-*` tags belong to development release automation. Do not move or replace published tags. Maintainers attach new milestone/version tags to the exact verified commit; a PR label does not create a Git tag.

## License and collaboration

The repository uses GNU GPLv3. Preserve existing license and provenance notices; bundled fonts and brand assets retain their respective notices. Discuss technical disagreements factually, explain decisions and respond respectfully to feedback.

## Contributors

The [GitHub contributor graph](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/graphs/contributors) records actual contributions. Git author-name variants are not separate team members. Use this guide and the complete project plan to find useful work; no contributor list implies extra repository permission or review authority.
