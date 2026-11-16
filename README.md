# Luminovia Portal

A real React/TypeScript Progressive Web App for Luminovia Training & Consulting. The local system connects invitation-only Supabase Auth, administrator MFA, bilingual profiles/evidence, teaching jobs and atomic allocation, calendar, private realtime chat, scanned files, wiki/forum, customers/courses and contract/invoice tracking. Individual client accounts, optional enrolled learners, safe course ratings, profile/invoice labels and a server-enforced default 50/50 commission model extend these workflows. CBW building blocks become provenance-linked course templates and referenced teaching offers; secure scanned profile pictures and staff comments connect the same application. The M6 source adds taxonomy administration, private availability, audited job lifecycle and explicit lecturer positions, personal dashboard previews, notification preferences/inbox and a reduced administrative audit reader. It is **not the complete production product yet**. See the [implementation plan](docs/IMPLEMENTATION_PLAN.md) for the entire outstanding scope.

The user's [Universal Master Prompt](docs/UNIVERSAL_MASTER_PROMPT.txt) is preserved verbatim and is the authoritative project specification. On continuation, read [WORKLOG](docs/WORKLOG.md) first, then [AGENTS.md](AGENTS.md) and the plan. The public Website repository is a read-only brand reference; it has not been changed.

## Requirements

- Linux (CachyOS locally, Ubuntu in CI), Node.js 26 LTS (tested with 26.13.1), npm, Docker Engine and the Docker Compose plugin supporting [healthcheck `start_interval`](https://docs.docker.com/reference/compose-file/services/#healthcheck) (Compose 2.20.2 or later). Python 3, Linux util-linux `flock` and official `age`/`age-keygen` 1.x (tested 1.3.2) are additionally required by the complete local release/update verification.
- Loopback ports 5173, 54321, 54322 and 54324 available. Local Docker services require several GB of disk space.
- Supabase CLI 3.1.0 and Deno 2.9.6 are pinned development dependencies; inspect their `--help` before database/remote operations.

## Start locally with one command

```bash
./portal start
```

The command installs locked npm dependencies when necessary and starts the complete local system: PostgreSQL, Supabase Auth/Storage/Realtime, Edge Functions, malware scanner, Mailpit and React/Vite. New migrations apply without resetting data. Fictional sample data are created only during the first empty initialization.

Open <http://127.0.0.1:5173>. Local email is captured exclusively in [Mailpit](http://127.0.0.1:54324). On a new empty initialization, the eleven fictional lecturers are `lecturer01@example.invalid` through `lecturer11@example.invalid`; additional accounts are `admin@example.invalid`, `participant@example.invalid`, `carina@example.invalid` (platform-owner demo) and `client@example.invalid` (client demo). These are separate fictional Auth accounts; actual invitations establish their own passwords.

```bash
./portal credentials   # deliberately display the original local test password
./portal status        # service status and URLs
./portal stop          # stop while preserving data
./portal restart       # restart while preserving data
```

Passwords, MFA, profile changes, verifications, suspensions, jobs, calendars and actual Storage files survive stop/start. Normal startup resets neither profiles nor passwords. Credentials are in the protected, ignored `.local/ACCOUNTS.txt`; server keys enter neither Git nor the browser bundle. Administrators enroll MFA through the actual security dialog.

`./portal up` stays attached to the terminal; Ctrl+C stops services while preserving data. Background startup stays active until `./portal stop`. First startup requires image downloads and scanner-signature initialization. The scanner is limited to 4 GB RAM; concurrent development and testing require memory for two separate local stacks.

Complete operational details, troubleshooting and persistence boundaries are in [LOCAL_DEVELOPMENT](docs/LOCAL_DEVELOPMENT.md). A Docker volume provides persistent local storage but is not an external backup.

## Current development and acceptance status

The M6 features connect database, API and interface. **Complete M6 application and native retained-data acceptance passed, and [PR #8](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/8) merged as `dc8e9a7`.** Exact-source CI passed 177 source tests, 234 PostgreSQL cases, 18 actual business API suites, 70 desktop/mobile workflows and two built-PWA checks, with real Auth, Storage and restart persistence. The local runner recorded PASS after cleanup, but its outer tool wrapper ended with 143; it must not be reported as local wrapper exit 0. [QA_RESULTS](docs/QA_RESULTS.md) and [WORKLOG](docs/WORKLOG.md) preserve the exact evidence and remaining product/platform gates. This historical acceptance does not certify later changes.

Contribution documentation merged through [PR #6](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/6) (`18ce633`), and the independent GitHub preview launcher through [PR #7](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/7) (`5f89986`). The label catalogue contains 30 managed labels and preserves the nine original GitHub labels. The separate activation status of review/merge rules is recorded in the [GitHub administration guide](docs/GITHUB_WORKFLOW.md).

## Implemented routes

| Route                    | Function                                                                                                                                 |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `/login`                 | Real email/password sign-in and password recovery; no public signup.                                                                     |
| `/auth/callback`         | Explicit one-time invitation acceptance; PKCE recovery callback.                                                                         |
| `/auth/password`         | Set a password after an authenticated invite/recovery.                                                                                   |
| `/`                      | Personal job suggestions, calendar/chat/notification/file previews, own contract receipts and capability-scoped management follow-ups.   |
| `/jobs`, `/jobs/:id`     | Combined filters, localised sessions/fees, exact-version terms acceptance and atomic allocation.                                         |
| `/calendar`              | Private appointments, confirmed assignments, published global events and month/week/day/agenda views.                                    |
| `/profile`               | Persisted DE/EN biography, contact/timezone, expertise and private CV/certificate uploads.                                               |
| `/chats`                 | Private DMs, staff/group and separate lecturer/participant course rooms; realtime messages, files, membership and read/mute state.       |
| `/files`                 | Quarantined/scanned private files, upload progress, authorised download/preview, history, replace, rename and archive.                   |
| `/wiki`, `/forum`        | Safe rich text/code, drafts/publication/revisions; threads, replies, accepted answers, subscriptions and moderation.                     |
| `/clients`               | MFA/capability-protected customer records, private contacts/notes, tags and archive.                                                     |
| `/courses`               | Reusable templates, actual runs/sessions, safe duplication and explicit publication.                                                     |
| `/contracts`             | Executed PDF versions/hashes, master/addendum chain, private downloads and receipt history. A receipt is not an e-signature.             |
| `/finance`               | Accepted-assignment earnings, scanned invoice PDFs, review, partial/full payments and authorised CSV with separate currencies.           |
| `/search`                | Permission-aware jobs, documents, messages, safe wiki/forum results and minimal chat contacts.                                           |
| `/security`              | Real Auth TOTP enrollment/challenge; administrative actions require AAL2 at the database.                                                |
| `/admin`                 | Atomic course/job creation, publication/archive, lecturer invitations.                                                                   |
| `/people`, `/people/:id` | Safe lecturer directory, own labels/expertise, actual upcoming/current/past courses and authorised anonymised ratings.                   |
| `/my-reviews`            | Optional learners review actual completed enrolled courses; management enrols and moderates with MFA.                                    |
| `/client`                | Own-organisation course requests/full fee, commissioned spend and assigned lecturers.                                                    |
| `/admin/accounts`        | Versioned account API-backed role assignment, separate invitations, scoped client memberships and linked profile/status management.      |
| `/admin/people`          | Search people, attest declared expertise with UTC expiry, suspend/reactivate accounts with named confirmation.                           |
| `/topics`                | DE/EN topic/tool/programming-language hierarchy, aliases, authorized related templates and MFA-protected versioned CRUD/archive.         |
| `/availability`          | Own private available/unavailable windows; explicit reduced sharing with MFA management and transaction-safe assignment conflict checks. |
| `/notifications`         | Own cursor-paged inbox, current-authorized links, read/unread state and explicit due-reminder refresh.                                   |
| `/settings`              | Own versioned notification preferences; optional categories never disable committed-work receipts.                                       |
| `/admin/audit`           | MFA/current `audit.read` capability, bounded metadata search/filter/cursor pages and an exact reviewed action allowlist.                 |

New standalone administrative offers support 1–20 explicitly priced lecturer positions. Each position covers the whole offered block; existing, client-originated and CBW/course-originated offers retain their original single-position budget. Every session is reserved in one PostgreSQL transaction. Qualification validity, executed-contract prerequisites, remaining capacity, job/deadline/terms status and private calendar/unavailable-window/confirmed-assignment conflicts are checked server-side. Accepted rates/currency/terms remain immutable snapshots. Requests are idempotent and competing jobs for the same lecturer are serialised. Future uninvoiced assignments can be cancelled as a whole block, preserving history; an audited explicit reopening permits a replacement to claim. Started or invoiced work requires separate review. The management Kanban cannot drag a lecturer into confirmation. See [JOB_LIFECYCLE](docs/JOB_LIFECYCLE.md).

Admins gain no access to others' private appointments, availability notes, DMs or contract documents through these additions. Shared availability is explicitly opt-in; the audit view excludes private action families and all detail payloads. Contract/session reminders are generated by the user's explicit refresh, without a claimed background email or push service.

German/English and light/dark/system preferences persist locally. Server data are held only in memory; the service worker caches static application assets only. Claims, messages, file operations and all other mutations require online server confirmation. The PWA provides an offline shell and explicit connection state; it does not pretend offline actions succeeded.

## GitHub checks and coverage

Separate Build, Typecheck, Lint, Formatting, Code quality and Tests and coverage tasks complement the existing real SQL/API/browser/selfhost checks. Run `npm run test:coverage` for full-source frontend V8 reports and regression thresholds. CodeQL, Dependabot and the current Maintainer/Admin direct-merge exceptions are explained in [CI_QUALITY](docs/CI_QUALITY.md).

## Stack and layout

React + TypeScript + Vite, Tailwind v4, shadcn-style Radix/CVA primitives, Lucide, React Router, TanStack Query, React Hook Form/Zod, i18next and FullCalendar/Luxon. Supabase PostgreSQL/Auth/Edge Functions are the backend; no extra application server. Tiptap/lowlight provide safe wiki/forum editing; private Supabase Storage and an internal ClamAV service process uploads. Advanced administration and remaining product scope are recorded in the plan.

- `src/features/`: functional areas; `src/components/ui/`: reusable primitives; `src/lib/`: shared API/types/localisation/time handling.
- `supabase/migrations/`: relational schema, RLS, capability checks, locked claim/admin routines and audit.
- `supabase/functions/`: bounded audited invitations and authenticated document upload/download with actual ClamAV scanning.
- `supabase/templates/invite.html`: bilingual token-hash invitation template compatible with PKCE clients.
- `scripts/local-*`: isolated fictional setup and real HTTP checks; `scripts/db-*`: real PostgreSQL adversarial/concurrency tests.
- `tests/e2e/`: real Auth/API browser flows, accessibility and built-PWA tests.

Dependencies are exact-pinned with `package-lock.json`. All FullCalendar packages use matching version 6.1.22. Security overrides pin patched `glob` and `minimatch`; see [security checklist](docs/SECURITY_PRIVACY_CHECKLIST.md) for remaining build-tool advisories. Use `npm ci`, not an unreviewed blanket `audit fix --force`.

## Try the latest GitHub revision separately

```bash
./portal github
```

The launcher fetches current main into its own managed checkout and starts it at **http://127.0.0.1:5373**, with separate Supabase API `56321`, PostgreSQL `56322` and Mailpit `56324`. Normal development on `5173`/`543xx` and its data remain intact. The preview also preserves its own accounts, passwords, MFA and files across stop/start and permitted forward updates. Changed historical migrations or migrations requiring review are stopped before unintended application; the guide explains the concrete local migration plan.

`./portal github test` checks the latest commit separately without updating a running preview. Additional commands, requirements and specific handling of migrations requiring review are in the [GitHub preview guide](docs/GITHUB_LOCAL_PREVIEW.md).

## Run complete verification with one command

```bash
./portal test
```

The command uses a sanitized temporary checkout, a random owned Supabase project name and separate ports/volumes. Tests neither reset nor modify development data or active development accounts. Checks cover code/types/formatting/dependencies, Edge Functions, real SQL/RLS/concurrency, actual HTTP/invitation/Mailpit workflows, desktop/mobile browsers and the built offline PWA. A real stop/start check compares password, MFA, profile, private appointment and actual Storage object bytes.

Reports and protected failure artifacts live under `.local/tests/<run>/`. Only the isolated test stack is removed afterward. Individual npm/SQL/API checks remain available for targeted debugging; run mutating integration checks inside the isolated test environment. New test scripts must respect the URL/container variables documented in [LOCAL_DEVELOPMENT](docs/LOCAL_DEVELOPMENT.md).

Executed results and boundaries are recorded in [QA_RESULTS](docs/QA_RESULTS.md) and [WORKLOG](docs/WORKLOG.md). Local browser/PWA checks do not replace physical iOS/Safari installation or validation on the eventual host. CI does not publish production.

## Staging and production

The actual **self-hosted development instance** runs at **https://cms.luminovia.org** on the existing Hostinger **KVM 1**. Frontend, Supabase database/Auth/Storage/Realtime/Edge and ClamAV reside on this VPS. The user explicitly declined an upgrade; approximately 100 GB of documents remains a later expansion target. Current quotas are 10 GiB total and 1 GiB per owner. Test email is captured internally in Mailpit only. [Setup, protected configuration, tests and operation](docs/HOSTINGER_DEVELOPMENT.md).

Every five minutes, the VPS checks for successfully verified immutable GitHub releases from `main`. Backups, migrations, runtime configuration and atomic web activation belong to the [automatic development update](docs/HOSTINGER_AUTOMATIC_UPDATES.md); server credentials remain on the VPS. Major/risky database changes require reviewed maintenance. Automatic Ubuntu security updates are enabled.

The VPS uses pinned PostgreSQL 17.12. Following the controlled patch, all eight CMS API groups passed again, with 50 concurrent claim attempts producing exactly one complete winner, unchanged private file access using the existing password, and real WSS delivery/revocation. An external database-plus-file backup was successfully restored in isolation using both the original image and, in advance, the 17.12 candidate. [Reviewed pins and actual results](deploy/hostinger/selfhost/postgres-upgrade-provenance.json) are documented.

Caddy uses the stable `/opt/luminovia-portal/www` directory: `current` points to the active frontend release, while shared immutable assets remain reachable for already open clients. Data and secret configuration reside outside this web directory.

The following notes about the previously planned managed backend do not describe this self-hosted instance. Complete production acceptance with real users/SMTP, increased capacity and recurring external backups remains separately required. The public marketing website was not changed.

Use separate approved staging and production Supabase projects. Frontend build variables are `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` only. Never use server secret/service-role credentials in a `VITE_` variable. Disable signup, configure exact callback URLs, install the custom invitation template, configure approved SMTP, bootstrap the first admin through a controlled server process and require MFA. See [DEPLOYMENT_RUNBOOK](docs/DEPLOYMENT_RUNBOOK.md) for migration, invitation reconciliation, hosting headers, backups of **database plus Storage objects**, restore/rollback and release gates.

`public/.htaccess` is an un-deployed Apache/LiteSpeed reference template; the current VPS serves the portal through Caddy. Its SPA rewrite, no-referrer/CSP/security/cache headers must be tested on that actual host; adapt `connect-src` for an approved custom Supabase domain. Redact authentication query strings in hosting/access logs. A local Vite preview does not exercise Apache headers.

Stop managed local services with `./portal stop`; database and actual Storage files remain intact. Do not use `--no-backup` for development data.

## Documentation

[Documentation index](docs/README.md) · [Roadmap](ROADMAP.md) · [Changelog](CHANGELOG.md) · [Decision notes](docs/decisions/README.md)

[System audit](docs/SYSTEM_AUDIT.md) · [Developer guide](docs/DEVELOPER_GUIDE.md) · [Functional audit](docs/FUNCTIONAL_CODE_AUDIT.md) · [CBW templates](docs/CBW_TEMPLATES.md) · [Profile pictures](docs/PROFILE_AVATARS.md) · [Comments](docs/RESOURCE_COMMENTS.md) · [Taxonomy](docs/TAXONOMY.md) · [Availability](docs/AVAILABILITY.md) · [Job lifecycle/capacity](docs/JOB_LIFECYCLE.md) · [Dashboard](docs/DASHBOARD.md) · [Notifications](docs/NOTIFICATIONS.md) · [Administration audit](docs/ADMIN_AUDIT.md) · [GitHub preview](docs/GITHUB_LOCAL_PREVIEW.md) · [Product scope](docs/PRODUCT_SPEC.md) · [Architecture](docs/ARCHITECTURE.md) · [ERD](docs/ERD.md) · [Brand](docs/BRAND_DESIGN_SYSTEM.md) · [Plan](docs/IMPLEMENTATION_PLAN.md) · [Security review](docs/BACKEND_SECURITY_REVIEW.md) · [Test plan](docs/TEST_PLAN.md) · [User guide](docs/USER_GUIDE.md)

## Contributing on GitHub

The [contribution guide](CONTRIBUTING.md) explains setup, branches, testing and the path to merge. The [issue guide](docs/ISSUE_GUIDE.md) covers bugs and proposals; the [PR guide](docs/PULL_REQUEST_GUIDE.md) describes required labels, review and CI. Contributions in German and English are welcome; general project documentation is maintained in English and application UI changes require both languages. Report vulnerabilities through the private reporting channel.

Repository license: GNU GPLv3; the authentic Space Grotesk font retains its included OFL notice. Brand assets remain Luminovia assets.

## Verified M6 checkpoint

[PR #8](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/8) merged after the complete application and native retained-data CI passed: 177 source tests, 234 PostgreSQL cases, 18 actual business API suites, 70 desktop/mobile workflows and two built-PWA checks. [Exact evidence, screenshots and remaining acceptance boundaries](docs/QA_RESULTS.md).

## Account and revenue APIs

[Account/revenue specification](docs/ACCOUNTS_REVENUE_SPEC.md) · [Generated platform API reference](docs/API_REFERENCE.md) · [Server audit](docs/ACCOUNTS_PLATFORM_AUDIT.md). The current source reference inventories 125 public RPCs from an actual disposable migration replay; an inventory proves the interface exists, not that every branch has passed native end-to-end acceptance.

New commission offers default to 50% platform / 50% lecturer; only admin/owner can change the percentage. Customer total and platform amounts remain in private tables and never appear in lecturer job/claim/invoice responses. Legacy accepted net fees stay unchanged, and unknown historical customer totals remain unknown. Income/payment status is tracking data; no bank transfer or tax calculation is initiated.

The account facade `/functions/v1/accounts/v1/` supports own profile, bounded administrative account search, roles, activation, organisation grants and idempotent invitations. Its OpenAPI is `/functions/v1/accounts/openapi.json`; all existing domain features remain accessible through the same JWT's documented Supabase RPCs and document gateway. Administrative actions require current database capabilities and MFA. New fixtures are insert-only and are created automatically only in an empty local bootstrap; existing populated instances are never silently reseeded.

## CBW building blocks and developer checks

All 24 original CBW PDFs in the supplied source folder are represented by 22 canonical building blocks and 24 hashed source revisions. LPC3/LPC4 retain both document variants; a source file is never silently dropped or duplicated as another course. The catalogue stores teaching content and exact filename/hash/page/date references, with original source authors and unrelated metadata excluded. Original PDF binaries and local personal paths are not published. New migrations install missing canonical templates without rewriting existing edited templates.

Use the CBW tab in Courses, plan an actual run with its customer/sessions, then choose **Create teaching offer**. Content and session references come from that run; the form reuses the standard fee/terms editor. The server rejects a changed source preview or duplicate active offer and preserves the accepted agreement. See [CBW_TEMPLATES](docs/CBW_TEMPLATES.md) for original-source verification and safe later editions.

```bash
node scripts/code-integrity.mjs --exports
./portal test
```

The compiler-based inventory detects disconnected frontend modules, genuinely unused runtime exports, unresolved relative imports, invalid literal routes/assets and transitive RPC wrappers. The complete command also checks delivered documentation links, real database/API bindings, Auth/MFA errors, actual desktop/mobile business journeys and the inherited offline updater/release/Caddy/Envoy guards. CI invokes this same command rather than a separate smaller local test subset. The [M4 migration review](docs/REVIEWED_M4_MIGRATIONS.md) describes the hosted operator gate; a merged source release does not assert those migrations are installed. These checks describe executed coverage; the outstanding complete product and hosted/manual gates remain in the plan.
