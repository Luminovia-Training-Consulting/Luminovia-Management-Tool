# Luminovia Portal

A bilingual German/English management application for Luminovia Training & Consulting. The React/TypeScript PWA connects teaching offers and atomic whole-block claims with courses, calendars, private collaboration, scanned documents and contract/invoice tracking.

This repository contains the application and its local/self-hosted tooling. The public [Luminovia website](https://luminovia.org/) is a separate brand reference. Development acceptance does not establish production readiness.

## Run locally

Use Linux, the Node version in [.node-version](.node-version), npm, Docker Engine and Docker Compose. Complete acceptance also requires Python 3, util-linux `flock`, and `age`/`age-keygen`. See [prerequisites and troubleshooting](DEVELOPMENT.md#section-local-development) before the first start.

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
./portal reset         # Confirm deletion and leave the local portal stopped
```

The development API uses port `54321`. Private runtime state and credentials stay in ignored `.local/`; do not share them in issues or screenshots. A persistent volume is not a backup.

## Preview the latest main

```sh
./portal github        # Fetch exact latest main into a separate persistent preview
./portal github status
./portal github stop
```

Open [the separate preview](http://127.0.0.1:5373); its API uses `56321`. It preserves its own accounts and files and leaves normal development data alone. `./portal github test` checks freshly fetched main in a separate QA checkout. Fetch failures and migrations requiring review stop explicitly. See [preview ownership and updates](DEVELOPMENT.md#section-github-local-preview).

## What the application covers

| Workflow                                                                           | Guide                                                                                                                                                                                                                                         |
|------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Teaching offers, filters, saved views, confirmed claims, cancellation and handover | [Jobs](GUIDE.md#section-job-discovery), [lifecycle](GUIDE.md#section-job-lifecycle), [handover](GUIDE.md#section-assignment-handover)                                                                                                         |
| Templates, customer runs, learning resources, readiness and teaching delivery      | [Courses](GUIDE.md#section-course-building-blocks), [workspace](GUIDE.md#section-course-learning-workspace), [readiness](GUIDE.md#section-course-readiness), [delivery](GUIDE.md#section-teaching-delivery)                                   |
| Personal/global calendar, availability, ICS and read-only connections              | [Calendar](GUIDE.md#section-calendar), [availability](GUIDE.md#section-availability), [connections](GUIDE.md#section-calendar-connections)                                                                                                    |
| Private chat, scanned files, wiki/forum and scoped search                          | [Chat](GUIDE.md#section-chat), [files](GUIDE.md#section-files), [knowledge](GUIDE.md#section-user-guide-wiki-and-forum)                                                                                                                       |
| Accounts, qualifications, private compensation, contracts and finance              | [Accounts API](API_REFERENCE.md#account-http-facade), [qualifications](GUIDE.md#section-qualifications), [pricing](GUIDE.md#section-delegated-roles-pricing), [finance](GUIDE.md#section-user-guide-earnings-invoices-and-recorded-payments)  |
| Dashboard, inbox, preferences, announcements and operational tools                 | [Dashboard](GUIDE.md#section-personal-dashboard), [notifications](GUIDE.md#section-notifications), [support](GUIDE.md#section-support-desk), [private enquiries](GUIDE.md#section-website-enquiries), [workbench](GUIDE.md#section-workbench) |

Public `/demo` offers fictional in-memory practice; `/help` provides searchable bilingual guidance. Signed-in users have a separate welcome guide and permission-aware tour. Demo actions do not create business records. Start with the [user guide](GUIDE.md#section-user-guide) or complete [project guides](README.md#documentation).

PostgreSQL permissions and current resource membership are authoritative. Claims require online confirmation of all sessions, and accepted terms and compensation remain immutable. Private DMs, calendars and contracts have no blanket administrator read bypass. Files pass quarantine/scanning before authorized exact-version access. The browser receives only the public Supabase configuration, never service credentials.

## Develop and verify

```sh
npm ci
./portal check        # Fast quality, coverage and build; no service stack
./portal test         # Complete isolated local acceptance of this checkout
```

The complete command uses its own fictional data, credentials, ports and cleanup. Coordinate shared QA ownership; never stop another checkout's services. Unit tests and builds alone do not prove Auth, Storage, concurrency, browser, retained-data or physical-device behavior. [Testing](DEVELOPMENT.md#section-test-plan), [CI profiles](DEVELOPMENT.md#section-ci-quality), [functional acceptance](DEVELOPMENT.md#section-functional-acceptance) and recorded QA describe the separate evidence.

The lifecycle and notification client APIs have 100% file-specific coverage gates; whole-source coverage is measured separately. The native merge controller binds all required checks, actual system/browser/native execution, current-source security and independent review before its native merge request. It never rewrites the main ref or bypasses repository rules.

For a frontend build, set the public `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` values; [developer setup](DEVELOPMENT.md#section-developer-guide) explains configuration. Synthetic values verify compilation only.

The frontend uses React, TypeScript, Vite, Tailwind/shadcn-style primitives, Router, TanStack Query, React Hook Form/Zod and i18next. Supabase supplies Auth, PostgreSQL, Storage, Realtime and Edge Functions; no separate business application server is required. See [architecture](DEVELOPMENT.md#section-architecture), [data model](DEVELOPMENT.md#section-erd), [API reference](API_REFERENCE.md) and [migration guide](DEVELOPMENT.md#section-migration-guide).

## Documentation

- [Product requirements](PRODUCT.md) and [original brief](PRODUCT_BRIEF.txt)
- [User guide](GUIDE.md)
- [Development, architecture and tests](DEVELOPMENT.md)
- [Operations and deployment](OPERATIONS.md)
- [API reference](API_REFERENCE.md)

## Scope, contribution and operation

The [product specification](PRODUCT.md#section-product-spec), original [master brief](PRODUCT_BRIEF.txt) and [roadmap](ROADMAP.md) retain the full target and remaining requirements. Feature guides describe source behavior; exact PR checks establish acceptance of a particular revision. This README deliberately carries no rolling test totals or hosted-installation claim.

Read [CONTRIBUTING](CONTRIBUTING.md) before opening an English issue or pull request. The [contributor list](CONTRIBUTORS.md) records verified attribution; the [pull request guide](DEVELOPMENT.md#section-pull-request-guide) explains the shared type/area/risk labels and current merge gates. Application UI changes need German and English. Report vulnerabilities through the private channel in [SECURITY](SECURITY.md). Use fictional data and customer-neutral examples throughout.

A merge does not publish a hosted PR deployment record. A push to `main` can trigger an automatic **development CMS** release only after the exact-main application and security runs pass; a separate manual exact-SHA dispatch is also available. See [the runbook](OPERATIONS.md#section-deployment-runbook) and [CI guide](DEVELOPMENT.md#section-ci-quality). Production, hosting/DNS changes, risky data operations and real-message delivery need their own authorization.

The current release is under the proprietary source-available terms in [LICENSE](LICENSE). Earlier GPLv3 releases and separately licensed bundled assets retain their respective terms and notices; see [brand provenance](DEVELOPMENT.md#section-brand-design-system).
