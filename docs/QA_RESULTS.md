# QA evidence — 2026-11-16

The latest continuation evidence is first. Older M1 results below remain historical; they do not describe the current local service state. Full target/production acceptance remains pending.

## Subsequent theme regression — actual defect fixed, new CI pending

Repeated documentation CI43774441712 rejected one taxonomy contrast check(69/70passed). Actual served M6markup/styles reproduced first-state button contrast1.841/1.037 during background interpolation; stable themes pass. Removing that interpolation retains transform feedback and gives immediate dark9.104/13.982 on the same actual page. New effect-based desktop/mobile regression samples the first computed theme states; exact new PR9 CI remains required. The historical accepted M6counts below are not rewritten as if this later run passed.

## M6 application acceptance — passed on exact signed source

Source `9d9bc567e70cdb3100a7ea6d78920d90a735cbba`: local runner report `.local/tests/977d0761/RESULT.txt` PASS at 2026-11-15T22:49:34.605Z; independent exact-source [CI43770187739](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43770187739) application `verify` succeeded at 22:53:22Z. The separate retained-image compatibility job also succeeded at 22:59:09Z; [PR8](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/8) merged at 23:05:43Z as `dc8e9a7e65c96076038bf7067791676578d121d4`.

| Check | Actual result |
| --- | --- |
| Source and graph | Lint/type/format;177 Vitest/45 files;105reachable modules/30routes; zero unused runtime exports, broken imports/routes/assets |
| Runtime/Edge |52 runtime,42 Edge tests and3 entry-point typechecks |
| Operating guards |76 Python,60 Node, real Envoy/Caddy boundaries; real age encryption fixtures |
| Database |24migrations, lint/security/performance advisors and234 PostgreSQL cases |
| Business interfaces |18 actual Auth/MFA/REST/Storage/WebSocket suites plus real idempotent Edge/Mailpit invitation |
| Persistence | Actual password/MFA/profile/private-event/object bytes survived stop/start |
| Browsers |70/70 desktop/mobile Chromium workflows, zero skipped;6.6 minutes; DE/EN/dark/offline/axe and real DnD/claim/storno/reopen |
| Build/PWA |56 public precache entries/2600.83 KiB;2/2 built-PWA checks in2.2 seconds |
| Cleanup | Owned random stack/network/volumes/markers removed; normal development records not targeted |

Actual inspected fictional screenshots: [desktop dashboard](screenshots/m6-desktop-dashboard.png), [mobile dashboard](screenshots/m6-mobile-dashboard.png), [desktop board](screenshots/m6-desktop-job-board.png), [mobile board](screenshots/m6-mobile-job-board.png).

The local outer tool shell reported143 after the runner's final PASS and did not save its extra `.exit` file. This is recorded rather than labelled exit 0; the independent complete CI application job exited successfully. No source fix is inferred from an unexplained outer-shell signal. Actual desktop/mobile screenshots were inspected; physical iOS/Safari, hosted SMTP, legal/retention and full remaining product scope are not covered by this Chromium/local acceptance.

## Latest GitHub command — actual retained preview acceptance

The official preview actually upgraded5f89986→dc8e9a7,18→24migrations, after accepting its exact reviewed plan. Update returned exit0. A separate genuine post-upgrade stop/start persistence probe also returned exit0 and preserved Auth/password/MFA/profile/private-event/object bytes. Exact SHA/status/history were independently checked; the probe was cleaned. The preview is available at5373 with its own563xx backend. [Commands and review boundary](GITHUB_LOCAL_PREVIEW.md).

## M6 third combined checkpoint — APIs passed, browser corrections required

Run `.local/tests/240bbb48/RESULT.txt` on `4e077b7` passed all18 actual business API suites plus real Edge/Mailpit, after the complete source/Edge/SQL/restart checks. Chromium desktop/mobile completed **48 passed /22 failed /zero skipped** in9.6minutes. Shared actual causes were notification accessible-name mismatch and three precise browser-fixture errors (translated region, live-status ambiguity, incorrect focus-event target). Build/PWA was not reached. Corrections plus the independently reproduced repeated-reopening notification regression require a fresh complete run04; this checkpoint is not final acceptance.

## M6 second combined checkpoint — closed-offer test expectation corrected

Run `.local/tests/d1cf07cc/RESULT.txt` on `68493cc` passed every SQL suite and the first ten actual Auth/API suites. The new capacity API assertion then expected `filled` although the established cancellation contract moves the offer to draft; exact `unavailable` was correct. Only the test was corrected and strengthened with unchanged-state assertions. Complete rerun remains pending; browser/build acceptance was not reached.

## M6 first combined checkpoint — failed safely, not final acceptance

Actual frozen-source `./portal test` run `.local/tests/ba7f328e/RESULT.txt` returned exit1 on `e024558`. The generic API permission inventory rejected five default EXECUTE grants on internal taxonomy/availability helpers. Correction and complete rerun are required. No native business API, desktop/mobile or build/PWA acceptance is claimed from this failed run. Source 177 Vitest / 52 runtime / 42 Edge cases, operating guards, real fresh 24-migration startup and Auth/MFA/Storage restart preservation had already passed; full details and owned cleanup are in [WORKLOG](WORKLOG.md).

## M5 system audit — complete local acceptance passed

`./portal test` passed on **2026-11-15 at 19:02:50.239UTC (16 November 05:02 Australia/Brisbane)** on frozen signed source `7abad7e`, baseline main `b9cdcc8`. Private report `.local/tests/d1953a8c/RESULT.txt`; launcher `.local/system-audit-test-04.exit` and execution session both returned **0**. The later integration of main `11448e4` changes deployment/backup/maintenance source and offline guard discovery, with no incoming application TS/SQL difference. Its targeted results are recorded separately; exact combined/native CI and merge are recorded on [PR #5](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/5).

| Check | Actual result |
| --- | --- |
| Source | Lint, TypeScript, formatting; **117 Vitest cases / 34 files** |
| Connections | **85 modules /25 routes /175 runtime exports**, no unreachable module, unused runtime export, broken relative import/literal route/static asset |
| Runtime | **33 Node cases**, including real child timeout/abort, stop acknowledgement, kernel QA contention/crash release, busy legacy listener and actual Vite watcher |
| Edge | **42 tests /3 entry-point typechecks**; updated Office validation plus all invitation/account/avatar/TCP/HTTPS regressions |
| Schema/SQL | All **18 migrations**, lint/security/performance advisors; **174 real PostgreSQL cases** including six finite-schedule and six API/security inventory cases |
| APIs | All **12 actual suites** plus Edge/Mailpit invitation; the corrected native HTTP test retains exact `23514` and unchanged old event instants |
| Restart | Actual password/MFA/profile/private-event/object bytes preserved across stop/start; probe cleanup passed |
| Browser | **54/54 desktop/mobile Chromium cases**, zero skipped, 4.8 minutes; 12-second actual idle-file/no-reload budget and blocked-storage DE/EN/dark/retained-draft cases passed |
| Build/PWA | Build; **47 public precache entries / 2415.14 KiB**; **2/2 built-PWA** registration/offline/private-cache checks, 2.2 seconds |
| Cleanup | Owned services/network/volumes/markers cleaned; normal development data not targeted |

Reproduced/fixed behavior and measurements are in [SYSTEM_AUDIT](SYSTEM_AUDIT.md): unbounded timestamps, excessive settled metadata requests, stuck scan polls, stale/cross-actor attachment metadata, version-history/download consistency, failed read receipt retries, duplicate immutable-avatar bytes, realtime burst invalidations, blocked preference storage, private local drafts across account switches, dishonest timeout/stop success, cross-checkout QA collisions and generated-HTML HMR reloads. Timing/memory and invalidation measurements retain their exact synthetic/component scope; they are not whole-platform hosted-throughput claims.

Earlier failed checkpoints remain in WORKLOG: run01 server acceptance with 53/54 browsers and actual startup `ERR_NETWORK_CHANGED`; run02 stopped before services on a legitimately occupied legacy-test port; run03 reached 174 SQL and failed a nondeterministic new HTTP fixture because the existing conflict trigger ran before the desired CHECK. No ordinary business assertion or retry was weakened. Run04 corrected the fixture and passed fully.

After the incoming daily-maintenance merge, actual targeted guards passed **38 updater + 13 maintenance + 22 backup Python tests**, no crypto skips, and **60 Node release/review/package/scanner/maintenance/recovery tests**. Real local `age`/`age-keygen`1.3.2 tools were made available in the user's bin without changing existing files or copying any recovery identity. Production Edge source lint passed ten files with require-await active; seven fixture files passed with Promise-shaped async doubles allowed. Those checks now join `./portal test`. Native selfhost image/retained-data compatibility remains a separate required CI job; its final result belongs to the exact PR record.

No M5 hosted installation or production publication was performed. The historical bounded M4 review tool remains 14→17 and deliberately refuses an 18-migration manifest. Actual installed history must be inspected before a separately authorised deployment. Physical mobile/other browsers/manual accessibility, real hosted maximum-load/capacity/SMTP, legal retention and full remaining product scope stay in the plan.

## M4 combined functional acceptance — complete command passed

`./portal test` passed on **2026-11-15 at 17:31:03.771UTC (16 November 03:31 Australia/Brisbane)** against frozen signed source `4c7c897`, including concurrent main through `1f9a114`. Project `luminovia-portal-test-7c2dd978`; private report `.local/tests/7c2dd978/RESULT.txt`. The wrapper explicitly captured **exit 0** in `.local/m4-test-04.exit`, and the execution session also returned 0. Subsequent local changes are documentation and actual fictional screenshots; exact submitted-source CI and the final merge are recorded on [PR #4](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/4).

| Check | Actual combined result |
| --- | --- |
| Source | Lint, strict TypeScript and formatting; **91 Vitest cases / 28 files** passed |
| Connections/runtime | **21 Node cases**: environment/ownership/persistence guards, catalogue delimiters, compiler import/export/route/asset/RPC graph, local documentation links and two actual-copy private snapshot fixtures |
| Edge | **37 tests**, all three entry-point typechecks passed; avatar PNG/revocation and private HTTPS/TCP scan boundaries retained |
| Release controls | **28 Python updater +35 Node** cases (M3 review 6, M4 review 8, package 7, scanner HTTP/TCP 14), plus **11 actual Envoy routes / 10 actual Caddy HTTP checks**; fixture-only/owned-resource cleanup |
| Fresh backend | All **17 migrations** replayed; SQL lint/security/performance advisors passed |
| SQL | **165 PostgreSQL cases**: core 25, accounts 11, API surface 3, avatars 10, CBW 16, chat 17, comments 11, commercial 14, commission 14, documents 12, knowledge 14, M4 preservation 4, profiles 14 |
| Actual APIs | All **12 suites** passed, including new avatars/CBW/comments and all earlier Auth/TOTP/REST/RPC/WebSocket/Storage/ClamAV regressions |
| Mail | Actual Edge invitation, durable retry and exactly one Mailpit delivery; no real recipient |
| Restart | Actual stop/start retained password, verified MFA, profile/timezone, private appointment and exact private Storage object bytes; probe cleanup passed |
| Browser | **52/52 desktop/mobile Chromium journeys**, zero skipped,4.3 minutes; new source-link/offer/image/comment workflows and existing regressions passed |
| Build/PWA | Build passed; **47 public static precache entries / 2413.56 KiB**; **2/2 built-PWA** SW/offline-deep-link/no-private-cache cases,2.2 seconds |
| Cleanup | Owned random services/network/volumes removed; normal persistent development stack was not targeted |

All 24 original supplied PDF bytes independently matched 22 canonical CBW codes and 24 source revisions. M4 preserves both LPC3/LPC4 variants, exact source/session identity, trusted source fingerprints and financial-only run offers. Real API/browser evidence includes stale preview rejection, concurrent/idempotent offers, actual whole-block allocation, private gross/net and revoked memberships. Raw PDFs/personal source paths are not published. Weekday planning does not decide holiday/break arrangements automatically.

Avatar evidence includes real JPEG-with-metadata conversion to bounded canonical PNG, actual clean scanner/Storage bytes/hash, scoped authenticated viewing, replacement/removal and access changed during download. The invalid-replacement screenshot intentionally retains the previous blue fictional avatar and shows the retry error. Comment evidence uses separate author/peer/moderator contexts and covers persistence, safe literal text, stale edits, MFA hide/restore and author withdrawal. New DE/EN/light/dark screens passed automated axe/overflow checks; actual desktop/mobile screenshots were visually inspected. Mobile full-page captures include the fixed navigation at the viewport position.

The final frontend inventory contains 84 connected modules, 25 registered routes and 172 runtime exports with **no unreachable module, genuinely unused export, unresolved import, invalid literal route or missing literal asset**. The compiler discovers 99 frontend literal RPC references (74 unique names), bound to the migrated API surface; the generated reference documents 106 public functions. Runtime/headless/vendor/migration interfaces remain deliberate and documented. These static checks do not prove every dynamic branch runs or certify a completely bug-free product.

**Hosted boundary:** no M4 installation was performed. The unchanged ordinary updater stops the avatar constraint replacement and CBW procedural import for operator review. The [read-only M4 plan](REVIEWED_M4_MIGRATIONS.md) verifies exact 14/17 history/source/package inventories without an apply mode. Its 4-case disposable preservation rehearsal proves old-row/column/ID/role/quota retention and atomic rollback; Auth is an id/email stub and file metadata only, so it does not establish native password/MFA or physical object preservation on the CMS. The separate restart probe above uses actual local Auth/Storage. Remaining product, physical/mobile/cross-browser/manual/privacy/production gates stay in the plan. No public website, hosted record, real email or bank transfer was changed.

## M3 accounts, profile courses/reviews and commission — complete command passed

`./portal test` completed successfully on **2026-11-15 at 15:27:43 UTC (16 November Australia/Brisbane)**, isolated project `luminovia-portal-test-b1c83645`. Private report: `.local/tests/b1c83645/RESULT.txt`. Source was frozen throughout the passing invocation; subsequent edits are documentation and the actual fictional screenshots only. Exact submitted-revision acceptance additionally comes from GitHub CI.

| Check          | Actual result                                                                                                                                                                       |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source         | Lint, strict TypeScript/no-unused checks and formatting; 59 Vitest tests across 19 files passed                                                                                     |
| Runtime        | All 7 environment/redaction/ownership/network safeguards passed                                                                                                                     |
| Edge           | All 22 handler tests and all 3 entry-point typechecks passed                                                                                                                        |
| Fresh database | All 13 migrations replayed; SQL lint and security/performance advisors passed with no warning/error                                                                                 |
| SQL            | All 120 real PostgreSQL checks: core 25, accounts 11, API surface 3, chat 17, commercial 14, commission 14, document 8, knowledge 14, profiles 14                                   |
| Actual APIs    | All 9 suites passed: accounts, chat, commercial, commission, documents, knowledge, core, operations, profiles; real Auth/TOTP/REST/RPC/WebSockets/Storage/ClamAV                    |
| Invitations    | Actual Edge delivery into Mailpit; durable role/org-bound idempotency and exactly one captured email; no real recipient                                                             |
| Persistence    | Actual stop/start preserved password, verified MFA, profile/timezone, private event and exact Storage bytes; checked probe cleanup passed                                           |
| Browsers       | 46/46 desktop/mobile Chromium workflows, zero skipped, 3.8 minutes; new account/client/net-invoice/profile/enrolment/review/moderation journeys and all existing regressions passed |
| Built PWA      | Production build passed; 50 public static precache entries (2379.73 KiB); 2/2 real SW/offline deep-link/no-private-cache checks passed in 2.2 seconds                               |
| Cleanup        | Owned random test project, network and volumes removed; normal development data not targeted                                                                                        |

New financial proof includes deterministic 50/50 cent rounding, configurable unaccepted offers, hidden customer gross/platform share in lecturer API/UI, client A/B isolation and membership revocation, immutable accepted revenue, legacy net compatibility, exact net invoice PDFs through actual ClamAV, labels/combined filters/CSV and tracked payment. No exchange conversion, tax recognition or bank transfer is asserted.

Account proof covers the façade and direct RPCs, explicit NULL pagination rejection, own-field whitelist/timezones, current role/MFA checks, simultaneous role/suspension protection for the last active administrator, durable generic/legacy invitation compatibility and immediate old-token suspension. A migrated source/API inventory bound all 88 delivered literal frontend RPC references to 95 executable public functions; public functions remain invoker wrappers and exposed tables have RLS.

Profile proof covers self-authored labels/search, real past/current/upcoming assignment phases and authorised course links, optional management enrolment, completed attendance before reviewing the actual lecturer, anonymous ordinary review projections, versioned edits/withdrawal, reasoned MFA moderation and immediate revocation. New desktop/mobile fictional screenshots were visually reviewed for labels, course context, escaped literal authored text, private money and readable responsive layout. Automated axe and horizontal-overflow checks passed on the new settled screens; physical-device/manual acceptance remains separate.

Earlier M3 failures and corrections remain in WORKLOG: unsupported unit-test selector, explicit JSONB default caught by SQL lint, and shared manager/learner browser session fixture. Canonical03 passed 44/46 browser cases; canonical04 with independent actor contexts passed 46/46 without relaxed app permissions. Concrete audit fixes include the real NULL limit bypass, draft-publication spend counts, duplicate time-zone validation and stale initial Auth actor race. This is scoped code/API integration verification, not a bug-free certification of every line or production release.

The original worktree's concurrent hosting/scanner changes and running persistent development instance were left untouched. New source is isolated on `codex/accounts-profiles-commission`. Full remaining master-prompt scope, hosted/manual/cross-browser/physical-PWA, DB+Storage disaster recovery, privacy/legal and separate production approval remain in IMPLEMENTATION_PLAN. No public marketing site, hosted data, real invitation or payment was changed by this work. A separate configured root build passed using only public frontend variables; scanning 47 emitted files against two actual normal local server-credential/password values found no matches.

## Historical M2 acceptance

## Expanded local system — complete local command passed

`./portal test` completed successfully on **2026-11-15 at 13:53:47 UTC**, isolated project `luminovia-portal-test-999c091e`. The ignored private report is `.local/tests/999c091e/RESULT.txt`.

| Check           | Actual result                                                                                                                                                                |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source          | Lint, TypeScript, formatting; 42 Vitest tests across 12 files passed                                                                                                         |
| Runtime         | 7 ownership/redaction/environment/network safeguards passed                                                                                                                  |
| Edge            | 11 tests across invitation/files and both Deno typechecks passed                                                                                                             |
| Fresh database  | All 10 migrations replayed; 43 public tables, all RLS-enabled; lint/security/performance advisors passed                                                                     |
| SQL             | 78 real PostgreSQL checks: core 25, chat 17, knowledge 14, commercial 14, document quotas/retries 8                                                                          |
| Actual services | Auth/TOTP, REST/RPC, WebSockets, private Storage/ClamAV and captured-mail invitation suites passed                                                                           |
| Persistence     | Actual stop/start retained original password, verified MFA factor, edited profile/timezone, private appointment and exact private object bytes; checked probe cleanup passed |
| Browsers        | 40/40 desktop/mobile Chromium workflows, zero skipped, 2.7 minutes; scanned pages passed axe                                                                                 |
| Built PWA       | Build passed; 46 static precache entries (~2.3 MiB);2/2 checks passed in 2.2 seconds for real SW control, offline deep links and no private API caches                       |
| Cleanup         | Only the random test stack/network/volumes removed; normal development untouched                                                                                             |

Real API cases include fifty simultaneous claims/one winner/five allocations, immutable accepted fees, personal-event privacy even against ordinary admins, forged roles/metadata denial and suspension; actual message delivery then removal/suspension revocation; safe published wiki snapshots independent of newer private drafts; original-currency invoices, partial/full payment and audited corrections; customer-contact isolation and protected accepted course schedules. Document tests use actual ClamAV clean/EICAR results, type/magic limits, exact version hashes/bytes, owner/peer/administrator/anonymous denial, direct Storage/signing bypass denial, changed-byte/target retry conflicts, concurrent owner quota locks and a real scanner outage followed by a genuinely clean recovered upload.

Browser coverage includes onboarding/recovery/MFA, profile/evidence, allocation/calendar, chat/group revocation, actual image Blob preview and private file version/rename/archive/search, reusable courses/directory contacts, wiki/code/publication/history, moderated forum and executed contract/invoice/payment tracking. These are actual local services, not intercepted API success responses.

The complete passing command was followed by visual review. A hidden attachment input caused a 33px mobile-chat overflow; native hidden inputs preserve the accessible trigger and remove the inherited full-width rule. A separate real isolated chat/commercial rerun passed all six desktop/mobile cases in 1.1 minutes, including actual picker/scanning/recipient-download bytes and no overflow. Measured viewport/scrollWidth returned to 412/412; restoring the old input reproduced 445px width. Its evidence is recorded in WORKLOG. GitHub runs the canonical full command again for the submitted revision. Current root build also passed and a scan found no actual local server credentials/passwords in repository source.

Earlier integration failures and fixes are retained in WORKLOG: first browser 26/38, second 34/40, third 39/40, then 40/40. Code entry asserts exact text before/after persistence, using desktop Enter and the explicitly reproduced Android-UA-emulation Shift+Enter path. Physical Android virtual-keyboard Enter, Safari/Firefox/iOS and native PWA installation remain manual/platform gates. Automated axe is not full WCAG certification.

No hosted Supabase, Hostinger/DNS, public website, real emails, real contracts/invoices or money transfers were changed. The entire target product remains incomplete; see the complete module ledger. Database/Storage persistence is proven locally, while production backups/restore/retention, privacy/legal, monitored staging and production approval remain pending.

## Historical M1 evidence

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

Historical singular/plural copy issue was subsequently corrected and the M1 CI passed.
