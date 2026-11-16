# Documentation index

General project documentation is maintained in English. The application supports German and English; user-authored content and literal UI examples retain their language. This index covers the connected implementation, its access boundaries and actual operating evidence. The complete master specification remains required.

The current combined source contains 32 migrations plus the accepted Demo/Help/Tour implementation and English project guides. Its complete acceptance is **pending**. Exact `9c42730` passed 316 PostgreSQL cases, 26 business API suites and real restart persistence, then failed two of 94 business browser journeys. The Calendar correction and focused integration checks passed. Current functional preflight passed 372 tests across 57 files and all coverage floors; it does not certify a complete corrected-source rerun. Read [QA results](QA_RESULTS.md) and the latest [work-log entry](WORKLOG.md) for revision-specific evidence.

## Start here

On continuation, read [WORKLOG](WORKLOG.md), then [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md), the [project instructions](../AGENTS.md) and the verbatim [master specification](UNIVERSAL_MASTER_PROMPT.txt). Inspect the current source, Git status and owning tests before changing existing work.

| I want to…                                    | Read                                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run the application locally                   | [Local development](LOCAL_DEVELOPMENT.md), [latest-main isolated preview](GITHUB_LOCAL_PREVIEW.md)                                                                  |
| Contribute, report a bug or propose a feature | [Contributing](../CONTRIBUTING.md), [issue guide](ISSUE_GUIDE.md), [PR guide](PULL_REQUEST_GUIDE.md)                                                                |
| Understand scope and progress                 | [Roadmap](../ROADMAP.md), [product specification](PRODUCT_SPEC.md), [complete implementation plan](IMPLEMENTATION_PLAN.md)                                          |
| Understand a change or decision               | [Changelog](../CHANGELOG.md), [decision notes](decisions/README.md), [work log](WORKLOG.md)                                                                         |
| Develop and verify source                     | [Agent instructions](../AGENTS.md), [developer guide](DEVELOPER_GUIDE.md), [architecture](ARCHITECTURE.md), [ER diagram](ERD.md), [API reference](API_REFERENCE.md) |
| Assess actual test evidence                   | [QA results](QA_RESULTS.md), [test plan](TEST_PLAN.md), [CI quality and coverage](CI_QUALITY.md), [security triage](CODE_SCANNING_TRIAGE.md)                        |
| Operate or release the system                 | [Deployment runbook](DEPLOYMENT_RUNBOOK.md), [operations](OPERATIONS.md), [automatic updates](HOSTINGER_AUTOMATIC_UPDATES.md)                                       |
| Use the application                           | [User guide](USER_GUIDE.md), [welcome guide](WELCOME_GUIDE.md), [guided demo and help](GUIDED_DEMO_AND_HELP.md)                                                     |
| Report a vulnerability privately              | [Security policy](../SECURITY.md)                                                                                                                                   |

```bash
./portal github start  # Fetch current main into the separate persistent preview
./portal github test   # Verify latest main in an isolated test checkout
./portal start         # Start this checkout while retaining its local data
./portal test          # Run this source's complete isolated verification
```

Normal development, the latest-main preview and canonical tests use separate owned environments. A local persistent volume is not an external backup. Credentials and private test artifacts must remain outside Git.

## Product and feature guides

| Area or entry point                                              | Connected guide and boundary                                                                                                                                                                              |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard `/`                                                    | [Dashboard](DASHBOARD.md): authorised server totals and bounded personal calendar, chat, inbox, file and contract previews                                                                                |
| Jobs `/jobs`, `/jobs/:id`, `/admin`                              | [Discovery and saved views](JOB_DISCOVERY.md), [lifecycle and capacity](JOB_LIFECYCLE.md): server cursors, complete atomic assignment, immutable terms, cancellation and explicit reopening               |
| Administrative file/chat choices                                 | [Purpose-scoped job and course pickers](JOB_PICKERS.md): limited metadata and exact choices under distinct `jobs.manage` / `courses.manage` permissions                                                   |
| Calendar `/calendar`                                             | [Calendar](CALENDAR.md): private appointments and allocations, visible windows and explicit global draft/publication management                                                                           |
| Availability `/availability`                                     | [Availability](AVAILABILITY.md): private blockouts, explicit reduced management sharing and server-side conflict checks                                                                                   |
| Topics `/topics`                                                 | [Taxonomy](TAXONOMY.md): hierarchy, aliases, revisions, archival and active/historical references                                                                                                         |
| Profiles `/profile`, `/people`, `/my-reviews`                    | [Profiles and course reviews](PROFILES_REVIEWS.md), [profile avatars](PROFILE_AVATARS.md)                                                                                                                 |
| Qualification review in profiles and `/admin/people`             | [Evidence and attestation history](QUALIFICATIONS.md): explicit self-owned topic binding to an exact certificate version, withdrawal and management review                                                |
| Customers, courses and clients `/clients`, `/courses`, `/client` | [Operations](OPERATIONS.md), [Course building blocks](COURSE_BUILDING_BLOCKS.md), [account and revenue specification](ACCOUNTS_REVENUE_SPEC.md)                                                           |
| Accounts `/admin/accounts`, security `/security`                 | [Account platform audit](ACCOUNTS_PLATFORM_AUDIT.md), [account/revenue contract](ACCOUNTS_REVENUE_SPEC.md), [API reference](API_REFERENCE.md)                                                             |
| Files `/files`                                                   | [Files](FILES.md): real quarantine/scanning, exact versions, private tags/folders and revocation of open resource dialogs                                                                                 |
| Chat `/chats`                                                    | [Chat and structured mentions](CHAT.md), [chat security](CHAT_SECURITY.md): current membership, deduplicated alerts, existing-policy moderation and scanned attachments                                   |
| Wiki, forum and comments `/wiki`, `/forum`                       | [Resource comments](RESOURCE_COMMENTS.md), [knowledge security](KNOWLEDGE_SECURITY.md), [collaboration implementation](COLLABORATION_AND_COMMERCIAL_IMPLEMENTATION.md)                                    |
| Contracts and finance `/contracts`, `/finance`                   | [Commercial security](COMMERCIAL_SECURITY.md), [client/commission security](CLIENT_COMMISSION_SECURITY.md), [collaboration and commercial implementation](COLLABORATION_AND_COMMERCIAL_IMPLEMENTATION.md) |
| Inbox and settings `/notifications`, `/settings`                 | [Notifications and quiet hours](NOTIFICATIONS.md): retained own inbox, category preferences and timezone-aware attention rules                                                                            |
| Announcements `/announcements`, `/admin/announcements`           | [Announcements](ANNOUNCEMENTS.md): immutable published revisions, current role audiences, validity, own acknowledgement and critical inbox notices                                                        |
| Administration `/admin`, `/admin/audit`                          | [Administrative audit](ADMIN_AUDIT.md): bounded safe projections under current permission/MFA                                                                                                             |
| Public exploration `/demo/*`, `/help` and account tour           | [Guided demo, help and tour](GUIDED_DEMO_AND_HELP.md): fictional exercises, practical help and an explicitly navigated permission-aware tour                                                              |

These guides document implemented slices and their limits. The [complete implementation plan](IMPLEMENTATION_PLAN.md) retains missing course/wiki/forum resource contexts, financial statements, real delivery scheduling, retention administration and broader platform acceptance. A demo simulation does not implement the corresponding business feature.

## Architecture, APIs and design

- [Architecture](ARCHITECTURE.md), [ER diagram](ERD.md), [generated API reference](API_REFERENCE.md) and [developer guide](DEVELOPER_GUIDE.md) explain data flow, current RPC/RLS boundaries, role/profile locking, cache isolation and migration ownership.
- [Product specification](PRODUCT_SPEC.md) complements the unchanged [master specification](UNIVERSAL_MASTER_PROMPT.txt); the latter remains authoritative for the full target.
- [Brand design system](BRAND_DESIGN_SYSTEM.md), [reference sources](REFERENCE_SOURCES.md) and [Course templates](COURSE_BUILDING_BLOCKS.md) record authentic assets, provenance and template/run/job references.

Schema changes are additive CLI-generated migrations. Public invoker RPCs delegate to narrowly granted private implementations; current database state authorises the actual caller. Authored API/browser tests and a generated reference are not evidence that a native suite passed.

- [Delegated roles and private compensation](DELEGATED_ROLES_PRICING.md), [personal welcome guide](WELCOME_GUIDE.md), [guided demo and help](GUIDED_DEMO_AND_HELP.md).
- [Account and revenue specification](ACCOUNTS_REVENUE_SPEC.md), [account platform audit](ACCOUNTS_PLATFORM_AUDIT.md), [profiles and reviews](PROFILES_REVIEWS.md).
- [Taxonomy](TAXONOMY.md), [availability](AVAILABILITY.md), [job lifecycle and capacity](JOB_LIFECYCLE.md), [dashboard](DASHBOARD.md), [notifications](NOTIFICATIONS.md), [administrative audit](ADMIN_AUDIT.md).
- [Course building blocks](COURSE_BUILDING_BLOCKS.md), [profile avatars](PROFILE_AVATARS.md), [resource comments](RESOURCE_COMMENTS.md), [collaboration and commercial implementation](COLLABORATION_AND_COMMERCIAL_IMPLEMENTATION.md).

## Security and quality

Current database roles and MFA are authoritative. Role-sensitive mutations lock the actor profile before fresh authorisation. Private calendar entries, availability notes, direct messages and contracts have no general administrator read bypass. Accepted commercial snapshots remain immutable, and lecturer projections exclude private gross/platform amounts.

A foreign qualification download requires an active explicit binding to the exact certificate version and current review permission/MFA. It creates no new CV/contract access. The existing separate `users.manage`/MFA CV permission and compatible manual attestation remain. SQL and the protected Edge download enforce these distinctions; browser metadata grants no authority.

- [Security and privacy checklist](SECURITY_PRIVACY_CHECKLIST.md), [backend security review](BACKEND_SECURITY_REVIEW.md), [dependency audit](DEPENDENCY_AUDIT.md) and [private reporting policy](../SECURITY.md).
- [Chat security](CHAT_SECURITY.md), [knowledge security](KNOWLEDGE_SECURITY.md), [commercial security](COMMERCIAL_SECURITY.md), [client/commission security](CLIENT_COMMISSION_SECURITY.md), [account platform audit](ACCOUNTS_PLATFORM_AUDIT.md).
- [Functional code audit](FUNCTIONAL_CODE_AUDIT.md), [system audit](SYSTEM_AUDIT.md), [test plan](TEST_PLAN.md), [executed QA results](QA_RESULTS.md), [CI/coverage](CI_QUALITY.md) and [CodeQL triage](CODE_SCANNING_TRIAGE.md).

Credentials and private material belong neither in browser bundles, offline caches, logs nor public failure artifacts. Historical evidence describes its recorded revision and environment; audits do not certify universal bug freedom, legal compliance or production readiness.

## Operations and repository administration

- [GitHub workflow and effective protection](GITHUB_WORKFLOW.md), [historical PR CI repair](PR_CI_REPAIR_20261116.md), [latest-main local preview](GITHUB_LOCAL_PREVIEW.md), [checked local PR preview packages](PR_PREVIEWS.md), [local development](LOCAL_DEVELOPMENT.md).
- [Deployment runbook](DEPLOYMENT_RUNBOOK.md), [operations](OPERATIONS.md), [self-hosted development](HOSTINGER_DEVELOPMENT.md), [automatic updates and recovery](HOSTINGER_AUTOMATIC_UPDATES.md), [KVM1 performance evidence](KVM1_PERFORMANCE.md).
- [Agent instructions](../AGENTS.md), [migration history and review](MIGRATION_GUIDE.md).
- [Reviewed historical M4 migration transition](REVIEWED_M4_MIGRATIONS.md), [Hostinger deployment files](../deploy/hostinger/README.md), [selfhost runtime](../deploy/hostinger/selfhost/README.md), [maintenance tools](../deploy/hostinger/maintenance/README.md), [backup tools](../deploy/hostinger/backups/README.md).

The current catalogue contains **36 managed labels** plus nine preserved GitHub defaults. PRs need exactly one `type:*`, one `risk:*` and at least one `area:*`. All three repository rulesets are active. Maintain/Admin accounts may merge through PRs without another person's approval; all **14 required CI checks and signatures remain mandatory for humans**. Native auto-merge is enabled and waits for applicable requirements. The maintenance App has its separate scoped review/check exception; the history/signature ruleset has no bypass. See [GITHUB_WORKFLOW](GITHUB_WORKFLOW.md) for current read-back policy and the remaining workflow proof.

The public Luminovia website remains a read-only brand reference. Production publication, real SMTP delivery, bank transfers and further hosting changes require their separate authorisation. Software documentation stays in the repository; teaching-material delivery rules do not change this format.

## Specification and project history

[Master prompt](UNIVERSAL_MASTER_PROMPT.txt) · [complete plan](IMPLEMENTATION_PLAN.md) · [roadmap](../ROADMAP.md) · [work log](WORKLOG.md) · [changelog](../CHANGELOG.md) · [decision notes](decisions/README.md).

Historical evidence describes its recorded revision and environment. For current status, read the latest work-log entry and exact PR/CI results. Development acceptance does not imply full product completeness or production approval.

[Guided experience audit](GUIDED_EXPERIENCE_AUDIT.md) records the accepted guided-demo/help behavior and its verification.
