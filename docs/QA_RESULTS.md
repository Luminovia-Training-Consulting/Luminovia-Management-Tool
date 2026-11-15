# QA evidence — 2026-11-15

This file records executed checks, not target-product acceptance. All backend mutations described here used disposable fictional data in local Docker Supabase. No hosted Supabase project or production website was changed; no messages were delivered to real email addresses.

## Environment

- Supabase CLI 3.1.0; local PostgreSQL 17.11 image.
- Local Auth, PostgreSQL, PostgREST, Storage, Realtime and Mailpit started successfully. Edge runtime 1.78.1 was then started for invitation testing; Studio/analytics were excluded.
- Invitation-only Auth (`enable_signup=false`), TOTP enabled, explicit table grants required, private schema not exposed via the Data API.
- `scripts/local-env.mjs` creates ignored `.env.local` with a current publishable browser key and ignored `.env.test.local` with server-only local test credentials. Keys and test passwords are not committed.
- `node scripts/local-seed.mjs`: **passed**. Created exactly 11 fictional lecturer profiles plus one local admin and one participant, verified sample expertise, fictional active contract records, and five-day Python / Linux sample jobs. This is local fixture creation, not an invitation sent to a real person.
- Chromium 159 downloaded through Playwright 1.65.1. Playwright warned that the host OS is unsupported and selected its Ubuntu 24.04 fallback build.

## Executed checks

`node scripts/local-api-check.mjs`: **passed** against actual local Supabase Auth and HTTP REST/RPC, without API interception or mock tokens.

- 50 concurrent HTTP claim requests across 11 authenticated lecturers: exactly one `confirmed`, 49 `filled`.
- Exactly one claim, all five calendar allocations, and one notification persisted.
- Winner retry with the same idempotency key returned the identical claim result.
- Changing the original offer did not change the accepted amount, total or terms snapshot.
- Private calendar event remained invisible to a different lecturer and the admin.
- Forged event ownership and self-granted admin roles failed.
- User-editable authentication metadata containing an invented admin role did not grant permissions.
- Anonymous requests and participants could not read teaching jobs.
- Administrative mutation with password-only AAL1 session was rejected by the backend MFA gate.

`node --check scripts/local-env.mjs`, `node --check scripts/local-seed.mjs`, `node --check scripts/local-api-check.mjs`: **passed**.

`supabase db reset --no-seed --yes` (CLI 3.1.0): **passed**, explicitly targeting the local database at `127.0.0.1:54322`. Replayed both complete migration files from scratch, including the invitation ledger. Local seeding and real HTTP race/RLS checks passed again after the reset. This corrects the initial startup's empty migration-history entry; acceptance is based on the clean replay.

`node scripts/local-invite-check.mjs`: **passed** against actual local Supabase Auth, Edge runtime and Mailpit.

- Enrolled and verified an actual TOTP factor for a dedicated fictional local QA admin; confirmed AAL2.
- Real invitation created an Auth account, lecturer role and named profile.
- Retry with the same idempotency key returned `already_sent` and the same reservation.
- Exactly one email for that recipient was captured locally by Mailpit; no real email delivery took place.
- Untrusted POST origin was rejected with HTTP 403.
- Local Kong answers OPTIONS itself and overrides CORS response headers to `*`; the function's POST origin check was verified separately. Hosted gateway behavior remains a staging check.

`npm run test:e2e -- --grep-invert 'built PWA'`: **20 passed, zero skipped**, 41.2 seconds on the final stable UI source. Chromium desktop (1440×1000) and Pixel 7 mobile emulation each exercised:

- Real invitation-only sign-in and protected-route redirects.
- Actual Auth-issued invitation token-hash acceptance, password setup, logout and password sign-in.
- Actual bilingual recovery email captured in Mailpit, same-browser PKCE callback, new password and subsequent sign-in.
- DE/EN profile save and reload persistence.
- Combined search/delivery/currency/fee filters, immediate real claim, filled status and calendar navigation.
- Private appointment creation and another lecturer's denied read/update.
- Direct REST role escalation and private profile access denial.
- Language switching preserving unsaved form input; light, dark and system themes; offline mutation controls disabled.
- Actual admin TOTP enrollment/challenge, five-session job publication and invitation form with real Edge delivery and lecturer-role creation.
- Lecturer self-selects expertise; admin verifies it with UTC expiry; confirmed suspension immediately denies the lecturer's existing session at RLS; UI reactivation restores access.

Automated axe scans on login, profile, calendar, admin, People and settled dark/light profile screens returned **no violations** under WCAG 2 A/AA, 2.1 A/AA and 2.2 AA tags. This is automated coverage, not a complete manual WCAG certification.

`E2E_MAILPIT_INVITE=1 npx playwright test tests/e2e/onboarding.spec.ts --project desktop-chromium`: **passed** for actual captured Edge invitation → email link → explicit acceptance → password setup → logout → new-password sign-in. The repeatable main suite generates real Auth token hashes to avoid repeatedly consuming SMTP invitation quotas; it does not mock authentication.

After the final bilingual recovery template was loaded, the captured-email command was rerun: **2 passed, zero skipped**, 4.1 seconds (actual invitation email acceptance plus actual bilingual PKCE recovery). The preceding `node scripts/local-invite-check.mjs` again passed all real Edge/Mailpit/deduplication assertions.

`E2E_BASE_URL=http://127.0.0.1:4173 E2E_PWA=1 npx playwright test tests/e2e/pwa.spec.ts`: **2 passed, zero skipped**, 3.0 seconds against the final production build. Desktop and mobile emulation verified standalone manifest/maskable icon, real service-worker registration and control, offline deep-link shell reload, unchanged static cache offline, and no cross-origin/Auth/REST/Storage/Functions response URLs in Cache Storage. Physical installation was not simulated or claimed.

Resolved during browser QA: dark theme inherited static root colors, sidebar/People accessible names, FullCalendar other-month contrast and decorative icon/gridcell labels, and default implicit invitation callback incompatibility with PKCE. The invitation fix was verified using the actual custom email, not just a generated account. Test harness selectors were narrowed to the visible searchbox, finite CSS transitions are allowed to settle before axe scans, and Playwright runs use their artifact directory sequentially.

## Clean final local handoff

After all mutating QA checks, `supabase db reset --no-seed --yes` successfully replayed **all three** migration files in the full local Supabase stack. `node scripts/local-env.mjs` regenerated ignored local credentials and `node scripts/local-seed.mjs` restored the original fictional dataset. Read-only SQL verification found exactly **13 Auth users / 11 lecturers**, **zero claims**, **zero invitation requests**, and **zero MFA factors**. No real user data existed in this fresh task-owned instance.

`node scripts/local-capture.mjs`: **passed**, refreshing desktop/mobile screenshots of login, clean dashboard, jobs, calendar and the English dark profile without editing any profile, job or calendar records. The fresh dashboard was visually inspected: two seeded published jobs, zero assignments/upcoming sessions, three expertise tags, authentic Luminovia branding. The admin/People images remain actual fictional test-flow evidence from the successful browser run. Screenshots contain no QR secrets or real customer/lecturer records.

The owned preview server and Edge process were stopped. `supabase stop --project-id luminovia-portal` completed with `backup:true`; a final inventory showed no remaining task-owned Docker services or preview/Edge processes. Clean seeded data remain preserved locally for the next start. The root agent handles its separate Vite dev server.

## Outstanding acceptance

Hosted Auth/SMTP configuration, actual Hostinger headers/SPA deployment, Safari/Firefox/iOS, physical PWA installation, manual accessibility assessment, production observability/restore drills and legal/privacy review remain separate acceptance gates. Phase 3–5 target-product modules are not accepted by these M1 checks.

Minor copy polish: a one-session job card currently uses the generic German plural (`1 Termine`). This does not affect allocation or amounts.
