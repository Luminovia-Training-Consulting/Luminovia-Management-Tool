# Luminovia Portal

Public fictional practice and bilingual guidance: [Guided demo and help](docs/GUIDED_DEMO_AND_HELP.md) (`/demo`, `/help`, and the signed-in Portal tour).

A real React/TypeScript Progressive Web App for Luminovia Training & Consulting. The local system connects invitation-only Supabase Auth, administrator MFA, bilingual profiles/evidence, teaching jobs and atomic allocation, calendar, private realtime chat, scanned files, wiki/forum, customers/courses and contract/invoice tracking. Individual client accounts, optional enrolled learners, safe course ratings, profile/invoice labels and server-enforced, privately configured role-specific compensation extend these workflows. Course building blocks become provenance-linked course templates and referenced teaching offers; secure scanned profile pictures and staff comments connect the same application. The M6 source adds taxonomy administration, private availability, audited job lifecycle and explicit lecturer positions, personal dashboard previews, notification preferences/inbox and a reduced administrative audit reader. It is **not the complete production product yet**. See the [implementation plan](docs/IMPLEMENTATION_PLAN.md) for the entire outstanding scope.

The current M7/M8 candidate adds paginated file/job discovery, private saved views and file organisation, structured chat mentions, quiet hours, versioned announcements, global-calendar administration, purpose-scoped course/offer choices and explicit evidence tied to an exact certificate version. It now combines **27 unchanged released main migrations and nine pending extensions (36 total)**. Current-main integration and the archive-read correction require fresh exact-head application/native/security/package checks before merge; historical passes below do not replace that gate. The [documentation index](docs/README.md) is the central developer entry point; the [implementation plan](docs/IMPLEMENTATION_PLAN.md) retains the entire outstanding scope.

The user's [Universal Master Prompt](docs/UNIVERSAL_MASTER_PROMPT.txt) is preserved verbatim and is the authoritative project specification. On continuation, read [WORKLOG](docs/WORKLOG.md) first, then the plan and [AGENTS.md](AGENTS.md). The public Website repository is a read-only brand reference; it has not been changed.

## Requirements

- Linux (CachyOS locally, Ubuntu in CI), Node.js 26 LTS (tested with 26.13.1), npm, Docker Engine and the Docker Compose plugin supporting [healthcheck `start_interval`](https://docs.docker.com/reference/compose-file/services/#healthcheck) (Compose 2.20.2 or later). Python 3, Linux util-linux `flock` and official `age`/`age-keygen` 1.x (tested 1.3.2) are additionally required by the complete local release/update verification.
- Loopback ports 5173, 54321, 54322 and 54324 available. Local Docker services require several GB of disk space.
- Supabase CLI 3.1.0 and Deno 2.9.6 are pinned development dependencies; inspect their `--help` before database/remote operations.

## Start and test the latest GitHub version separately

```bash
./portal github start   # fetch the latest main commit and start its separate preview
./portal github test    # verify the latest main commit in a fully isolated environment
```

Open the preview at **http://127.0.0.1:5373**. The launcher fetches `origin/main` from the fixed project repository into a managed checkout and displays its exact commit ID. Your working files and normal development data on `5173`/`543xx` are preserved. The preview has its own Supabase API on `56321`, PostgreSQL on `56322` and Mailpit on `56324`; its accounts, passwords, MFA and files survive stop/start and permitted forward updates. `./portal github` is shorthand for `start`.

```bash
./portal github status        # saved commit ID, service status and URLs
./portal github credentials   # deliberately display the original fictional preview password
./portal github update        # update while preserving preview data
./portal github stop          # stop only the preview, preserving its data
```

`github test` uses a separate test checkout and does not update a running preview. Fetch errors are reported; an old version is never presented as the latest source. Rewritten historical migrations or changes requiring review are stopped before unintended application. Prerequisites, memory needs and the concrete local migration plan are documented in the [GitHub preview guide](docs/GITHUB_LOCAL_PREVIEW.md).

## Start locally with one command

Development and testing run on the local PC by default. Use `./portal check` for
fast quality, coverage and build feedback while editing, then `./portal test` for
complete isolated acceptance before delivery. Use `./portal github test` for freshly fetched `main`, and
`./portal github` for a persistent latest-main preview. These need no GitHub
deployment or self-hosted Actions runner. Automatic GitHub quality/security
checks remain; CMS releases and PR deployment records require an explicit manual
publication action.

```bash
./portal start
```

The command installs locked npm dependencies when needed and starts the complete local system: PostgreSQL, Supabase Auth/Storage/Realtime, Edge Functions, malware scanner, Mailpit and React/Vite. It applies new migrations without resetting data. Fictional examples are created only during the first empty initialization.

Open <http://127.0.0.1:5173>. Local emails are captured only in [Mailpit](http://127.0.0.1:54324). A fresh empty installation creates eleven fictional lecturers, `lecturer01@example.invalid` through `lecturer11@example.invalid`, plus `admin@example.invalid`, `participant@example.invalid`, `carina@example.invalid` (platform-owner demo) and `client@example.invalid` (client demo). These are separate fictional Auth accounts; real invitees set their own passwords.

```bash
./portal credentials   # deliberately display the original local test password
./portal status        # service status and URLs
./portal stop          # stop while preserving data
./portal restart       # restart while preserving data
```

Passwords, MFA, profile changes, verifications, suspensions, jobs, calendars and actual Storage files survive stop/start. Normal startup does not reset profiles or passwords. Credentials remain in the protected, ignored `.local/ACCOUNTS.txt`; server keys never enter Git or the browser bundle. Administrators enroll MFA through the real security dialog.

`./portal up` stays attached to the terminal; Ctrl+C stops services without deleting their data. Background startup remains active until `./portal stop`. First startup downloads images and initializes scanner signatures. The scanner has a 4 GB RAM limit; simultaneous development and verification need enough memory for two independent local stacks.

See [LOCAL_DEVELOPMENT](docs/LOCAL_DEVELOPMENT.md) for operation, troubleshooting and persistence boundaries. A Docker volume provides persistent local storage, not an external backup.

## Current development and acceptance status

The latest completed local archive-correction checkpoint (`c808caa`) passes **515 frontend cases / 65 files**, **51 focused file cases**, types/lint/format/compiler checks and the production/PWA build. The preceding accepted publication-control integration passed **100 runtime cases**. A deterministic regression was red before the archive-read fix and green afterwards. The final earlier head `0b615a7` correctly failed 111/112 application browsers; it is not reported as accepted. Integrating actual main `e88df84`, including the neutral catalogue and the unchanged released 27-migration prefix, requires fresh source-specific verification. Current results belong in [WORKLOG](docs/WORKLOG.md) and [QA_RESULTS](docs/QA_RESULTS.md).

### Historical source-bound checkpoints

**Historical complete 32-migration result:** exact [CI43794921492](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43794921492) and local source `9c42730` failed acceptance. All 316 SQL cases, 26 actual business API suites, 46 Edge tests and real restart persistence passed; business browsers finished **92 passed / 2 failed out of 94**. Both global-calendar journeys lost the open detail after DE→EN. Build/PWA and native selfhost acceptance were not reached. Earlier failed runs remain in [WORKLOG](docs/WORKLOG.md).

Signed correction `bf09f19` preserves details for identical visible ranges. Its regression failed before the fix, then all 12 Calendar component cases, TypeScript, focused lint and formatting passed. The App/Shell merge passed another 78 focused tests across nine files. Accepted [PR16](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/16), main `e75f55d`, adds the public guided demo/help and authenticated tour; its independent acceptance does not certify the combined M7/M8 source.

**Historical functional preflight passed 372/372 tests across 57 files**, with all configured V8 coverage floors satisfied: statements 57.65%, branches 52.32%, functions 49.11%, lines 59.46%. That checkpoint's compiler inventory found 135 reachable modules and 34 routes without connectivity/export errors. Browser collection discovers 106 business cases plus two built-PWA cases; collection is not execution or a pass. A fresh full isolated and exact-source CI acceptance of the corrected integration remains pending. The historical 342-test/128-module/32-route snapshots below are revision-specific, not the measured counts of this integration.

**M6 passed complete local and exact-commit CI acceptance before merging.** [PR #8](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/8) merged as `dc8e9a7` after actual Auth/MFA, Storage, permission, concurrency, browser, PWA and stop/start persistence checks. The subsequent reproduced theme-contrast fix passed both exact CI gates before [PR #9](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/9) merged as `9c2103b`. Application acceptance and the separate retained-data selfhost-image verification are recorded; they do not establish complete production readiness.

Separately, the incoming Main checkpoint `1341b16` passed [all nine CI jobs](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43788369925): 197 unit/component tests, 234 SQL cases, 18 actual business API suites, 72 desktop/mobile browser cases, persistence, built-PWA and real selfhost compatibility. These historical results do not verify the later M7/M8 integration.

**The pre-merge M7/M8 source with the file-dialog correction passed preflight; complete native 32-migration acceptance and exact CI for the integrated source remain pending.** At `1adc134`, 316 Vitest cases passed in 53 files. The compiler inventory found 128 reachable modules and 32 routes without graph errors; an actual replay of 32 migrations inventoried 155 public RPCs. These counts belong to that source revision and do not automatically apply after integration with Main. Focused database/Edge checks are recorded in the feature guides. They do not replace a complete Auth, Storage, scanner, browser and retained-data run. Authored API/browser cases count as passed only after actual execution. [QA_RESULTS](docs/QA_RESULTS.md) and [WORKLOG](docs/WORKLOG.md) hold the actual evidence.

Connected features and their limits are documented in [Files](docs/FILES.md), [job discovery and saved views](docs/JOB_DISCOVERY.md), [chat and mentions](docs/CHAT.md), [notifications and quiet hours](docs/NOTIFICATIONS.md) and [announcements](docs/ANNOUNCEMENTS.md). M8 adds [purpose-scoped offer/course choices](docs/JOB_PICKERS.md), [global calendar publications](docs/CALENDAR.md) and [qualification evidence and history](docs/QUALIFICATIONS.md). Remaining product scope and acceptance work stay in the complete plan.

The contribution guides merged in [PR #6](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/6) (`18ce633`), and the independent GitHub preview launcher in [PR #7](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/7) (`5f89986`). The catalogue contains 30 managed labels alongside nine preserved GitHub defaults. Public contribution guidance, issue forms and pull request instructions use English. The [GitHub administration guide](docs/GITHUB_WORKFLOW.md) records all three active rulesets: only CarinaSchoppe's personal account (`User:29256704`) has a PR-only review exception. Every other account needs independent review, and all 15 required checks and signatures remain mandatory for everyone.

## Implemented routes

| Route                    | Function                                                                                                                                    |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `/demo`, `/demo/*`       | Public, explicitly fictional25-module guided practice; in-memory exercises never perform real business mutations.                           |
| `/help`                  | Public bilingual searchable workflows, module deep links and practical recovery guidance.                                                   |
| `/login`                 | Real email/password sign-in and password recovery; no public signup.                                                                        |
| `/auth/callback`         | Explicit one-time invitation acceptance; PKCE recovery callback.                                                                            |
| `/auth/password`         | Set a password after an authenticated invite/recovery.                                                                                      |
| `/`                      | Personal job suggestions, calendar/chat/notification/file previews, own contract receipts and capability-scoped management follow-ups.      |
| `/jobs`, `/jobs/:id`     | Server-paged search/sorting, own saved views, exact detail, localised sessions/fees, terms acceptance and atomic allocation.                |
| `/calendar`              | Private appointments, confirmed assignments, visible-window global-event pages and explicit MFA-protected draft/publication/archive.        |
| `/profile`               | DE/EN biography, contact/timezone, expertise, private CV/certificate uploads and consent to share one exact certificate version per topic.  |
| `/chats`                 | Private DMs, staff/group/course rooms; realtime, structured mentions, scanned files and purpose-scoped participant-course choices.          |
| `/files`                 | Server-paged search, own tags/folders; scanning, authorised exact-file dialogs/downloads, history, replace/archive and scoped offer choice. |
| `/wiki`, `/forum`        | Safe rich text/code, drafts/publication/revisions; threads, replies, accepted answers, subscriptions and moderation.                        |
| `/clients`               | MFA/capability-protected customer records, private contacts/notes, tags and archive.                                                        |
| `/courses`               | Reusable templates, actual runs/sessions, safe duplication and explicit publication.                                                        |
| `/contracts`             | Executed PDF versions/hashes, master/addendum chain, private downloads and receipt history. A receipt is not an e-signature.                |
| `/finance`               | Accepted-assignment earnings, scanned invoice PDFs, review, partial/full payments and authorised CSV with separate currencies.              |
| `/search`                | Permission-aware jobs, documents, messages, safe wiki/forum results and minimal chat contacts.                                              |
| `/security`              | Real Auth TOTP enrollment/challenge; administrative actions require AAL2 at the database.                                                   |
| `/admin`                 | Atomic course/job creation, publication/archive, lecturer invitations.                                                                      |
| `/people`, `/people/:id` | Safe lecturer directory, own labels/expertise, actual upcoming/current/past courses and authorised anonymised ratings.                      |
| `/my-reviews`            | Optional learners review actual completed enrolled courses; management enrols and moderates with MFA.                                       |
| `/client`                | Own-organisation course requests/full fee, commissioned spend and assigned lecturers.                                                       |
| `/admin/accounts`        | Versioned account API-backed role assignment, separate invitations, scoped client memberships and linked profile/status management.         |
| `/admin/people`          | Search people, review explicitly shared certificate evidence/history, attest expertise with UTC expiry and suspend/reactivate accounts.     |
| `/topics`                | DE/EN topic/tool/programming-language hierarchy, aliases, authorized related templates and MFA-protected versioned CRUD/archive.            |
| `/availability`          | Own private available/unavailable windows; explicit reduced sharing with MFA management and transaction-safe assignment conflict checks.    |
| `/notifications`         | Own cursor-paged inbox, current-authorized links, read/unread state and explicit due-reminder refresh.                                      |
| `/announcements`         | Current audience-authorised DE/EN publications, cursor pages and own revision-specific acknowledgement; up to three shell banners.          |
| `/settings`              | Own versioned notification preferences and timezone-aware in-app quiet hours; inbox and critical receipts remain available.                 |
| `/admin/audit`           | MFA/current `audit.read` capability, bounded metadata search/filter/cursor pages and an exact reviewed action allowlist.                    |
| `/admin/announcements`   | Current capability/MFA, immutable revisions, separate drafts, publish/archive/recover and bounded search; no background scheduler.          |

New standalone administrative offers support 1–20 explicitly priced lecturer positions. Each position covers the whole offered block; existing, client-originated and course-originated offers retain their original single-position budget. Every session is reserved in one PostgreSQL transaction. Qualification validity, executed-contract prerequisites, remaining capacity, job/deadline/terms status and private calendar/unavailable-window/confirmed-assignment conflicts are checked server-side. Accepted rates/currency/terms remain immutable snapshots. Requests are idempotent and competing jobs for the same lecturer are serialised. Future uninvoiced assignments can be cancelled as a whole block, preserving history; an audited explicit reopening permits a replacement to claim. Started or invoiced work requires separate review. The management Kanban cannot drag a lecturer into confirmation. See [JOB_LIFECYCLE](docs/JOB_LIFECYCLE.md).

Admins gain no access to others' private appointments, availability notes, DMs or contract documents through these additions. Shared availability is explicitly opt-in; the audit view excludes private action families and all detail payloads. Contract/session reminders are generated by the user's explicit refresh, without a claimed background email or push service.

Downloading another lecturer's qualification evidence requires current `qualifications.verify` and MFA plus an active explicit evidence binding to one certificate version. It grants no general CV, contract or certificate-library access; the separate existing `users.manage`/MFA CV permission and manual qualification attestation remain. Course/offer pickers return purpose-authorised metadata, not additional financial or job-detail rights. The administrative Kanban still shows the newest **500** offers with an explicit limit notice; it is separate from paginated marketplace discovery. Global-event management is bounded to the visible calendar window. See the [permission architecture](docs/ARCHITECTURE.md) and individual feature guides for exact limits.

The authenticated **Portal tour** explains only destinations available to the current account and navigates after explicit choice. Pause/resume/restart stores only validated per-account step/status in browser session storage; it grants no permissions and confirms no business actions. [Guided demo, tour and help boundaries](docs/GUIDED_DEMO_AND_HELP.md).

German/English and light/dark/system preferences persist locally. Server data are held only in memory; the service worker caches static application assets only. Claims, messages, file operations and all other mutations require online server confirmation. The PWA provides an offline shell and explicit connection state; it does not pretend offline actions succeeded.

## GitHub checks and coverage

Separate Build, Typecheck, Lint, Formatting, Code quality and Tests and coverage tasks complement the existing real SQL/API/browser/selfhost checks. Run `npm run test:coverage` for full-source frontend V8 reports and regression thresholds. CodeQL, Dependabot and Carina's personal PR-only review exception, with mandatory CI/signatures for everyone and independent review for all other accounts, are explained in [CI_QUALITY](docs/CI_QUALITY.md).

## Stack and layout

React + TypeScript + Vite, Tailwind v4, shadcn-style Radix/CVA primitives, Lucide, React Router, TanStack Query, React Hook Form/Zod, i18next and FullCalendar/Luxon. Supabase PostgreSQL/Auth/Edge Functions are the backend; no extra application server. Tiptap/lowlight provide safe wiki/forum editing; private Supabase Storage and an internal ClamAV service process uploads. Advanced administration and remaining product scope are recorded in the plan.

- `src/features/`: functional areas; `src/components/ui/`: reusable primitives; `src/lib/`: shared API/types/localisation/time handling.
- `supabase/migrations/`: relational schema, RLS, capability checks, locked claim/admin routines and audit.
- `supabase/functions/`: bounded audited invitations and authenticated document upload/download with actual ClamAV scanning.
- `supabase/templates/invite.html`: bilingual token-hash invitation template compatible with PKCE clients.
- `scripts/local-*`: isolated fictional setup and real HTTP checks; `scripts/db-*`: real PostgreSQL adversarial/concurrency tests.
- `tests/e2e/`: real Auth/API browser flows, accessibility and built-PWA tests.

Dependencies are exact-pinned with `package-lock.json`. All FullCalendar packages use matching version 6.1.22. Security overrides pin patched `glob` and `minimatch`; see [security checklist](docs/SECURITY_PRIVACY_CHECKLIST.md) for remaining build-tool advisories. Use `npm ci`, not an unreviewed blanket `audit fix --force`.

## Run complete verification with one command

For fast edit feedback, run `./portal check` first. It runs local quality,
coverage and a synthetic-config production build without starting Docker
services or publishing a package. Complete business acceptance still uses:

```bash
./portal test
```

The command uses a sanitized temporary checkout, a random independent Supabase project and separate ports/volumes. It preserves normal development data and accounts. Checks cover source, types, formatting, dependencies, Edge Functions, actual SQL/RLS/concurrency, HTTP/invitation/Mailpit workflows, desktop/mobile browsers and the built offline PWA. A real stop/start check compares passwords, MFA, profile, private event and actual Storage object bytes.

Reports and protected failure artifacts stay under `.local/tests/<run>/`. Only the isolated test stack is removed afterwards. Individual npm/SQL/API checks remain available for focused debugging; run mutating integration checks inside the isolated environment. New scripts must respect the URL/container variables documented in [LOCAL_DEVELOPMENT](docs/LOCAL_DEVELOPMENT.md).

Executed results and limits are recorded in [QA_RESULTS](docs/QA_RESULTS.md) and [WORKLOG](docs/WORKLOG.md). Local browser/PWA checks do not establish physical iOS/Safari installation or acceptance on a later host. CMS development packages require an authorised manual `Portal checks` run on `main`, `publish_release=true`, the exact current `main` SHA in `expected_commit` and all existing verification gates. Ordinary pushes, merges and manual verification runs do not publish a release.

## Staging and production

The actual **self-hosted development instance** runs at **https://cms.luminovia.org** on the existing Hostinger **KVM 1**. The frontend, Supabase Database/Auth/Storage/Realtime/Edge and ClamAV share this VPS. The user explicitly declined a capacity upgrade; approximately 100 GB of documents is a future target. Current quotas are 10 GiB total and 1 GiB per owner. Test emails are captured in internal Mailpit. See [setup, private configuration, verification and operation](docs/HOSTINGER_DEVELOPMENT.md).

The existing VPS updater checks every five minutes for successfully tested immutable GitHub releases from `main`; its timer has not been changed by the local-first workflow. New releases are now published only by explicit manual request, so normal merges no longer supply it with automatic updates. [Automatic development updates](docs/HOSTINGER_AUTOMATIC_UPDATES.md) cover backups, migrations, runtime configuration and atomic frontend promotion; server credentials remain on the VPS. Major or risky database changes require reviewed maintenance. Ubuntu security updates are enabled automatically.

The VPS uses the pinned PostgreSQL 17.12 image. After its controlled patch, all eight CMS API groups passed again, including 50 concurrent claims with one complete winner, the unchanged private file with the saved password, and actual WSS delivery/revocation. An off-server database-plus-file backup was restored in isolation using both the original image and the reviewed 17.12 candidate. The [verified pins and actual results](deploy/hostinger/selfhost/postgres-upgrade-provenance.json) are recorded.

Caddy mounts the stable `/opt/luminovia-portal/www` directory: `current` points to the active frontend release, while shared immutable assets remain available to existing clients. Data and secret configuration stay outside this web directory.

The following managed-backend notes describe an earlier deployment option, not the current self-hosted instance. Production approval with real users/SMTP, larger capacity and recurring off-site retention remains separate. The public marketing site has not been changed.

Use separate approved staging and production Supabase projects. Frontend build variables are `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` only. Never use server secret/service-role credentials in a `VITE_` variable. Disable signup, configure exact callback URLs, install the custom invitation template, configure approved SMTP, bootstrap the first admin through a controlled server process and require MFA. See [DEPLOYMENT_RUNBOOK](docs/DEPLOYMENT_RUNBOOK.md) for migration, invitation reconciliation, hosting headers, backups of **database plus Storage objects**, restore/rollback and release gates.

`public/.htaccess` is an undeployed Apache/LiteSpeed reference template; the current VPS serves the portal through Caddy. Test its SPA rewrite, no-referrer/CSP/security/cache headers on the actual target host and adapt `connect-src` for an approved custom Supabase domain. Redact authentication query strings in hosting/access logs. A local Vite preview does not exercise Apache headers.

Stop managed local services with `./portal stop`; database and actual Storage files are retained. Do not use `--no-backup` for development data.

## Documentation

[Agent working guide](AGENTS.md) · [SQL migration reading guide](docs/MIGRATION_GUIDE.md). Maintain the comprehensive English source comments with their actual contracts and preserve released migration bytes.

[Central developer documentation index](docs/README.md) — reading order, architecture, feature guides, APIs, test evidence, security and operations. The [user guide](docs/USER_GUIDE.md) explains connected account workflows.

[Roadmap](ROADMAP.md) · [Changelog](CHANGELOG.md) · [Decision notes](docs/decisions/README.md) · [Guided demo, help and tour](docs/GUIDED_DEMO_AND_HELP.md)

[Developer guide](docs/DEVELOPER_GUIDE.md) · [Architecture](docs/ARCHITECTURE.md) · [ERD](docs/ERD.md) · [Generated API reference](docs/API_REFERENCE.md) · [Plan](docs/IMPLEMENTATION_PLAN.md) · [Product scope](docs/PRODUCT_SPEC.md) · [Brand](docs/BRAND_DESIGN_SYSTEM.md)

[Files](docs/FILES.md) · [Job discovery](docs/JOB_DISCOVERY.md) · [Job lifecycle/capacity](docs/JOB_LIFECYCLE.md) · [Job/course pickers](docs/JOB_PICKERS.md) · [Calendar](docs/CALENDAR.md) · [Qualifications](docs/QUALIFICATIONS.md)

[Chat](docs/CHAT.md) · [Notifications/quiet hours](docs/NOTIFICATIONS.md) · [Announcements](docs/ANNOUNCEMENTS.md) · [Dashboard](docs/DASHBOARD.md) · [GitHub preview](docs/GITHUB_LOCAL_PREVIEW.md)

[Course templates](docs/COURSE_BUILDING_BLOCKS.md) · [Profile pictures](docs/PROFILE_AVATARS.md) · [Comments](docs/RESOURCE_COMMENTS.md) · [Taxonomy](docs/TAXONOMY.md) · [Availability](docs/AVAILABILITY.md) · [Administration audit](docs/ADMIN_AUDIT.md) · [User guide](docs/USER_GUIDE.md)

[System audit](docs/SYSTEM_AUDIT.md) · [Functional audit](docs/FUNCTIONAL_CODE_AUDIT.md) · [Security review](docs/BACKEND_SECURITY_REVIEW.md) · [Test plan](docs/TEST_PLAN.md) · [Executed QA results](docs/QA_RESULTS.md)

[CI quality and coverage](docs/CI_QUALITY.md) · [Code scanning baseline review](docs/CODE_SCANNING_TRIAGE.md) · [GitHub rules and maintenance App](docs/GITHUB_WORKFLOW.md)

[Personal welcome guide](docs/WELCOME_GUIDE.md) · [Checked local PR preview packages](docs/PR_PREVIEWS.md).

## Contributing on GitHub

[CONTRIBUTING](CONTRIBUTING.md) explains setup, branches, tests and the path to merge. The [issue guide](docs/ISSUE_GUIDE.md) covers bugs, questions and proposals; the [pull request guide](docs/PULL_REQUEST_GUIDE.md) explains required labels, review and CI. The shared catalogue contains 36 managed labels; every PR needs exactly one `type:*`, exactly one `risk:*` and at least one `area:*`. The reviewed rules give only `CarinaSchoppe` a personal PR-only review exception; all 15 required checks and history/signature rules remain mandatory. Other maintainers, administrators, bots and the maintenance App gain no such exception from role membership. The [GitHub administration guide](docs/GITHUB_WORKFLOW.md) records the reviewed snapshot, live-rule boundary and manual-only publication policy. Use English for issues, pull requests and community documentation; product UI strings remain German/English. Report vulnerabilities through the private route in [SECURITY](SECURITY.md).

Repository license: GNU GPLv3; the authentic Space Grotesk font retains its included OFL notice. Brand assets remain Luminovia assets.

## Verified M6 checkpoint

[PR #8](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/8) merged after the complete application and native retained-data CI passed: 177 source tests, 234 PostgreSQL cases, 18 actual business API suites, 70 desktop/mobile workflows and two built-PWA checks. [Exact evidence, screenshots and remaining acceptance boundaries](docs/QA_RESULTS.md).

## Account and revenue APIs

[Current delegated roles and private pricing](docs/DELEGATED_ROLES_PRICING.md) · [Foundational account/revenue specification](docs/ACCOUNTS_REVENUE_SPEC.md) · [Generated platform API reference](docs/API_REFERENCE.md) · [Server audit](docs/ACCOUNTS_PLATFORM_AUDIT.md). The source reference inventories public RPCs from an actual disposable migration replay; an inventory proves the interface exists, not that every branch has passed native end-to-end acceptance.

New role-priced offers require a confidential compensation policy configured by authorised Administration with current MFA. The server captures the policy for each offer and returns only the current actor's permitted quote; later policy changes do not rewrite accepted amounts. Public source provides no business-percentage default. Customer total and platform amounts remain in private tables and never appear in lecturer job/claim/invoice responses. Legacy accepted net fees stay unchanged, and unknown historical customer totals remain unknown. Income/payment status is tracking data; no bank transfer or tax calculation is initiated.

The account facade `/functions/v1/accounts/v1/` supports own profile, bounded administrative account search, roles, activation, organisation grants and idempotent invitations. Its OpenAPI is `/functions/v1/accounts/openapi.json`; all existing domain features remain accessible through the same JWT's documented Supabase RPCs and document gateway. Administrative actions require current database capabilities and MFA. New fixtures are insert-only and are created automatically only in an empty local bootstrap; existing populated instances are never silently reseeded.

## Course building blocks and developer checks

Course templates are reusable across customers. Create customer organisations in **Customers**, then associate each actual course run with its selected organisation. Invited client accounts receive access through explicit organisation memberships and current server permissions. Public documentation, examples and screenshots use customer-neutral descriptions or clearly fictional organisations; real customer names and records stay out of the repository.

All 24 supplied source PDFs are represented by 22 canonical building blocks and 24 hashed source revisions. LPC3/LPC4 retain both document variants; a source file is never silently dropped or duplicated as another course. The catalogue stores teaching content and exact filename/hash/page/date references, with original source authors and unrelated metadata excluded. Original PDF binaries and local personal paths are not published. New migrations install missing canonical templates without rewriting existing edited templates.

Open **Courses → Course building blocks**, plan an actual run with the selected customer and sessions, then choose **Create teaching offer**. Content and session references come from that run; the form reuses the standard fee/terms editor. The server rejects a changed source preview or duplicate active offer and preserves the accepted agreement. See [COURSE_BUILDING_BLOCKS](docs/COURSE_BUILDING_BLOCKS.md) for original-source verification and safe later editions.

```bash
node scripts/code-integrity.mjs --exports
./portal test
```

The compiler-based inventory detects disconnected frontend modules, genuinely unused runtime exports, unresolved relative imports, invalid literal routes/assets and transitive RPC wrappers. The complete command also checks delivered documentation links, real database/API bindings, Auth/MFA errors, actual desktop/mobile business journeys and the inherited offline updater/release/Caddy/Envoy guards. CI invokes this same command rather than a separate smaller local test subset. The [M4 migration review](docs/REVIEWED_M4_MIGRATIONS.md) describes the hosted operator gate; a merged source release does not assert those migrations are installed. These checks describe executed coverage; the outstanding complete product and hosted/manual gates remain in the plan.
