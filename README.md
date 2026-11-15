# Luminovia Portal

A real React/TypeScript Progressive Web App for Luminovia Training & Consulting. The first development milestone connects invitation-only Supabase Auth, administrator MFA, bilingual profiles/expertise, teaching jobs, transactional first-come-first-served allocation and a private calendar. It is **not the complete production product yet**. See the [implementation plan](docs/IMPLEMENTATION_PLAN.md) for the entire outstanding scope.

The user's [Universal Master Prompt](docs/UNIVERSAL_MASTER_PROMPT.txt) is preserved verbatim and is the authoritative project specification. On continuation, read [WORKLOG](docs/WORKLOG.md) first, then [AGENTS.md](AGENTS.md) and the plan. The public Website repository is a read-only brand reference; it has not been changed.

## Requirements

- Node.js 26 LTS (tested with 26.13.1), npm and Docker Engine.
- Loopback ports 5173, 54321, 54322 and 54324 available. Local Docker services require several GB of disk space.
- Supabase CLI 3.1.0 and Deno 2.9.6 are pinned development dependencies; inspect their `--help` before database/remote operations.

## Start an isolated local development instance

```bash
npm ci
bash scripts/local-start.sh
node scripts/local-seed.mjs
bash scripts/local-functions.sh
```

Keep the functions command in its own terminal. In another terminal:

```bash
npm run dev -- --port 5173 --strictPort
```

Open <http://127.0.0.1:5173>. `local-start.sh` starts only this project's local Supabase services, applies migrations on first startup and writes ignored `.env.local` (public browser values) and `.env.test.local` (server/test credentials). The local scripts reject non-loopback targets. They never seed hosted projects. Starting again regenerates the local fixture password: rerun `local-seed.mjs` afterwards. Existing user data are not removed by seeding; only known fictional fixtures are updated.

Fixtures include **eleven fictional lecturer profiles**, a fictional administrator and participant, expertise, executed-contract metadata and teaching jobs with five sessions. The seed uses reserved `example.invalid` addresses. Inspect the private `.env.test.local` on your own machine for the generated fixture password; it is deliberately not in this README, Git or the browser bundle. Account emails are `lecturer01@example.invalid` through `lecturer11@example.invalid`, plus `admin@example.invalid` and `participant@example.invalid`.

Local emails appear only in [Mailpit](http://127.0.0.1:54324). No real email is sent. The invitation Edge Function is explicitly enabled by `local-functions.sh` only for approved loopback origins. An administrator must set up/verify TOTP at **Account security / Kontosicherheit** before administration permissions appear. No browser role selector or fake authentication bypass exists.

For an existing local database, a **destructive local-only rebuild** is available for migration acceptance, not routine startup:

```bash
npx --no-install supabase db reset --no-seed --yes
node scripts/local-seed.mjs
```

Do not point reset/seed/test scripts at real or hosted data.

## Implemented routes

| Route | Function |
| --- | --- |
| `/login` | Real email/password sign-in and password recovery; no public signup. |
| `/auth/callback` | Explicit one-time invitation acceptance; PKCE recovery callback. |
| `/auth/password` | Set a password after an authenticated invite/recovery. |
| `/` | Real open jobs, personal assignment counts and upcoming sessions. |
| `/jobs`, `/jobs/:id` | Combined filters, localised sessions/fees, exact-version terms acceptance and atomic allocation. |
| `/calendar` | Private appointments, confirmed assignments, published global events and month/week/day/agenda views. |
| `/profile` | Persisted DE/EN biography, contact/timezone and self-declared expertise. |
| `/security` | Real Auth TOTP enrollment/challenge; administrative actions require AAL2 at the database. |
| `/admin` | Atomic course/job creation, publication/archive, lecturer invitations. |
| `/admin/people` | Search people, attest declared expertise with UTC expiry, suspend/reactivate accounts with named confirmation. |

Single-slot jobs are supported in this milestone. Every session in a multi-day job is reserved in one PostgreSQL transaction. Qualification validity, executed-contract prerequisites, job/deadline/terms status and private/confirmed calendar conflicts are checked server-side. Accepted rates/currency/terms are immutable snapshots. Requests are idempotent and competing jobs for the same lecturer are serialised. Admins cannot read private calendar entries merely because they are admins.

German/English and light/dark/system preferences persist locally. Server data are held only in memory; the service worker caches static application assets only. Claims, messages (future scope), file operations (future scope) and all current mutations require online server confirmation. The PWA provides an offline shell and explicit connection state; it does not pretend offline actions succeeded.

## Stack and layout

React + TypeScript + Vite, Tailwind v4, shadcn-style Radix/CVA primitives, Lucide, React Router, TanStack Query, React Hook Form/Zod, i18next and FullCalendar/Luxon. Supabase PostgreSQL/Auth/Edge Functions are the backend; no extra application server. Chat, Storage, wiki/forum, finance and advanced administration remain planned vertical slices, not decorative placeholder routes.

- `src/features/`: functional areas; `src/components/ui/`: reusable primitives; `src/lib/`: shared API/types/localisation/time handling.
- `supabase/migrations/`: relational schema, RLS, capability checks, locked claim/admin routines and audit.
- `supabase/functions/invite-lecturer/`: bounded audited invitation delivery with retry deduplication.
- `supabase/templates/invite.html`: bilingual token-hash invitation template compatible with PKCE clients.
- `scripts/local-*`: isolated fictional setup and real HTTP checks; `scripts/db-*`: real PostgreSQL adversarial/concurrency tests.
- `tests/e2e/`: real Auth/API browser flows, accessibility and built-PWA tests.

Dependencies are exact-pinned with `package-lock.json`. All FullCalendar packages use matching version 6.1.22. Security overrides pin patched `glob` and `minimatch`; see [security checklist](docs/SECURITY_PRIVACY_CHECKLIST.md) for remaining build-tool advisories. Use `npm ci`, not an unreviewed blanket `audit fix --force`.

## Verification

```bash
npm run lint
npm run typecheck
npm run format:check
npm test
npm run test:db
node scripts/local-api-check.mjs
npx --no-install deno test supabase/functions/invite-lecturer/handler_test.ts
npx --no-install deno check supabase/functions/invite-lecturer/index.ts
npx playwright install chromium
npm run test:e2e
npm run build
npm audit --omit=dev
```

With the local function runtime running, also execute `node scripts/local-invite-check.mjs`. It checks actual admin TOTP, Edge delivery, deduplication and one captured local Mailpit message. A freshly captured invitation can be consumed with `E2E_MAILPIT_INVITE=1 npx playwright test tests/e2e/onboarding.spec.ts --project=desktop-chromium` exactly once.

The PostgreSQL test harness creates a disposable database inside **this local stack**, applies the actual migrations, uses real RLS/database roles with compatible `auth.uid()`/JWT test stubs and drops it afterwards. The separate HTTP harness uses actual Auth-issued tokens and PostgREST, including 50 concurrent claims. They establish different guarantees; neither is a hosted production test.

Built-PWA checks require `npm run preview -- --port 4173 --strictPort` in another terminal, then `E2E_PWA=1 E2E_BASE_URL=http://127.0.0.1:4173 npx playwright test tests/e2e/pwa.spec.ts`. They inspect manifest, real service-worker control, offline deep links and absence of private API URLs in Cache Storage. Manual native installation and Safari/iOS testing remain separate acceptance gates.

Actual executed results and limitations are recorded in [QA_RESULTS](docs/QA_RESULTS.md) and [WORKLOG](docs/WORKLOG.md). CI checks source and local backend/browser functionality; it has **no production deployment action**.

## Staging and production

No hosted Supabase project was available through the connected inventory when development started. No hosted database, Hostinger/DNS, public marketing website or production email was modified. Production publishing requires a concrete reviewed release and separate approval.

Use separate approved staging and production Supabase projects. Frontend build variables are `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` only. Never use server secret/service-role credentials in a `VITE_` variable. Disable signup, configure exact callback URLs, install the custom invitation template, configure approved SMTP, bootstrap the first admin through a controlled server process and require MFA. See [DEPLOYMENT_RUNBOOK](docs/DEPLOYMENT_RUNBOOK.md) for migration, invitation reconciliation, hosting headers, backups of **database plus Storage objects**, restore/rollback and release gates.

`public/.htaccess` is an un-deployed Apache/LiteSpeed template for the future separate Hostinger portal root. Its SPA rewrite, no-referrer/CSP/security/cache headers must be tested on that actual host; adapt `connect-src` for an approved custom Supabase domain. Redact authentication query strings in hosting/access logs. A local Vite preview does not exercise Apache headers.

To stop this task's services after development: stop Vite/functions with Ctrl+C, then `npx --no-install supabase stop`. Do not use `--no-backup` if you want to preserve local test data.

## Documentation

[Product scope](docs/PRODUCT_SPEC.md) · [Architecture](docs/ARCHITECTURE.md) · [ERD](docs/ERD.md) · [Brand](docs/BRAND_DESIGN_SYSTEM.md) · [Plan](docs/IMPLEMENTATION_PLAN.md) · [Security review](docs/BACKEND_SECURITY_REVIEW.md) · [Test plan](docs/TEST_PLAN.md) · [User guide](docs/USER_GUIDE.md)

Repository license: GNU GPLv3; the authentic Space Grotesk font retains its included OFL notice. Brand assets remain Luminovia assets.
