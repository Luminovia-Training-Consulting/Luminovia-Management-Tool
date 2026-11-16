# Contributing to Luminovia Portal

Use English for issues, pull requests and contributor documentation. Application UI changes must include German and English; user-authored content keeps its language.

## Choose a focused change

Read the [project overview](README.md), [documentation index](docs/README.md), [product specification](docs/PRODUCT_SPEC.md) and relevant feature guide. The [roadmap](ROADMAP.md) describes remaining requirements. Inspect the current source and existing issues/PRs before proposing overlapping work. Agent-assisted changes also follow [AGENTS](AGENTS.md).

Report bugs, questions and feature ideas through the [issue chooser](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/issues/new/choose); the [issue guide](docs/ISSUE_GUIDE.md) explains useful reproductions. Suspected vulnerabilities belong in [private security reporting](SECURITY.md), not a public issue.

External contributors use a fork; contributors with write access can use an owned branch. Agent branches normally start with `codex/`. Keep unrelated changes and other worktrees intact. Use meaningful signed commits and open a PR against `main`.

## Set up and check

Use Linux, the Node version in [.node-version](.node-version), npm and Docker/Compose. Complete verification additionally needs Python 3, util-linux `flock` and `age`/`age-keygen`; see [local development](docs/LOCAL_DEVELOPMENT.md).

```sh
npm ci
./portal check
./portal start
./portal test
./portal stop
```

`check` runs fast quality/coverage/build checks. `start` preserves ordinary local data. `test` owns a separate disposable stack for actual database/API/browser/PWA acceptance; it must never target ordinary development or hosted data. `stop` preserves development volumes. Use focused unit/component checks while editing and the complete command for changes to behavior or infrastructure. Explain checks not run and any first failure; a written test or browser discovery is not executed acceptance.

`./portal github` previews latest main separately; `./portal github test` verifies that source rather than your uncommitted edits. Coordinate the shared QA lock and never terminate foreign services. [Test plan](docs/TEST_PLAN.md), [CI profiles and coverage](docs/CI_QUALITY.md), and [functional acceptance](docs/FUNCTIONAL_ACCEPTANCE.md) explain scope and evidence.

Use `npm ci` and the lockfile. Dependency updates must preserve compatible peer families; do not add unrelated upgrades or use blanket `audit fix --force`.

## Preserve application contracts

- **Authorization:** current database roles, MFA, RLS, exact grants and resource membership decide access. Test direct requests, other actors and revocation. Hidden UI and editable metadata confer no rights.
- **Claims and money:** confirm only after a successful online transaction reserves every session. Preserve accepted schedules, terms, contract versions and original-currency compensation. A payment record is not a bank transfer.
- **Migrations:** released SQL bytes remain unchanged. Add new migrations through the pinned CLI and check retained data, permissions and concurrency. See [migration ownership](docs/MIGRATION_GUIDE.md).
- **Private resources:** preserve distinct DM, calendar, evidence, contract and invoice boundaries. Exact file bytes require current authorization and completed scanning. Do not generically cache authenticated responses or private file bytes offline. The explicit opt-in [minimal own teaching schedule](docs/CALENDAR_CONNECTIONS.md) is the documented narrow exception.
- **Interface:** provide DE/EN text and meaningful loading/error/empty states; check keyboard access, mobile layout and light/dark themes. Store instants with intended IANA zones; exercise Berlin DST and Brisbane.
- **Documentation:** update the affected feature/API/runbook alongside the change. Keep API generation reproducible and distinguish current behavior, historical evidence and pending operational acceptance.

Public docs, examples, filenames, commits and screenshots must be customer-neutral. Use fictional people and organisations. Never commit credentials, tokens, private traces, CVs, customer records or financial documents. Preserve source explanations, licenses and asset provenance; see [agent source-comment rules](AGENTS.md#comments-are-part-of-the-source).

## Prepare the pull request

Complete the English template with the concrete problem, resulting behavior, relevant issue, actual checks and material limits. Use `Closes #123` only when the PR fully resolves it. Attach fictional screenshots for meaningful UI changes and describe database/operational effects where applicable.

Every PR needs exactly one `type:*`, exactly one `risk:*` and at least one `area:*` label. External contributors can suggest labels for a maintainer to apply. See the [PR guide](docs/PULL_REQUEST_GUIDE.md#pull-request-labels).

All changes to `main` require a PR, signed history and current required checks against an up-to-date base. The reviewed policy has one personal PR-only review exception for `CarinaSchoppe`; maintainer/admin membership alone grants no exception. Other contributors and maintenance automation need independent approval, latest-push approval and resolved review conversations. No actor bypasses mandatory checks or signature/history rules. The dated [GitHub policy readback](docs/GITHUB_WORKFLOW.md#active-rule-layers) records the exact contexts and producers; live server policy remains authoritative.

A merge does not publish a CMS release or PR deployment record. Releases require an explicitly authorized manual `Portal checks` dispatch on `main`, `publish_release=true` and the exact current commit in `expected_commit`, followed by all publication gates. Hosting/DNS, production, risky migrations and real-message delivery retain separate authorization. See [release operation](docs/DEPLOYMENT_RUNBOOK.md).

## Licensing and collaboration

Contributions use the repository's [GNU GPLv3 license](LICENSE). Preserve bundled font, upstream and brand notices. Explain technical disagreements plainly and respond respectfully. Published tags identify immutable revisions; do not move or replace them. Milestone tags and local preview packages do not certify production readiness.
