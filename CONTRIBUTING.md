# Contributing to Luminovia Portal

Use English for issues, pull requests and contributor documentation. Application UI changes must include German and English; user-authored content keeps its language.

## Choose a focused change

Read the [project overview](README.md), [project guides](README.md#documentation), [product specification](docs/PRODUCT.md#section-product-spec) and relevant feature guide. The [feature catalogue](docs/FEATURES.md) describes the current application. Inspect the current source and existing issues/PRs before proposing overlapping work. Agent-assisted changes also follow [AGENTS](AGENTS.md).

Report bugs, questions and feature ideas through the [issue chooser](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/issues/new/choose). Include the affected revision, observed behavior and a reproducible example. Suspected vulnerabilities belong in [private GitHub reporting](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/security/advisories/new), not a public issue.

External contributors use a fork; contributors with write access can use an owned branch. Agent branches normally start with `codex/`. Keep unrelated changes and other worktrees intact. Use meaningful signed commits and open a PR against `main`.

## Set up and check

Use Linux, the Node version in [.node-version](.node-version), npm and Docker/Compose. Complete verification additionally needs Python 3, util-linux `flock` and `age`/`age-keygen`; see [local setup](README.md#run-locally).

```sh
npm ci
./portal check
./portal start
./portal test
./portal stop
```

`check` runs fast quality/coverage/build checks. `start` preserves ordinary local data. `test` owns a separate disposable stack for actual database/API/browser/PWA acceptance; it must never target ordinary development or hosted data. `stop` preserves development volumes. Use focused unit/component checks while editing and the complete command for changes to behavior or infrastructure. Explain checks not run and any first failure; a written test or browser discovery is not executed acceptance.

`./portal github` previews latest main separately; `./portal github test` verifies that source rather than your uncommitted edits. Coordinate the shared QA lock and never terminate foreign services.

Use `npm ci` and the lockfile. Dependency updates must preserve compatible peer families; do not add unrelated upgrades or use blanket `audit fix --force`.

## Preserve application contracts

- **Authorization:** current database roles, active-account status, RLS, exact grants and resource membership decide access. The opt-in privileged authenticator policy verifies current native TOTP sessions. Test direct requests, other actors and revocation. Hidden UI and editable metadata confer no rights.
- **Claims and money:** confirm only after a successful online transaction reserves every session. Preserve accepted schedules, terms, contract versions and original-currency compensation. A payment record is not a bank transfer.
- **Migrations:** released SQL bytes remain unchanged. Add new migrations through the pinned CLI and check retained data, permissions and concurrency.
- **Private resources:** preserve distinct DM, calendar, evidence, contract and invoice boundaries. Exact file bytes require current authorization and completed scanning. Do not generically cache authenticated responses or private file bytes offline. The explicit opt-in [minimal own teaching schedule](docs/GUIDE.md#section-calendar-connections) is the documented narrow exception.
- **Interface:** provide DE/EN text and meaningful loading/error/empty states; check keyboard access, mobile layout and light/dark themes. Store instants with intended IANA zones; exercise Berlin DST and Brisbane.
- **Documentation:** update the affected feature/API/runbook alongside the change. Keep API generation reproducible and distinguish current behavior, historical evidence and pending operational acceptance.

Public docs, examples, filenames, commits and screenshots must be customer-neutral. Use fictional people and organisations. Never commit credentials, tokens, private traces, CVs, customer records or financial documents. Preserve source explanations, licenses and asset provenance; see [agent source-comment rules](AGENTS.md#comments-are-part-of-the-source).

## Prepare the pull request

Complete the English template with the concrete problem, resulting behavior, relevant issue, actual checks and material limits. Use `Closes #123` only when the PR fully resolves it. Attach fictional screenshots for meaningful UI changes and describe database/operational effects where applicable.

Every PR needs exactly one `type:*`, exactly one `risk:*` and at least one `area:*` label. External contributors can suggest labels for a maintainer to apply.

All changes to `main` require a PR, signed history and current required checks against an up-to-date base. The reviewed policy has one personal PR-only review exception for `CarinaSchoppe` (`User:29256704`); maintainer/admin membership alone grants no exception. Other contributors and maintenance automation need independent approval, latest-push approval and resolved review conversations. No actor bypasses mandatory checks or signature/history rules. Check the live GitHub rules for current required contexts.

The prepared native automatic-merge controller requires an independent current-head approval and native `clean` mergeability for every candidate, including Carina-authored and App-authored PRs. Her personal exception applies only when that exact user performs a native merge; another account or the App cannot inherit it from the PR author. Review independence uses the actual source push bound to the CI suite, not a workflow actor, retry initiator or commit email. Missing push evidence grants no
exception; contradictory evidence blocks the candidate.

All fifteen required contexts and their producer Apps remain mandatory. The additional browser job and the actual successful system, browser and native acceptance steps must belong to the current canonical CI run; green job names with skipped full steps do not suffice. Only verified Draft UI/docs may use reduced checks. Changing to Ready starts fresh full verification through `ready_for_review`. Measured coverage does not establish universal bug freedom or whole-system 100% coverage.

Keep unfinished work as Draft and disable queued native auto-merge while held. `merge:hold` remains a coordination marker until the proposed default-branch metadata guard is delivered; a label alone does not currently pause GitHub's native merge queue. The prepared controller rejects it. Exact-source CI, permitted merge and actual trusted-main execution still need separate evidence; repository auto-merge availability does not establish controller delivery.

Daily dependency maintenance uses its own signed PR with `type:dependencies`, `area:devops` and `risk:high`, independent review and all fifteen current checks. The maintenance App has no review, check or history bypass. See the [maintenance guide](deploy/hostinger/maintenance/README.md).

A merge does not publish a PR deployment record. An exact-current-main push can publish a **development CMS** release automatically after its application and security checks pass. The explicitly authorised manual `Portal checks` dispatch with `publish_release=true` and exact `expected_commit` remains available. Hosting/DNS, production, risky migrations and real-message delivery retain separate authorization. See [release operation](deploy/hostinger/README.md).

## Licensing and collaboration

The current release uses the proprietary source-available [LICENSE](LICENSE). Prior GPLv3 releases retain their original terms. External contributors may work on the Project only with written authorization; contributions intended for a proprietary release require a separate written rights agreement before inclusion. Mere submission or attribution does not grant independent use, distribution or commercial rights. Preserve bundled font, upstream and brand notices. Explain technical disagreements
plainly and respond respectfully. Published tags identify immutable revisions; do not move or replace them. Milestone tags and local preview packages do not certify production readiness.

The [GitHub contributor graph](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/graphs/contributors) records repository contributions. Author-name variants are not separate team members. Attribution grants no repository permission or review authority. Use the [feature catalogue](docs/FEATURES.md) and feature guides to choose useful work.
