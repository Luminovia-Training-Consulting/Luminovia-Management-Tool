# Luminovia Portal

A bilingual German/English management application for Luminovia Training & Consulting. The React/TypeScript PWA connects teaching offers and atomic whole-block claims with courses, calendars, private collaboration, scanned documents and contract/invoice tracking.

This repository contains the application and its local/self-hosted tooling. The public [Luminovia website](https://luminovia.org/) is a separate brand reference. Development acceptance does not establish production readiness.

## Run locally

Use Linux, the Node version in [.node-version](.node-version), npm, Docker Engine and Docker Compose. Complete acceptance also requires Python 3, util-linux `flock`, and `age`/`age-keygen`. See [prerequisites and troubleshooting](docs/LOCAL_DEVELOPMENT.md) before the first start.

```sh
git clone https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool.git
cd Luminovia-Management-Tool
./portal start
```

Open [the local portal](http://127.0.0.1:5173). The launcher installs locked dependencies when needed and starts PostgreSQL, Supabase Auth/Storage/Realtime, Edge Functions, Mailpit, the scanner and Vite. It preserves existing data. First initialization seeds fictional accounts; use `./portal credentials` to display their original local password. Local authentication emails go to [Mailpit](http://127.0.0.1:54324).

```sh
./portal status
./portal stop          # Stop owned services; retain data
./portal restart
```

The development API uses port `54321`. Private runtime state and credentials stay in ignored `.local/`; do not share them in issues or screenshots. A persistent volume is not a backup.

## Preview the latest main

```sh
./portal github        # Fetch exact latest main into a separate persistent preview
./portal github status
./portal github stop
```

Open [the separate preview](http://127.0.0.1:5373); its API uses `56321`. It preserves its own accounts and files and leaves normal development data alone. `./portal github test` checks freshly fetched main in a separate QA checkout. Fetch failures and migrations requiring review stop explicitly. See [preview ownership and updates](docs/GITHUB_LOCAL_PREVIEW.md).

## What the application covers

| Workflow                                                                           | Guide                                                                                                                                                                             |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Teaching offers, filters, saved views, confirmed claims, cancellation and handover | [Jobs](docs/JOB_DISCOVERY.md), [lifecycle](docs/JOB_LIFECYCLE.md), [handover](docs/ASSIGNMENT_HANDOVER.md)                                                                        |
| Templates, customer runs, learning resources, readiness and teaching delivery      | [Courses](docs/COURSE_BUILDING_BLOCKS.md), [workspace](docs/COURSE_LEARNING_WORKSPACE.md), [readiness](docs/COURSE_READINESS.md), [delivery](docs/TEACHING_DELIVERY.md)           |
| Personal/global calendar, availability, ICS and read-only connections              | [Calendar](docs/CALENDAR.md), [availability](docs/AVAILABILITY.md), [connections](docs/CALENDAR_CONNECTIONS.md)                                                                   |
| Private chat, scanned files, wiki/forum and scoped search                          | [Chat](docs/CHAT.md), [files](docs/FILES.md), [knowledge](docs/KNOWLEDGE_SECURITY.md)                                                                                             |
| Accounts, qualifications, private compensation, contracts and finance              | [Accounts API](docs/API_REFERENCE.md), [qualifications](docs/QUALIFICATIONS.md), [pricing](docs/DELEGATED_ROLES_PRICING.md), [commercial boundaries](docs/COMMERCIAL_SECURITY.md) |
| Dashboard, inbox, preferences, announcements and operational tools                 | [Dashboard](docs/PERSONAL_DASHBOARD.md), [notifications](docs/NOTIFICATIONS.md), [support](docs/SUPPORT_DESK.md), [workbench](docs/WORKBENCH.md)                                  |

Public `/demo` offers fictional in-memory practice; `/help` provides searchable bilingual guidance. Signed-in users have a separate welcome guide and permission-aware tour. Demo actions do not create business records. Start with the [user guide](docs/USER_GUIDE.md) or [complete documentation index](docs/README.md).

PostgreSQL permissions and current resource membership are authoritative. Claims require online confirmation of all sessions, and accepted terms and compensation remain immutable. Private DMs, calendars and contracts have no blanket administrator read bypass. Files pass quarantine/scanning before authorized exact-version access. The browser receives only the public Supabase configuration, never service credentials.

## Develop and verify

```sh
npm ci
./portal check        # Fast quality, coverage and build; no service stack
./portal test         # Complete isolated local acceptance of this checkout
```

The complete command uses its own fictional data, credentials, ports and cleanup. Coordinate shared QA ownership; never stop another checkout's services. Unit tests and builds alone do not prove Auth, Storage, concurrency, browser, retained-data or physical-device behavior. [Testing](docs/TEST_PLAN.md), [CI profiles](docs/CI_QUALITY.md), [functional acceptance](docs/FUNCTIONAL_ACCEPTANCE.md) and [recorded QA](docs/QA_RESULTS.md) describe the separate evidence.

For a frontend build, set the public `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` values; [developer setup](docs/DEVELOPER_GUIDE.md) explains configuration. Synthetic values verify compilation only.

The frontend uses React, TypeScript, Vite, Tailwind/shadcn-style primitives, Router, TanStack Query, React Hook Form/Zod and i18next. Supabase supplies Auth, PostgreSQL, Storage, Realtime and Edge Functions; no separate business application server is required. See [architecture](docs/ARCHITECTURE.md), [data model](docs/ERD.md), [API reference](docs/API_REFERENCE.md) and [migration guide](docs/MIGRATION_GUIDE.md).

## Scope, contribution and operation

The [product specification](docs/PRODUCT_SPEC.md), original [master brief](docs/UNIVERSAL_MASTER_PROMPT.txt) and [roadmap](ROADMAP.md) retain the full target and remaining requirements. Feature guides describe source behavior; exact PR checks establish acceptance of a particular revision. This README deliberately carries no rolling test totals or hosted-installation claim.

Read [CONTRIBUTING](CONTRIBUTING.md) before opening an English issue or pull request. Application UI changes need German and English. Report vulnerabilities through the private channel in [SECURITY](SECURITY.md). Use fictional data and customer-neutral examples throughout.

A merge does not publish a CMS release or hosted PR deployment. Publication requires the explicit manual controls in [the runbook](docs/DEPLOYMENT_RUNBOOK.md) and [CI guide](docs/CI_QUALITY.md). Production, hosting/DNS changes, risky data operations and real-message delivery need their own authorization.

Licensed under [GNU GPLv3](LICENSE); bundled assets retain their notices and [brand provenance](docs/BRAND_DESIGN_SYSTEM.md).
