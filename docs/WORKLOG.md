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

## 15 November 2026 — persistent local runtime and expanded M2 integration

The user's continuation attachment is byte-identical to the preserved authoritative prompt. Continued the existing `codex/portal-foundation` branch and draft PR #1; no marketing-site or production changes. Previous head `b05f4b1` has successful GitHub M1 CI. All continuation work is in this repository, with durable plan/source/migrations and ignored private runtime state.

Implemented `./portal start/up/status/stop/restart/credentials` for the actual local PostgreSQL/Auth/Storage/Realtime/Mailpit/Edge/ClamAV/Vite system. Startup applies new migrations without a reset; the bootstrap is insert-only and preserves existing passwords, MFA, profiles, verification and business records. PID/session ownership and local-Docker guards prevent accidental unrelated/remote service mutation. `./portal test` creates a sanitized independent checkout and random Supabase project with its own ports/volumes/credentials, runs all source/backend/browser checks, and cleans only that test project. CI now uses this same command. Existing direct mutating browser/legacy HTTP tests require explicit isolated test mode.

Added real vertical slices with their database permissions and interfaces:

- Private documents with owner/uploader separation and exact immutable versions/hashes, bounded type/magic/size/rate/quota validation, actual pinned ClamAV INSTREAM quarantine/clean processing, no scanner bypass, live-authorised Edge downloads with direct Storage/signing blocked, previews/history/replacement/rename/archive, CV/certificates, pre/post-claim job and room attachments.
- Persisted realtime DMs/groups/staff-general and separate lecturer/participant course rooms; membership revocation, history/search/read/mute/reactions/edit/delete, no administrator DM bypass, actual attachment integration. Real WebSocket checks prove positive delivery then no later messages after removal/suspension.
- Tiptap wiki/forum with strict JSON/link validation and safe code-language rendering, isolated draft/published snapshots, optimistic revisions/history, categories, replies/acceptance/subscriptions/reports/lock/pin/archive/moderation.
- Private customer/contact/note/tag directory, reusable course templates and precise actual runs/sessions/publication/safe duplication. Job-linked sessions cannot be retimed silently. Explicitly published course sessions join only the global calendar.
- Executed PDF contract registration, immutable version/hash receipts explicitly not signatures, master/addendum applicability and expiry/revocation; original-currency earnings, claim-derived scanned invoice PDFs, review, payment/partial payment/correction and formula-safe scoped CSV.
- Central responsive navigation and permission-aware search over jobs/files/messages/safe wiki/forum results/minimal chat contacts. Profile evidence and job/chat documents use the same real document API.

Pre-aggregate evidence: actual normal-stack restart preserved password, verified MFA, changed bilingual profile/Brisbane timezone, private event and exact Storage bytes; six runtime safety tests passed. Actual SQL: original 25, chat 17, knowledge 14 and commercial 14 checks passed; operations actual Auth/TOTP API 11 passed. Real document/chat/knowledge/commercial HTTP/Storage/WebSocket/ClamAV checks passed on disposable fictional actors with scoped cleanup. SQL lint/advisors passed after observed initplan/tag-variable findings were corrected. Full source TypeScript/lint/format passed; Vitest **41/41 across 11 files**. Frontend agents also executed read-only desktop/mobile/colour-mode axe checks; written mutation E2E files remain unaccepted until executed by the complete command.

The first complete isolated `./portal test` invocation is in progress. It has already started all services from nine migrations, passed the actual persistence probe, source/11 Edge checks, 70 SQL checks and chat/commercial APIs. Aggregate outcome, file scanner-outage test, browser failures/corrections and final counts will be recorded below. Do not infer acceptance from authored tests. The full target is still incomplete: advanced job lifecycle/capacity/Kanban, availability, detailed profiles/taxonomy, notification preferences/email, resource attachments/retention and operational/hosted/manual release gates remain explicit in the plan.

### First complete command exposed issues and preserved development data

The first `./portal test` run (`.local/tests/9f1a849b/`) passed source/runtime/11 Edge checks, fresh services, actual restart persistence, all 70 SQL cases, all actual API checks and captured-mail delivery. Its browser stage finished **26 passed / 12 failed** across desktop/mobile; cleanup removed only the random test stack. No build/PWA pass is inferred from that aborted later stage.

Fixed the observed causes before the next run: duplicate sibling React keys multiplied chat composers after room refresh; the scanner's second same-container startup failed to open its root-owned `/tmp/clamd.log`; wiki code input and customer-selection-after-reload test assumptions were wrong. The scanner now logs in foreground and has a configuration-correct actual healthcheck. Actual same-container stop/start + clean/EICAR INSTREAM checks passed. The outage test is strengthened to require a genuinely scanned clean upload after recovery, rather than merely waiting without asserting readiness. The profile evidence E2E now requires a clean document-list status before/after reload rather than matching a chosen filename.

An independent review also found retry-content/target ambiguity and a cross-uploader owner-quota race. The Edge gateway now compares incoming and immutable stored SHA-256 on retries, and a separate versioned migration tightens replacement-target identity and locks the quota subject. New real API/SQL regressions are being run. These findings did not expose an unauthorised read or Storage bypass; they are upload integrity/resource-boundary corrections.

Current GitHub inspection shows Carina already merged PR #1 into `main` (`53df30b`, identical source tree to previous head). Preserved all work and created `codex/local-system-and-collaboration` from current `origin/main`; this continuation will be a new PR. No agent merge or production deployment occurred.

### Second integration result and final acceptance run

The second whole-command run (`.local/tests/547a6f09/`) passed **42 source, 7 runtime, 11 Edge and 78 real PostgreSQL checks**, the actual restart/data probe and all six API suites plus captured-mail invitation. Document API regressions prove changed same-length bytes are rejected for clean/quarantined retries, replacement requests cannot change target semantics, scanner outage fails closed and clean uploads genuinely recover afterwards. Published Docker ports were verified as loopback-only on the new owned bridge; the scanner has no host port.

Browser result: **34 passed / 6 failed**. All six files/browser cases and all four operations browser cases passed, including real image Blob rendering, profile evidence clean status across reload, directory/course CRUD/MFA and safe duplication. Chat messaging/revocation itself now passed but four chat journeys failed axe because an aria-label lacked its required group role. The mobile finance scroll container needed a focusable named region. Mobile Android-UA emulation did not insert the code newline with plain hardware Enter; explicit Shift+Enter was reproduced and the test retains exact code text/script-safety assertions. Physical Android virtual-keyboard Enter is still manual device acceptance. These three corrections are in the next source snapshot; native-device behaviour is not claimed.

Runtime review corrected two additional harness issues: capture JSON output on child-process `close` instead of `exit`, and check every persistence-probe cleanup operation, removing its own private event before deleting the Auth account. Two precisely identified leftover probe accounts were removed; actual normal instance returned to the original thirteen fixtures. Cleanup failure now fails the probe instead of silently leaving it behind. The final complete command has started with all these changes; no success is inferred until it finishes.

### Third browser checkpoint — 39/40 and exact editor input

The third canonical command passed every preceding stage, including checked persistence cleanup, all 78 SQL and actual APIs. Browser result: **39 passed / 1 failed**. Chat including live revocation/axe, mobile finance including invoice review/payment corrections, all file/preview/evidence and course/directory journeys passed. The remaining desktop wiki failure was caused by using mobile-emulation Shift+Enter on desktop, where Tiptap correctly exits the code block. The fixture now uses normal desktop Enter and explicitly reproduced Android-UA-emulation Shift+Enter, and checks the exact full code inside the live editor before saving as well as after persistence. This does not assert physical mobile keyboard acceptance. No product workaround or relaxed content assertion was introduced.

The next full invocation uses this final fixture. Earlier successful stage counts remain evidence, while aggregate acceptance still waits for the complete command including current build/PWA and cleanup.

### Complete local command passed

`./portal test` completed successfully in `.local/tests/999c091e/` at **2026-11-15 13:53:47 UTC**. It replayed all ten migrations and passed lint/typecheck/formatting, **42 Vitest tests across 12 files, 7 runtime safeguards, 11 Edge tests, 78 real PostgreSQL checks**, all six actual API suites plus captured-mail invitation, **40/40 desktop/mobile workflows (2.7 minutes, zero skipped)**, production build, **2/2 built-PWA checks (2.2 seconds)** and owned-resource cleanup. The build precaches 46 public static entries (~2.3 MiB). Actual private Storage bytes, Auth/MFA and profile/event persistence survive restart; temporary probes are checked and removed. The test project was removed; normal data were not reset or targeted.

Visual inspection of the passing fictional desktop/mobile screenshots caught horizontal overflow in populated mobile chat (1168px screenshot versus expected1082px). The hidden attachment input inherited global full-width input styling despite its screen-reader-only class. It now uses native `hidden`, with an accessible trigger button; the same commercial file-picker pattern was corrected. New populated-chat overflow and actual picker/upload checks are being run on an independent disposable targeted stack before commit. Final CI executes the entire canonical command on the exact updated revision. A prior passing run is not used to dismiss a later visual finding.

## 16 November 2026 — visual correction accepted and source preservation

The separate owned targeted project `luminovia-portal-test-5f79d8e5` ran all **six desktop/mobile chat and commercial browser cases successfully (1.1 minutes)**. The chat test now opens the actual filechooser button, uploads a fictional file through real ClamAV, sends the attachment and verifies the recipient's authorised download byte-for-byte. Both populated chat cases assert no horizontal document overflow before their axe scan. Causal measurement confirms viewport/scrollWidth **412/412** with native hidden; restoring the legacy input alone reproduced an input at left 33/width 412/right 445 and document width 445; restoring the fix returned 412. The corrected mobile screenshot is 1082px at the actual device scale. The commercial picker correction passed the full executed-contract/invoice/payment browser path too.

Current root production build passed after the native-hidden changes. Refreshed core fictional screenshots read only against normal development; no profile/job/calendar records were edited. Source scan found no actual generated local server credential/password in repository files. Final source Vitest 42/42 and lint passed again. The accepted local whole-command result and the later narrow targeted proof are distinct and both retained; GitHub CI will run the entire command on the submitted final revision. Normal runtime remains available on 127.0.0.1:5173 with original 13 accounts and private durable volumes.

All requested full-product scope remains in IMPLEMENTATION_PLAN. This is a functioning expanded local milestone, not a claim of full production completion. No hosted Supabase, Hostinger/DNS, marketing repository, real invitation, real financial record or money movement was changed. Next preserve the signed branch/new PR and observe actual CI, then continue outstanding lifecycle/capacity/Kanban, availability, taxonomy/profile, notification/email and operational release gates.

### Signed GitHub checkpoint

- Signed source commit `f5fa6e528f91c353e304979aedbc25d1bb468b74` was verified locally with the configured public allowed-signers file and pushed to `codex/local-system-and-collaboration` using this repository's existing SSH push URL. No global Git/signing settings changed.
- Created [draft PR #2](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/2) against current `main`; PR #1 had already been merged by Carina. PR #2 remains unmerged.
- GitHub Actions started the actual canonical `./portal test` workflow. Local acceptance and the six post-visual-correction checks passed as recorded above. This checkpoint is written before remote completion; consult the exact latest head/check on PR #2 before inferring its result. CI contains no production deployment.
- Targeted QA cleanup passed: no test containers, volumes or networks remain; normal runtime is ready with exactly 13 original accounts/profiles, loopback-only service ports, healthy internal ClamAV and persistent data. Generated credentials/logs/reports remain ignored and private. The source worktree is preserved in signed Git history, including the full remaining target plan.

## 16 November 2026 — M3 accounts, profiles and commission extension

User explicitly authorised direct development-branch pushes and merges, confirmed the 50/50 default, approved individual client accounts, and clarified optional learner accounts/enrolment by management/admin. Full business administration is available to admin/owner, retaining qualification/contract/atomicity and private-DM/calendar boundaries. Requirements are preserved in `ACCOUNTS_REVENUE_SPEC.md`; they extend the original unchanged master prompt.

Merged previously verified PR #2 at exact head `521fd41` (full CI 43722247578 passed). Current main merge is `ce09de1`. To preserve concurrent uncommitted hosting/scanner work in the original workspace, created isolated worktree `/home/carinaschoppe/.codex/worktrees/luminovia-accounts-platform` on `codex/accounts-profiles-commission`. All new code and dependency installation are in that worktree; unrelated original files were not changed or staged. Production is not authorised or touched.

Implemented three coordinated migrations: private gross/commission offers and immutable accepted revenue ledger plus client memberships/requests; profile details/labels, real course history and optional learner enrolment/verified reviews; and account identity/profile/directory/role/lifecycle API plus a shared idempotent invitation ledger. Added real client portal, role-adapted dashboard/navigation, pricing/reporting/invoice labels/filtering, public-safe staff profiles and administrative account management. The new versioned Edge API uses current Auth and database capabilities; native domain RPCs remain the authority.

Initial meaningful checks passed: commission14, profiles14 and accounts11 real disposable PostgreSQL cases plus original 25/chat17/commercial14 regressions. Account Edge11 dependency-injected tests pass. Source/type/lint checks passed incrementally; full integrated/canonical API+browser/PWA acceptance remains pending at this checkpoint.

Code audit found and corrected concrete issues: explicit null account pagination bypassed the limit (102 returned against a 100-row cap); draft offers inflated published finance counts; duplicated new timezone validation repeated an existing foundation trigger and was removed; owner/admin UI chat eligibility did not match backend capability; calendar links dropped the selected course ID; missing role-appropriate navigation led clients/learners to staff-only routes; and a delayed initial Auth session could overwrite a later logout/account change. The Auth race was reproduced red then fixed with 4 regression checks. New and legacy invitation endpoints now share the same reservation/completion implementation. Shared account browser fixture helpers remove repeated Auth/TOTP setup between new specs.

No complete-code or bug-free certification is inferred. Run the complete isolated command, inspect actual failures and fix them; then signed push/new PR, observe exact CI, merge as the user authorised, verify merged main and preserve actual evidence. Continue the remaining original full-product scope after this explicit accounts/revenue/profile request is accepted.

### M3 integrated source and first whole-stack checkpoint

The integrated source passed TypeScript/lint/format and **59 tests across 19 files**. The new Account API passed **11 Edge handler tests**, bringing the full Edge set to 22. New disposable account SQL 11 and cross-source API-surface SQL 3 passed; actual migration inventory contains 95 public functions and 88 literal delivered frontend references all bind to executable migrated APIs. The generated reference is `docs/API_REFERENCE.md`.

`m3-test-01` failed immediately on an unsupported RTL-only `exact` option; corrected the selector (string role names already match exactly). `m3-test-02` then passed all source/runtime/Edge stages, started every service and passed the real Auth/MFA/Storage persistence+cleanup probe and original 25 SQL cases. Database lint stopped on an implicit text-to-JSONB default in create_client_request. Corrected to explicit JSONB; backend replayed all migrations in a disposable database and checked all PL/pgSQL bodies with plpgsql_check, returning zero issues. Commission 14 SQL passed again. The next canonical run uses the corrected source; no later API/browser pass is inferred yet.

### M3 canonical03 — actual server acceptance and isolated browser fixture correction

The third full invocation replayed all 13 migrations, passed 59 source checks across 19 files, 7 runtime safeguards, 22 Edge checks/typechecks, actual stop/start persistence and checked cleanup, all 120 real PostgreSQL cases, SQL lint/security/performance advisors, all nine actual API suites and the captured-mail invitation. These included real Auth/TOTP, WebSockets, private Storage/ClamAV, 50-way claim concurrency, hidden gross/cross-organisation isolation, immutable accepted splits, account-role/lifecycle races and real completed-course review authorisation. The private artifact is `.local/tests/f44a033b/`.

Browser result was44/46: both account flows, both client/50-50/net-invoice flows and all existing journeys passed. The two new people journeys failed because manager and learner test pages shared one BrowserContext, so Supabase session storage correctly replaced the manager identity when the learner signed in. The fixture now uses separate manager and learner contexts; no authentication workaround or app permission relaxation was introduced. The next complete invocation includes this correction. Build/PWA were not reached in this failed run and remain unclaimed until actual completion.

Inspected fictional desktop/mobile screenshots show working client full-fee/assigned-teacher view, lecturer net-only invoice/labels and separate account management; screenshots contain no real person, QR code or credential. A current scan compared four actual local server-credential/password values with 258 deliverable repository files and found zero matches. This does not substitute for exact-revision CI, hosted security or the remaining product release gates.

### M3 complete local command passed

The corrected full `./portal test` finished at **2026-11-15T15:27:43.573Z** (16 November Australia/Brisbane), private report `.local/tests/b1c83645/RESULT.txt`. All 13 additive migrations, 59 source/19 files, 7 runtime, 22 Edge, 120 SQL plus clean lint/advisors, all 9 real API suites and captured invitation, 46/46 desktop/mobile cases (3.8 minutes), current production build and 2/2 built-PWA checks (2.2 seconds) passed. Static precache contains 50 entries/2379.73 KiB; private API data are not cached. Actual Auth/MFA/profile/event/object bytes survived restart and all probe/test resources were cleaned. Normal development was never reset or mutated by canonical QA.

Reviewed the actual new fictional desktop/mobile account/client/revenue/net-invoice/profile screenshots. Documentation now includes the approved scope, actual API inventory/OpenAPI, current ERD/architecture, role-specific user guide, scoped audit and complete remaining product plan. Ten new screenshots are retained as review evidence; private traces/credentials/reports remain ignored. The original hosting/scanner worktree and live runtime remain untouched, so its current running source is not claimed to be M3. Next: signed branch push, exact GitHub CI, authorised merge and main verification. No production deployment.

A separately configured root production build also passed using only the normal local public URL/publishable key. Comparing the 47 emitted build files with the two actual normal server-credential/password values found zero matches. The build is ignored and was not deployed.

### M3 signed submission checkpoint

Signed source commit `ff3153847d5b312c9569a5ca54fb411f5cd658af` was locally verified and pushed to `codex/accounts-profiles-commission`. [PR #3](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/3) targets unchanged main `ce09de1`; the full canonical CI was queued at this documentation checkpoint ([initial run](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43730325773)). The following documentation-only commit preserves this submission and does not change the locally accepted application/tests. Check the PR's actual latest head/checks for final remote evidence; initial queued state is not a passing CI claim.

The user has explicitly authorised direct merging after checks. The workflow contains verification only and no deployment; verify the current base/workflow again before merging in case of concurrent changes. Original `/home/carinaschoppe/Documents/ChatGPT/Luminovia` is now on separate `codex/hostinger-auto-updates` with concurrent uncommitted work; it and its running development instance remain untouched. M3 source and full local reports are in the isolated accounts worktree. Do not overwrite/stash/commit the other branch's changes when continuing.
