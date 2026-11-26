# Luminovia Portal

A bilingual German/English management application for Luminovia Training & Consulting. The React/TypeScript PWA connects teaching offers and atomic whole-block claims with courses, calendars, private collaboration, scanned documents and contract/invoice tracking.

This repository contains the application and its local/self-hosted tooling. The public [Luminovia website](https://luminovia.org/) is a separate brand reference. Development acceptance does not establish production readiness.

## Run locally

Use Linux, the Node version in [.node-version](.node-version), npm, Docker Engine and Docker Compose. Complete acceptance also requires Python 3, util-linux `flock`, and `age`/`age-keygen`.

```sh
git clone https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool.git
cd Luminovia-Management-Tool
./portal start
```

Open [the local portal](http://127.0.0.1:5173). The launcher installs locked dependencies when needed and starts PostgreSQL, Supabase Auth/Storage/Realtime, Edge Functions, Mailpit, the scanner and Vite. It preserves existing data. First initialization seeds fictional accounts; use `./portal credentials` to list the fictional email addresses and verify each available local password. Local authentication emails go to [Mailpit](http://127.0.0.1:54324).

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

Open [the separate preview](http://127.0.0.1:5373); its API uses `56321`. It preserves its own accounts and files and leaves normal development data alone. `./portal github test` checks freshly fetched main in a separate QA checkout. Fetch failures and migrations requiring review stop explicitly.

## What the application covers

See the [feature catalogue](docs/FEATURES.md) for the full inventory across editions.

| Workflow                                                                           | Guide                                                                                                                                                                                                                                         |
|------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Teaching offers, filters, saved views, confirmed claims, cancellation and handover | [Jobs](docs/GUIDE.md#section-job-discovery), [lifecycle](docs/GUIDE.md#section-job-lifecycle), [handover](docs/GUIDE.md#section-assignment-handover)                                                                                                         |
| Templates, customer runs, learning resources, readiness and teaching delivery      | [Courses](docs/GUIDE.md#section-course-building-blocks), [workspace](docs/GUIDE.md#section-course-learning-workspace), [readiness](docs/GUIDE.md#section-course-readiness), [delivery](docs/GUIDE.md#section-teaching-delivery)                                   |
| Personal/global calendar, availability, ICS and read-only connections              | [Calendar](docs/GUIDE.md#section-calendar), [availability](docs/GUIDE.md#section-availability), [connections](docs/GUIDE.md#section-calendar-connections)                                                                                                    |
| Private chat, scanned files, wiki/forum and scoped search                          | [Chat](docs/GUIDE.md#section-chat), [files](docs/GUIDE.md#section-files), [knowledge](docs/GUIDE.md#section-user-guide-wiki-and-forum)                                                                                                                       |
| Accounts, qualifications, private compensation, contracts and finance              | [Accounts API](API_REFERENCE.md#account-http-facade), [qualifications](docs/GUIDE.md#section-qualifications), [pricing](docs/GUIDE.md#section-delegated-roles-pricing), [finance](docs/GUIDE.md#section-user-guide-earnings-invoices-and-recorded-payments)  |
| Dashboard, inbox, preferences, announcements and operational tools                 | [Dashboard](docs/GUIDE.md#section-personal-dashboard), [notifications](docs/GUIDE.md#section-notifications), [support](docs/GUIDE.md#section-support-desk), [private enquiries](docs/GUIDE.md#section-website-enquiries), [workbench](docs/GUIDE.md#section-workbench) |

Public `/help` provides searchable bilingual guidance. Signed-in users have a separate welcome guide and permission-aware tour. Start with the [user guide](docs/GUIDE.md#section-user-guide) or complete [project guides](README.md#documentation).

PostgreSQL permissions and current resource membership are authoritative. Claims require online confirmation of all sessions, and accepted terms and compensation remain immutable. Private DMs, calendars and contracts have no blanket administrator read bypass. Files pass quarantine/scanning before authorized exact-version access. The browser receives only the public Supabase configuration, never service credentials.

## Develop and verify

```sh
npm ci
./portal check        # Fast quality, coverage and build; no service stack
./portal test         # Complete isolated local acceptance of this checkout
```

The complete command uses its own fictional data, credentials, ports and cleanup. Coordinate shared QA ownership; never stop another checkout's services. Unit tests and builds alone do not prove Auth, Storage, concurrency, browser, retained-data or physical-device behavior.

The lifecycle and notification client APIs have 100% file-specific coverage gates; whole-source coverage is measured separately. The native merge controller binds all required checks, actual system/browser/native execution, current-source security and independent review before its native merge request. It never rewrites the main ref or bypasses repository rules.

For a frontend build, set the public `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` values. Synthetic values verify compilation only.

The frontend uses React, TypeScript, Vite, Tailwind/shadcn-style primitives, Router, TanStack Query, React Hook Form/Zod and i18next. Supabase supplies Auth, PostgreSQL, Storage, Realtime and Edge Functions; no separate business application server is required.

## Documentation

- [Product requirements](docs/PRODUCT.md)
- [LMS implementation and verification backlog](docs/LMS-BACKLOG.md)
- [Production-readiness evidence and implementation backlog](docs/PRODUCTION-READINESS.md)
- [User guide](docs/GUIDE.md) and [feature catalogue](docs/FEATURES.md)
- [Design QA notes](docs/design-qa.md)
- [Hosted CMS](deploy/hostinger/README.md) and [customer Academy](deploy/academy/README.md)
- [API reference](API_REFERENCE.md)

## Scope, contribution and operation

The [product specification](docs/PRODUCT.md#section-product-spec) describes the target. Feature guides describe source behavior. Acceptance evidence applies to the revision tested.

Read [CONTRIBUTING](CONTRIBUTING.md) before opening an English issue or pull request. Application UI changes need German and English. [Report vulnerabilities privately](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/security/advisories/new). Use fictional data and customer-neutral examples throughout.

A merge does not publish a hosted PR deployment record. A push to `main` can trigger an automatic **development CMS** release only after the exact-main application and security runs pass; a separate manual exact-SHA dispatch is also available. See the [hosted CMS guide](deploy/hostinger/README.md). Production, hosting/DNS changes, risky data operations and real-message delivery need their own authorization.

The current release is under the proprietary source-available terms in [LICENSE](LICENSE). Earlier GPLv3 releases and separately licensed bundled assets retain their respective terms and notices.
