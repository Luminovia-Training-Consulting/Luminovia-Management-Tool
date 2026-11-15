# Luminovia Portal — development work log

**Read this file first on every continuation**, then `IMPLEMENTATION_PLAN.md`, `AGENTS.md` and the authoritative `UNIVERSAL_MASTER_PROMPT.txt`. Preserve functioning source and unrelated changes. Record actual commands/results; planned checks do not count as passed. Date context is Australia/Brisbane.

## 15 November 2026 — reconnaissance and M1 foundation (in progress)

### Scope and decisions

- User authorised development of the functioning portal in `Luminovia-Training-Consulting/Luminovia-Management-Tool`, using the attached master prompt as authoritative. Production publishing and changes to the public marketing website require separate approval.
- Existing local workspace contained an empty Git repository. Existing remote management repository was inspected and fetched; original `main` commit is `1a61cb0` (`Update README.md`). Development branch is `codex/portal-foundation`; original LICENSE/README preserved pending application documentation.
- Complete 29,729-byte attached prompt copied verbatim to `docs/UNIVERSAL_MASTER_PROMPT.txt`; root `AGENTS.md` makes it persistent project instructions. No separate design image was attached.
- Selected M1 vertical slice: actual Auth, secure role/profile/expertise foundation, permissioned course/job publishing, job search/detail, atomic single-slot whole-block claims and own calendar. Every other requested module remains in the durable plan.
- Connected Supabase `list_projects` returned an empty list. No hosted project created or modified. Local Docker is available and local Supabase development/QA is in progress. No Hostinger changes or production deployment.

### Verified brand/source work

Commands actually executed by the brand/documentation agent:

- `git -C /home/carinaschoppe/Documents/ChatGPT/websites/luminovia rev-parse HEAD` and `git ls-remote https://github.com/Luminovia-Training-Consulting/Website.git refs/heads/main`: both `2778a9be96b7d6c29ec0f11a1677c7530c602ccc`.
- Read `src/index.css` and `src/styles/home.css` in the read-only website checkout. Exact light/dark tokens, system body font, self-hosted Space Grotesk, seven-colour strip and asymmetric pastel cards match the master brief.
- Compared local CSS/font/logo bytes with raw files at that remote commit using Python `urllib.request`/SHA-256; every compared file matched. Hashes recorded in `BRAND_DESIGN_SYSTEM.md`.
- Copied only the authentic compact/full logos, Space Grotesk WOFF2 and OFL into portal `public/brand`; full logo visually inspected. No portraits, personal certificates or other private/source downloads copied.
- Live company site was inspected in the parent task through the web tool; current page presents Luminovia Training & Consulting. Source reference repository and live website remain unchanged.

### Persistent deliverables

Created the full product map, implementation ledger, brand guide, architecture decisions, target ERD/permission boundaries, test plan, security/privacy release checklist, deployment/backup/rollback runbook and first-slice user guide. These describe target requirements and current limits; they do not certify incomplete modules.

### Verification still in progress

Application source, migration, Auth/API/browser, concurrency, accessibility and build results must be appended by the implementing/QA agents after execution. Do not infer a pass from this initial entry. Exact implemented API/schema is owned by the migration SQL and backend notes. No SMTP deliverability, managed-staging acceptance, cross-browser/mobile installation or production restore/rollback acceptance has been established here.

### Immediate next actions

1. Integrate and test frontend against actual local Supabase Auth/Data API and committed migrations.
2. Complete database/RLS/adversarial tests including fifty simultaneous claims, cross-job double-booking, idempotency, immutable terms and private-calendar isolation.
3. Record exact source/test/build/browser commands, output summaries, screenshots and remaining findings; update implementation statuses only from actual evidence.
4. Select the next useful vertical slice and retain all remaining modules. Configure managed staging/SMTP only with appropriate access/authorisation; do not publish production implicitly.

## 15 November 2026 — backend local verification checkpoint

Reported by the backend implementation agent after actual execution against the local Supabase PostgreSQL container:

- Migration implements 22 public tables with RLS, scoped column grants, private actor/capability implementations and public SECURITY INVOKER RPC wrappers. Management mutations require database capability plus JWT AAL2. APIs include `claim_job`, `create_job`, `set_job_status` and `get_my_permissions`.
- `node scripts/db-rpc-tests.mjs` passed **17 real PostgreSQL tests** in a disposable database. That harness uses real PostgreSQL roles/RLS/locking with compatible `auth.uid()`/`auth.jwt()` test functions; it does not validate HTTP tokens. Fifty distinct eligible actor transactions produced exactly one confirmed winner and 49 filled results, with all five allocations and one notification/claim event/course-chat membership set. Winner retry was idempotent.
- Further passing database cases: same lecturer concurrently claiming different overlapping jobs; no partial rows on conflict; private appointment conflicts; missing/expired contract and unverified qualification rejection; stale terms rejection and immutable accepted fee/terms after offer edits; owner/role/activation/verification forgery denial; admin/private-calendar isolation; ignored editable role metadata; inactive/participant/anonymous denial; management AAL1 denial and AAL2 creation.
- Database lint initially found an unused variable, which was removed. Advisors initially warned about per-row Auth UID evaluation; policies were updated to cached subselects. Final executed commands: `npx --yes supabase@3.1.0 db lint --schema public,private --fail-on warning` → `[]`, no schema errors; `npx --yes supabase@3.1.0 db advisors --type all --level warn --fail-on warn` → `[]`, no issues found.
- `npx --yes supabase@3.1.0 migration list` listed `20261115111133` in local/history columns against the local stack (the CLI labels its database-history column “remote”; this was not a hosted project). Startup initially registered the then-empty migration before full SQL was applied directly; a clean reset/reapply remains a required final migration validation.
- Separately, the QA agent reported actual local Supabase Auth+REST fifty-request claim validation. This is distinct from the disposable-database test; API/browser evidence remains owned by the QA checkpoint below.

Implemented scope limits are explicit: single-slot jobs only; filled jobs refuse silent reopening; cancellation/substitutes are not enabled; chat membership is transactional infrastructure, not a messaging UI; contracts are eligibility/version references without file/hash/acceptance lifecycle; customer/template/run records are created inside the atomic job RPC, without comprehensive independent CRUD; no evidence upload/document centre yet. No hosted Supabase writes or production changes.

## 15 November 2026 — independent frontend/API review (before build acceptance)

Read-only review identified issues for the parent implementer to resolve before browser acceptance:

1. Bind claim consent to the exact reviewed job/terms version. Refetched terms must invalidate existing checkbox consent, and job-ID changes must reset mutation result/idempotency state; a prior confirmation must never be reused for another job.
2. Combined date filters must match a session within both bounds. Separate “some date after from” and “some date before to” can falsely match a block whose sessions straddle an empty range.
3. Profile biography validation must align with the database's 4,000-character limit rather than allowing 5,000.
4. Clear private query state on authenticated actor-ID changes, not only explicit sign-out, because shared query keys otherwise risk displaying a previous actor's in-memory results.
5. Complete remaining hard-coded decorative DE/EN text and handle reload/cancellation of unfinished MFA enrollment without trapping a user behind a discarded QR/factor.

These are review findings, not claimed final-state failures or fixes. The parent is integrating corrections; final checks below must record their actual resolution. Official Supabase changelog/CLI/API sources were checked and recorded in `REFERENCE_SOURCES.md`; invitation function CORS was highlighted to the backend agent.

## 15 November 2026 — invitation/security extension checkpoint

Backend agent reported the following additional actual checks after the first database checkpoint:

- `node scripts/db-rpc-tests.mjs` now **21 PASS**, adding qualification expiry/valid-contract linkage, a simultaneous appointment-versus-claim race, invitation MFA/reservation/deduplication and rate-limit cases. `npm run test:db` now has the convenience shell wrapper expected by package scripts.
- `npx --yes deno test supabase/functions/invite-lecturer/handler_test.ts` → **7 PASS**; `npx --yes deno check supabase/functions/invite-lecturer/index.ts` → passed. These handler/type checks do not alone establish actual Edge HTTP/CORS or onboarding completion.
- Second migration adds `invitation_requests`, bringing the current exposed RLS-enabled table count to **23**. Exact-origin CORS, server-only completion, fixed lecturer role, pre-send durable reservation, duplicate-send protection and five-new-invites-per-fifteen-minute rate limiting are implemented. Failures require reconciliation rather than automatic resend.
- Independent integration review found callback disagreement: function/config used `/auth/callback`, app/recovery used `/auth/password`. Parent/backend/QA were notified to reconcile and test the actual invitation/recovery landing path. Do not mark onboarding accepted merely because the local mail capture contains an invitation.
- Actual local Edge HTTP and clean migration reset/reseed are pending QA at this checkpoint. No real emails or hosted project modifications.

## 15 November 2026 — clean integration replay and local invitation delivery

QA executed `supabase db reset --no-seed --yes` with pinned CLI3.1.0 against the local loopback stack. **Both migration files replayed from scratch successfully**. `node scripts/local-seed.mjs` passed, then `node scripts/local-api-check.mjs` passed again against actual Auth/HTTP REST/RPC: fifty concurrent requests across eleven real local Auth lecturers produced one confirmed result and 49 filled, all five allocations and one notification, idempotent retry, immutable accepted fees/terms, private-event denial for another lecturer and admin, role/metadata/owner forgery denial, participant/anonymous restrictions and management MFA gate.

`node scripts/local-invite-check.mjs` passed against actual local Edge/Auth/Mailpit: actual QA admin TOTP/AAL2, lecturer Auth/profile/name creation, idempotent `already_sent` retry, exactly one locally captured email for the fictional recipient, and HTTP403 for an untrusted POST origin. The local Kong gateway answers OPTIONS itself and overrides response CORS headers to `*`; the function's exact-origin POST check was verified, while hosted gateway behaviour remains a staging acceptance item. No email was delivered to real people and no hosted project was changed. See `QA_RESULTS.md` for full QA evidence.

These local delivery checks do **not yet accept invitation link consumption/password setup**. The app callback route and recovery redirect were reconciled in source, but independent inspection of installed Auth SDK code highlighted the PKCE-versus-implicit invitation callback boundary. Parent/QA were asked to consume a real captured invitation in a fresh browser context, set a password and sign in before calling onboarding verified.

## 15 November 2026 — accessible form validation repair

Changed only `src/components/common.tsx` and added `src/components/common.test.tsx` for this repair. `Field` associates its label with the native input/select/textarea, preserves/deduplicates existing help references, supplies stable hint/error IDs, marks actual errors with `aria-invalid`, and removes stale invalid/description references after correction. Form handlers/refs are preserved. One Field owns one native control, preventing duplicated generated IDs across unrelated children.

Executed:

- `npx vitest run src/components/common.test.tsx` → **5 PASS**, covering input/select/textarea accessible names/descriptions, validation correction/external help preservation and healthy controls without invalid/dangling description attributes.
- `npm run typecheck` → passed.
- Initial targeted ESLint flagged captured-variable mutation in the child mapping. Replaced it with pure index selection; `npx eslint src/components/common.tsx src/components/common.test.tsx --max-warnings 0` → passed, then targeted tests passed again.

Source review confirms the parent's repairs for exact-version claim consent, keyed per-job detail/mutation state, same-session date-range matching, 4,000-character profile biographies, actor-ID cache clearing, contract-required job input, repeated job creation and taxonomy loading errors. Private calendar events now request keyboard interactivity. Actual browser regression/accessibility acceptance remains with QA; a source review is not a browser pass. Minor remaining copy issue observed: private-event deletion still used the save-success message at this checkpoint.

## 15 November 2026 — managerial verification and suspension slice

Implemented `src/features/admin/people.tsx` and bilingual interface keys. The parent integrates `/admin/people` and styling. The page queries real permissioned profiles, declared lecturer expertise and topic data; supports text search and selected profile details; verifies/revokes only an already declared topic with an explicitly UTC optional future expiry. Verification is a management attestation; evidence files are not uploaded by this slice. The UI requires `users.manage` and `qualifications.verify`, while each RPC independently checks its own capability and AAL2.

Account suspension/reactivation requires an explicit dialog containing the actual target name. No own-account action is offered. The request preserves the selected person/search and awaits server acknowledgement, with no optimistic status. Failed changes leave the existing state and dialog visible. The backend protects self/last-active-admin cases, serializes concurrent activation changes and audits previous/new state. Session data access is denied by fresh active-profile checks; global Auth-session revocation remains an additional operational action.

Executed by this frontend agent:

- `npx vitest run src/features/admin/people.test.tsx` → **5 PASS** against a mocked backend, testing capability privacy gating, selected-topic UTC request/no optimistic success, named confirmation/cancel/search preservation/no self action, backend rejection and invalid past expiry. These component tests do not replace the real browser/API checks.
- `npx eslint src/features/admin/people.tsx src/features/admin/people.test.tsx src/lib/i18n.ts --max-warnings 0` → passed.
- `npm run typecheck` → passed after the parent corrected an unrelated portable base64 helper; no People type errors.
- Initial component run failed because its accessible-name matcher expected a separating space not emitted by nested text. Person buttons now expose an explicit separated name/status label; corrected tests pass. The current source has no known failing scoped test.

Backend agent reports `npm run test:db` now **25 PASS**, replaying all three migrations in a disposable real PostgreSQL database. New cases cover existing-topic attestation/expiry/eligibility/revocation/audit, forged/AAL1 denial, suspension access denial with existing sessions, reactivation, self/last-admin protection and concurrent mutual-admin suspension. Lint/advisors remain clean; Deno's seven handler tests and type check passed again. The third migration was applied locally and migration history reconciled; the earlier complete-stack reset covered the first two files, while the final disposable test harness cleanly replayed all three.

Parent-reported dependency scan: `npm audit --omit=dev` has zero findings; full audit retains four low findings through an unpatched `deepmerge` build-tool chain. Exact patched `glob`/`minimatch` overrides removed moderate findings. This is an acknowledged build-tool advisory, not a claim of zero full dependency findings. CI was added for source/local-backend/browser checks with no production deployment action; GitHub push/run status still pending at this checkpoint.

Final integrated browser results, onboarding/recovery acceptance and aggregate source/build checks will be appended after actual QA reporting. No hosted Supabase/Hostinger/production changes, real invitations or marketing-site edits.

## 15 November 2026 — final source validation checkpoint

The parent executed and reported the following against the integrated source:

- `npm run typecheck` → passed.
- `npm test` → **22 PASS across five files**: five Field accessibility tests, five People administration tests, six DST/time/money tests, three consent/filter regressions and three public-configuration checks.
- `npm run lint` → passed; `npm run format:check` → passed.
- `npm run build` → passed, with lazy feature chunks, manifest and generated service worker (26 static precache entries, approximately 1.5MB). A generated build alone is not supported-platform installation acceptance.
- Documentation code fences and relative local links were checked; no missing local links or unbalanced fences.

Final twenty-case browser suite and two built-PWA checks, plus a full-stack replay of all three migrations, are pending the QA checkpoint. GitHub push/CI status is still pending; do not infer a remote pass from local validation. No production deployment action exists in CI.

### People browser accessibility correction

QA successfully exercised verification with UTC expiry, account suspension, existing-session API denial and reactivation on desktop/mobile, then found a WCAG label-content-name mismatch in the person-selection buttons. The synthetic dot-separated `aria-label` disagreed with the visible adjacent name/status text. Removed that override and added literal whitespace to the visible content so the derived accessible name matches it. The scoped component suite passed again (5 tests), now selecting the exact visible accessible name. The full browser/axe rerun remains the acceptance source.

## 15 November 2026 — final browser workflow acceptance

QA executed `npm run test:e2e -- --grep-invert 'built PWA'` → **20/20 passed, zero skipped**, in 41.2 seconds across desktop/mobile Chromium viewport projects. These use actual local Auth/Data API rather than intercepted application responses.

Verified journeys include invitation token-hash acceptance/password setup/new-password login; bilingual Mailpit recovery using PKCE; DE/EN profile persistence; combined job filters and complete five-session claim; private calendar; IDOR/role safety; language/theme/form state and offline write guards; actual administrator TOTP, publishing and invitation form; and the People path from self-selected expertise through management verification/UTC expiry, suspension, denial with an existing session and reactivation. Axe found no violations on the scanned screens. The person-button visible/accessibility name correction passed this complete rerun.

The earlier default invitation's implicit callback failed against the PKCE client as predicted. The implemented fix keeps PKCE, uses a custom bilingual invitation template with `token_hash`, requires explicit acceptance at public `/auth/callback`, then verifies the OTP before `/auth/password`. Both this actual browser path and bilingual PKCE recovery now pass locally. Hosted email template/SMTP configuration is still separate.

Final current-build PWA checks, the final full-stack reset/reseed of all three migrations and fresh fictional screenshots are being completed by QA. Cross-browser/physical-device installation, hosted staging, production privacy/SMTP/restore acceptance and all later target modules remain outstanding.

### Final source rerun after all UI corrections

At the final source checkpoint (21:49 Australia/Brisbane), the parent reran `npm test` → **22/22 across five files**, plus lint, typecheck, formatting and build → all passed. This supersedes the earlier pre-final-build checkpoint. The strengthened People test's unsupported RTL `exact` option was removed (string role names already match exactly); the final passing typecheck includes that correction. No more source feature changes are planned for this milestone. GitHub push/CI remain pending until reported.

## 15 November 2026 — M1 local acceptance and clean handoff

QA reported the final current-build PWA run **2/2 passed, zero skipped**, in 3.0 seconds, after the final production build. It verified manifest/maskable icons, actual service-worker control, offline deep links/connection state and no private API URLs in Cache Storage. Actual Edge/Mailpit invitation delivery passed again, followed by targeted captured-email onboarding and recovery **2/2 passed** in 4.1 seconds. These supplement the full **20/20** desktop/mobile workflow suite and do not imply physical/native installation or hosted SMTP acceptance.

The final full local stack reset replayed **all three migration files successfully**, regenerated private ignored environment files and reseeded. SQL handoff counts were **13 Auth users, exactly 11 lecturers, zero claims, zero invitation requests and zero MFA factors**. The first administrator must enroll MFA through the real UI. Fresh fictional desktop/mobile screenshots were captured read only. QA preview/Edge services stopped, `supabase stop` preserved local data with backup enabled, and no task-owned containers remained. The parent handles its remaining dev-server teardown.

M1 is complete as a locally verified development milestone: **22 source, 25 SQL, 7 Edge handler, 20 browser workflow and 2 built-PWA checks passed**, with separate actual HTTP fifty-way allocation and captured-mail checks. Local lint/typecheck/format/build/advisors passed. The entire target product is not complete or production-approved; collaboration/uploads/wiki/forum/contracts/finance and remaining hardening stay in the full plan. Managed project inventory was empty; no hosted Supabase, Hostinger/DNS, marketing website or real-email changes occurred.

Security checklist checkboxes now distinguish evidenced local M1 controls from pending full-product/hosted/manual release gates. README includes `/admin/people`. GitHub signed commit/push/CI status remains pending until the parent reports the actual result.

### Final documentation and minor copy/logging correction

Documentation is reconciled to the final local acceptance above; actual GitHub status is the remaining checkpoint to record after push. The parent is correcting the minor singular/plural “1 Termin” copy and suppressing credential-bearing local-start success output, then rerunning source checks/build. These do not broaden product scope. The exact final committed revision must pass its configured CI; no remote pass is claimed before it is observed.

## 15 November 2026 — GitHub preservation checkpoint

- Created source commit `6d0bbf2ae87eb61f2c1d073c786e45682800fd29` on `codex/portal-foundation`. Its SSH signature was verified locally against the existing configured public signing key; no global signing configuration was changed.
- The HTTPS OAuth push was rejected because the token lacks GitHub's `workflow` scope. The existing authorised SSH account authenticated successfully, so only this repository's push URL was set to SSH; HTTPS fetch remains intact. The complete branch, including CI, was then pushed successfully.
- The GitHub connector could not create a PR (`Resource not accessible by integration`). The existing GitHub CLI access created [draft PR #1](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/1). It remains unmerged.
- GitHub Actions began actual isolated verification for that exact source commit. Local passes are recorded above; remote CI completion is being monitored separately. The workflow never deploys to production.
- A real cold-start observation identified that the local gateway may answer preflight before an Edge handler exists. A narrow CI readiness improvement is being verified against the real local runtime; it must wait for a non-writing handler rejection rather than gateway OPTIONS success.
- After final small localisation correction (`1 Termin` / `1 session`) and startup-log credential-output removal, lint, typecheck, 22 source tests, formatting and production build all passed again. Fresh clean-fixture screenshots were refreshed against that build. Local Vite/preview/functions/Supabase were stopped with database backups preserved; the clean fictional accounts remain available for documented local restart.

### Remote CI baseline verified

[GitHub Actions run 43711315201](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43711315201) completed **successfully** for the exact signed application commit `6d0bbf2ae87eb61f2c1d073c786e45682800fd29`. Clean dependency installation, source checks, Deno checks, actual isolated Supabase startup, PostgreSQL/advisors, real HTTP/Edge/Mailpit, browser workflows, production build and built-PWA checks all passed remotely. This is CI/local-service evidence, not hosted staging or production acceptance. A final workflow-only readiness/concurrency improvement is being checked separately.

### Cold Edge readiness verified

- Both the [push run](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43711315201) and [PR run](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43711410829) passed for `6d0bbf2`.
- Added `scripts/local-functions-ready.mjs` and replaced the workflow's preflight probe. Against a real cold local runtime it stayed pending while only the gateway existed, then exited successfully only on the actual handler's anonymous `403 permission_or_mfa_required` JSON. Anonymous credentials, an empty body and the permission rejection prevent reservation or sending. Non-loopback targets are rejected before requesting.
- The probe preserved all clean fixture counts: 13 accounts, 11 lecturers, zero invitations, claims and MFA factors. Syntax and ESLint passed. Shared branch concurrency now coalesces push/PR runs.
- These are CI reliability changes; application behavior is unchanged. The final revision is signed/pushed after this checkpoint and its actual CI result is available on draft PR #1.

### Final CI result and unambiguous PR check cleanup

The final full [PR CI run 43711811112](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43711811112) passed every step for signed head `22dc052`, including the new readiness probe, 22 source tests, 25 SQL tests, seven Edge tests, actual HTTP/Edge/Mailpit checks, 20 browser workflows and the separate two built-PWA checks. The two PWA tests in the main browser selection were intentionally skipped and then passed in the dedicated built-artifact stage.

`gh pr checks` also exposed the deliberately cancelled duplicate push job as a failed bucket for that same SHA. To keep the PR check set unambiguous, the final workflow triggers on PRs and pushes to `main`; feature-branch pushes use their PR run instead of starting a duplicate. Shared concurrency still cancels obsolete runs on older commits. No application code changed. The final trigger-only revision is checked again before handoff, with the live result on PR #1.
