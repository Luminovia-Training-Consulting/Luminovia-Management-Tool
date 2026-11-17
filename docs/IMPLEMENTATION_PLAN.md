# Persistent implementation plan

## Bug hunt — lazy route bundle correction (17 November 2026)

- [x] Inspect clean published `main` independently of the dirty feature checkout and identify a measurable production build defect.
- [x] Split shell-only announcements/notification components from their full pages and lazy-load those pages on direct routes as well as section hubs.
- [x] Pass all 867 frontend tests, targeted UI tests, typecheck, lint and public-config production/PWA build; confirm ineffective dynamic-import warnings are gone and route chunks are emitted.
- [x] Align stale SQL assertions with accepted self-declared expertise behavior; pass 25 PostgreSQL groups including 50 parallel claims, and pass the focused owned-cascade SQL suite after adding an explicit `oid[]` initializer migration.
- [ ] Run the complete isolated SQL/API/desktop/mobile/PWA acceptance after the other checkout releases the shared test lock. The latest `./portal test` retry stopped safely before startup due to that lock; an earlier exact full run reached and diagnosed the SQL/lint failures now addressed.
- [ ] Push signed branch through the repository PR workflow, monitor exact-head checks and merge when required checks pass.

## Workspace clarity, account creation and manual planning — 17 November 2026

The latest user revision explicitly restores restricted guest accounts; participants remain retired. Individual lecturer defaults replace role-based price defaults for new commissioned offers without rewriting accepted snapshots.

- [x] Increase usable chat transcript area, collapse secondary controls, compact composer/sidebar, separate lounge/tabs; move profile link to heading and arrange profile privacy blocks as responsive tiles.
- [x] Put Support inside Knowledge & Help, keep old ticket deep links, add icon/category navigation to recent bell and loaded inbox history; create genuine invoice/payment inbox events with current-resource title/link checks.
- [x] Organise administration into clear course/assignment/account/customer entry points; add current-authority manual complete-job lecturer allocation and keep course-run/customer organisation membership linkage.
- [x] Add per-lecturer percentage/default50 or EURday/default200 settings and authoritative quote revision checks; retain accepted conditions and private gross visibility boundaries.
- [x] Add admin direct account creation and role editing, including admin/management/senior lecturer/lecturer/client and restricted guest. Company accounts require organisation binding; guests receive no business permission widening.
- [x] Add reviewed local ICS import: floating/IANA/UTC times, all-day exclusive ends, bounded recurrences/exclusions/exceptions; atomic owner-only batches, duplicate skipping and confirmed-assignment conflict denial.
- [x] Pass867 frontend tests,331 runtime checks, type/lint/format/export checks and production build; focused SQL/account-facade/native Auth/UI journeys pass. Native desktop/mobile/dark visual review passes, as do actual production PWA manifest/icons/active-service-worker/browser-installability checks. Full historical canonical acceptance and hosted exact-head CI remain separate unverified gates.
- [x] Push integrated main and refresh retained-data local preview at5773: verified private archive, preserve Auth/Storage/project/password, apply four forward migrations and pass native admin login plus calendar/import, account creation dialog, administration board entry, support tab and profile heading smoke.

## Current exact-main CI repair — 17 November 2026

- [x] Inspect current `origin/main` and failed `Portal checks` run 44072628974; fast CI gates passed, full isolated verification exposed stale password-only/MFA fixture expectations.
- [x] Correct delegated-pricing historical policy setup and AAL1 expectations, current account revocation status, and delivery management projection expectations without weakening authorization.
- [x] Correct document fixture to exercise permission-authorized invoice upload at AAL1, and retain foreign/anonymous/RLS denials.
- [x] Focused local SQL verification: delegated pricing 18/18 groups; delivery 12/12 groups; documents 13/13 groups; `git diff --check` clean.
- [x] Fresh full system attempt passed 830 unit tests, 331 runtime checks, 95 Edge tests, startup/persistence, concurrent claims and SQL suites until the document assertion was corrected.
- [x] Align capacity, picker and discovery SQL fixtures with current active-role/password-only semantics; focused verification passes 8/8, 6/6 and 9/9 groups.
- [x] Align actual audit API acceptance with `audit.read` permission and factor-free AAL1 admin/owner access; management and lecturer denial remains required.
- [x] Correct stale lifecycle authorization assertion; focused local PostgreSQL lifecycle suite passes 12/12 groups.
- [ ] Run fresh full isolated system and browser acceptance on the corrected exact head, fix every failure, and inspect fresh GitHub `Portal checks` through completion.
- [ ] Claim CI green only after every required current-head job succeeds; retain complete test scope.

## Calendar, marketplace and owned deletion revision — 17 November 2026

The later user instructions supersede earlier admin-verified expertise and blanket commercial-history deletion blockers.

- [x] Remove calendar subscription UI; retain search/type, add actor-scoped customer and topic/tag filtering, and accessible chevron/Today/Month/Week/Day/Agenda controls.
- [x] Collapse marketplace filters and saved-view controls into one optional section, remove the separate saved-views block, make the entire job card a native link, and separate assignment management actions with clear spacing.
- [x] Matching self-declared expertise is sufficient for claims, replacements, notifications and readiness; retain current authorization, contracts, capacity, complete-job and conflict checks.
- [x] Add organisation deletion to its Edit dialog; extend confirmed deletion to owned lecturer contracts/documents/calendar/claims and directly linked organisation jobs/history/documents. Reopen shared job capacity and preserve unrelated/shared roots. Freeze impact identities so parent deletion cannot strand child documents.
- [x] Source verification: 832 frontend tests, 331 Node tests, typecheck, ESLint, formatting, export integrity and production/PWA build pass. Build uses synthetic public-only local configuration.
- [x] Real isolated PostgreSQL coverage: 64 calendar/expertise/replacement/notification/commission/readiness groups, 27 existing permanent-deletion groups and the owned-cascade regression pass.
- [x] Native calendar at 1440/390/320px: actual customer/topic filtering, navigation and view changes; no overflow, JS errors or automatic WCAG findings.
- [x] Native self-declared claim: actual login, unverified own-topic insertion, HTTP200 confirmed full claim and both sessions allocated; missing topic denied, no JS errors/mobile overflow.
- [x] Native marketplace at 1440/390px: blank card area opens detail, one native link, filters collapsed, no standalone saved-view heading, management gap20px, no overflow/page errors.
- [x] Native confirmed lecturer and organisation deletion: Auth, exact scanned files/Storage, reservations, personal calendar and linked historical/current records removed; shared job reopened and unrelated template/peer data retained.
- [x] Update the persistent local preview at5773 without a data reset: verified backup archive, preserved project/port overlay and Auth/Storage volumes, applied all three forward migrations, checked installed frozen-scope/file-fence definitions and passed native admin login/calendar/jobs smoke.
- [ ] Full canonical historical API/E2E/PWA suite and hosted exact-head CI remain separate from focused native acceptance; do not claim those passed from this slice.

## User revision: simpler portal and supplied design — 17 November 2026

Implemented from `todos.txt` and the supplied portal images:

- [x] Simplified primary navigation; topbar search and fixed-size bell; Support last; no standalone welcome, delivery, learning, workbench, timesheets, availability or deletion navigation entries.
- [x] Cream/navy/blue and pastel styling, rainbow heading arcs, coloured course cards/tags, aligned file centre; responsive stylesheet checks at 320/760/1280px.
- [x] One authored biography, numerical teaching years with legacy-text retention, no generic public labels, plain password link, expertise maintenance via current admin/management taxonomy permissions.
- [x] Course overview tiles link across their full area; course hub combines catalogue/readiness/representations, knowledge combines wiki/help, communication combines forum/announcements/notifications.
- [x] Tour launcher only in Settings; contextual permanent deletion in person/course/template details.
- [x] Participant-only/guest-only accounts denied server-side and frontend; removed participant enrolment controls. Company-to-lecturer reviews enforced by current customer membership.
- [x] 852 Vitest tests, ESLint, TypeScript and production/PWA build pass. Two real isolated PostgreSQL groups verify current-role denial, review eligibility/revocation and full migration replay.
- [ ] Full logged-in desktop/mobile/PWA/API acceptance: canonical `./portal test` is blocked by another checkout holding the shared QA lock. Existing participant-focused historical test fixtures must be updated for the retired participant product contract.
- [x] Dashboard composition uses live assignments/readiness/calendar and the shared rainbow/pastel design. Person records have actual basic editing, roles/access, block/reactivate and delete actions at the top. Course records have Edit/Archive/Delete at the top; course workspace is operational rather than learner-facing.
- [x] Remove retired availability, delivery-evidence, participant enrolment, workbench and timesheet frontend modules and their obsolete UI tests. Shared calendar/finance functions remain connected and tested.
- [x] Group settings into appearance/account/notifications/quiet-hours/organisation, embed help/FAQ without a second public header and retain its section on topic navigation, place replacement discovery inside the course catalogue rather than its own tab.
- [x] Add current-authority managed-profile editing and actual course destinations (company, lecturers, exact permitted chats and assignments); full-migrated PostgreSQL regressions pass.
- [x] Review all principal authenticated views natively: 52 role/route combinations at desktop/mobile with no JS errors or overflow; 21 admin views pass automated axe checks. Native mutation journeys and each TODO are recorded in [UI_ACCEPTANCE_20261117](UI_ACCEPTANCE_20261117.md).
- [ ] Complete the separate all-history canonical SQL/API/E2E/PWA run after the shared QA lock is available; native UI acceptance does not certify every historic suite.

## Internal UI redesign — 17 November 2026

- [x] Refresh the shared authenticated shell, official sidebar branding, readable navigation, page headings, panels, inputs, buttons, tables and dashboard metrics in line with the supplied clean navy/blue/pastel reference direction.
- [x] Keep UI data and actions bound to existing authenticated actor/customer scopes; do not seed or copy the illustrative screenshot records.
- [x] Pass focused shell regression (12/12), lint, typecheck, formatting and frontend build with synthetic public-only Supabase build values.
- [x] Inspect actual authenticated dashboard, course workspace, jobs, files and other principal routes at desktop/mobile; record real browser evidence and corrected defects in UI_ACCEPTANCE_20261117.
- [ ] Continue the full exact-head local system, API and browser acceptance after repairing the isolated runtime startup/cleanup issue. CI is outside the requested local audit.
- [x] Pass the availability, assignment-handover, job-briefing and announcement PostgreSQL suites after updating this checkout's local migrations: 8, 15, 12 and 16 groups respectively.
- [ ] Re-run complete isolated system/browser acceptance; the earlier attempt stopped during service startup before the local persistent runtime was repaired.

**17 November QoL programme:** The user requests one integrated PR covering the supplied QoL prompt. Scope/status and gaps are tracked in [QOL_PROGRAMME_STATUS](QOL_PROGRAMME_STATUS.md), and every prompt criterion is enumerated in [QOL_FEATURE_MATRIX](QOL_FEATURE_MATRIX.md). The programme remains incomplete. The current branch has chat, calendar, contacts, wiki, restore and job-navigation slices; an integrated SQL replay passed, while exact-head full CI, browser/PWA/native acceptance and substantial feature inventory remain open. Preserve the full requested scope and report incomplete criteria honestly.

## Main migration-version collision — 17 November 2026

- [x] Give `remove_mfa_and_assurance_gates` a unique migration version (`20261117130021`) and update its SQL-test path. The previous version duplicated `company_lecturer_decisions` and prevented clean Supabase migration replay.
- [x] Verify all migration versions are unique, apply the complete migration set in a fresh isolated local stack, confirm the renamed version is recorded, and receive HTTP 200 from `/login`.

## Local admin bootstrap and default password — 17 November 2026

- [x] Check the active local Auth project on every startup; a stale bootstrap marker can no longer suppress creation of missing fictional accounts, while existing accounts and passwords are preserved.
- [x] Set a stable admin/test-account password only for an empty loopback Auth instance and expose it through `./portal credentials`; keep changed passwords intact when accounts already exist.
- [x] Cover stale markers, account preservation and password selection with focused regression tests.
- [ ] Complete a clean full `./portal start` rehearsal on the updated launcher; a local attempt stopped with Supabase CLI reporting `Expected local service db is not running` after the DB endpoint had become available.

## QoL continuation after current main integration — 17 November 2026

- [x] Merge current `main` through `cc6218e` normally; retain the consolidated root documentation and the user-required project ledgers and verbatim prompt under `docs/`.
- [x] Place the 13 programme migrations after the accepted contract-owner migration without changing their SQL bodies.
- [x] Pass the integrated networkless migration replay and focused SQL suites for privacy, restore, navigation, chat replies/unread, membership origin, wiki attachments, API grants, deletion, forum metadata, profile expertise privacy and strict group invitations; regenerate the API reference from 308 migrated functions.
- [ ] Implement all remaining QoL prompt criteria; use the feature matrix to track each criterion and its actual evidence.
- [ ] Pass exact-current-head unit/source checks, complete database/API integration, desktop/mobile browser and PWA acceptance, security checks and required CI. Prior source snapshots are not evidence for the final head.
- [ ] Keep the draft PR open and user-owned. No production deployment, real mail, production data changes, or PR merge is included.

### Combined local source acceptance — 17 November 2026

- [x] `./portal check`: 845 tests in 119 files; typecheck, lint, formatting, code-quality check, production build and PWA generation pass. Coverage: statements 70.87%, branches 66.79%, functions 61.44%, lines 73.23%.
- [x] Regenerate API reference from 96 migration files/308 public functions through `20261117130020` in a disposable database.
- [ ] Run complete `./portal test` and current-head GitHub CI. Local browser/QA port 55321 belongs to another checkout and remains untouched; browser E2E cases are discovered but not executed locally.

### Additional QoL slices — 17 November 2026

- [x] Add searchable calendar title and event-type filters for loaded personal, assignment, global and course entries; disclose the loaded-page/date-range boundary.
- [x] Add private file details from freshly authorized document metadata and the current RLS-protected version row; pass 47 focused component tests, 13 document SQL/API groups and author a desktop/mobile E2E case.
- [x] Add DE/EN course teaching-link copy with server-authorized HTTPS validation and actual clipboard result; pass 10 component cases and 11 course PostgreSQL groups.
- [x] Add actor-scoped chat room last-message previews; hidden content and tombstones are excluded. Pass the focused component/SQL checks and add a browser assertion.
- [x] Audit bulk notification read: existing snapshot-bounded action is complete at source, with 15 isolated PostgreSQL groups and 71 component/API tests; no new implementation needed.
- [ ] Execute the new browser cases in an isolated environment and complete the remaining feature matrix. External email/push delivery is not asserted.

### Topic-group invitations — 17 November 2026

- [x] Add server-authorized, owner-managed topic-group invites with consent before membership; recheck current owner, active staff roles and room state on each operation.
- [x] Add German/English owner and invitee UI, and test concurrent and stale invitation decisions in isolated PostgreSQL.
- [ ] Add exact current API reference entries and run the authored desktop/mobile E2E. Strict invitation-only groups, other group kinds and outbound notifications remain open.

### Personal chat archive — 17 November 2026

- [x] Add per-member archive/restore for own direct and topic conversations while preserving shared messages and access; reject course/system rooms.
- [x] Pass focused PostgreSQL own-scope/lifecycle checks and five focused archive/pin UI tests; typecheck and targeted lint pass.
- [x] Add an integration regression proving other members retain room/message access after personal archival; regenerate the API reference from the exact 91-migration source.
- [ ] Run actual desktop/mobile browser coverage and integrated full acceptance. Group-level archive, course/system rooms, and distinct hide semantics remain open.

### Group-wide topic message pins — 17 November 2026

- [x] Add role/MFA-gated pin/unpin, current-member pin list, safe navigation to the original message, stale-content filtering and deletion-scope handling for topic groups.
- [x] Pass 3 isolated PostgreSQL groups, 16 focused component/thread/Realtime tests, and full `./portal check` (823 unit tests, source checks, build and PWA); regenerate the API reference from 92 migrations/302 public functions.
- [ ] Run the new desktop/mobile E2E and full current-head API/browser/selfhost acceptance. Other room kinds remain outside this slice.

### Forum thread metadata — 17 November 2026

- [x] Add owner title/category editing and MFA-qualified moderator edits, with optimistic-concurrency checks that preserve drafts on conflict.
- [x] Pass two component cases and isolated PostgreSQL authorization, validation, race and state-preservation checks; regenerate the API reference from 93 migrations/303 public functions.
- [ ] Run actual desktop/mobile browser acceptance and integrated full-head checks. Existing creation, replies, subscriptions, moderation, attachments and search still require complete prompt-wide acceptance.

### Expertise visibility and strict group invitations — 17 November 2026

- [x] Add an independent owner preference for showing expertise in authorised profile and directory/filter projections; preserve owner self-view, qualification checks, contact preferences and job eligibility.
- [x] Add optional invitation-only topic-group creation and owner mode changes, with consent-gated membership and a locked server-side direct-add check; retain established members.
- [x] Pass the profile SQL and component suites (including existing 14 profile SQL and 22 profile/people component cases), four invitation-only SQL groups, six unread SQL groups and 11 focused chat UI/group cases.
- [ ] Run actual Auth/REST and desktop/mobile browser acceptance. Duplicate strict-group creation after an uncertain network outcome remains possible; additional group kinds are not covered.

## PR35 private-document acceptance follow-up — 17 November 2026

- [x] Trace both current exact-head CI failures to the stale native fixture: an administrator attempted to preview another actor's private personal document after the accepted migration removed that bypass.
- [x] Update real Auth/Storage acceptance to assert the MFA administrator is denied and the MFA owner confirms, polls and retries deletion; keep the privacy boundary unchanged.
- [ ] Pass focused checks and fresh full exact-head/current-base CI, including local system, browser, selfhost retained-data, security and preview gates; merge PR35 only when all required checks pass.

PR 35 follow-up: cancellation-marker publication and the announcement quiet-window fixture have focused passing local checks; rerun the complete required CI on the integrated head and address remaining failures before merge. The full product scope below remains unchanged.

PR 35 review corrected the administrator-wide private-document deletion bypass; the 27-group disposable SQL suite passed. Full integrated CI remains required before merge.

## PR35 integration after PR31 — 17 November 2026

- [x] Preserve the 70 accepted migration sources and replay the three unpublished deletion migrations after the accepted job briefing migration.
- [x] Include job-owned briefing and request rows in the reviewed deletion scope, with bilingual impact labels; test changed-scope detection and physical deletion.
- [ ] Complete exact-head full CI and merge under current rules; native Auth/Storage and browser acceptance are not established by the SQL fixture.

## PR35 native diagnostics and accepted main38 — 17 November 2026

- [x] Inspect native CI43903652814; distinguish secondary Auth/REST cleanup errors from its truncated primary failure, without claiming an unproved root cause.
- [x] Replay exact be81819 in a separate owned native stack:72migrations,50API/invitation suites,TLS/WebSockets,retained data,50claims and checked cleanup pass; no OOM kill/restart is observed.
- [x] Preserve bounded primary/final failure context after existing secret redaction; real failing-child regression and13candidate/lint/format guards pass.
- [x] Integrate accepted main38 documentation/browser source, preserving user-required ledgers and all69immutable SQL bodies; retain no root changelog.
- [x] Regenerate the complete 72-migration API with the accepted improved generator (265 functions), pass combined source checks (704 cases/92 files), 4 actual upgrade groups and 16 candidate/documentation guards; remove the exact owned SQL fixture.
- [ ] Complete the owned canonical full-phase `d0a16dfe` snapshot (started before the documentation-only results update), push the signed integration and require fresh current-head complete CI before the authorised PR35 merge.

## PR35 integration after accepted PR25 — 17 November 2026

- [x] Preserve actually merged PR25/main `4f7f6c0`, all69published SQL blobs and the existing PR35 fixes through normal ancestry; resolve all three documentation conflicts without dropping ledgers or contracts.
- [x] Upgrade the real composition fixture from the accepted69file baseline; combined72file replay passes upgrade4/deletion25/company8/support16/API6/enquiries17groups and regenerates265public API functions.
- [x] Pass704frontend cases,173runtime and92Edge cases,29candidate/TLS and3documentation checks plus existing source/coverage/build gates. The full local command remains refused before startup by a foreign-owned shared QA lock.
- [ ] Publish the signed integration, inspect complete fresh current-head system/browser/native/security/package CI, fix any failures and merge PR35 under existing repository rules. No production/publication operation belongs to this work.

## Browser test runtime — 17 November 2026

- [x] Keep both Chromium projects, every browser scenario/assertion, per-file ordering and zero retries. Restore one browser worker: the first parallel run reproduced shared Supabase Auth account-deletion failures.
- [x] Use Playwright's virtual clock for the 15-second stale-query behavior and shorten the idle observation only to 10.1 seconds, beyond the prior 10-second polling boundary.
- [x] Baseline exact-head timings from the last green main-based CI: browser cases 20m34s; system verify 35m32s. About 17 minutes came from separate SQL/API suites run serially.
- [x] Use a bounded pool for independent SQL suites (up to four isolated databases); retain stop-on-failure and wait-for-in-flight cleanup semantics. API suites stay sequential because they share one GoTrue service and parallel cleanup failed in CI.
- [x] Scale independent PR SQL shards to at most four isolated workers; keep retained selfhost API suites sequential after the same GoTrue cleanup failure. Retain real migration/restart/image, auth, browser, concurrency, and cleanup proofs.
- [x] Replay migrations once per isolated PostgreSQL worker into an owned ephemeral template and clone a fresh database per SQL suite; keep main migration acceptance and every historical-bound migration check unchanged. Exact-head SQL/template suites passed.
- [ ] Complete exact-head CI with serial browser/API fixtures and collect successful per-job timings before claiming the final speedup. Do not trim coverage.

## Current contract privacy and local audit — 17 November 2026

- [x] Reproduce the personal contract access boundary and implement owner-only file access with bounded administrative registration metadata in a new migration.
- [x] Pass isolated SQL privacy and actual Auth/MFA/Storage contract download, registration and replacement checks; retain historical files and accepted records.
- [x] Fix the pinned Deno installer for clean npm 12 installs and verify the public demo on desktop and mobile emulation.
- [x] Complete the local isolated SQL/API/browser/build/PWA run on the pre-dashboard audit snapshot: 162 desktop/mobile and 4 PWA cases passed with checked cleanup.
- [ ] Complete combined exact-head CI and integrate current `main` before any permitted merge.
- [x] Start a separate fictional-data preview of the PR45 snapshot on alternate loopback ports and check the actual lecturer login/contract screen; existing preview services remain untouched.
- [ ] Verify a fresh latest-main preview after the relevant PRs merge. The overall product and release requirements below remain open.

## PR37 participant-origin CI repair — 17 November 2026

- [x] Trace the native fixture cleanup failure to dependent membership-origin rows blocking deletion of its owned participant room.
- [x] Make provenance rows follow room/profile lifecycle with cascading foreign keys and add an actual database assertion for room cleanup.
- [ ] Pass focused checks and fresh full exact-head/current-base system, browser, SQL, native/selfhost, security and preview checks; merge only when all required gates pass.

## Participant chat membership origins

- [x] Track new assignment-derived and explicit participant-room membership without guessing legacy provenance; fail closed and provide an authorized explicit resolution.
- [x] Preserve independently authorized membership and active additional course claims or enrolments; re-evaluate enrolment removal and both handover paths.
- [ ] Complete independent security review and exact-head CI, including native Auth and browser acceptance; do not infer hosted migration or production readiness.

## PR35 private-document acceptance follow-up — 17 November 2026

- [x] Trace both current exact-head CI failures to the stale native fixture: an administrator attempted to preview another actor's private personal document after the accepted migration removed that bypass.
- [x] Update real Auth/Storage acceptance to assert the MFA administrator is denied and the MFA owner confirms, polls and retries deletion; keep the privacy boundary unchanged.
- [ ] Pass focused checks and fresh full exact-head/current-base CI, including local system, browser, selfhost retained-data, security and preview gates; merge PR35 only when all required checks pass.

PR 35 follow-up: cancellation-marker publication and the announcement quiet-window fixture have focused passing local checks; rerun the complete required CI on the integrated head and address remaining failures before merge. The full product scope below remains unchanged.

PR 35 review corrected the administrator-wide private-document deletion bypass; the 27-group disposable SQL suite passed. Full integrated CI remains required before merge.

## PR35 integration after PR31 — 17 November 2026

- [x] Preserve the 70 accepted migration sources and replay the three unpublished deletion migrations after the accepted job briefing migration.
- [x] Include job-owned briefing and request rows in the reviewed deletion scope, with bilingual impact labels; test changed-scope detection and physical deletion.
- [ ] Complete exact-head full CI and merge under current rules; native Auth/Storage and browser acceptance are not established by the SQL fixture.

## PR35 native diagnostics and accepted main38 — 17 November 2026

- [x] Inspect native CI43903652814; distinguish secondary Auth/REST cleanup errors from its truncated primary failure, without claiming an unproved root cause.
- [x] Replay exact be81819 in a separate owned native stack:72migrations,50API/invitation suites,TLS/WebSockets,retained data,50claims and checked cleanup pass; no OOM kill/restart is observed.
- [x] Preserve bounded primary/final failure context after existing secret redaction; real failing-child regression and13candidate/lint/format guards pass.
- [x] Integrate accepted main38 documentation/browser source, preserving user-required ledgers and all69immutable SQL bodies; retain no root changelog.
- [x] Regenerate the complete 72-migration API with the accepted improved generator (265 functions), pass combined source checks (704 cases/92 files), 4 actual upgrade groups and 16 candidate/documentation guards; remove the exact owned SQL fixture.
- [ ] Complete the owned canonical full-phase `d0a16dfe` snapshot (started before the documentation-only results update), push the signed integration and require fresh current-head complete CI before the authorised PR35 merge.

## PR35 integration after accepted PR25 — 17 November 2026

- [x] Preserve actually merged PR25/main `4f7f6c0`, all69published SQL blobs and the existing PR35 fixes through normal ancestry; resolve all three documentation conflicts without dropping ledgers or contracts.
- [x] Upgrade the real composition fixture from the accepted69file baseline; combined72file replay passes upgrade4/deletion25/company8/support16/API6/enquiries17groups and regenerates265public API functions.
- [x] Pass704frontend cases,173runtime and92Edge cases,29candidate/TLS and3documentation checks plus existing source/coverage/build gates. The full local command remains refused before startup by a foreign-owned shared QA lock.
- [ ] Publish the signed integration, inspect complete fresh current-head system/browser/native/security/package CI, fix any failures and merge PR35 under existing repository rules. No production/publication operation belongs to this work.

## PR35 mergeability repair — 17 November 2026

- [x] Reproduce the current SQL blocker and trace the fresh-account browser blocker to accepted request-revision and profile-preference dependencies.
- [x] Add a forward-only private deletion-scope integration; preserve released SQL, granular permissions, shared evidence, accepted commercial history and uncertain external delivery barriers.
- [x] Place all3unaccepted deletion migrations after the accepted prefix; preserve all69current accepted sources, exact support/qualification/enquiry helper composition and4actual upgrade groups.
- [x] Reproduce planner-dependent snapshot reordering and order both catalogue walks; retain exact protected-dependency and concurrent-change assertions.
- [x] Pass8company and25permanent-deletion PostgreSQL groups with ownership/preservation/delivery regressions and bilingual impact labels.
- [x] Pass integrated `./portal check`:704frontend cases/92files, coverage floors, types/lint/format/compiler and production/PWA build.
- [ ] Finish current-head full required CI, including native Auth/Storage/browser acceptance; canonical local invocation initially refused a foreign-owned shared QA lock.
- [ ] Merge only PR35 after current checks pass and repository rules permit; no release publication or production operation is authorised by this repair.

The complete target and all unrelated pending work remain below.

## All-open-PR merge continuation — permanent deletion

- [x] Preserve actual accepted main `7fbdb956`, both additive ledgers and all released migration bytes; the latest direct user request supersedes earlier PR35-only merge sequencing.
- [ ] Pass current integrated-source checks, then let the single coordinator perform the protected PR35 merge after every required current-head gate succeeds. No publication or deployment belongs to this request.

## Confirmed permanent deletion — current user extension

- [x] Record the latest direct decision: permanent confirmed deletion, no trash; companies only own jobs; this task does not merge unrelated PRs.
- [x] Audit actual account/Storage/job/company/FK behavior on main1de544d; define the bounded [execution contract](PERMANENT_DELETION.md).
- [x] Implement typed administrative deletion plans, current authority/MFA, dependency handling, irreversible fences and truthful completion;25new real SQL groups and reduced-content/executor recovery review pass.
- [x] Implement server-only native Auth hard deletion and exact all-version Storage cleanup, upload leases/path fences and failure/retry orchestration;62Edge unit cases pass. Actual native byte/Auth/race acceptance remains pending below.
- [x] Close inherited company job/history/attachment bypasses and expose only own-company deletion targets;7real company SQL groups pass.
- [x] Implement bilingual admin/context confirmation UI with pending/error/success and server receipt recovery; retain archive separately;535frontend cases and actual source/build checks pass.
- [ ] Execute targeted real SQL/Auth/Storage and browser checks in owned fictional fixtures, then complete the reserved local acceptance and current-head CI.
- [x] Deliver signed commits and pushed [draft PR35](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/35), with actual checks and native/CI gaps stated.
- [x] Correct actual SQL-lint failure, protected payment history, assignment room/file revocation, retained business audit visibility and full lifecycle budget contract;21deletion+8company SQL groups,64Edge cases and real PL/pgSQL checking pass.
- [ ] Complete the reserved actual native/full local acceptance and fresh required CI, then merge only PR35 under the user's latest explicit instruction. No other PR merge or production operation is authorised.
- [x] Pass complete canonical local acceptance on signed67b749d:29native API suites,116application+2PWA browsers, all SQL/source checks and actual cleanup. Keep this evidence source-bound.
- [x] Close remaining company history/earnings/calendar/raw-RLS paths and pass8expanded SQL groups; improve reviewed impact clarity and pass23focused deletion cases.
- [ ] Verify the final follow-up with native company deletion/revocation and new screenshots; integrate only actual accepted main and replay the final migration order before current required CI and the authorised PR35 merge.
      PR40 browser acceptance repair: single shared preferences and visible mobile sign-out are implemented; 25 focused component tests, TypeScript and ESLint pass locally. The complete exact-head GitHub/browser/native gates remain pending.

## PR31 after accepted documentation main — 17 November 2026

- [x] Integrate accepted PR38/main `bcba673`, preserve the briefing contract, and regenerate the API reference from the actual 70-migration replay (254 application functions).
- [x] Recheck 695 frontend tests and source/build/coverage gates plus 16 candidate/documentation checks; all 69 accepted migration bytes and the unreleased briefing body remain unchanged.
- [ ] Run current-head full CI and address any real failures; merge only after all required checks succeed and current main is integrated.

## PR31 retained-upgrade repair — 17 November 2026

- [x] Place the byte-identical unpublished briefing migration after all 69 accepted SQL sources and guard its order.
- [x] Pass 695 frontend cases and source/build gates, 13 candidate and 3 documentation checks, and the real 69→70 upgrade plus 12 briefing and 12 lifecycle SQL groups.
- [ ] Observe fresh current-head full CI, integrate any newly accepted main, and merge PR31 only after all required gates succeed. No deployment is included.

## PR25 mergeability continuation — 17 November 2026

- [x] Resolve both documentation conflicts against accepted main `2c7d326`, preserving all released migrations and complete ledgers.
- [x] Correct native candidate TLS leaf semantics without disabling validation; actual enquiry-runtime positive/untrusted/wrong-host HTTPS and socket/candidate suite passes29cases.
- [x] Pass combined `./portal check` (681frontend),173runtime and74Edge cases with unchanged gates. Full local acceptance refuses a foreign-owned shared QA lock before startup.
- [ ] Push signed correction, inspect fresh exact-head full system/browser/native/security/package CI, repair any failures and complete the authorised PR25 merge when repository rules permit. No production/publication action is included.

## PR25 repair on accepted PR24 — 17 November 2026

- [x] Bind private enquiry intake to accepted main `99add7d`, preserving all 68 published migrations and incoming application/operational workflows.
- [x] Resequence the one unpublished enquiry migration after the released prefix; use the accepted owner-only notification resolver without restoring direct authenticated execution.
- [ ] Verify canonical and native enquiry adapter startup, actual SQL permissions/inbox/conversion, frontend and complete isolated acceptance. Record actual results in WORKLOG; previous PR24 results do not accept PR25.
- [ ] Push signed repair to PR25, refresh its stale stacked description and draft status when ready, observe all required current-revision checks, and merge only when repository rules permit. No release or production action is included.

All complete product and seven-module ledgers below remain required. Prior coordination notes describe their historical checkpoints; this PR repair follows the current user request.

## Current final delivery on actual 68-migration main

- [x] Preserve accepted PR24 main `99add7de`, all68published migration bytes, its operational source and both complete ledgers. Maintain PR12-first priority; no additional feature merge is needed.
- [x] Update the matrix for readiness/delivery/replacements/support and their forwarding/privacy/authority integrations; bounded source review finds no concrete old calendar/search/API contract break.
- [x] Pass674frontend/89files with all coverage/type/lint/format/compiler/build gates,156runtime cases without skips and actionlint/own-diff checks. Discovery validates156application+4PWA cases in54files only; earlier service/SQL passes remain bound to their recorded sources.
- [ ] Publish the signed coherent final head, require matching actual system/browser evidence and successful68-migration native/parallel-SQL/security/preview checks, then perform and verify the normal PR12 merge. Release temporary review-state holds appropriately afterwards.

## Current final delivery on actual 62-migration main

- [x] Preserve actual PR17 main `4cc20874`, all62released migration blobs and the unchanged earlier36-file prefix, both complete histories and all accepted product/operating source. Reconfirm PR12-first through the user-authorised coordination message; no later feature merge is required.
- [x] Adapt the existing real search journey to the actual unified RPC/DTO/labels/profile link while keeping seven hits, all six sources, four denied fixtures, literal/DEEN/draft/reload/navigation/accessibility checks. Explicit E2E TypeScript/lint/format pass; update the A–N matrix honestly for accepted slices and remaining scope.
- [x] Preserve scoped Deno assets, SMTP-worker checks, actual30-minute browser-command allowance and60-minute system budget; retain strict hash/discovery/results/phase/privacy/cancellation guards. Pass18focused fixtures,156runtime cases and643frontend/83files with unchanged coverage floors, types/lint/format/compiler/build/actionlint. Discover148application+4PWA cases in50files without claiming execution.
- [ ] Publish the frozen signed current source and complete fresh system/browser/native/parallel-SQL/security/preview gates, checking phase/source identity and zero skipped/retried browser cases.
- [ ] Merge and verify PR12 normally, then release only still-applicable temporary review-state holds. No new merge permission, provider activation or production dispatch.

## Current final delivery after accepted PR36 main

- [x] Retain the user's PR12-first priority and accepted main `7fbdb956`; preserve all 36 released SQL bytes and actual independent system/browser/native gate semantics. Temporarily hold the other previously-ready PR review states while sources/tests continue; record original heads for appropriate release after PR12 merges.
- [x] Complete phase integration with explicit safe evidence labels, strict source/browser validation in the browser phase, independent safe verify/browser artifacts and unchanged missing-evidence failures. Keep default local `all`, full stage partition and cancellation-after-cleanup failure behavior.
- [x] Pass combined source/build/coverage checks with 515 frontend/65 files and all 144 runtime cases without skips, including real-controller phase/source/browser/privacy/cancellation regressions; formatting/actionlint/diff checks pass. Preserve exact6ff's separately completed 15-gate/120+2/91-stage full checkpoint as history.
- [ ] Preserve the parallel remote Main36 reconciliation in ordinary ancestry, publish the signed final source and require fresh full-profile system AND browser reports plus native/security/preview success on the current base.
- [ ] Merge and verify PR12 normally, then release the temporary review-state hold where still applicable. No renewed merge approval, unaccepted feature collection or production dispatch.

## Current all-PR merge continuation — PR12

- [x] Integrate actually accepted PR36/main `7fbdb956` through normal ancestry; preserve both ledgers, phase isolation, strict browser evidence and all 36 released migration files.
- [ ] Complete local source/orchestration checks and final current-head system/browser/native/security/package CI; merge sequentially through the central coordinator after required checks pass.

Earlier checkpoint evidence and the complete product scope below remain unchanged.

## Current priority: deliver PR12 first

- [x] Apply the user's direct priority change: PR12 now precedes the earlier feature queue. Merge after current required checks without renewed approval; do not import unaccepted PR17 source.
- [x] Reconcile actual PR34 main `c5281002`, preserving conservative scope routing, full PR12 classification, parallel native/application work, independent SQL workers and all 36 published migration bytes. Retain the measured 50-minute full-application allowance and source/browser evidence.
- [x] Complete the acceptance-upload interaction fix with actual red-to-green workflow regression (ten scope cases); retain cancelled full-run evidence and strict missing-report errors. Preserve the parallel remote reconciliation and both complete ledgers.
- [x] Pass combined local source checks: 515 frontend/65 files and all coverage/type/lint/format/compiler/build gates, 130 runtime cases without skips, actionlint/format/diff checks; derive full from the actual 27 changed paths. No app/API/browser/dependency/migration bytes change over accepted3daf.
- [ ] Publish the coherent signed final branch and observe its exact-head/current-base complete CI; prior3daf acceptance remains source-specific evidence.
- [ ] Require and inspect all 15 final-head/current-base checks, actual full-profile application/native reports and exact preview binding, then perform and verify the normal PR12 merge. No production or release dispatch.

## Current accepted functional checkpoint and ordered delivery

- [x] Complete exact published `3daf4f03` CI: all 15 mandatory checks, 91 application stages, 120 application + two built-PWA cases with zero skips/retries and owned cleanup, 351 SQL groups and 28 business API suites.
- [x] Complete actual ten-service selfhost acceptance: 36 migrations/29 suites/50 claims, retained password/MFA/private-event/scanned bytes, TLS/WebSockets/Mailpit/cleanup. Verify the exact-head preview manifest/archive hash and zero new CodeQL findings. No changed image version or hosted publication is claimed.
- [x] Preserve the local complete-ledger composition and honour the earlier ordered hold until the user's later explicit PR12-first decision; fresh exact-final-head/current-base acceptance remains required by the current delivery section above.

## Current documentation-only main reconciliation

- [x] Preserve separate remote main merge `3daf4f0` in normal ancestry without dropping PR29's ledger additions. Published executable source remains unchanged; local documentation/privacy guards pass three cases.
- [ ] Preserve incomplete exact-1dd CI as cancelled after 86 passed stages; observe separate current-3daf CI, then incorporate actually accepted later main and publish one coherent final branch update under the explicit queue.
- [x] Retain actual PR29 main `c0622a7`, both histories, current English quote/consent/retry guidance and all 36 immutable released migration bytes; application/test/dependency/operating bytes remain identical to published `1dd3c9e`. Three documentation/privacy guards pass.
- [ ] Let exact-1dd complete CI finish, preserve its actual result and integrate later genuinely accepted main before the released final publication/current-base acceptance. No competing shared-PC run or premature main merge.

## Current functional delivery after accepted PR10 main

- [x] Diagnose exact `68af64e` CI cancellation: 90 passed stages including 31 SQL scripts, 28 business API stages and 120 application browsers; the 40-minute job budget cut off PWA execution. Preserve incomplete evidence and increase only the aggregate CI budget to 50 minutes, with every individual deadline/assertion unchanged.
- [ ] Complete fresh exact-head CI through built-PWA, checked owned cleanup, native retained-data and preview gates; the cancelled partial run is not full acceptance.
- [x] Integrate actual main `1de544d872706eebc95a942a1956254ed87ae40d`, retaining all 36 published migration bytes, both histories, manual publication controls and the complete functional acceptance matrix.
- [x] Pass relevant combined source checks: 515 frontend cases/65 files and coverage/build, 109 runtime cases, three documentation/privacy cases, actionlint and whitespace checks. Preserve the strict source fingerprint and browser-inventory guards.
- [x] Retain the actual E7 full-PC and all-15-check CI results as source-specific evidence, with matching source fingerprints and checked owned cleanup.
- [x] Complete bounded owned PostgreSQL on frozen `ddb8485`: commission 14 groups and lifecycle 12 groups, each all 36 migrations; historical catalogue-preservation five groups on its exact 24-file baseline plus the one neutral-catalogue migration. Record the initial own PID-limit failure, one justified complete lifecycle rerun, unchanged source and checked cleanup separately from native Auth acceptance.
- [x] Independently inventory all 38 browser files/both projects: 120 application cases plus two PWA cases. Discovery alone is not executed acceptance; initial fixture-incomplete discovery was rejected, not counted as a pass.
- [ ] Keep PR12 Draft/no-auto-merge while the explicit merge/shared-PC queue serves PR17, then PR24 and PR25. Do not launch a competing shared full-PC run.
- [ ] Reconcile later actually merged main where necessary, prepare the signed PR update and require all 15 fresh exact-head/current-base checks before the released normal merge. Full remaining product/platform acceptance stays open; no publication dispatch is included.

## Current functional delivery after complete PC acceptance

- [x] Complete frozenE7PCrun1aacef6d with launcher/session exit0, all72stages,94application+2PWA cases without skips/retries and independently verified cleanup. Its source fingerprint exactly matchesE7's all15green CI/native/preview acceptance.
- [x] Integrate actualPR13maine88df84c locally, preserving the neutral catalogue,27thmigration, prior26immutable migration bytes, source/evidence and both allowlisted CIartifacts.
- [x] Pass relevant local checks:254frontend/52files and build;105runtime;20native/updater guards;3documentation/privacy groups;4real Chromium synthetic pointer/layout cases. None substitutes for the later source's full native/SQL/current-head CI.
- [ ] Preserve explicitPR10-first priority: PR12 stays Draft/no-auto-merge; no shared full run or competing merge untilPR10 completes. Current catalogue-preservation SQL remains honestly pending.
- [ ] Afterwards reconcile only actually merged main as necessary, complete relevant local checks and all15exact-final-head CIgates, then perform the released normal merge. No release/publication dispatch is authorised by this feature work.

## Current functional delivery after explicit-publication main

- [x] Incorporate actual PR27 maine048edb7 after its15green checks. Executable source remains byte-identical to locally checked068b603; published guidance retains manual exact-SHA publication plus all15strict gates without bypass.
- [x] Complete isolated local PostgreSQL suites:commission14groups and lifecycle12groups, each26migrations, real late-reader/claim assertions, exit0 and verified owned DB/container cleanup; private0600evidence retained. This is SQL-auth-helper acceptance, not native Auth/browser proof.
- [x] Preserve full exact05b2c0dapplication/native/preview acceptance:72stages,94browser+2PWA with zero skips/retries,258SQL/19APIs and26migration/20suite native retained-data checks. Later remote3c88334 is preserved without losing the corrected guidance.
- [ ] Run the complete PC acceptance after PR31's reserved repetition naturally cleans up, then reconcile genuinely newer actual main and complete final15current-head checks. Keep temporary Draft/no-auto-merge state until the reserved merge is released.

## Earlier functional delivery after protected-maintenance main

- [x] Integrate actual main319ab69f locally, preserving explicit-publication controls and all functional/quote-race repairs. Resolve three guidance conflicts in favour of mandatory15checks/current-base protection plus separately authorised publication.
- [x] Pass combined local source/build acceptance with254frontend cases/52files,102runtime cases,23maintenance guards and16focused publication/GitHub/documentation guards; workflow/diff checks pass. No new full PC/native pass is inferred.
- [ ] Complete the coordinated full PC slot naturally, preserve actual logs/exit/cleanup, and integrate PR27's actual main plus any required newer main before final exact-head15-check acceptance.
- [ ] Keep PR12's temporary draft state and no-auto-merge instruction until its reserved merge is released; no source/QA work waits for a larger collected branch.

## Actual Main17 integration — final PR24 current-head acceptance

PR17 has actually merged as main `4cc20874edc1f865b71106b7bb1299e16fec5aad`. Its 62 published SQL files remain byte-identical; six pending operational additions make 68 files in PR24. Application, SQL, E2E specifications, database helper, generated API inventory and package/lock bytes remain identical to the complete local `2c850fc488165e37887807a74e92414e4fa0a25e` pass. The newer executor combines accepted Main36 system/browser phase routing with Main17’s 30-minute aggregate browser budget; individual tests, assertions and retries are unchanged.

- [x] Integrate actual accepted Main17 while preserving both complete product and feature ledgers, all 62 published SQL bodies and six pending additions, original financial snapshots, four authority-race corrections and two notification-resolver ACL corrections.
- [x] Preserve remote `9bfa7f2` ancestry while excluding accidental accounting through signed revert `31d4e975d87b50835275be5e78454f0b3bc32397`. The original accounting source remains separately preserved for later delivery; no history rewrite or accounting acceptance is inferred.
- [x] Retain the source-bound full local `2c850` result: 674 frontend cases, all 68 SQL files and real APIs, 150 application browser cases in 13.3 minutes, 4 built-PWA cases in 10.4 seconds and checked cleanup. Current executor/phase checks separately pass 146 runtime cases and 3 documentation cases.
- [ ] Sign and publish the final reviewed integration, then observe every current-head full system, browser, actual native, security and package gate before the individual PR24 merge. All 15 required contexts and the browser-phase package prerequisite remain mandatory.
- [ ] Rebind the already prepared stacked PR25 to the actually accepted PR24 source and complete its own current-source checks before its separate merge. Preserve every remaining product item and accounting’s separate scope.

The `2c850` pass is not relabelled as a repeated full run of the newer executor. Ordinary `./portal test` remains complete; neither split phase alone constitutes full acceptance. The personal Carina-only PR review exception and manual-only publication controls remain unchanged. Earlier unmerged-candidate notes, queue reservations and failures below retain their historical source-bound meaning.

## Current Main36 reconciliation and history-preserving accounting correction

Actual accepted Main36 is `7fbdb956a513ca8eec3d0f2404adc213c656af1f`, with 36 published SQL files. Frozen PR17 `dd646f91ece7eb136f776597d04e67b27bf72b60` remains an unmerged candidate; our local source still contains 68 SQL files and the generated 247-public-function API inventory. This preparation reconciles Main36’s CI/runner changes with the fully tested local `2c850` candidate while keeping accounting outside PR24’s operational scope.

- [x] Complete ordinary full local acceptance on exact `2c850fc488165e37887807a74e92414e4fa0a25e`: 674 frontend cases, all 68 SQL files and real API stages, 150 application browser cases in 13.3 minutes and 4 built-PWA cases in 10.4 seconds. Owned cleanup completed and the shared slot was released.
- [x] Preserve accidental remote accounting integration `9bfa7f2` in normal ancestry and prepare signed local revert `31d4e975d87b50835275be5e78454f0b3bc32397`. Its tree is exactly the pre-accounting `bbc1ea7` tree; accounting’s original source remains available for separately scoped later delivery. The revert is not pushed, and the `2c850` pass does not cover `9bfa7f2`.
- [x] Retain every product and feature ledger, all 62 candidate-prefix SQL bodies, the six pending operational additions, four authority-race corrections, two resolver ACL corrections and historical contract tests. Preserve the personal Carina-only PR review exception and manual-only publication.
- [ ] Complete the current Main36 runner reconciliation and relevant source/phase checks. Conservative full scope is mandatory for this backend/private-resource/test-infrastructure PR; system, browser and actual native success must all gate the final package. Ordinary `./portal test` remains complete.
- [ ] After PR17 actually merges, bind the prepared source to its accepted main tree and the corrected remote history, preserve all released SQL bytes, and observe all 15 successful final exact-head checks and signed history before the individual PR24 merge.

Earlier source-specific passes, queue notes and remaining product checkboxes below are preserved as history. They neither accept the accidental accounting composition nor substitute for final current-main CI. No deployment, publication or real-message delivery is authorised by this correction.

## Historical preparation states retained during Main36 reconciliation

Earlier source from the preceding local candidate recorded these states. They remain historical; the current Main36 reconciliation above controls delivery.

> - [ ] Publish final signed source, verify exact remote bytes, pass actual SQL-worker plus full application/native/security/package CI and measure the new SQL duration.
>
> - [ ] Perform the expressly authorised protected PR34 merge only when every final-current-head check passes; observe main acceptance separately without dispatching a release.

Earlier source from the incoming pre-candidate preparation recorded these states. They remain historical; the current Main36 reconciliation above controls delivery.

> The latest direct request is to make PR24 and then PR25 mergeable and merge them individually. A subsequently relayed direct instruction reserves PR17 first, so actual main/QA ordering is **PR17 → PR24 → PR25**. This coordinates actual merge collisions; it is not a blanket development or source freeze. Accepted PR10/main `1de544d` and all36released SQL blobs remain intact. The six unreleased operational files now follow that accepted prefix (42total); after PR17 actually merges, compare its real migration prefix and recreate only still-unreleased versions if required.
>
> - [x] Reconcile accepted main PR10 with the first-four operational source, retaining both full product/extension ledgers and the current personal-only review/manual-publication rules.
>
> - [x] Recreate the six pending migration filenames through the installed CLI with unchanged SQL bodies and dependency order; retain all36published blobs exactly.
>
> - [x] Generate the actual183public-RPC reference from42SQL files. Root's current source checks pass546frontend cases/71files, unchanged coverage floors, types/lint/format/compiler checks; focused SQL evidence remains separately scoped.
>
> - [ ] Complete the real current-base integration after actual PR17, including renewed prefix checks and relevant source/functional checks.
>
> - [ ] Obtain all15successful exact-head application/native/security/package checks and signed history before individually merging PR24, then repeat the scoped process for PR25. Historical acceptance does not replace these gates.
>
> - [ ] Preserve every outstanding item across all seven requested additions; do not infer full product, native retention, installation or production acceptance from this preparation.
>
> The earlier PR10/PR27 priority notes below describe their recorded source checkpoints. Their merges are now accepted; they are not current blockers or instructions to restore a previous shared freeze.

## Accepted Main34 CI integration with the still-unmerged PR17 candidate

Actual accepted main is now `c5281002c2ea1102abe91a71d497ceeea87341f4` (PR34). This local merge applies its 13 CI, documentation and testing-file changes to signed PR24 candidate `d96ea21`; Main34 changes no application or SQL source. Frozen PR17 source `dd646f91ece7eb136f776597d04e67b27bf72b60` remains an unmerged candidate. The inventory stays at 68 SQL files, including the 36 published main migrations and the complete unchanged 62-file candidate prefix. Current PR24 additions retain the two pending notification-resolver ACL corrections and the test-only historical contract ceilings.

- [x] Preserve both complete product and feature ledgers, historical failures and successes, the four operational modules, current governance and manual-only publication controls while reconciling the accepted CI documentation.
- [x] Record the pre-Main34 candidate `d96ea21` checks: 674 frontend cases, 110 runtime cases and the final 10 relevant SQL suites pass. The generated API reference remains owned by its actual 68-file replay; it is not overwritten by this documentation merge.
- [x] Retain conservative source-derived docs/standard/full CI selection. Unknown or sensitive paths and uncertain Git context select full, as does every main/manual invocation; required jobs independently reject invalid scope. All 15 required contexts and the outer 60-minute full-profile verify budget remain intact.
- [ ] Bind the candidate to the actual accepted PR17 main tree after its real merge, preserving every published SQL byte and rechecking the remaining version order.
- [ ] Complete current combined local/browser/native acceptance after PR35 cleanup and the legitimate PR24 QA reservation. Observe all 15 successful exact-head checks and signed history before the individual PR24 merge, then repeat for PR25.

This PR changes backend, private-resource and test infrastructure, so its final acceptance requires the full profile. Faster evidence for a documentation-only or standard PR is not substituted. The PR17 owner’s separately prepared 30-minute browser-only aggregate budget remains candidate work; the outer full-profile budget stays 60 minutes. Neither a timeout adjustment nor earlier scoped passes establish combined browser/native acceptance. Earlier sections below retain their named historical states, including the now-completed PR34 delivery tasks.

## Local PR17 and PR24 candidate integration — accepted main still pending

The coordinator explicitly authorised local candidate integration while the actual delivery order remains **PR17 → PR24 → PR25**. This preparation combines PR24 checkpoint `d4e2954` with frozen PR17 source `dd646f91ece7eb136f776597d04e67b27bf72b60`. Accepted main remains `c0622a7`. The local inventory is 68 SQL files: the 62 byte-identical PR17 candidate sources, including 36 already released main migrations, followed by six CLI-reversioned PR24 bodies. This source preparation does not claim PR17 is merged or that the combined candidate has passed its complete final acceptance.

- [x] Preserve both complete feature and product ledgers, the four operational modules and four observed authority-race corrections, current actor-specific pricing, original accepted snapshots, customer-neutral guidance, the personal Carina-only PR review exception and manual-only publication controls.
- [x] Reconcile the candidate architecture, schema, user workflows and migration guide while retaining the actual failed and successful source-bound history from both branches.
- [x] Pass candidate-only source checks: 674 frontend cases in 89 files, coverage S66.68/B62.10/F56.90/L68.82%, unchanged thresholds, TypeScript and ESLint. These results do not replace the complete local/native checks.
- [ ] Generate the public API inventory from the actual 68-file replay; complete the combined SQL, cross-RPC directed/marketplace, authority, resource-isolation and current-source functional checks.
- [ ] Complete the permitted full local acceptance after actual Main17 binding and PR35 cleanup, when the shared QA slot reaches PR24. Separate PR17 evidence records 643 frontend cases, 142 application browser cases and 4 built-PWA cases; its native CI remains pending, and those outcomes do not certify this combination.
- [ ] After PR17 actually merges, bind this preparation to the accepted main tree and verify the released migration prefix and remaining version order. Complete all 15 exact-head required application/native/security/package checks and signed history before individually merging PR24, then repeat the scoped process for PR25.

Earlier sections below preserve the tasks and pending states at their named checkpoints. Their former source-freeze or accepted-main prerequisites do not prohibit this expressly authorised local candidate preparation. Remaining product, installation, physical-device, external delivery and production work stays in scope as recorded.

## Current PR17 delivery — explicitly next after PR10

- [x] Preserve original PR17 ancestry and integrate actual accepted main `1de544d`, manual-only publication, neutral catalogue, the current strict fifteen gates and PR10 archive correction.
- [x] Preserve all 36 published SQL bodies and reconcile the 23 unpublished extension versions after them; actual 59-source replay inventories 224 public functions.
- [x] Complete independent frontend, SQL authorization/concurrency/commercial and course-resource reviews; correct demonstrated substitution-consent and post-lock waitlist authority defects without dropping requested features.
- [x] Verify the full reviewed substitution snapshot invalidates previous consent on changed offers; preserve identical-refresh/language state. Four real waitlist lock-barrier cases and the vulnerable-source negative control also establish the additive 60th correction.
- [ ] Complete current-source local checks and complete Auth/API/desktop/mobile/built-PWA/retained-data/native acceptance; record failures and stages not reached honestly.
- [ ] Push the signed integrated PR17 head, observe all fifteen required current-head checks, resolve review threads and merge with the tested tree.

Current final source contains62 migrations:36 unchanged published main files and26 additive extension/correction sources. Independently reproduced waitlist metadata disclosure and real safeupdate Push-configuration refusal are also corrected; eight privacy/authority and six actual safeupdate SQL groups pass. Full acceptance remains the unchecked gate above. Local command04 passed62-source SQL/43 APIs/retention but failed11 of142 application browser cases across six flows (131 passed,19.0min); no timeout or full pass is claimed. The filled-offer waitlist fallback, mobile navigation lifetime and keyboard-scrollable finance table defects are corrected with original-source negative regressions; final source/build check passes643/83. Named-form/search/committed-save/immutable-receipt and separate browser-project known/unknown-cost fixtures retain their assertions. Final focused reproduction passes18/18 desktop/mobile cases with actual62-migration restart retention and checked cleanup; this is targeted-only evidence. The unchanged complete local/current-head/native gates remain required, with final acceptance and merge recorded on PR17. The application job outer budget alone rises40→60min after the recorded40m CI timeout; all per-test/stage deadlines, zero retries and fifteen gates remain.

Carina clarified that PR17 is next; unrelated PRs and historical reservations below are not prerequisites. No deployment, real email, server timer activation or physical-device acceptance is implied. The full smart-operations request and remaining master-product ledger below remain required.

## Smart operations extension — current user request

**Current delivery priority:** PR10 alone owns the next main merge/shared PC QA slot. Keep PR17 draft with no auto-merge or merge watcher. Own58-source code and focused evidence are committed; full current-main acceptance is pending. After PR10, integrate actual main e88df84 or newer (including local publication controls/customer-neutral catalogue and the final canonical core), reconcile only undelivered own migration versions with byte-identical SQL, and repeat complete local/native/current-head CI before advancing PR17. The server's automatic mail/Push workers remain uninstalled.

The entire new request is preserved in [SMART_OPERATIONS_SPEC](SMART_OPERATIONS_SPEC.md): alerts/email/push, personal dashboard, quality management, search, timesheets, client/participant workflows, Control Center, replacements/waitlists, favourites/saved filters, calendar feeds, qualifications, forecasts, history, tasks and offline schedule. No pending feature is removed from the original module ledger below.

Current isolated branch: `codex/smart-notifications-and-dashboard`, integrating accepted main `0a6002a`/PR21 after `fabd71a`/PR18 in an independent worktree. All26 accepted migration sources are byte-identical. Full local development/functional testing is the default; no deployment/release workflow is invoked by preparing this feature PR. Independent PR27 owns those workflow switches. Other feature PRs retain their own delivery and integration evidence.

- [x] Implement transactional email outbox, per-account email opt-in/quiet hours and service-only finite Hostinger SMTP worker; disabled server templates, no credential in deliverables.
- [x] Implement private persisted dashboard card order/visibility, own Teaching Day and own assignment preparation checklist, with server ownership/version checks.
- [x] Implement fresh permission-checked personal ICS downloads, bounded periods/size, explicit private-event inclusion and UTC/zone preservation.
- [x] Implement explicit self-opt-in staff email/phone contact visibility, current staff-only projection and versioned DE/EN controls; focused SQL/component checks pass.
- [x] Complete local integrated acceptance on signed d7d3c58: 219 component tests, 272 SQL cases/groups, 23 actual business API suites, 80 desktop/mobile cases and two built-PWA cases; exit 0 after cleanup. [Evidence](QA_RESULTS.md).
- [ ] Observe separate current PR application/native retained-image CI and review status; no production acceptance is inferred from local success.
- [ ] Activate reviewed SMTP/timer on the authorised target with privately supplied credentials, live authorised-recipient/provider proof and monitoring. Source completion does not mean live mail was sent.
- [x] Implement source and focused checks for Push, waitlists/atomic substitutions, shared learning/customer workspaces, attendance/Q&A/notebook/feedback/quiz/PDF completion, timesheets/statements/forecasts/Control Center, tasks/templates/favourites/recommendations, revocable calendars/offline schedules and stable eleven-area search. These are source checkpoints, not combined acceptance.
- [x] Complete customer teaching-hour/document briefs and immutable revision history; exact reviewed rollout controller and standalone worker distribution; integrate accepted private roles and reviewed discovery/saved-view/evidence source. Focused checks pass; installed/combined acceptance remains separate.
- [x] Bind discovery and substitution to the recipient/current actor's captured-role quote; retain explicit monetary/terms consent, nullable private prices, role/policy-bound cursors and honest unknown forecast costs. Recheck withdrawal authority after concurrent role edits and return current assignment status on accepted retries.
- [x] Connect Teaching Day to the current course, deliberately shared same-organisation customer contact, exact allowed materials/reports and shared preparation counts, preserving own private checklist and current confirmed-session authority.
- [ ] Freeze and run the entire expanded source, actual Auth/API/desktop/mobile/PWA and native ten-service retained-data suites. Resolve every genuine failure; generate current API/architecture and honest acceptance records.
- [ ] Publish signed PR17 after complete local feature acceptance, observe all15 current required exact-head checks and resolve actual merge collisions through central coordination. Verify the eventual merge/main readback; do not infer it from a push or green local tests.
- [ ] Follow the user's explicit release preference before any CMS deployment or private SMTP/Push timer activation. Retain per-account/per-device consent. Physical mobile/desktop Push delivery requires a supported consenting device and remains a separate untested acceptance step.
- [x] Actual self-addressed Hostinger465 TLS SMTP acceptance and IMAP993 receipt; that exact test's SPF/DKIM/DMARC pass. Automatic application timers are not yet installed.

## All-open-PR merge continuation

The latest direct instruction authorises all current PR integrations and protected merges after successful current required checks. Earlier merge reservations below are historical. PR24 now incorporates accepted main `7fbdb95`, preserving both CI-routing and operational histories, all36released SQL files and six pending additions unchanged. Relevant integration checks and fresh exact-head required CI remain the next gate; no deployment is requested.

## Current user-directed operational delivery preparation

The current delivery order is **PR17 → PR24 → PR25**: make each PR mergeable and merge it separately after its current required checks pass. Accepted main `c0622a763127081a7b5be092ce2782253991c6a5` includes PR29’s English private-pricing and discovery documentation. This local preparation integrates those six documentation updates while retaining PR24’s four operational modules, four observed authority-race corrections, 36 unchanged released SQL files and six pending additions (42 SQL files in total). Independent source work continues while the actual merge and shared acceptance slots follow that order.

- [x] Reconcile accepted PR10 and PR29 documentation with the operational source, retaining the complete product and extension ledgers, customer-neutral guidance, personal Carina-only PR review exception and manual-only publication controls.
- [x] Create the six pending migration versions through the installed CLI in dependency order; preserve all 36 released bodies exactly. Generate the current 183-public-RPC inventory from the actual 42-file replay.
- [x] Correct and test the four real post-wait authority failures through current public account and business RPCs, retaining the original claims, receipts and financial snapshots.
- [x] Observe all 15 required checks passing on signed PR24 head `2a15df12a287c8882d675417c90637142fe7866d`, including the complete application and native retained-data gates in [run 43842679588](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43842679588). That source-bound result remains recorded separately from this documentation merge and the future accepted PR17 integration.
- [ ] Integrate PR17 only after its actual main merge. Compare the real accepted migration prefix, recreate only still-unreleased versions if necessary, and complete the relevant current-source functional checks.
- [ ] Obtain all 15 successful exact-head checks and signed history on that final current-base PR24 integration, then merge PR24 normally and repeat the scoped process for PR25.
- [ ] Preserve every outstanding item across all seven requested additions. Full product completion, installation and production acceptance remain separate from the recorded PR24 checks.

The earlier PR10, PR27 and PR29 preparation notes below record their named historical checkpoints. Those PRs are now accepted; their former holds and pending checkboxes do not restore an earlier source freeze or supersede the current order.

## Seven additional operational modules — current user request

The exact additional [implementation prompt](OPERATIONS_EXTENSION_PROMPT.txt) is preserved alongside the original authoritative specification. All seven additions remain required. [Ownership/PR audit](EXTENSION_COORDINATION.md), [actual status and next actions](OPERATIONS_EXTENSION_STATUS.md).

- [x] Inspect/fetch current main, all11open PRs/commits/checks, live rules, security findings and authorised development-release automation; isolate new work from the original dirty checkout.
- [x] Implement initial course-readiness, delivery, future whole-block replacement and support source with server-side authority, DE/EN UI and focused SQL/source tests. Their full acceptance remains open.
- [ ] Deliver the separately implemented enquiry/document, accounting and consented-amendment sources. Current focused evidence is recorded in their worktrees; actual Auth/scanner/browser acceptance and final current-main reconciliation remain required.
- [ ] Complete started/partially completed/invoiced replacement workflow and optional waitlist/ordered notices.
- [ ] Complete exact-source canonical acceptance. Local e34a5bf passes SQL/Auth/API/scanner and 95/96 browsers; transport failure makes the whole run FAIL and build/PWA were not reached. Own feature screenshots were inspected; the isolated public-help desktop/mobile follow-up passes2/2.
- [ ] Push the corrected signed PR24/PR25 sources and prepare focused accounting/amendment PRs. Verify all current required checks. Coordinate the current actual PR17 → PR24 → PR25 sequence and legitimate shared QA ownership while continuing independent feature preparation.
- [ ] Verify any separately authorised installation from actual state. Local development/tests are now the default; the separate workflow owner controls publication switches. No production/public Website/DNS/real-mail/purchase action is implied.

Initial SQL evidence: readiness16, delivery12, replacement13, support12groups. Whole-source257tests and unchanged coverage floors pass; TypeScript/ESLint pass. The canonical complete command returned exit1 before startup because another checkout holds shared QA ownership; this is not a full integration pass.

## All-open-PR merge continuation — smart operations

- [x] Integrate accepted main `7fbdb956`, preserving phase separation and PR17-only font/mail/browser aggregate requirements plus both ledgers.
- [ ] Verify the integrated source and every required current-head CI gate, then let the single coordinator complete the authorised protected merge.

## Current PR17 integration with accepted PR34 CI policy

- [x] Preserve PR17's complete source-bound acceptance/failure evidence and the incoming faster-PR CI history while retaining the entire remaining product ledger.
- [x] Verify the actual PR17 backend/private-resource/delivery diff selects full application/native acceptance; preserve all15 gates/manual publication. Correct missing raw-worker diagnostic operator and narrowly scoped PDF font read capability; real operator/safeupdate/diagnostic and font negative/positive probes pass.
- [ ] Complete current-head workflow, native retained-data, security and preview-package checks, retaining the30-minute aggregate browser command and60-minute outer verification budget without changing individual tests, retries or assertions.
- [ ] Merge the exact verified PR17 head after all fifteen required contexts succeed. No publication, external provider activation or production operation follows from source integration alone.

The complete local application pass on `dd646f9` and the failed136-of142 CI browser-budget run remain distinct evidence below; neither is relabelled a current mixed-source CI/native result.

## Full PR acceptance critical path — further authorised continuation

- [x] Measure two-worker SQL5m07s, complete native/retained-data success, and historical full browser13.9m versus13s Chromium setup; preserve canonical SQL lint/advisor and native-engine checks.
- [x] Route sensitive PR system and browser acceptance onto separate owned runners; preserve main/manual/local complete acceptance and all existing required context names.
- [x] Pass56focused phase/bootstrap/snapshot/safety/worker/scope/preview/policy cases and38actual shell boundary/routing cases; validate launcher normalization, complete stage partition, fresh service/persistence/seed setup and failure/cancellation cleanup. Scoped lint/format/compiler connectivity/actionlint pass; actual Docker/complete child-process evidence remains pending CI.
- [ ] Publish signed exact source, observe every final-head system/browser/native/security/package gate, measure actual wall time, and complete the user-authorised protected merge.

The complete product scope and earlier actual-source evidence below remain in force.

## Safe development-speed improvements — explicit continuation

- [x] Observe signed608687f/PR34 Portal43855915270 success in11m36s (approximately59%less than28m),351actual SQL groups and every required context; fix missing metadata labels and observe green43856170205.
- [x] Implement two separate pinned networkless SQL workers with exhaustive partition, unchanged real races/durability, bounded cancellation/cleanup and actual per-suite timing reports; disable JIT only in the disposable PR fixture.
- [x] Add conservative actual-merge docs/standard/full selection, full sensitive/unknown/main/manual acceptance, early independent jobs and required-gate preflights that fail on scope errors or fast non-PR profiles.
- [x] Preserve source/rules/dependencies/migrations, all15required statuses, coverage/security/release requirements; make preview evidence profile explicit and reject missing CLI profile.
- [x] Pass26focused local scope/worker/routing/preview/governance cases and scoped lint/format/actionlint; record local subprocess/Docker limitations and independent read-only review.
- [x] Publish signed8f29147 and verify13exact remote blobs; Portal43860971674 passes complete SQL/native/application/security/package gates in32m35s, including SQL5m07s,114desktop/mobile and2built-PWA cases.
- [x] Observe the user-performed protected PR34 merge after every final-head check passed: signedmain c528100. Main acceptance is a separate run; no release was dispatched.

This continuation preserves the complete remaining product scope and prior source-bound evidence below.

## Faster PR CI — 16 November 2026

- [x] Measure actual successful baseline: approximately28minutes, mostly21-minute application plus6-minute serial native rehearsal.
- [x] Keep quality/coverage/security/metadata contexts; add bounded runtime/Edge/audit and one pinned isolated PostgreSQL suite on every PR, without repeated frontend quality/unit/build commands.
- [x] Preserve all15required context names, preview success prerequisites, immutable SQL/dependencies and exact-main manual release gates; run unchanged complete application/native main/manual suites in parallel.
- [x] Document PR SQL/Auth-stub limitations and package evidence scope; pass six runner orchestration, three routing/release-policy and four maintenance/governance checks, scoped lint/format and actionlint.
- [ ] Publish the prepared branch changes after repository write access or browser file upload is available; connector403 and shell DNS restrictions currently block publication. No extension permission was changed.
- [ ] Observe exact-head GitHub runtime/Edge/PostgreSQL/image startup and security/coverage/package results, measure actual optimized duration and merge only after every current required check succeeds.
- [ ] Observe a complete main/manual application/native run before claiming that parallel full acceptance passed; no publication is requested.

All remaining product and operational scope below is preserved. Local Docker and subprocess execution are restricted; mocked routing passes do not replace the pending native evidence.

## English quote/discovery documentation — released PR10 continuation

- [x] Integrate accepted main `1de544d` and preserve all 36 released SQL sources, neutral naming, operator guidance and complete actual-main histories.
- [x] Replace obsolete unpaged/future wording with actual shipped actor quotes, monetary filtering/order, cursor context, exact consent and current SQL/query/DTO/UI ownership in the role, discovery and migration guides.
- [x] Pass fresh `./portal check` (515 frontend cases/65 files, unchanged coverage floors and build), 102 runtime cases, 20 focused documentation/privacy/catalogue/metadata cases and technical-guide formatting; deliver the signed bounded update through [PR #29](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/29).
- [ ] Complete all 15 exact-current-head required checks and the assigned actual merge. Preserve queue-controlled Draft; no additional routine user approval is required.

The earlier 3ed9a24 all-green checkpoint applies only to its e88 base. All remaining product and operational scope in the ledger below remains required.

## Current PR17 delivery — explicitly next after PR10

- [x] Preserve original PR17 ancestry and integrate actual accepted main `1de544d`, manual-only publication, neutral catalogue, the current strict fifteen gates and PR10 archive correction.
- [x] Preserve all 36 published SQL bodies and reconcile the 23 unpublished extension versions after them; actual 59-source replay inventories 224 public functions.
- [x] Complete independent frontend, SQL authorization/concurrency/commercial and course-resource reviews; correct demonstrated substitution-consent and post-lock waitlist authority defects without dropping requested features.
- [x] Verify the full reviewed substitution snapshot invalidates previous consent on changed offers; preserve identical-refresh/language state. Four real waitlist lock-barrier cases and the vulnerable-source negative control also establish the additive 60th correction.
- [x] Complete full local command05 on signed `dd646f9`:643/83 source cases,62 SQL/migration stages,43 APIs+Edge, real Auth/MFA/Storage retention,142 app browser and4 PWA cases, checked cleanup. Application/SQL/API/browser-spec bytes remain identical in the subsequent executor-only correction.
- [ ] Complete fresh exact-head CI including native retained-data/package acceptance. Prior CI43858966704 passed136 browser cases before its20-minute aggregate deadline; only that complete-command budget rises to30 minutes, with all individual tests and all other stage deadlines preserved.
- [ ] Push the signed integrated PR17 head, observe all fifteen required current-head checks, resolve review threads and merge with the tested tree.

Current final source contains62 migrations:36 unchanged published main files and26 additive extension/correction sources. Independently reproduced waitlist metadata disclosure and real safeupdate Push-configuration refusal are also corrected; eight privacy/authority and six actual safeupdate SQL groups pass. Full acceptance remains the unchecked gate above. Local command04 passed62-source SQL/43 APIs/retention but failed11 of142 application browser cases across six flows (131 passed,19.0min); no timeout or full pass is claimed. The filled-offer waitlist fallback, mobile navigation lifetime and keyboard-scrollable finance table defects are corrected with original-source negative regressions; final source/build check passes643/83. Named-form/search/committed-save/immutable-receipt and separate browser-project known/unknown-cost fixtures retain their assertions. Final focused reproduction passes18/18 desktop/mobile cases with actual62-migration restart retention and checked cleanup; this is targeted-only evidence. The unchanged complete local/current-head/native gates remain required, with final acceptance and merge recorded on PR17. The application job outer budget alone rises40→60min after the recorded40m CI timeout; all individual test deadlines, zero retries and fifteen gates remain. The separately measured browser-command aggregate now has30 minutes; all other stages keep20 minutes.

Carina clarified that PR17 is next; unrelated PRs and historical reservations below are not prerequisites. No deployment, real email, server timer activation or physical-device acceptance is implied. The full smart-operations request and remaining master-product ledger below remain required.

## PR10 current accepted Main13 checkpoint

- [x] Preserve c808 archive-race regression/fix while resolving actual main e88 conflicts and retaining customer-neutral/personal-only/manual-publication contracts.
- [x] Preserve all27released SQL blobs; CLI-reversion nine pending bodies without changing bytes, in dependency order after the released prefix (36total).
- [x] Pass actual local source/build command515frontend,102runtime,3documentation/privacy cases; replay36in owned SQLfixture, generate160publicRPCs and pass6role-discovery groups, with checked fixture cleanup.
- [ ] Run the specifically authorised targeted real file-browser acceptance once the actual shared kernel QA lock is free; do not claim a repeated complete PC run.
- [ ] Integrate the next actually accepted Main31, recheck released prefix/order, then observe all15final exact-head checks before normal PR10 merge. No speculative feature bundle or weaker gate is permitted.

## PR10 current archive-race correction

- [x] Record exact0b615a7CI43823638639 as failed111/112application browsers; do not substitute older complete passes.
- [x] Reproduce the pre-commit initial-filter response restoring an archived row, then explicitly cancel old documents reads before the post-ACK refresh.
- [x] Preserve exact-resource ACL checks, independent newer drafts and exactly-one-mutation assertions; pass51focused component cases and515frontend cases through actual `./portal check`.
- [x] Synchronise the native browser fixture with the applied filter and exact server archive acknowledgement; keep final zero-filename assertion and all original timeouts.
- [ ] Observe fresh complete current-head application/native/security/package CI, then merge PR10 normally on its exclusive accepted-main position.

## PR10 final accepted-base merge gate

- [x] Complete local isolated acceptance on eee73e4:514frontend,30additional SQL suites,28business APIs plus invitation,112application+2built-PWA browsers, restart retention and checked cleanup; PASS/exit0.
- [x] Observe all15exact eee73e4 GitHub checks in43818183207, including actual native35migrations/29API suites/retained data and PRpreview package.
- [x] Integrate actual accepted PR27/main e048edb without unrelated feature sources; preserve manual publication, both ledgers and stable documentation anchors.
- [x] Run actual `./portal check` and100runtime cases on that final control integration; application/SQL/dependency/browser source remains byte-identical to eee73e4. No extra shared-PC full run is claimed.
- [ ] Observe all15required checks on the final signed pushed integration/current base, then perform the explicitly authorised regular PR10 merge. Earlier passes do not replace this final gate.

## PR10 sequential merge continuation

- [x] Preserve original PR10 and M7/English integration ancestry; reconcile actual accepted main319ab69 and its PR-based maintenance boundary without changing live settings.
- [x] Independently reproduce the prepared mobile course-tab overflow, retain the scoped wrapping correction and pass both real Chromium layouts; retain file-menu access/refresh regressions.
- [x] Pass 514 frontend cases with unchanged coverage floors, 92 runtime cases, 23 maintenance cases, types/lint/format/compiler checks and released26-migration byte preservation.
- [ ] Integrate PR27's actual accepted publication-control ancestry once its exclusive prior merge completes; no broad feature bundle is required.
- [ ] Complete isolated local application and final exact-head application/native/security/package checks, then merge PR10 as directly authorised. Historical native and source-level passes are not substituted for the final combined revision.

## Final PR13 delivery gates

- [x] Integrate actual accepted main `e048edb` and preserve current PR23 `7767564` ancestry, all27migration sources, English/private-role guidance and both ledgers.
- [x] Run `./portal check` (254frontend cases),98runtime cases,12native candidate cases, documentation/privacy/metadata, formatting, source-export and actionlint checks.
- [x] Attempt canonical full local acceptance; record the existing global QA lock refusal before service startup and preserve every foreign process/port.
- [ ] Publish the signed final existing-PR branch update; all15exact-head current-base GitHub gates must pass before the directly authorised normal merge.

## Final PR13 integration of accepted PR27/main

PR27 passed all15mandatory checks on `485ac16`, including full application, actual selfhost retained-data and preview-package gates, and merged as actual main `e048edb` at07:21:44UTC. This PR13 continuation incorporates that actual accepted main without bundling an unmerged branch. It preserves `./portal check`, complete local acceptance, explicit exact-SHA CMS publication and manual-only PR deployment metadata, together with the corrected pre-captured quote versions in the concurrent lifecycle fixture. No publication workflow is dispatched.

The complete PR13 source retains the English documentation, customer-neutral PR23 `7767564` product/migration27, all26released SQL bytes, current personal PR-only review snapshot and the unified12-case native port allocator correction. Both complete ledgers and every original branch head remain in normal ancestry. The next gates are final current-source local checks, one signed normal PR13 branch update, all15fresh exact-head GitHub checks and the directly authorised merge. Earlier checkpoints and externally changed rule modes below remain historical.

## Latest PR23 port-correction ancestry

PR23 advanced to `7767564` with an independently developed correction for the same duplicate-port failure. This normal merge preserves that actual head, both prior PR23 heads and the earlier reviewed port correction. The selector and complementary recycling, real-socket and cleanup regressions are reconciled into one implementation; all ownership/isolation/unique-port gates remain. Current evidence and the final combined PR13 checks govern acceptance. Older records below describe their exact named source checkpoints and do not establish the current live policy, source tree or complete final native pass.

## Current PR13 continuation — latest personal policy and native fixture

The verified06:42UTC correction restores active review27329000 with only User29256704 (`CarinaSchoppe`) in `pull_request` mode and its original independent-review conditions. There are no extra scanning/quality/Copilot rules in that layer. History/checks remain active, without bypass and with all15mandatory statuses/signatures. All older always/disabled/role-based records below are timestamped history; no server rule is written here.

Both current PR13 `eb001c4` and PR23 `8047b94` heads are preserved in the normal ancestry. The native candidate port selector now reserves all3loopback listeners together before releasing them; a deterministic recycling regression, failure-cleanup cases and real TCP group rebind pass (11candidate+3documentation cases). The incoming isolation/ownership/unique3guards remain. An independent read-only review finds no actionable defect; actual Docker handoff/native preservation still requires final CI. PR27's current-base acceptance and actual main merge remain the preceding release dependency; no unaccepted PR27 bundle is published in this branch.

## PR13 preservation of actual merged PR22/main

The remote PR13 branch was updated through GitHub to `eb001c4`, incorporating actual accepted main `319ab69`/PR22. This continuation retains that exact ancestry and the signed PR23 product composition, without force pushing. The maintenance publisher, no-retry-main behavior, workflow and CLI regressions are preserved. Current personal review-policy snapshot and its later external enforcement drift remain documented above older dated governance records. PR27 still owns the separately tested local-first/manual-publication controls and concurrent lifecycle-fixture correction; its updated current-base acceptance precedes final PR13 delivery.

Historical06:30UTC checkpoint: review enforcement was disabled externally while history/checks remained active. At that point source preserved the06:25UTC snapshot. The later06:42UTC readback supersedes both: active review, only CarinaSchoppe User29256704 in `pull_request` mode and no extra scanning/quality/Copilot rules in that layer. Source and present-tense guidance now follow that corrected configuration. No server rule is modified by this task.

## Final PR13 composition and acceptance boundary

- [x] Preserve actual remote PR13 `af3bd61` and its PR23 `d448fab` ancestry alongside the reviewed English/current-personal-policy candidate `84fc41c`.
- [x] Retain the customer-neutral catalogue and additive migration27, course UI/pointer fixes, both evidence ledgers and all26previously released migration bytes.
- [ ] Integrate actual accepted PR27/main publication controls and corrected concurrent lifecycle fixture; verify current source and publish one signed final PR13 head without force-pushing.
- [ ] Observe all15mandatory exact-head checks on the complete composition, then perform the directly authorised PR13 merge. Earlier documentation-only/local passes do not certify this product source.

## Independent maintenance delivery after source-freeze release

- [x] Honour the latest instruction to finish PR22 separately; preserve other source branches and the proposed group worktree. Earlier group/freeze entries below are historical.
- [x] Remove the obsolete no-change retry-main helper/CLI/workflow path and publisher Actions-write token scope; unchanged scans skip privileged publication, while tested changed candidates retain native PR/review/CI protection.
- [x] Pass31local maintenance/candidate tests, including real CLI failure/no-network acceptance, plus lint/type/workflow/diff checks; re-read live15-check/no-App-bypass and main-only signing-environment configuration.
- [ ] Sign/push the scoped final correction, pass all15exact-current-head checks, complete coordinated normal PR merge and verify the real App diagnostic creates/labels/closes its owned draft and removes its branch while main stays unchanged. No release/deployment is authorised by this diagnostic.

## Current continuation — App PR-only maintenance and audited execution

This latest user instruction removes the maintenance App exception as well. It supersedes the earlier human-only verification and historical ALWAYS guidance. All remaining product modules below remain in scope.

- [x] Remove App5776881 from live review/check bypass lists and read back all3active policies; checks/history have no exceptions, only human maintain/admin retain PR-only review exceptions.
- [x] Replace direct daily main promotion with exact signed dependency-only branch/PR publication and native required-review/CI auto-merge; never mutate the main ref or substitute pre-merge dispatch for PR CI.
- [x] Verify deterministic retries/lost responses, changed signatures/parents/blobs/PR identity, stale candidate and existing reviewed-PR preservation, plus the real CLI command path with network-free fictional fixtures.
- [x] Wire protected main-only selected-repository short-lived App tokens and the missing official age prerequisites for full candidate tests; update current guides and rule snapshots.
- [x] Run lint/type/source-connection/coverage/build/workflow checks and49Node+13Python offline guards;226unit/component cases pass with existing floors. No frontend runtime module or export is statically unconnected.
- [x] Complete independent final review; correct the invalid GraphQL interface selection and remove unsupported hold-label behavior. All20maintenance groups pass, including a concurrent classification-change rejection.
- [x] Deliver signed [PR22](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/22); its durable GitHub record owns final exact-head full/security/native CI and merge acceptance. All15checks must pass before merging; an open PR is not a passed full run.
- [x] Obtain explicit action-time confirmation and grant the existing App only additional pull_requests:write; UI confirms one selected repository and REST confirms the installed permissions, with no rule bypass.
- [x] Observe all14required checks passing on exact PR22 checkpoint8c50852, including84browser/2PWA and the24migration/19suite native retained-data run. Main advanced afterward, so this is not a current-base merge permit.
- [x] Honour the authorised PR15 merge hold and integrate its actual merged43504b8main once. Both conflicts preserve current PR-only behavior plus incoming English comments,35labels and MFA fixtures;32focused guards and independent review pass.
- [x] Extend the existing manual diagnostic with real draft-PR creation/labels/closure and owned-ref cleanup;23maintenance groups plus11metadata/1documentation pass. Unknown or externally changed resources are preserved; no diagnostic merge is attempted.
- [x] Honour the subsequently authorised PR18 merge hold and integrate actualfabd71amain without conflicts, retaining its private pricing/welcome26migrations and QA fixtures. Fresh249frontend/75targeted Node cases pass.
- [ ] Observe all15checks on the final combined PR22 head; the intentionally cancelled8176724interim run and prior8c50852checks do not satisfy this acceptance.
- [x] Add PR18's actual successful PR preview package job as the15thmandatory Actions check, with strict up-to-date enforcement and no bypasses; synchronize current guides.
- [ ] Verify actual short-lived App token/signature/PR CI after the source reaches protected main. The configured environment key/ID and installed scopes alone are not execution proof.

No App review exemption is restored: automated PRs need normal independent approval/latest-push approval and resolved conversations as well as all15required checks. An outdated open maintenance PR must be explicitly resolved before regeneration; no reviewed content is overwritten. The unmerged direct-ref auto-merger in PR19 is not part of this implementation.

## Earlier human-only verification — superseded on 16 November 2026

- [x] Verify active live history/review/check rules: humans require a PR, maintain/admin can skip independent review, all14 checks remain mandatory even for CarinaSchoppe, and the PR must be up to date.
- [x] Preserve the existing separate maintenance App exception; record its exact scope without claiming a working token/promotion path.
- [x] Synchronize the three rule JSON snapshots with authenticated live readback in isolated codex/main-protection-verification-20261116; make no application or repository-setting mutation where the requested setting is already active.
- [ ] Replace standard-token direct daily main promotion with a verified protected PR path. Current strict rules reject direct promotion safely; do not disable protection to restore it.

This current instruction supersedes historical ALWAYS/disabled guidance below. The full product ledger remains required. Admins retain settings-edit authority, but ordinary merges and pushes must satisfy the active rules.

Updated: 16 November 2026 (Australia/Brisbane). On continuation read [WORKLOG](WORKLOG.md), then the verbatim [master specification](UNIVERSAL_MASTER_PROMPT.txt), source and actual test evidence. The full target remains required. A working development slice is not production approval.

## Current functional delivery — accepted source and necessary current-main integration

- [x] Accept signed0950506 in all15required checks:72stages,94application+2PWA cases without skips/retries,258SQLgroups including legacy,19API suites and actual26-migration/20-suite native retention/TLS/cleanup. [Source-specific proof](QA_RESULTS.md).
- [x] Preserve prepared PR27 publication controls and integrate actual PR21 main0a6002a5 locally; resolve both documentation histories without implementation conflicts. Local source/build acceptance passes254frontend cases/52files and all102runtime checks; migration/dependency bytes remain unchanged.
- [x] Integrate owner30075c9's necessary lifecycle-fixture race correction: actual quotes captured before all50claims, exact winner/session assertions retained and deterministic late-reader coverage added. Local syntax/lint/format checks pass; do not label this a new full SQL pass.
- [x] Correct the separate commission fixture with10pre-reviewed authorised quotes before10parallel claims, exact1winner/9filled/revenue/allocation assertions and a deterministic late-reader case. Local syntax/lint/format passes; complete SQL acceptance remains pending.
- [ ] Use the next assigned local QA slot after the readiness checkout releases it naturally; the earlier refused command is not a local pass. Discovery94/28files is not executed acceptance.
- [ ] Incorporate actual PR27 main after its reserved publication-control merge, then push one necessary signed current-source integration and pass all15current-head gates before merging PR12. No publication dispatch or larger PR22/26 collection belongs to this work.

## Earlier functional acceptance preparation — publication control first

- [x] Keep published0950506 and its full CI unchanged while preparing necessary PR27ec29bc5 locally; preserve its original head and every functional/privacy/evidence assertion.
- [x] Pass actual combined local `./portal check` with249frontend cases/52files and build, all100runtime cases with zero skips, actionlint and diff checks. No backend/QA service was started.
- [ ] Observe actual0950506 full application/native/PWA outcome, without inventing a pass or pushing cosmetic changes during that run.
- [ ] Incorporate PR27's actual main after its reserved first merge; its explicit exact-SHA publication guard must be present before PR12 merges.
- [ ] Push one necessary signed integration, pass all15current exact-head required gates and merge the completed functional PR according to the direct user instruction. No release/preview-publication dispatch belongs to this task.

Other proposed PR21/22/26 group work remains separate from this frozen functional scope. The complete outstanding product/platform requirements below remain required.

## Smart operations extension — current user request

**Current delivery priority:** PR10 alone owns the next main merge/shared PC QA slot. Keep PR17 draft with no auto-merge or merge watcher. Own58-source code and focused evidence are committed; full current-main acceptance is pending. After PR10, integrate actual main e88df84 or newer (including local publication controls/customer-neutral catalogue and the final canonical core), reconcile only undelivered own migration versions with byte-identical SQL, and repeat complete local/native/current-head CI before advancing PR17. The server's automatic mail/Push workers remain uninstalled.

The entire new request is preserved in [SMART_OPERATIONS_SPEC](SMART_OPERATIONS_SPEC.md): alerts/email/push, personal dashboard, quality management, search, timesheets, client/participant workflows, Control Center, replacements/waitlists, favourites/saved filters, calendar feeds, qualifications, forecasts, history, tasks and offline schedule. No pending feature is removed from the original module ledger below.

Current isolated branch: `codex/smart-notifications-and-dashboard`, integrating accepted main `0a6002a`/PR21 after `fabd71a`/PR18 in an independent worktree. All26 accepted migration sources are byte-identical. Full local development/functional testing is the default; no deployment/release workflow is invoked by preparing this feature PR. Independent PR27 owns those workflow switches. Other feature PRs retain their own delivery and integration evidence.

- [x] Implement transactional email outbox, per-account email opt-in/quiet hours and service-only finite Hostinger SMTP worker; disabled server templates, no credential in deliverables.
- [x] Implement private persisted dashboard card order/visibility, own Teaching Day and own assignment preparation checklist, with server ownership/version checks.
- [x] Implement fresh permission-checked personal ICS downloads, bounded periods/size, explicit private-event inclusion and UTC/zone preservation.
- [x] Implement explicit self-opt-in staff email/phone contact visibility, current staff-only projection and versioned DE/EN controls; focused SQL/component checks pass.
- [x] Complete local integrated acceptance on signed d7d3c58: 219 component tests, 272 SQL cases/groups, 23 actual business API suites, 80 desktop/mobile cases and two built-PWA cases; exit 0 after cleanup. [Evidence](QA_RESULTS.md).
- [ ] Observe separate current PR application/native retained-image CI and review status; no production acceptance is inferred from local success.
- [ ] Activate reviewed SMTP/timer on the authorised target with privately supplied credentials, live authorised-recipient/provider proof and monitoring. Source completion does not mean live mail was sent.
- [x] Implement source and focused checks for Push, waitlists/atomic substitutions, shared learning/customer workspaces, attendance/Q&A/notebook/feedback/quiz/PDF completion, timesheets/statements/forecasts/Control Center, tasks/templates/favourites/recommendations, revocable calendars/offline schedules and stable eleven-area search. These are source checkpoints, not combined acceptance.
- [x] Complete customer teaching-hour/document briefs and immutable revision history; exact reviewed rollout controller and standalone worker distribution; integrate accepted private roles and reviewed discovery/saved-view/evidence source. Focused checks pass; installed/combined acceptance remains separate.
- [x] Bind discovery and substitution to the recipient/current actor's captured-role quote; retain explicit monetary/terms consent, nullable private prices, role/policy-bound cursors and honest unknown forecast costs. Recheck withdrawal authority after concurrent role edits and return current assignment status on accepted retries.
- [x] Connect Teaching Day to the current course, deliberately shared same-organisation customer contact, exact allowed materials/reports and shared preparation counts, preserving own private checklist and current confirmed-session authority.
- [ ] Freeze and run the entire expanded source, actual Auth/API/desktop/mobile/PWA and native ten-service retained-data suites. Resolve every genuine failure; generate current API/architecture and honest acceptance records.
- [ ] Publish signed PR17 after complete local feature acceptance, observe all15 current required exact-head checks and resolve actual merge collisions through central coordination. Verify the eventual merge/main readback; do not infer it from a push or green local tests.
- [ ] Follow the user's explicit release preference before any CMS deployment or private SMTP/Push timer activation. Retain per-account/per-device consent. Physical mobile/desktop Push delivery requires a supported consenting device and remains a separate untested acceptance step.
- [x] Actual self-addressed Hostinger465 TLS SMTP acceptance and IMAP993 receipt; that exact test's SPF/DKIM/DMARC pass. Automatic application timers are not yet installed.

## Current joint PR10/PR13 integration with released PR18

- [x] Preserve both original PR10/PR13 histories, the English roadmap/decision/index structure and the reviewed Calendar, file-menu and PWA-title corrections from the incoming source.
- [x] Resolve documentation conflicts with accepted main `fabd71a`, retaining the private policy, subordinate authority, own welcome progress and PR-preview boundaries alongside the complete M7/M8 ledger.
- [x] Inventory 35 SQL files: the 26 byte-identical released files, eight byte-identical M7/M8 sources renamed after that prefix and one additive role-aware discovery migration.
- [x] Replay35migrations in the owned networkless SQL fixture, pass6role-aware and9discovery groups, and regenerate the actual160-function API reference. Native upgrade/retention remains a separate pending gate.
- [x] Pass current514frontend/92runtime checks, stronger coverage floors, compiler graph and30SQLsuites/321groups on the owned integration; preserve current15-check policy.
- [ ] Complete the combined isolated Auth/API/desktop/mobile/PWA and native retained-data acceptance after the shared QA slot is available. Earlier source-specific passes below do not certify this integration.
- [ ] Publish the signed combined head and observe all 15 current required checks, including `PR preview package`, before the coordinated merge. Review exceptions never bypass CI or signatures.

## Earlier PR13 policy checkpoint — superseded by the latest dated readback

The latest explicit user decision is authoritative: only `CarinaSchoppe` (GitHub User29256704) receives the sole personal review-ruleset exception. The latest readback sets `bypass_mode: always` only on that review ruleset and includes CodeQL, code-quality and Copilot-review rules. All15CI checks and verified signatures remain mandatory; history/check bypass lists are empty. Source snapshots mirror the designated owner's confirmed live update. Older role-based, unrestricted or disabled-rule entries below are dated development history, not instructions to restore those configurations. PR27 has the next main merge, followed by this independent PR13 conflict resolution; feature work does not wait for a large aggregate branch.

## Native candidate port-selection correction

- [x] Reproduce legal immediate ephemeral-port reuse deterministically; preserve simultaneous three-port uniqueness and loopback ownership boundaries.
- [x] Hold all three reservation listeners until selection completes, and release partial groups on bind failure; retain the existing uniqueness assertion without retries or timeout changes.
- [x] Pass11candidate cases, including real TCP group/rebind cleanup and rejection of an isolated old-algorithm mutant, plus targeted lint/format/whitespace checks.
- [ ] Repeat required complete native retained-data CI on the integrated signed source before the authorised PR merges; local socket fixtures do not establish complete native acceptance.

## PR13/PR23 requested conflict correction

- [x] Resolve PR13 against actual main0a6002a, preserving both full product/evidence ledgers and accepted roles/welcome/help/metadata work.
- [x] Reconcile current rule snapshots and contributor guides to15mandatory checks, no history/check/App bypass and Maintain/Admin PR-only review exceptions; preserve released SQL and application/workflow/dependency source. The older14-check/App-exception snapshots below are historical.
- [x] Pass22focused documentation/metadata/integrity guards, targeted lint, formatting and diff checks.
- [x] Integrate signed PR23 d448fab directly, preserving neutral content, its additive migration and both original PR heads in the final normal-merge ancestry.
- [ ] Observe all15required checks on final PR13 source/current base, then merge directly under Carina's latest explicit instruction. The former coordination hold is superseded by that instruction.

## PR13 current-base acceptance

- [x] Preserve prior exact-head acceptance as historical evidence; resolve the eight current conflicts and integrate accepted main through `0a6002a` without application or released-migration changes.
- [x] Reconcile the 36-label catalogue, 15 mandatory live checks, current private pricing/roles/welcome guidance and both documentation histories.
- [x] Pass fresh local254frontend/88runtime/13documentation-metadata cases, unchanged coverage thresholds, type/lint/format/source-integrity/build/actionlint checks. Application,26SQL migrations and operating code match accepted main.
- [ ] Publish the signed conflict resolution and pass every current required check on the final head before the authorised merge. PR27 has the next actual main merge; preserve its publication controls and required shared-fixture correction when integrating that base.
- [x] Confirm prior exact-head quality, security, full application/native and corrected metadata success.
- [x] Integrate current main e75f55d after PR16; retain both documentation histories and the complete guided-demo implementation.
- [ ] Observe fresh exact-source quality/security/application/native and metadata checks; merge PR13 only when every required gate passes, as explicitly authorised by the user. The live PR is the final acceptance record.

The current required-check policy has 15 contexts. Older 14-check readbacks below remain historical evidence; use current server rules and exact-head results. Production, hosted installation and other operational approvals remain separate.

> Historical PR21 acceptance notes follow. PR18 and PR21 have since merged; they do not impose a current merge hold. The active joint integration is recorded above.

- [x] Translate the remaining general guides, forms, security policy and 30 label descriptions into English, preserving bilingual application behaviour, authored content and the verbatim specification.
- [x] Add a [documentation index](README.md), discoverable [roadmap](../ROADMAP.md), changelog (historical changelog removed) and [decision notes](decisions/README.md); correct stale M6-pending prose using recorded accepted evidence.
- [x] Add a [documentation index](README.md), discoverable [roadmap](../ROADMAP.md), changelog and [decision notes](decisions/README.md); correct stale M6-pending prose using recorded accepted evidence.
- [x] Read back all three active rules after concurrent02:33UTC activation; synchronize source JSON without changing live settings. Maintain/Admin review exceptions are PR-only; all 14 strict current-base checks apply without human bypass. Preserve separate maintenance-App promotion/source-delivery work. This current snapshot supersedes earlier dormant-rule/governance descriptions below.
- [x] Read back all eleven existing PRs, including active #10; every PR already has one type, one risk and at least one area label. Preserve classifications and the nine original labels.
- [x] Extend delivered documentation verification to roadmap/change notes and local heading fragments so translated navigation is checked.
- [x] Record actual local checks, safe full-command refusal, verified English-label readback and signed publication on [PR #13](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/13). All six quality gates and the four Security jobs passed on first head `8e14e9e`; the latest complete application/native acceptance is recorded by the PR's exact-source checks, not inferred from this checkbox. No bug-free certification, new product module, hosted/production change or real mail is implied by this increment.

The full product and operational ledger remains below; open PR #10 and concurrent source are not silently included in this documentation acceptance.

## PR23 current native gate correction

- [x] Retain exact d448fab application-verify success and the actual native setup failure (two unique ports where three were required); no native SQL/API proof or preview completion is inferred.
- [x] Hold three temporary loopback listeners together and release all on success/failure; preserve the original assertion and all acceptance gates. Ten native unit cases pass, including real bind-failure cleanup and successful rebinding.
- [x] Preserve parallel main319ab69/PR22 and all26published SQL bytes, both verification ledgers and current Draft/no-auto-merge queue. No global-QA reservation is bypassed.
- Fresh exact-head full CI/native/preview acceptance and subsequent sequential merge remain recorded on [PR23](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/23); PR27 owns the next actual merge.

## PR23 current-main conflict resolution

- [x] Integrate accepted main `0a6002a` / PR21, preserving both ledger histories, all guided-experience fixes and all26published main migration bytes.
- [x] Pass254frontend cases with unchanged coverage floors,28catalogue/privacy/documentation/metadata/integrity guards, affected UI checks, TypeScript/ESLint/source formatting and the export graph.
- [ ] Observe complete exact-head PR23 application/native/security CI and merge under the current explicit user instruction; no full acceptance or hosted installation is inferred from local focused checks.

## PR23 mobile acceptance continuation

- [x] Record exact failed82/84mobile/browser acceptance; preserve actual successful SQL/API/persistence evidence and stages not reached.
- [x] Reproduce the exact CI435px layout/412px visual viewport failure with the actual React UI and broad system font, including a failing ordinary click without screenshots.
- [x] Add strict pointer hit-target readiness/geometry and a native covered-control/scroll/capture regression; both desktop/mobile fixture cases pass without changing business assertions, retries or timeouts.
- [x] Integrate current mainfabd71a comments, private role pricing/welcome and previews, preserving26published SQL sources, customer-neutral wording and MIGRATION_GUIDE.
- [x] Correct the nonwrapping German course tabs with scoped wrapping; four real-source-CSS pointer/layout regressions pass, and overflow checks use document clientWidth.
- [x] Complete exacta793da4/fabd71a acceptance:249frontend,263SQL,92browser,2PWA; native27migration upgrade/retention/20API suites; all quality/security/preview gates. Six fresh screenshots inspected and OCR checked.
- [x] Retain newly merged main0a6002a guided-help/compiler fixes; this new combined source needs its own acceptance.
- [x] Current-main focused local254frontend/89runtime/type/lint/format/compiler checks pass. Local complete3250296d passes90/92browsers and all4course/source cases; two initial-login module loads fail with recorded ERR_NETWORK_CHANGED. Keep this failed run distinct from the accepted prior CI.
- [x] Diagnose coincident host container-interface churn without changing assertions;20fresh actual-React login renders pass in a separate backend-free diagnostic. Respect the explicit PC-QA reservation for any complete rerun.
- Current exact-source full application/native/security acceptance, feature screenshots and the user-authorised merge are owned by [PR23](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/23). A partial screenshot artifact or source submission does not mark that acceptance complete.

## Current correction — customer-independent catalogue and authorised Git delivery

- [x] Neutral public docs, UI, tool/data names and source-linked catalogue; original migration bytes/UUIDs/source hashes and edited/used templates retained.
- [x] Focused original-checkout validation and removal of eight branded screenshots are recorded in WORKLOG.
- [x] Isolate the change from independently open roles/pricing work onto current main; preserve all unrelated source and the full product ledger below.
- [x] Submit signed [PR23](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/23) with main-compatible preservation checks, required complete application/security/native gates and a six-screenshot fictional artifact. Actual CI completion, visual evidence and the user-authorised merge are recorded on that PR; submission alone is not acceptance.

Customer organisations remain privately configured and reusable templates support multiple explicit organisation scopes. Publication of this source does not assert hosted migration installation or production acceptance.

## Current direction — local PC testing and explicit publication

- Final integration follows actual main319ab69 through verified remote mergef24eae9. Prior head30075c9 passed all15required checks (88browser/2PWA plus real26-migration/20-suite native retention); current f24local checks pass254frontend/95runtime/23maintenance cases. Correct the three retained governance contradictions once, preserving manual publication controls, then use PR27's fresh exact-head checks and actual merge record. Other feature development remains independent.
- [x] Add `./portal check` for fast local source/coverage/build feedback, retaining complete isolated `./portal test` and latest-main `./portal github test`.
- [x] Keep automatic quality/security/application/native gates; make CMS publication an explicit exact-SHA manual choice and PR deployment metadata manual-only.
- [x] Notify the 16 other active project Codex chats and preserve the local-first rule in `AGENTS.md` and operator/contribution guides.
- [x] Run the actual fast local command (249 frontend tests before integration;254on current-main integration and build pass), all95integrated offline runtime tests and workflow validation. Cancel the old automatic main publication run and temporarily disable the old metadata publisher, with real server readback.
- Signed [PR27](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/27) owns the exact required CI and coordinated user-authorised merge record. After its actual merge, re-enable the manual-only metadata workflow and verify main's publication guard. The first run was cancelled after PR21 advanced main; current-main integration preserves both feature histories.
- [x] Reproduce the existing50-way lifecycle fixture's disappearing-offer consent lookup from the actual failed run, capture real actor quotes before racing and add a deterministic late-reader case; all12real PostgreSQL groups pass in a fresh disposable local container. Fresh signed-head CI remains the merge gate.

The VPS polling timer and normal/hosted data are unchanged. This direction supersedes historical automatic release/publication descriptions below; it does not remove any product, security or release acceptance requirements.

## Current functional/integration completion audit

Current delivery instruction: signed commit→push→prepared PR→direct merge after current full CI. Actual PR15 main43504b8 and subsequently accepted PR18 mainfabd71a (merged05:09:15UTC) are incorporated on the owned PR12 branch. All incoming roles/private pricing/welcome/preview functions and our functional assertions are preserved; migration/dependency bytes match accepted PR18. Local92runtime/249frontend cases and type/lint/format/actionlint/unchanged coverage floors pass. The published be1run failed89/90browser cases at a desktop navigation-readiness race; signedf010721 corrects it with a genuine desktop/mobile Chromium diagnostic. Push the final combined source and require fresh exact-head application/native/security acceptance, then merge PR12 without another approval question. Production remains separate.

**Latest accepted functional application source before the roles extension:** signed f7453a6, CI43799280625, all68stages,90application+2PWA browser cases with zero skips/retries,234SQL/all18APIs and actual native retained-data compatibility passed. This is historical proof for that exact source; final acceptance of the combined26-migration roles extension is pending. [Actual counts and limits](QA_RESULTS.md).

Current user priority: verify real connected user functions and repair missing behavior/test coverage, not rely on unit percentages. Isolated branch `codex/full-functional-integration-tests` starts at1341b16; concurrent shared-checkout onboarding/role/preview work is preserved and requires separate acceptance.

- [x] Read complete specification, current owning source/migrations and actual domain discovery. Map existing A–N slices to [functional acceptance suites](FUNCTIONAL_ACCEPTANCE.md), preserving the complete remaining product ledger.
- [x] Add real calendar lifecycle/DST/private/global browser workflows and six-source search/privacy/language/navigation checks.
- [x] Extend existing knowledge/chat/commercial/commission HTTP suites for missing connected operations, state transitions, current MFA/qualification/contract checks and retry/privacy boundaries.
- [x] Implement discovered-versus-executed browser enforcement, zero skipped/flaky/retried cases, separate application/PWA reports and source-bound stage evidence. Actual exit-zero-skipped/focused-suite negative probe passes.
- [x] Complete fresh frozen `./portal test` on signed b93b400:run3346a7e6,actual exit0,68passed stages,234SQL/all18APIs/78application+2PWA,zero skipped/retried browser cases and owned cleanup. [Actual results](QA_RESULTS.md).
- [x] Push signed reviewable source as draft PR12, preserving concurrent independent product changes.
- [x] Accept the corrected board in exact-source full CI/native verification on signed1e72507:all68 stages,234SQL/all18APIs/78application+2PWA,zero skips/retries;actual retained password/MFA/roles/private event/scanned bytes/TLS/WebSockets/50claims/cleanup passed. Local run04 safely refused a competing checkout's QA lock; no local pass is invented. First77/78 CI failure remains historical. [Exact results](QA_RESULTS.md).
- [x] Preserve per-project failure evidence without miscounting a passed sibling browser;7 focused guards include genuine Playwright skip/focus/single-project-failure probes. Application/migrations/journeys remain unchanged after accepted1e72507; final PR checks are independently inspectable. No production/hosted deployment belongs to this request.
- [ ] Correct the independent be1ef25 desktop search-navigation readiness race (89/90cases passed; no skip/retry), then accept the final roles-integrated source in complete application/native/security CI before direct merge.

## Coordinated PR18 integration

The owner-approved PR18 head0675bb9 is integrated on the owned PR21 branch, preserving all audit fixes and both guidance systems. Local combined checks pass254frontend/87runtime cases with no disconnected modules/exports; migration bytes and dependencies match the owner source. The explicit PR18 main-merge hold is respected. Include the actual resulting main merge before the final push, then require all current-head quality/security/application/native and PR-preview-package gates before immediate merge.

## Standing delivery workflow

Carina requires signed commit → push → prepared PR → direct merge after required CI succeeds, without another routine approval. AGENTS.md records this rule; explicit merge holds remain respected. PR21 already includes exact PR15 head2e367f6 on its own branch to preserve comments and the audited fixes. Local integration passes231frontend/68runtime cases with identical production JS; exact-head combined/native/security CI and PR15 coordination completion govern its immediate merge.

## Guided experience re-audit

- [x] Independently trace all PR16 modules, routes, handlers, runtime exports and meaningful control-flow/state behavior; preserve legitimate non-frontend entries.
- [x] Reproduce/fix actual tour-access recovery, same-topic Help focus and demo accepted-offer identity errors; remove confirmed inert copy/metadata/branches/markers.
- [x] Correct erased-type false positives in the runtime-use guard with adverse fixtures and runtime-class inheritance preservation.
- [x] Execute current local source/coverage/public-browser/guard/build checks and document actual evidence in [GUIDED_EXPERIENCE_AUDIT](GUIDED_EXPERIENCE_AUDIT.md).

Exact combined/native/security, extended real-account browser acceptance and the user-authorised merge are tracked on [PR21](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/21). Application head13313de passed all combined/native/security gates. Current main metadata changes are integrated with unchanged application source and21passingtargetedguards. Further main merges are temporarily held by user-authorised coordination until PR15 completes. The prior merged PR16 baseline remains preserved; these focused fixes do not mark unrelated product modules complete.

## PR18 complete-CI repair

- [x] Correct the missing disposable compensation bootstrap after real retention, with explicit owned QA identity and three executable orchestration regressions.
- [x] Cover candidate-only settings after the older native-selfhost baseline upgrades and passes retention/readiness; preserve no-policy normal startup.
- [x] Integrate current main e75f55d, retaining account welcome, Portal tour and public help/demo.
- [x] Observe actual application/quality/security success on21959fa:249unit/component tests,88desktop/mobile cases,2built-PWA cases, real retention/SQL/API and checked cleanup.
- [x] Reproduce native replay refusal for the pending Welcome migration, add its atomic envelope without changing released history, and pass the actual24→26local selfhost retention/API/TLS/cleanup rehearsal against the prepared incoming main source.
- [x] Integrate actual PR20/PR15 main43504b8 without losing private-pricing behavior, source comments or MFA fixture guards; normalized source review and native rehearsal passed.
- [ ] Complete exact final-head GitHub application/native-selfhost/preview-package CI and record the observed result. No production action is part of this CI repair; do not bypass coordinated main merge holds.

## Current continuation — private roles/pricing, welcome guide and PR previews

The latest request supersedes the earlier shared compensation default. Work is isolated on `codex/pr-preview-welcome-roles` from `1341b16`; existing accepted business history and the full module ledger below remain in scope. Actual business percentages are private Administration configuration because the source repository is public.

- [x] Implement and separately test subordinate role delegation, guest access and self/equal/higher protection across role/activation/invitation APIs; company budget memberships remain Administration-only.
- [x] Implement private versioned compensation configuration, captured offer policies, role-scoped quotes and server-bound consent; retain accepted claims/invoices and legacy history.
- [x] Add administration setup and accurate per-offer preview, permission-scoped role controls and own quote rendering; 215 frontend tests and the existing coverage floors pass before full acceptance.
- [x] Add a DE/EN sequential welcome guide with own persistent progress, pause/resume/skip/restart and permission-aware links; focused frontend/SQL checks pass.
- [x] Add read-only gated local PR packages and a separate trusted GitHub Deployment metadata publisher, with real artifact URLs, stale-run/expiry cleanup and no production-host connection.
- [ ] Finish exact-source combined native Auth/API/desktop/mobile/PWA/retained-data acceptance; fix any actual failures without weakening assertions.
- [ ] Publish the signed PR and observe exact-head quality/security/application/native outcomes and real downloadable artifact; record a first-PR metadata bootstrap only if actually run.
- [ ] A continuously hosted URL per PR requires separately configured isolated hosting/backend. The implemented artifact deployment does not claim such a service.
- [ ] Production policy setup/migration/deployment is a separate operational step; this request does not authorise production or real email changes.

[Roles and private pricing](DELEGATED_ROLES_PRICING.md), [welcome guide](WELCOME_GUIDE.md), [PR previews](PR_PREVIEWS.md). The verbatim original specification remains preserved; these explicit user extensions update its operating details without dropping any remaining modules.

## Comprehensive code comments and agent guide

Requested directly on `main`: explain the maintained code throughout and provide a project-specific `AGENTS.md`, using OpenXLR's guide as a structural reference. Work uses a dedicated review worktree so the original checkout's concurrent feature changes remain separate. The independent English community commit `3256d1a` is preserved; contributor guidance remains English and source commentary uses English.

- [x] Annotate the original170frontend and104launcher/script/browser-test files, maintained Edge/operating code and root build/CI/configuration entry points with purposes, contracts and important flow/security/resource explanations. Preserve and annotate the incoming PR16 guided-demo/help main additions:183frontend and109launcher/script/browser-test files in total, including the two private fixture sources. Combined226frontend/63runtime/10publicbrowser cases pass locally; exact protected PR acceptance remains required.
- [x] Expand `AGENTS.md` with the actual ownership map, reading order, business/security invariants, commands, collaboration/Git rules, comprehensive English-comment policy and operational boundaries; add a canonical `.github/copilot-instructions.md` entry point.
- [x] Explain all 24 released migrations in [MIGRATION_GUIDE](MIGRATION_GUIDE.md); preserve their exact bytes, vendor provenance, JSON/lockfiles, generated data and assets.
- [x] Compare executable syntax/literals, CSS rules and parsed/active configuration against current main at pure-comment checkpoint1055101; run frontend coverage, type/lint/build, runtime, Edge and offline operating checks.
- [x] Harden only the existing private MFA test-state IO after the protected CodeQL gate re-flags it; ten real filesystem regression groups and all62combined runtime tests pass. Fresh exact-head full CI remains the acceptance source for this bounded harness exception.

The full product ledger below remains unchanged. The protected PR additionally requires hardening the existing private MFA test-state file reader/writer after CodeQL re-flags its old race warning in the touched fixture. That bounded harness change receives real ownership/symlink/atomic-write regressions; application business behavior stays unchanged. Exact-head CodeQL and full application/selfhost CI remain acceptance gates, with no advance production/hosted claim.

Historical PR15 request, now reconciled on the separate combined-source rehearsal: explain the maintained code throughout and provide a project-specific `AGENTS.md`, using OpenXLR's guide as a structural reference. Work uses a dedicated review worktree so the original checkout's concurrent feature changes remain separate. The independent English community commit `3256d1a` is preserved; contributor guidance remains English and source commentary uses English.

Current reconciliation preserves all32 released migration bytes and94 product behavior:212 frontend/Edge syntax trees and26CSS structures match, with purpose/contract comments adapted to current M7/M8 implementations. Exact final acceptance follows the actual main15 merge and the complete combined-source gates.

## Historical PR CI repair

Requested PRs6/7/8/9/14/11 are already merged. Their final application checks and later metadata failures are distinguished in [the audit](PR_CI_REPAIR_20261116.md);14 is a cancelled temporary-base fixture, not a failed product merge.

- [x] Reconcile the35managed labels with current GitHub usage; preserve existing names, colours, descriptions and assignments.
- [x] Use current trusted main for the ordinary read-only metadata check, skip automatic closed-PR events and add a main-only manual historical check; retain strict categories, canonical identity and stale-head rejection.
- [x] Pass12focused Node regressions plus workflow/format/link checks and real read-only label validation for all six PRs.
- [ ] Publish the signed fix, observe exact-head CI, merge under the user's explicit instruction and execute all six historical checks through the merged main workflow.

No new application migration, production deployment or reduction of the remaining product scope belongs to this repair.

- [x] Reconcile the35managed labels with current GitHub usage; preserve existing names, colours, descriptions and assignments.
- [x] Use current trusted main for the ordinary read-only metadata check, skip automatic closed-PR events and add a main-only manual historical check; retain strict categories, canonical identity and stale-head rejection.
- [x] Pass12focused Node regressions plus workflow/format/link checks and real read-only label validation for all six PRs.
- [x] Signed PR20 head6e593f5 passed all14 required checks and merged asd4c1f49; all six explicit current-main historical metadata rechecks passed. These validate present labels, not a replacement for historical application runs.

## Current combined acceptance after Demo/Help integration

- [x] Preserve all32 migrations, M7/M8 resource/privacy boundaries, the complete master-specification ledger and accepted incoming Demo/Help/Tour source from PR16/main `e75f55d`.
- [x] Record exact `9c42730` CI43794921492 as **failed**:316 SQL cases,26 actual business API suites and real restart persistence passed;92/94 browser journeys passed and both global-calendar DE→EN journeys failed. Earlier29-migration failures remain historical evidence in WORKLOG.
- [x] Reproduce the dialog-loss regression and correct only semantic calendar range handling in `bf09f19`;12 Calendar cases, TypeScript, lint and formatting pass. Equal-range language signals preserve the same detail; real navigation still clears it and introduces no duplicate range queries.
- [x] Resolve the App/Shell/Demo integration while preserving actor-bound private state, current inbox/quiet preferences, announcement banners, all M7/M8 routes and the extracted Preferences component; TypeScript, focused lint/format and 78 tests across nine affected files passed.
- [x] Preserve incoming PR13 English documentation, roadmap/changelog/decision notes and the 36-label catalogue without replacing M7/M8 APIs, ACLs, the complete remaining ledger or failed-run history.
- [x] Record current functional preflight: 372 tests across 57 files; coverage S57.65/B52.32/F49.11/L59.46%, all configured floors passed. The corrected source has no complete native acceptance yet; its final combined SHA is not asserted here.
- [x] Measure the current compiler inventory: 135 reachable modules, 34 routes, 286 runtime exports and zero connectivity/export/link/asset errors; collect 106 authored business browser cases plus two built-PWA cases without collection errors. Discovery does not mark those journeys passed.
- [ ] Complete integration checks and a fresh full isolated run of the combined M7/M8/Demo/Help source, then observe both exact application and retained-data CI gates. Do not reuse individual branch or pre-merge counts as combined acceptance.
- [ ] After the tested product merge, execute the actual main-only maintenance-App workflow proof. Preserve the independently strengthened14 required checks, mandatory signatures and review-only Maintain/Admin PR exception; do not restore an older nine-check policy. Review-hold decisions for separate PR13/19 remain separate from this product gate.

## PR13 documentation-branch acceptance history

- [x] Confirm prior exact-head quality, security, full application/native and corrected metadata success.
- [x] Integrate current main e75f55d after PR16; retain both documentation histories and the complete guided-demo implementation.
- [ ] Observe fresh exact-source quality/security/application/native and metadata checks; merge PR13 only when every required gate passes, as explicitly authorised by the user. The live PR is the final acceptance record.

## English documentation and repository verification continuation

The user requests English general documentation, detailed contribution/issue/PR instructions, an explicit roadmap and useful notes, current/historical labels, protected main and continued direct merge authority. Work is isolated on `codex/english-documentation-governance` from accepted main `1341b16`; concurrent role/welcome-tour changes in the original checkout are preserved.

- [x] Translate the remaining general guides, forms, security policy and 30 label descriptions into English, preserving bilingual application behaviour, authored content and the verbatim specification.
- [x] Add a [documentation index](README.md), discoverable [roadmap](../ROADMAP.md), changelog (historical changelog removed) and [decision notes](decisions/README.md); correct stale M6-pending prose using recorded accepted evidence.
- [x] Add a [documentation index](README.md), discoverable [roadmap](../ROADMAP.md), changelog and [decision notes](decisions/README.md); correct stale M6-pending prose using recorded accepted evidence.
- [x] Read back all three active rules after concurrent02:33UTC activation; synchronize source JSON without changing live settings. Maintain/Admin review exceptions are PR-only; all 14 strict current-base checks apply without human bypass. Preserve separate maintenance-App promotion/source-delivery work. This current snapshot supersedes earlier dormant-rule/governance descriptions below.
- [x] Read back all eleven existing PRs, including active #10; every PR already has one type, one risk and at least one area label. Preserve classifications and the nine original labels.
- [x] Extend delivered documentation verification to roadmap/change notes and local heading fragments so translated navigation is checked.
- [x] Record actual local checks, safe full-command refusal, verified English-label readback and signed publication on [PR #13](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/13). All six quality gates and the four Security jobs passed on first head `8e14e9e`; the latest complete application/native acceptance is recorded by the PR's exact-source checks, not inferred from this checkbox. No bug-free certification, new product module, hosted/production change or real mail is implied by this increment.

The full product and operational ledger remains below. Those PR13 checks concern its documentation branch and do not certify the M7/M8 integration, which is tracked separately above.

- [x] Reconcile the35managed labels with current GitHub usage; preserve existing names, colours, descriptions and assignments.
- [x] Use current trusted main for the ordinary read-only metadata check, skip automatic closed-PR events and add a main-only manual historical check; retain strict categories, canonical identity and stale-head rejection.
- [x] Pass12focused Node regressions plus workflow/format/link checks and real read-only label validation for all six PRs.
- [x] Signed PR20 head6e593f5 passed all14 required checks and merged asd4c1f49; all six explicit current-main historical metadata rechecks passed. These validate present labels, not a replacement for historical application runs.

## Guided exploration and practical help

User requested a complete bilingual guided experience, safe fictional test system, practical problem explanations and a tested PR/merge. Work is isolated on `codex/guided-demo-help`; unrelated original roles/preview/welcome-checklist changes remain outside this PR.

- [x] Public fictional demo for all25current portal modules, guided route sequence and meaningful in-memory exercises; explicit simulation labels, reset/reload erasure, DE/EN and shared themes.
- [x] Authenticated permission-aware Portal tour with explicit navigation, pause/resume/restart and per-account session progress; unchanged server permissions, MFA and online confirmation.
- [x] Public searchable bilingual help with practical workflows, module deep links, general recovery and entry points from login/tour/errors.
- [x] Source checks, production build, actual public desktop/mobile acceptance, initial whole-source coverage above unchanged gates and precise usage/security documentation. See WORKLOG for executed counts and remaining exact-source checks.
- Integration and the user-authorised merge are tracked on [PR16](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/16). Its exact-head full application/native retained-data/security checks and merge state are the acceptance record. No production deployment is implied.

[Guided demo and help](GUIDED_DEMO_AND_HELP.md) complements the full target below. These educational simulations do not mark any unimplemented business module complete and do not replace the independent account welcome checklist.

- [x] Public fictional demo for all25current portal modules, guided route sequence and meaningful in-memory exercises; explicit simulation labels, reset/reload erasure, DE/EN and shared themes.
- [x] Authenticated permission-aware Portal tour with explicit navigation, pause/resume/restart and per-account session progress; unchanged server permissions, MFA and online confirmation.
- [x] Public searchable bilingual help with practical workflows, module deep links, general recovery and entry points from login/tour/errors.
- [x] Source checks, production build, actual public desktop/mobile acceptance, initial whole-source coverage above unchanged gates and precise usage/security documentation. See WORKLOG for executed counts and remaining exact-source checks.
- Accepted [PR16](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/16) is included through incoming main `e75f55d`. Its independent evidence is retained; the current combined32-migration source still requires fresh complete application/native retained-data/security acceptance. No production deployment is implied.

## English community information

> Historical accepted-main checkpoint. Its counts and former rules describe that source snapshot; current merge eligibility is the 15-check policy stated above.

The current language request covers public security/contribution documentation, GitHub issue/PR forms and guidance, managed label descriptions and PR metadata feedback. Isolated branch `codex/english-community-guides` preserves concurrent application work and the full product ledger below.

- [x] Translate community entry points and their setup/developer/CI/security guidance into English; preserve commands, actual permission/release boundaries and the authoritative specification.
- [x] Keep issue form IDs, default labels, required fields and PR label identifiers stable; translate human-visible text and section links.
- [x] Translate and read back all30managed label descriptions without changing IDs/names/colours/assignments; preserve9default labels.
- [x] Translate metadata-validation feedback and adapt its two message assertions; all8existing behavior tests pass.
- [x] Complete integrated formatting, file/link and translated-anchor validation, plus all8metadata behavior tests. Deliver the English surface through the signed repository commit; live publication is verified separately.

New contribution discussions use English. Product UI remains German/English, existing authored content retains its language, and all outstanding product/production requirements remain in the ledger.

## GitHub quality, coverage and maintainer merge continuation

> Historical accepted-main checkpoint. Its counts and former rules describe that source snapshot; current merge eligibility is the 15-check policy stated above.

Current request: visible compilation/type/style/quality/security/coverage tasks, Dependabot and uninterrupted direct Maintainer merges. Work is isolated on `codex/github-quality-checks` from current accepted main9c2103b; no business migration, normal preview, VPS or production mutation belongs to this slice.

- [x] Preserve existing full application/native-selfhost/release and daily maintenance paths; add explicit quality/coverage gates and reports with no private credentials.
- [x] Measure all executable frontend source honestly, including untested modules;197unit/component cases pass,48.89%lines with baseline-preserving global and stronger critical-file gates.
- [x] Coordinate exact Vitest/coverage peers in daily discovery; actual plan regression includes simultaneous changes despite unrelated upstream failures.
- [x] Enable/read back free Dependabot security updates, Secret Scanning and Push Protection; preserve existing alerts and add appropriate update configuration.
- [x] Read back current Maintainer/Admin ALWAYS; synchronize both dormant review/check rules and source JSON with the same current role preference and9check names. No roles/invitations/Appkeys added.
- [x] Complete local workflow/format/build/guard checks and actual exact-head PRquality/coverage/security acceptance; PR11 merged as6648651, proving direct Maintainer merge while full checks run. Main repeats the complete application/native/release gates; its actual outcome is taken from CI and the operational evidence record, not assumed from this checkbox.

The first whole-main CodeQL baseline reports existing warnings beyond the earlier PR diff; [bounded triage](CODE_SCANNING_TRIAGE.md) records actual contexts, three tested small hardenings and remaining local-reader/scanner/Origin follow-up. No false zero-finding or complete security-certification claim is made.

The additional PR-/check rules remain disabled until the independently prepared maintenance App has a proven token/promotion path; current effective Maintainer/Admin merge freedom is already present. The older personal PR-only preference below is superseded. Full remaining product scope stays unchanged.

## Current combined acceptance after Demo/Help integration

- [x] Preserve all32 migrations, M7/M8 resource/privacy boundaries, the complete master-specification ledger and accepted incoming Demo/Help/Tour source from PR16/main `e75f55d`.
- [x] Record exact `9c42730` CI43794921492 as **failed**:316 SQL cases,26 actual business API suites and real restart persistence passed;92/94 browser journeys passed and both global-calendar DE→EN journeys failed. Earlier29-migration failures remain historical evidence in WORKLOG.
- [x] Reproduce the dialog-loss regression and correct only semantic calendar range handling in `bf09f19`;12 Calendar cases, TypeScript, lint and formatting pass. Equal-range language signals preserve the same detail; real navigation still clears it and introduces no duplicate range queries.
- [x] Resolve the App/Shell/Demo integration while preserving actor-bound private state, current inbox/quiet preferences, announcement banners, all M7/M8 routes and the extracted Preferences component; TypeScript, focused lint/format and 78 tests across nine affected files passed.
- [x] Preserve incoming PR13 English documentation, roadmap/changelog/decision notes and the 36-label catalogue without replacing M7/M8 APIs, ACLs, the complete remaining ledger or failed-run history.
- [x] Record current functional preflight: 372 tests across 57 files; coverage S57.65/B52.32/F49.11/L59.46%, all configured floors passed. The corrected source has no complete native acceptance yet; its final combined SHA is not asserted here.
- [x] Measure the current compiler inventory: 135 reachable modules, 34 routes, 286 runtime exports and zero connectivity/export/link/asset errors; collect 106 authored business browser cases plus two built-PWA cases without collection errors. Discovery does not mark those journeys passed.
- [ ] Complete integration checks and a fresh full isolated run of the combined M7/M8/Demo/Help source, then observe both exact application and retained-data CI gates. Do not reuse individual branch or pre-merge counts as combined acceptance.
- [ ] After the tested product merge, execute the actual main-only maintenance-App workflow proof. Preserve the current 15 required checks, including PR preview package, mandatory signatures and review-only Maintain/Admin PR exception; do not restore an older nine-check policy. Review-hold decisions for separate PR13/19 remain separate from this product gate.

The incoming PR17 history recorded the following earlier pending instruction when that snapshot named 14 required checks. It is retained as historical evidence; the current 15-check policy and personal Carina-only PR review exception above remain authoritative.

> - [ ] After the tested product merge, execute the actual main-only maintenance-App workflow proof. Preserve the independently strengthened14 required checks, mandatory signatures and review-only Maintain/Admin PR exception; do not restore an older nine-check policy. Review-hold decisions for separate PR13/19 remain separate from this product gate.

## PR13 documentation-branch acceptance history

- [x] Confirm prior exact-head quality, security, full application/native and corrected metadata success.
- [x] Integrate current main e75f55d after PR16; retain both documentation histories and the complete guided-demo implementation.
- [ ] Observe fresh exact-source quality/security/application/native and metadata checks; merge PR13 only when every required gate passes, as explicitly authorised by the user. The live PR is the final acceptance record.

## English documentation and repository verification continuation

The user requests English general documentation, detailed contribution/issue/PR instructions, an explicit roadmap and useful notes, current/historical labels, protected main and continued direct merge authority. Work is isolated on `codex/english-documentation-governance` from accepted main `1341b16`; concurrent role/welcome-tour changes in the original checkout are preserved.

- [x] Translate the remaining general guides, forms, security policy and 30 label descriptions into English, preserving bilingual application behaviour, authored content and the verbatim specification.
- [x] Add a [documentation index](README.md), discoverable [roadmap](../ROADMAP.md), changelog (historical changelog removed) and [decision notes](decisions/README.md); correct stale M6-pending prose using recorded accepted evidence.
- [x] Add a [documentation index](README.md), discoverable [roadmap](../ROADMAP.md), changelog and [decision notes](decisions/README.md); correct stale M6-pending prose using recorded accepted evidence.
- [x] Read back all three active rules after concurrent02:33UTC activation; synchronize source JSON without changing live settings. Maintain/Admin review exceptions are PR-only; all 14 strict current-base checks apply without human bypass. Preserve separate maintenance-App promotion/source-delivery work. This current snapshot supersedes earlier dormant-rule/governance descriptions below.
- [x] Read back all eleven existing PRs, including active #10; every PR already has one type, one risk and at least one area label. Preserve classifications and the nine original labels.
- [x] Extend delivered documentation verification to roadmap/change notes and local heading fragments so translated navigation is checked.
- [x] Record actual local checks, safe full-command refusal, verified English-label readback and signed publication on [PR #13](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/13). All six quality gates and the four Security jobs passed on first head `8e14e9e`; the latest complete application/native acceptance is recorded by the PR's exact-source checks, not inferred from this checkbox. No bug-free certification, new product module, hosted/production change or real mail is implied by this increment.

The full product and operational ledger remains below. Those PR13 checks concern its documentation branch and do not certify the M7/M8 integration, which is tracked separately above.

## Concurrent quality baseline and current governance

Incoming main `3256d1a` adds visible build/type/lint/format/connectivity checks, enforceable V8 coverage floors and reports, independent CodeQL, Dependency Review and dependency-update guidance. These are preserved. The pre-incoming316-unit result and pre-Demo342-test coverage pass are historical source-bound checkpoints. The first32-migration exact CI subsequently failed the two Calendar language journeys; the corrected combined source requires the fresh complete acceptance above. See [CI_QUALITY](CI_QUALITY.md) and [CODE_SCANNING_TRIAGE](CODE_SCANNING_TRIAGE.md).

The three live rules are active after the user's clarification: Maintain/Admin review exception through PRs only; all14 currently required CI contexts and signatures remain compulsory for humans; only the scoped tested maintenance App has its technical review/check exception. History has no bypass. The configured App's actual main-only workflow probe remains after the tested product merge. Auto-Merge availability is enabled. Source and live rule details are in [GITHUB_WORKFLOW](GITHUB_WORKFLOW.md).

## Current combined source — complete acceptance next

The primary `codex/community-and-resource-completion` branch combines all eight additive M7/M8 migrations with the approved repository-scoped maintenance workflow, reviewed file-dialog fixes, Calendar correction and incoming Demo/Help/Tour source. There are **32 migrations / 155 public RPCs**; PR16 introduces no migration. Historical pre-Demo checks passed lint/types and **342 Vitest cases / 54 files** with all coverage thresholds; the earlier M7/M8 graph inventoried **128 reachable modules / 32 routes** with no detected disconnected runtime source. Those counts do not verify this new integration. A fresh source inventory, full native integration and both exact CI gates remain mandatory.

The next steps are to run the complete isolated command, fix real failures, record actual evidence, merge PR10 only after application and retained-image checks pass, then probe the App workflow on main and recheck the active, precise review/check policies. Keep the separate persistent GitHub preview current through its reviewed migration plan. No production/public-website deployment is authorised.

The full remaining module ledger stays required. Connected source now includes exact-version evidence, published global-event management, scoped administrative job pickers, saved views, file organisation, chat mentions, quiet hours and announcements. These do not imply course/wiki/forum attachment contexts, finance PDF statements, actual email scheduling, retention administration or physical-platform acceptance are complete.

## M8 connected continuation — implementation and focused checks in progress

The separate `codex/scoped-resource-job-pickers` branch continues the remaining specification with purpose-scoped administrative job search, published global-calendar management, and explicitly shared, version-pinned qualification evidence. The file/course-chat pickers must preserve their actual write permissions; they must not reuse lecturer-marketplace eligibility. Global events require current management MFA and explicit publication. Evidence review must preserve manual verification, CV/contract boundaries and accepted assignment snapshots.

These modules are **not yet accepted**. Finish source and focused checks, freeze all owners, replay the additive migration set, generate the actual API reference, and run the complete isolated Auth/Storage/scanner/SQL/API/browser/PWA command plus both exact CI gates. M7 PR10 and its corrected local run remain a separate pending gate. The entire remaining module ledger below stays required.

## M7 discovery and community source frozen — complete acceptance pending

Current branch `codex/community-and-resource-completion` preserves all24accepted M6 migrations and adds five actual CLI migrations (29total). Connected source now includes server-side file search/cursors/private tags and virtual folders, job discovery/exact details/scalar counts/private saved views, structured chat mentions and existing-policy moderation/drag-drop, effective in-app quiet hours and versioned DE/EN announcements. See [FILES](FILES.md), [JOB_DISCOVERY](JOB_DISCOVERY.md), [CHAT](CHAT.md), [NOTIFICATIONS](NOTIFICATIONS.md), [ANNOUNCEMENTS](ANNOUNCEMENTS.md), [ARCHITECTURE](ARCHITECTURE.md) and [ERD](ERD.md).

Integrated preflight passed source lint/type/format and240Vitest cases across50files. Compiler graph:119reachable modules/32routes, no unresolved imports/unreachable modules/unused runtime exports. The generated API reference inventories146actual migrated public functions. Focused real temporary-PostgreSQL groups: files6, jobs9(including observed save/remove role-withdrawal races), mentions11, attention9(timezones/DST/CAS/retained inbox), announcements16(profile-lock/revocation/commit/ACK/publication privacy). API/browser scenarios are authored and discovered but **not yet a passed canonical M7/native acceptance**.

Independent M6follow-up PR9 records accepted evidence and fixes a reproduced160ms theme-interpolation contrast defect; the exact new CI must pass before its merge. M7 contains the same atomic color-pair fix and first-computed-state regression. Keep legacy scoped job pickers,500-cardboard, rich course/wiki/forum resources, financial statements, real scheduling/email and remaining administration/retention work visible in the full ledger below.

## M6 continuation — complete operations and latest-source local preview

The current attached master prompt is unchanged. The entire module ledger below remains required; accepted client accounts, 50/50 default, optional managed learners and selfhost development continue. This M6 product work is isolated on `codex/complete-operations-and-local-preview`. Preserve all existing migration history and independently delivered runtime/governance changes.

The independent runtime delivery merged through [PR #7](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/7) as `5f89986`. `./portal github` retrieves exact current main into an owned persistent preview at `5373`/`563xx`; `./portal github test` uses a separate latest-source QA checkout. Normal `5173`/`543xx` records are preserved. Real-Git/process fixtures and a separate actual native rehearsal are recorded in WORKLOG; the independent runtime merge does not certify this new business source. [Preview/migration controls](GITHUB_LOCAL_PREVIEW.md).

| M6 vertical                                | Implemented source and focused evidence                                                                                                                                                                                                                         | Remaining acceptance/boundary                                                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Taxonomy](TAXONOMY.md)                    | DE/EN hierarchy, aliases, related authorized templates, current-MFA versioned CRUD/archive; preserves existing expertise IDs/expiry/references; 10 real PostgreSQL groups                                                                                       | Combined Auth/API/browser and retained-data CI passed on9d9bc56; physical/manual acceptance remains separate.                                          |
| [Availability](AVAILABILITY.md)            | Own private windows/notes, explicit reduced management sharing, atomic unavailable-window/assignment exclusion; 8 real PostgreSQL groups including real claim/blockout race                                                                                     | Current Auth/API/browser and retained-data checks passed. No private-calendar/admin bypass or scheduled booking.                                       |
| [Job lifecycle/capacity](JOB_LIFECYCLE.md) | Versioned metadata/deadlines/copy/archive, whole-block cancellation/reopening, accessible management Kanban; explicit new standalone 1–20 per-position offers, immutable legacy budgets, revenue/client projections; controlled invoice/cancellation race fixed | Combined SQL/Auth/REST/WebSocket/browser and retained-data acceptance passed, including repeated reopening. No automatic substitute selection.         |
| [Dashboard](DASHBOARD.md)                  | Personal calendar/chat/inbox/scanned-file previews, own pending contract receipts and authorized management follow-ups; bounded shared query observers                                                                                                          | Complete management cost/document workflow and broader matching/search remain in the ledger; native browser cases passed.                              |
| [Notifications](NOTIFICATIONS.md)          | Own stable inbox/read state, current-authorized links, versioned preferences, final-transaction matching, cancellation/claim receipts, explicit session/contract reminder refresh; 15 real PostgreSQL groups                                                    | Quiet hours, announcement banners, approved durable email/retry and optional push remain pending. No background scheduler/mail is claimed.             |
| [Administrative audit](ADMIN_AUDIT.md)     | Current `audit.read`/MFA, exact reviewed action allowlist, safe metadata only, finite 30/93-day windows and tuple cursors; 9 unit/component tests and 7 real PostgreSQL groups                                                                                  | Retention, bulk recovery, brand/permission settings and broader diagnostic UI remain pending. Native Auth/API/browser and retained-data checks passed. |

Taxonomy and availability together passed 18 focused Vitest tests. The generated [API reference](API_REFERENCE.md) currently inventories 125 public RPCs from a disposable migration replay. Static connectivity/type checks and focused passes are source evidence, not a complete product or deployment guarantee. **M6 application and retained-data CI passed on signed 9d9bc56; PR8 merged as dc8e9a7.** All 70 browser cases,234 SQL cases,18 actual business API suites and2 built-PWA cases passed. [Exact evidence and local wrapper limitation](QA_RESULTS.md). The complete remaining product ledger still applies. No production or public-website change belongs to this milestone.

## GitHub contribution and governance continuation

Requested: require independent review for other contributors while allowing `CarinaSchoppe` to merge through a personal PR-only exception; supply useful labels/tags, issue/PR templates and a GitHub-discoverable contribution guide. Contributor source passed exact CI and merged through [PR #6](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/6) as `18ce633`. The catalogue now contains 30 managed labels plus nine preserved original GitHub labels; earlier PR classifications retain existing labels. [PR guide](PULL_REQUEST_GUIDE.md).

[GitHub administration](GITHUB_WORKFLOW.md) records the current active history/review/CI policies. Maintain/Admin roles may bypass only the review requirement through PRs; CI and signatures remain mandatory. The private repository-scoped App5776881, selected installation182397724 and main-only signing Environment are configured. Its actual protected signing/bypass probe passed without any signature exception; the real main-only workflow probe follows the tested merge. Earlier standard-bot failures and disabled-rule checkpoints remain historical in WORKLOG. No production or public-website change belongs to this task.

## M5 local acceptance passed — system functionality and performance audit

Requested after PR #4: inspect the delivered code for concrete defects, disconnected code, unnecessary request/render loops, UI/accessibility gaps and missing regression coverage. Baseline is merged main `b9cdcc8`; this work is isolated on `codex/system-functionality-performance-audit`. Concurrent daily-maintenance/backup work and normal/hosted instances remain outside this audit's mutations.

- [x] Inspect current frontend, SQL/Edge/API, local runtime and release interfaces, preserving legitimate headless/vendor/migration entry points.
- [x] Reproduce and fix concrete failure/performance paths with meaningful request-count, lifecycle, timeout and permission regressions.
- [x] Exercise actual desktop/mobile/DE/EN/theme journeys and bounded network activity; inspect current screenshots.
- [x] Update developer/test/security documentation with examined scope, measured results and remaining gates.
- [x] Complete the local command and signed push. Exact combined/native CI and the authorised merge are recorded on [PR #5](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/5); inspect that durable record on continuation.

Local frozen `7abad7e` passed 117 source, 33 runtime, 42 Edge, 174 SQL, 12 API, 54 browser and 2 PWA checks plus build/persistence/cleanup. Main `11448e4` maintenance/backup source was preserved, with 76 Python and 60 Node guards. Exact PR CI43752233890 passed, PR #5 merged as `bb32274`, and exact-main CI43753910114 also passed. Ordinary automatic hosted activation is recorded below. [Evidence](QA_RESULTS.md).

## Daily maintenance and complete recovery accepted on KVM1

The authorised development instance automatically installed main `bb322746` at 2026-11-15T20:04:30UTC after exact successful CI and immutable release verification;18 exact migration sources,10 running containers / 9 healthy checks, no OOM, maintenance or manual-recovery flag. Maintenance source11448e4 and the reviewed M4 transition were already accepted through ordinary network installation and a genuine VM physical rollback drill. M5's sole forward migration used the unchanged ordinary policy.

- [x] Independent latest-compatible stable npm/Node/JSR/runtime discovery, full application plus actual retained-data gates, signed fixed-file/base-CAS promotion and explicit exact-main CI; daily02:41UTC. Actual token signature probe passed; first candidate run passed compatible npm-lock gates but safely declined a now-stale main base after PR5. No bot main promotion is invented.
- [x] Five-minute automatic immutable application release installation, bounded transient-network retry, private health before public activation, physical checkpoint/restore before public writes, same-major PostgreSQL proof/private-copy gate. Actual physical rollback and automatic M5 application passed.
- [x] Complete encrypted02:00UTC backups, all 3 databases/documents/configuration/keys, age identity off-server, up to 3 adaptive local sets and 26h freshness gate. Final actual schema18set restored all 3 databases/1,990 files plus credentials/permissions/source history. Temporary restore resources/plaintext cleaned.
- [x] Official Ubuntu packages03:00UTC and coordinated necessary reboot 03:30 UTC, fresh complete backup/global locking and pending-reboot fence; units/effective policy/dry run accepted. Actual first necessary reboot remains **untested**; kernel7.3.0-10 is installed while7.3.0-9 still runs.
- [ ] Recurring off-site retention: Hostinger daily full-VM add-on remains unpurchased pending specific price approval. Local encrypted sets/manual desktop copies do not establish recurring off-site service.

Post-automatic-deployment hosted Auth/MFA/Mailpit/recovery/RLS, actual scanning,50 claims, private file and WSS delivery/revocation passed. Existing 3 users/profiles/roles,1 private document/object,10/1GiBquotas and22templates/24sources remain. No capacity upgrade, real SMTP, production release or future100GB/15–25-member acceptance is implied. Full remaining product scope stays below; [WORKLOG](WORKLOG.md) records exact evidence and limitations.

## M4 local acceptance passed — functional audit and reusable course-building-block content

Requested 16 November: source-grounded functional/dead-code/connection audit; meaningful failed-path tests and developer docs; course building blocks as reusable provenance-linked templates; profile pictures; and resource-specific comments. M3 is merged through PR #3. Work is isolated in `codex/functional-qa-building-blocks`; original concurrent hosting edits and normal persistent data remain untouched.

- [x] Import all 24 PDF source references into 22 canonical building blocks/templates, retaining both LPC3/LPC4 revisions. Provide readable searchable content and safe template/run duplication.
- [x] Create real offers from an existing course run with exact template/session/source references, authoritative server defaults, gross/net separation and idempotency; change only scheduling/financial/delivery details as needed.
- [x] Secure scanned profile avatars with own upload/remove/replace, scoped authenticated viewing and no private-file bypass or offline caches.
- [x] Staff comments under templates and jobs, with access checks, bounded text, actual persistence, idempotency, cursor pagination, edits/withdrawals and reasoned MFA moderation.
- [x] Reproduce and fix functional gaps in Auth/search and any other actual findings; verify import/export/RPC connections; document legitimate runtime-only entry points.
- [x] Update README, developer/feature/API documentation, test inventory and exact acceptance evidence; review readable desktop/mobile/DE/EN/theme screens.
- [x] Pass the complete isolated command and push signed source. Exact CI and the authorised merge are recorded on [PR #4](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/4); check its current state on continuation. Production publishing remains separate.

Combined frozen source `4c7c897` passed the full command with exit 0:91 source, 21 runtime, 37 Edge, 165 SQL, 12 real API suites/Mailpit, 52 browser and 2 PWA cases; release controls 28 Python/ 35 Node/ 11 Envoy/ 10 Caddy. [Exact evidence](QA_RESULTS.md). Hosted M4 passed its separate reviewed14→17 transition and ordinary maintenance-release installation; current hosted M5/schema18 acceptance is recorded above.

## M3 and self-hosted development accepted — account, profile and commission extension

The user authorised direct pushes/merges on 16 November and approved 50/50 default, client accounts, role-specific financial views and optional managed learners/reviews. [Exact extension](ACCOUNTS_REVENUE_SPEC.md). PR #2 was verified and merged; M3 was delivered separately from `codex/accounts-profiles-commission`, preserving unrelated original hosting edits. Full isolated acceptance passed in `.local/tests/b1c83645/`: 59 source, 7 runtime, 22 Edge, 120 SQL, all 9 actual API suites plus Mailpit, 46 browser workflows, build and 2 PWA checks. Exact GitHub/main integration is recorded on [PR #3](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/3). Remaining original modules below are still required.

## Previous accepted checkpoint — persistent local system and M2

M1 is locally verified and was merged by Carina in PR #1. The previous continuation was delivered through [PR #2](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/2), whose exact CI passed before the authorised merge into main (`ce09de1`). This continuation adds a single-command persistent local runtime and complete isolated verification command, followed by actual collaboration, documents, knowledge, directory/course and commercial slices. The complete isolated command passed: 42 source, 7 runtime, 11 Edge, 78 SQL, all actual API/Mailpit suites, 40 browser workflows and 2 built-PWA checks. A later visual hidden-input overflow correction has a separate targeted acceptance record; exact submitted source is verified by CI. See WORKLOG/QA_RESULTS. No mocked authentication or decorative module placeholders are used.

## Current self-hosted development and automatic updates

**Current authorised hosting:** the user retained **KVM1 for development/setup** at **https://cms.luminovia.org**, with complete self-hosted Supabase and private files. Current main `bb322746`/18migrations is installed; PostgreSQL 17.12 and compatible digest-pinned services are healthy. M4 templates/avatars/comments passed their reviewed migration transition; M5's forward check constraints installed automatically. Existing accounts/passwords/keys/quotas remain. KVM4 and approximately100GB/15–25members remain future sizing, not an authorised purchase or completed load test.

**Automatic updates and recovery:** daily02:41UTC component discovery/gates and five-minute released-main polling require no VPS Git clone. Exact CI43753910114 and automatic M5 installation/post-checks passed. Complete encrypted backups02UTC include secrets and actual documents; the final native schema18restore passed3 databases / 1,990 files and5runtime+3Auth credentials. OS03UTC/necessary reboot 03:30 UTC share freshness/global locks. First real required reboot is pending; no post-boot acceptance is claimed. Recurring off-site retention and real SMTP remain separate; see [update runbook](HOSTINGER_AUTOMATIC_UPDATES.md).

**KVM1 optimisation accepted:** one verified-unused hook dispatcher is disabled reversibly. All nine actual healthchecks use30s normal/5s startup/3failures, reducing configured launches76→18/min. Backend resource/pool/security settings are preserved. Full live HTTP/ClamAV/mail/50-claim/privacy/WSS checks passed. Corrected updater source `69c81a1` passed exact CI43738585027 and installed through the normal GitHub path in `site_controller` mode; all ten container IDs/start times/image IDs/restart counters and existing backup hashes remained unchanged. The prior list-order discovery bug and a component-test cleanup race are fixed. Quiet30s observations showed95.11% CPU idle and1755MiB RAM available; these are development snapshots, not future load acceptance. See [performance record](KVM1_PERFORMANCE.md) and WORKLOG.

| Work item                      | Implemented slice                                                                                                                                               | Acceptance source                                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Persistent local runtime       | `./portal start/up/status/stop/restart/credentials`; real PostgreSQL/Auth/Storage/Realtime/Edge/Mailpit/ClamAV/Vite, no startup reset                           | Actual password/MFA/profile/private-event/object-byte restart probe; runtime safety tests                                             |
| Isolated complete verification | `./portal test`, random project, separate credentials/ports/volumes, scoped cleanup; CI same command                                                            | Complete invocation result in latest work log                                                                                         |
| Core M1                        | Auth/invites/MFA, roles, profiles/expertise, managerial verification/suspension, single-slot atomic jobs, private calendar                                      | Original 22 source / 25 SQL / 7 Edge / 20 browser / 2 PWA checks; regressions retained                                                |
| Private documents              | Actual scan/quarantine, limits, live-authorised download, preview, immutable version history, replace/rename/archive, profile evidence and job/chat attachments | Real Auth/Storage/ClamAV API, SQL and browser checks; scanner outage included in isolated suite                                       |
| Realtime chats                 | DMs, groups/general/separate course rooms, membership, persisted messages/reactions/history/search/read/mute, files                                             | 17 real SQL cases, actual WebSocket positive/revocation/suspension tests, component/browser flows                                     |
| Wiki/forum                     | Safe rich-text/code editor, draft/publish/history, categories, threads/replies/accept/report/lock/pin/archive/subscriptions                                     | 14 real SQL cases, Auth/MFA API, content-boundary and browser checks                                                                  |
| Customers/courses              | Private directory/contacts/notes/tags/archive; reusable templates, real runs/sessions/publication/safe copy                                                     | 11 real Auth/MFA API cases, component/privacy/read-only checks plus isolated browser journeys                                         |
| Contracts/finance              | Executed PDF/version/hash/receipt/addenda, applicable-contract prerequisite, immutable earnings/invoice/payment records and scoped CSV                          | Commercial SQL/API/component and isolated browser checks recorded in latest work log                                                  |
| Global search/calendar         | Permission-filtered jobs/files/messages/safe wiki/forum/contacts; explicitly published course sessions in global calendar                                       | Real API boundaries plus desktop/mobile journeys; no search over private draft bodies                                                 |
| M6 operations source           | Taxonomy, private availability, audited lifecycle/per-position capacity, Kanban, personal dashboard, own inbox/preferences and safe administrative audit        | Application and retained-data CI accepted on9d9bc56; mergedPR8dc8e9a7                                                                 |
| Latest-main local preview      | Merged PR7; `./portal github` persistent `5373`/`563xx` preview and separate `github test` QA checkout                                                          | Independent runtime evidence in WORKLOG; does not imply new business-feature acceptance                                               |
| M3 extension                   | Scoped accounts/client commission/profile/review functions merged in PR3 and integrated into the hosted development release                                     | Combined acceptance: 59 source, 31 Edge, 124 SQL, 46 browser and 2 PWA checks; hosted accounts/privacy/revocation passed              |
| Hosted development             | Actual self-hosted KVM 1 at cms.luminovia.org; private Supabase services, internal Mailpit, 18 migrations                                                       | Eight hosted API suites, fifty requests/two actors, restart persistence and browser login; see current WORKLOG                        |
| Automatic updates              | Immutable GitHub package/CI, actual successful network installation, guarded VPS updater and active Ubuntu security timers                                      | 38 updater/13 PG-recovery/25 backup guards plus Node policy/native recovery; exact CI, actual installation and post-checks in WORKLOG |
| Managed Cloud                  | Initial approved free project exists but is unused after explicit self-hosting direction                                                                        | No deployed functions, users, files or mail; no application dependency                                                                |
| Production                     | No deployment performed or authorised                                                                                                                           | Requires complete release gates and explicit approval                                                                                 |

## Full phase board

- [x] Phase 0: repository/environment and brand reconnaissance, verbatim project specification, persistent plan and work log.
- [ ] Phase 0: complete self-hosted production configuration/ownership, real SMTP, EU region/privacy and capacity acceptance; current KVM1 development is authorised and online.
- [ ] Phase 1: production-complete Auth lifecycle, invitations/admin MFA/revocation, all shell states, DE/EN/theme/mobile accessibility and PWA platform verification.
- [ ] Phase 2: complete profiles/evidence, editable verified expertise taxonomy, customer/contact directory, reusable courses/runs/sessions, job filters/saved views/Kanban/attachments/capacity, robust claims/cancellation/reopening/substitutes, private availability and published global calendar.
- [ ] Phase 3: secure realtime DMs/groups/course channels, file centre/quarantine/scanning/versioning/revocation, wiki/forum and permission-aware global search, notification preferences/delivery.
- [ ] Phase 4: executed contracts/versioned acceptance, compensation/invoices/payment/export workflows, administration/audit/bulk recovery/retention and verification.
- [ ] Phase 5: full end-to-end/adversarial/accessibility/platform sweep, monitored staging acceptance, backups of DB and storage plus restore drill/rollback, operational handoff and separately approved production release.

## Module completeness ledger — full remaining scope

| Module                 | Current functioning slice                                                                                                                                                                                                                                       | Required follow-up                                                                                                                                                                                                                                                                                                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A Dashboard/navigation | Authenticated branded responsive shell, permission-filtered search, mobile More; M6 bounded personal calendar/chat/inbox/file/contract previews and capability-scoped follow-ups                                                                                | Extend authorized management cost/document follow-ups, expertise/availability matching and resource search; combined source adds own saved views; M6browseracceptancepassed; physical/manualplatformacceptance remains                                                                                                                              |
| B Users/Auth/profiles  | Invites/recovery/MFA, roles, suspend/reactivate, bilingual profile/timezone/phone, expertise attestation, scanned CV/certificates and scoped scanned avatars                                                                                                    | Structured education and visibility preferences; full lifecycle/recovery hardening. The combined source adds explicitly shared exact-version evidence and common attestation history; complete native32 acceptance remains required. M3 adds validated experience/country/languages/self-labels, current database role editor and account HTTP API. |
| C Taxonomy             | M6 shared DE/EN topics/tools/programming-language hierarchy, aliases, related authorized courses, current-MFA versioned CRUD/archive and active/historical selectors                                                                                            | M6Auth/API/browseraccepted; availability/expertise search and future catalogue needs remain without rewriting historical qualifications                                                                                                                                                                                                             |
| D Organisations        | Search/edit/archive, types/industry/location/timezone/tags, permissioned contacts and private notes, linked course runs                                                                                                                                         | Organisation-scoped files and richer topic/filter/contact actions. M3 adds explicitly managed client accounts/memberships, course requests and organisation-scoped spend/assigned-teacher views.                                                                                                                                                    |
| E Courses              | Reusable descriptions/syllabus/prerequisites/topics; actual customer/delivery/venue/precise sessions; safe duplicate and publication                                                                                                                            | Standalone participant groups, resource links and independent split-job editor. M3 adds optional manager enrolment, lecturer course history/deep links and eligible learner reviews with moderation.                                                                                                                                                |
| F Jobs/claims          | Combined filters/current consent, whole-block atomic claims and immutable snapshots; M6 versioned edit/copy/deadlines, accessible Kanban, explicit new 1–20 per-position capacity, safe cancellation/reopening/replacement                                      | M7source adds paginated advanced search/sorting and private saved views; complete M7nativeacceptance. The scoped file/course-chat pickers are replaced in the combined source. Remaining: richer vacancy/resource UI and substitute orchestration; preserve single-position client/Course budgets                                                   |
| G Calendar             | Private events, confirmed jobs, published global course data, month/week/day/agenda/time zones; M6 own available/unavailable editor and explicitly shared reduced management windows                                                                            | Combined source adds global-event management, plain descriptions/safe links and bounded published discovery; exact own assignment titles are connected. Remaining: event files/invitations, real scheduling and permitted private drag/edit; ICS later. Complete native32 acceptance remains required.                                              |
| H Chat                 | Private DMs/groups/staff general and separate course participant rooms; persisted realtime/history/search/reactions/edit/delete/read/mute/files; immediate future-event revocation; permission-scoped profile-to-DM links already call the actual create_dm API | M7source adds structured versioned mentions/deduplicated alerts, visible existing-policy group moderation and scanner drag-drop; complete M7nativeacceptance. Remaining: presence/typing if practical and richer group administration                                                                                                               |
| I Files                | Authenticated private scope, actual scanner/quarantine, validated PDF/Office/images/text, limits/progress, preview/download/version/hash/rename/archive, evidence/chat/job contexts                                                                             | M7source adds server-paged literal search and private tags/virtual folders; complete M7nativeacceptance. Remaining: course/organisation resources, real classification policy, sharing/expiry links, restricted archives and retention/purge tools; large videos stay external                                                                      |
| J Contracts            | Personal/master/addenda/version PDF/hash, immutable receipt (no signature claim), effective/expiry/revocation and claim prerequisites; M6 own due-expiry notices on explicit reminder refresh                                                                   | Scheduled/approved renewal delivery, assignment-confirmation documents, configurable privacy/legal/retention documents and approved legal/e-sign review if needed                                                                                                                                                                                   |
| K Wiki/forum           | Safe Tiptap content/code language labels, DE/EN categories, wiki revisions/draft/publish, forum acceptance/subscriptions/moderation                                                                                                                             | Authorised attachments and course-template links, finer editorial workflow and richer search/presentation                                                                                                                                                                                                                                           |
| L Finance              | Original-currency expected/completed/invoiced/paid earnings; claim-derived invoice PDFs, review/reject, partial/full payments/void, scoped formula-safe CSV                                                                                                     | Downloadable statements and richer time-series reporting. M3 adds private gross/platform/net agreements with privately configured role-specific compensation, immutable accepted splits, client spend, owner revenue and labelled/filterable invoices; no payroll/accounting/tax/bank claims.                                                       |
| M Notifications        | Committed own inbox with safe links/cursor/read state, versioned category preferences, final-transaction topic matching, cancellation receipts and explicit own session/contract reminder refresh; chat mute retained                                           | M7source adds in-app quiet attention and versioned audience-scoped banners/important inbox notices; complete M7nativeacceptance. Durable approved email scheduling/retry and optional push remain                                                                                                                                                   |
| N Administration       | Invites/MFA/suspension/verification, customers/courses, account/client-role APIs, contracts/invoices/payments; M6 taxonomy/lifecycle board and finite safe `audit.read` projection                                                                              | M7source adds announcement management and current-role publication/ACK protection. Granular permission/brand settings, retention, bulk recovery, richer diagnostics/status UI and full product/hosted/manual acceptance remain. Existing backup/restore acceptance is operational evidence, not a delivered retention UI.                           |

## Next source-verified slices after the M6 acceptance gate

These are remaining implementation candidates, not delivered functions or extra production permissions. Complete the current combined gate first.

1. **Bounded discovery at scale:** `documentsQuery` currently loads an unpaged list and searches filenames in the browser; configured REST `max_rows=1000` means older accessible records can be absent. This is a source-derived limit, not a performed 1001-file test. Implement server-side literal search and stable cursor pagination, then versioned own tags/folders using existing resource authorization, scanner and immutable version/download paths. Inspect the analogous jobs/calendar/course list limits; do not simply raise the global cap.
2. **Knowledge resources and course materials:** safe authored internal links already work. Add genuine document/course references and appropriate authorization for wiki/forum revisions and enrolled course users; existing file contexts alone do not grant these rights. Test actual scanned bytes, drafts, history and revocation.
3. **Chat completion and qualifications:** profile-to-DM, current qualification verification/expiry, scanned evidence uploads and chat attachments already exist. Remaining work includes structured mentions/deduplicated alerts, visible authorized group moderation and linking an attestation to an exact evidence version. Preserve private DM and personal evidence boundaries.
4. **Personal views and calendar work:** reuse current URL filters for versioned saved job views and well-defined currency/unit sorting. Add explicit global-event management and authenticated calendar export with genuine timezone/parser tests. Course-session splitting is a separate new planning model; existing multi-position capacity is not session splitting.
5. **Administrative and notification configuration:** real DE/EN announcement lifecycle/banner, meaningful in-app quiet hours (retain inbox and critical receipts), protected/versioned permission-matrix editing and limited text/asset brand configuration. Existing current-role checks, official branding and private-resource boundaries remain authoritative. Scheduled reminder/publication delivery needs a genuinely running tested scheduler.
6. **Financial documents:** scoped period statements and accepted assignment confirmations based on immutable server records, with actual PDF rendering/content checks and original-currency/privacy assertions. Do not invent historical snapshots, legal signatures, banking or tax functionality.

## Current acceptance and next continuation actions

### PR #37 test cleanup follow-up — 2026-11-17

The corrected migration passed through candidate setup, retained-data upgrade and preceding API suites. The next failure was the job-picker test deleting its room before removing existing `chat_members` references. Remove the fixture-owned memberships first, then verify the new participant-origin metadata cascades when the room is deleted. This is fixture cleanup, not a runtime authorization or schema weakening. The full current-head selfhost, application and browser gates still need to pass.

1. Preserve all normal persistent records and prior verified ledgers. Last recorded hosted application acceptance is `bb322746`, exact-main CI43753910114 plus automatic installation/post-checks and the schema18complete restore. PR6/PR7 merges and M6 source are distinct. Recheck actual hosted/main state on continuation; no later source/documentation change proves installation.
2. M3 was merged through [PR #3](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/3), then integrated with the authorised self-hosted development and automatic-release path. No merge remains pending for that application slice. The system now consumes tested main releases without manual cloning; destructive/backdated/major migrations remain reviewed operations. Production deployment is separate.
3. M6 passed the combined application and retained-data gates and merged through PR8(dc8e9a7). Continue the isolated M7 source-derived discovery/community slices above; preserve all24accepted migrations, private-resource boundaries, old commercial snapshots and the complete remaining master-prompt ledger. Each further slice requires its own complete integration acceptance.
4. Continue the authorised self-hosted CMS development and configure real SMTP only when approved; no managed-backend dependency is intended. Development native all-database/file/key restore and physical VM rollback have passed. Complete remaining hosted/manual/cross-browser/physical-PWA, privacy, monitoring, recurring off-site and production-scale recovery acceptance before a concrete production approval request.

### PR #37 merge gate — 2026-11-17

The migration-order regression now accepts later independent migrations while preserving the ordered deletion-upgrade composition test. Push the signed repair, then require exact-head application, SQL, browser, selfhost and governance checks before merging PR #37.
