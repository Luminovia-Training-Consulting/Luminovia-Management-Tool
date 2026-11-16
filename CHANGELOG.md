# Changelog

This project records accepted development increments rather than inventing released semantic versions. Exact execution records remain in [QA_RESULTS](docs/QA_RESULTS.md) and [WORKLOG](docs/WORKLOG.md). Production deployment requires separate authorisation.

## Unreleased — English documentation and repository discoverability

- Translate general contribution, developer, feature and operating documentation into English while retaining the bilingual application and literal authored examples.
- Add the [documentation index](docs/README.md), [roadmap](ROADMAP.md) and [decision notes](docs/decisions/README.md).
- Explain the newly active main history/review/check protection, PR-only Maintainer/Admin review exceptions and all nine required checks accurately.
- Preserve the full product scope, existing PR labels and recorded acceptance boundaries.

Validation and publication for this increment are recorded in its PR and work log; writing this entry is not a successful test or released version.

## 16 November 2026 — visible quality and security checks

[PR #11](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/11) added distinct Build, Typecheck, Lint, Formatting, Code quality and Tests and coverage jobs, real V8 reports and explicit baseline-preserving thresholds. CodeQL covers JavaScript/TypeScript, Python and Actions; Dependabot checks Actions and npm security updates. A real direct Maintainer merge was demonstrated. Whole-main findings remain separately documented in [security triage](docs/CODE_SCANNING_TRIAGE.md).

## 16 November 2026 — M6 connected operations

[PR #8](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/8) connected managed taxonomy, private lecturer availability, job cancellation/reopening/capacity and management Kanban, a role-adapted dashboard, in-app preferences/reminders and bounded administrative audit. Exact native/API/browser and retained-data acceptance passed on the documented revision. [PR #9](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/9) subsequently fixed transient action-label contrast during theme changes.

## 16 November 2026 — contributor workflow and isolated GitHub preview

[PR #6](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/6) delivered contributing/issue/PR guides, templates, metadata validation and managed labels. [PR #7](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/7) added a separate persistent exact-main preview and isolated QA checkout, with explicit migration review boundaries.

## Earlier accepted development increments

- [M5 / PR #5](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/5): scheduling, account, file/realtime and runtime reliability fixes, plus measured request and resource improvements.
- [M4 / PR #4](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/4): provenance-linked CBW templates, scanned profile avatars and authorised resource comments.
- [M3 / PR #3](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/3): account/client APIs, accepted commission snapshots, profile history and optional course reviews.
- [M2 / PR #2](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/2): persistent local development, chat/files, knowledge, directory/course and commercial workflows.
- [M1 / PR #1](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/1): secure real-Auth PWA foundation and transactional teaching-job claims.

See the [roadmap](ROADMAP.md) for requirements beyond these accepted slices. Accepted milestones do not establish complete-product, legal, production or physical-device certification.
