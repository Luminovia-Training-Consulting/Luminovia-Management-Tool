# QA evidence — 2026-11-16

## Frozen 36-migration composition: actual bounded SQL acceptance

Signed `ddb848564753ea5a89b326d649708c69385475c5` passes commission 14 groups and lifecycle 12 groups on all 36 migrations, exit 0. The catalogue-preservation regression independently passes five groups on its intentional historical baseline of 24 migrations through `20261115213550`, followed only by `20261116032005`. No historical migration or production SQL was changed.

The first lifecycle attempt failed at PostgreSQL fork after six groups under the own 256-PID ceiling. Exactly one complete repetition, with only the own container ceiling raised to 512, passes; source and real fifty-way race/assertions are unchanged. Both own pinned PostgreSQL 17.12 containers have no network or hostports, 768 MiB/one CPU/private tmpfs and checked database/container removal. Evidence is private mode 0600 under `.local/full-functional/independent-sql/6dc8d65c52-result.json` and `232fcc59c2-result.json`. SQL Auth helpers are emulated; native Auth/HTTP acceptance remains separate.

Independent backend-free collection validates all 38 files/both browser projects: 120 application cases plus two PWA cases. No journey was executed by collection. Noncredential placeholders satisfy fixture-presence conditions only; earlier fixture-incomplete discovery correctly failed the no-disabled-case guard. Bounded source review found no actionable regression. Fresh complete exact-head CI remains pending, and PR12 remains Draft under the PR17 → PR24 → PR25 shared-PC/actual-main priority.

## Accepted PR10 main: combined source checks, full CI still pending

The local functional-test branch now incorporates actual main `1de544d872706eebc95a942a1956254ed87ae40d` (PR10, merged 09:04:25 UTC). All 36 published migration files are byte-identical to that main. The runner preserves source hashing, independent complete browser discovery, no skips/retries and cleanup-before-PASS.

Actual combined checks pass: `./portal check`, 515 frontend cases in 65 files, coverage S65.18/B59.74/F56.60/L67.28% with all existing floors, type/lint/format/compiler checks and production/PWA build (66 precache entries, 2799.81 KiB); 109 runtime cases with zero skipped; three documentation/privacy cases; actionlint and whitespace checks. Logs remain private under `.local/full-functional/main10-*`.

These are focused current-source results. E7's full PC/CI pass below does not certify this later 36-migration composition. Bounded owned SQL verification and all 15 fresh exact-final-head checks remain pending. PR12 stays Draft without auto-merge while the explicit queue serves PR17, then PR24 and PR25; no new shared full-PC run is started.

## E7complete PC/CI acceptance; later neutral-catalogue integration

SignedE7cab0d passed actual PC `./portal test`, run1aacef6d,07:33:30.406–07:49:32.799UTC with launcher/session exit0 and all72stages. Actual94application+2PWA cases have zero skips/retries; SQL/API/invitation/retention and owned cleanup pass. Independent local Docker readback finds no run-owned containers/volumes/networks or checkout lock. Private proof: `.local/tests/1aacef6d/acceptance.json` and `.local/full-functional/e7cab0d-full-local.*`.

CI43824413347 passed all15gates on exactE7:application07:51:11UTC,native07:57:08UTC,preview07:57:18UTC. Its fingerprint matches PC exactly: `e8250d5a2a494d08691292c9bdfd33e55ab4d4ea7038e9ecb5d556323e595720`. Counts:254frontend/102runtime/42Edge/76Python/72operatingNode,258SQLgroups,19APIs,94+2browsers; native26migrations/20suites with actual retained Auth/MFA/private-event/scanned bytes and cleanup. Reports/package verification: `.local/functional-ci/pr12-e7cab0d/`.

Subsequent actualPR13maine88df84c introduces neutral-catalogue migration27. Its local integration passes254frontend/build,105runtime,20native/updater guards,3documentation/privacy groups and4controlled-HTML real-Chromium pointer/layout cases; the last4exercise no backend/Auth and record no separate pageerror listener. Earlier isolatedPG14+12acceptance remains bound to068b603/26migrations. No later full native/SQL/current-head pass is invented. ExplicitPR10-first priority keeps PR12 Draft and reserves shared QA; further own acceptance resumes afterwards.

## PR10 final-CI archive race

CI43823638639 on0b615a7 failed111/112application browsers at mobile file discovery's final zero-filename assertion after archive confirmation. Earlier SQL/API/restart stages passed; build/PWA/native/preview acceptance was not reached. The new held-initial-response component regression reproduces the row returning after server acknowledgement. Explicit cancellation before list invalidation corrects that product race; all51focused cases and515frontend cases/coverage plus the actual local source/build command pass. The browser fixture also awaits the applied filter and exact archive RPC acknowledgement, without changing the final deletion assertion, retries or timeouts. New complete exact-head CI remains mandatory. Earlier eee73e4 local/CI/native acceptance is retained as historical evidence only.

The latest continuation evidence is first. Older M1 results below remain historical; they do not describe the current local service state. Full target/production acceptance remains pending.

## Current joint PR10/PR13 integration — acceptance pending

This source merges accepted main `fabd71a` with the incoming M7/M8 implementation and English documentation history. The 35-file candidate retains the 26 byte-identical released migrations, appends the eight byte-identical renamed M7/M8 files and the additive role-aware discovery correction. The generated API inventory and actual replay/upgrade behavior must still be verified from the combined database. No current complete native, browser, PWA or retained-data pass is claimed here. The 372-test preflight and the failed 32-migration runs below retain their exact earlier source scope.

The acceptance gate is the final combined revision: appropriate source/focused regressions, complete isolated Auth/SQL/API/desktop/mobile/PWA execution, actual retained-data selfhost verification and all 15 required GitHub checks, including `PR preview package`. A source merge, authored test or old individual branch pass cannot substitute for those results. Hosted installation and production acceptance remain separate.

## Historical PR18 extension checkpoint — combined acceptance then pending

[PR18](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/18) preserves accepted M6 and all historical commercial records. The current combined run is a separate gate. Focused frontend:215cases/49files, S48.61/B43.47/F38.76/L50.43%; lint/type/format/build and the source graph pass. Preview/runtime/community guard combination passes36cases; three additional execution-based QA bootstrap cases pass.

Actual signed-source `a55089b` local `.local/tests/98a4eba3/RESULT.txt` and [CI43795741418](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43795741418) both return **exit1** after all26migrations, schema lint/advisors, **257 individual SQL cases**, genuine retained password/MFA/profile/private-event/Storage bytes and four actual API suites. The first commissioned course-offer API correctly rejects missing private policy. The QA bootstrap had been filtered out by intentionally sanitized nested startup; the corrected runner explicitly seeds its fictional policy with its own QA identity after the persistence proof. No normal development or production policy is chosen by seeding. Native API/browser/build-PWA completion is still required after this test-environment correction.

Earlier CI43794432854 exposed wrapper fixture dependence on the outer QA port overlay, fixed and covered by an actual nested-process regression. CI43794974281 exposed legacy test expectations that allowed one equal-role administrator suspension; assertions now require both denied and both accounts unchanged. No permission/assertion was relaxed to accept either behavior. Current captured-offer duplication, role-bound consent, private configuration and stale-policy UI reload have independent regressions. Source/test existence and previous milestone acceptance are not labelled complete acceptance for this extension.

## Historical M7 functional preflight — complete acceptance then pending

The integrated functional source including PR16 Demo/Help/Tour, the Calendar correction and scoped picker passed `npm run test:coverage`: **372/372 tests across 57 files**, exit 0. Measured coverage: statements **57.65%**, branches **52.32%**, functions **49.11%**, lines **59.46%**; every configured floor passed. No new complete native pass or final merged-source SHA is claimed by this preflight. The separate PR19 automatic-merge implementation is not included.

The current compiler inventory contains **135 reachable modules, 34 routes and 286 runtime exports**, with no unreachable modules, unresolved imports, unused runtime exports, broken literal links or missing assets. Playwright collection in explicit local test mode discovers **106 business cases plus two built-PWA cases**, with no collection errors. Those cases are authored/discovered, not passed current-source native acceptance.

## Historical 32-migration CI — Calendar failures, corrected integration then pending

Exact source `9c42730` failed complete acceptance in [CI43794921492](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43794921492). All **316 PostgreSQL cases, 26 actual business API suites, 46 Edge tests and real restart persistence passed**. The local run also exited 1 with the same two Calendar failures in `.local/tests/cf7ffa12/RESULT.txt` (9.8 minutes); runtime guards 56, operational Node guards 61 and Python guards 76 passed. Business browsers finished **92 passed / 2 failed out of 94**: both desktop/mobile global-calendar journeys lost the published-event detail after the DE→EN switch. Build/PWA and the native selfhost acceptance were not reached. This is a failed complete gate, not a full pass.

The focused regression failed before signed correction `bf09f19` and passed afterwards. All **12 Calendar component cases**, whole-tree TypeScript and focused lint/format passed. The App/Shell merge with accepted PR16/main `e75f55d` then passed **78 tests across nine affected files**, TypeScript and focused lint/format. These checks preserve same-range details, real navigation, account boundaries, announcements, current notifications/quiet hours, Demo, Help, Tour and Preferences; they do not establish complete acceptance of the combined source. A fresh full isolated run and exact-source application/security/retained-data CI remain pending.

The older counts below, including **342 tests, 128 modules and 32 routes**, belong to their recorded pre-Demo revisions. They are not the measured counts or acceptance result of the current combined source. The 29-migration failures and successful M6 results remain separate historical evidence.

## Historical pre-Demo source coverage — full native result then pending

The pre-Demo integrated source passed **342/342 unit/component tests in54files** and every configured V8 coverage floor. Measured statements55.78%, branches50.40%, functions46.94%, lines57.60%; file API lines98.92%, functions96.29%. Reported source coverage includes all executable browser TS/TSX and public-config code; SQL, Edge and browser acceptance are separate. `./portal test` now executes this gate and preserves HTML/LCOV/JSON reports. A complete new native32 result is still required.

## Combined 32-migration preflight — native acceptance still required

Signed source `1adc134` passed **316 Vitest cases / 53 files**, lint and TypeScript. The source graph contains **128 reachable modules and 32 routes**, with no unreachable modules, unresolved imports, unused runtime exports, missing literal assets or broken literal routes. A real disposable migration replay inventories **155 public functions**. Focused module checks and independent reviews are recorded in WORKLOG; they do not replace actual Auth/Storage/browser integration.

The next canonical run discovers 26 native business API suites, 94 business browser cases and 2 separately built-PWA cases. Its actual result and the exact application/retained-data CI must be recorded before complete acceptance. Earlier 29-migration failures below remain honest checkpoints. The open build-only advisory is documented in [DEPENDENCY_AUDIT](DEPENDENCY_AUDIT.md).

## M7 second combined run — actual dialog defect reproduced and corrected

Source `8fe3e19`: detached launcher **exit 1**, private report `.local/tests/1aab5e9e/RESULT.txt`. All native migration/285 SQL/23 API/invitation/restart checks passed again; browsers **85/86** (9.9 minutes). Exact CI43782621640 reproduced file-dialog loss in both browser projects (84/86, 14.6 minutes). Trace: a delayed new filter unmounted the captured dialog before any archive RPC. Native test steps and their timeouts remain unchanged. New deterministic regressions reproduce the original lifetime defect; exact-resource revalidation also covers successful empty responses after room-access withdrawal. The final combined 32-migration source still requires a complete new native gate and exact CI. Build/PWA was not reached by these failed checkpoints.

## M7 first combined run — 84/86 browsers, corrected fixture, rerun required

Frozen source `eaefea5` returned **exit 1**, explicitly captured by the detached launcher in `.local/m7-test-01.exit`; private report `.local/tests/b026ab59/RESULT.txt`. All 29 migrations, 285 PostgreSQL cases, 23 actual business API suites, real Edge/Mailpit and real password/MFA/profile/calendar/Storage restart preservation passed. Chromium completed **84 passed / 2 failed / zero skipped** (7.8 minutes). Both failures came from mixed notification-fixture row shapes producing a NULL ID before the quiet-hour UI journey. Explicit IDs now fix the fixture without relaxing its assertions. Build/PWA was not reached. Full corrected-source verification and exact PR CI remain required.

Visually inspected passing journeys from this run: [file centre](screenshots/m7-desktop-file-centre.png), [structured chat mention and scanned attachment](screenshots/m7-desktop-chat-mentions.png), [desktop announcement](screenshots/m7-desktop-announcements.png), [mobile announcement](screenshots/m7-mobile-announcements.png). These images do not turn the two failing journeys into passes.

## M7 source preflight — not full acceptance

Integrated current source passed lint/type/format,240Vitest cases across50files and compiler connectivity (119modules/32routes; zero unreachable/unresolved/unused runtime exports). Actual disposable29-migration replay generated146public functions. Narrow module SQL groups passed (files6,jobs9,mentions11,attention9,announcements16); temporary minimal Auth identities are not real Auth/TOTP acceptance. Actual API/browser definitions are authored. The complete native isolated M7 command and exact application/retained-image CI remain pending; no M7deployment/merge or fullpass is claimed.

## Final local verification of the accepted-main composition

`./portal check` passes TypeScript, ESLint, source/GitHub formatting, the compiler export graph, all254frontend tests in52files and the synthetic public-config production/PWA build (63precache entries). Coverage remains S51.15/B46.15/F41.61/L52.96% with unchanged floors. `node --test scripts/runtime-*.test.mjs` passes98cases without skips, including the14documentation/privacy/metadata cases. All12native candidate allocator/boundary cases pass; actionlint and resolved-document formatting/whitespace checks pass. All26previously released SQL blobs remain unchanged and the catalogue is the preserved27thmigration.

The canonical `./portal test` attempt exits1 before snapshot/service startup because another checkout holds the global QA lock. No foreign ports, processes or data are altered, and no complete local DB/API/browser/native pass is claimed. All15fresh exact-head GitHub results remain required before the authorised PR13 merge. Six fictional desktop/mobile catalogue/source/job images from named PR23 application checkpoint `d448fab`/run43814253694 were inspected; they show neutral sample content and wrapping mobile tabs, while source dialogs are scrolled to comments. This historical visual checkpoint does not replace final combined native acceptance.

## Final PR13 integration of accepted PR27/main

PR27 passed all15mandatory checks on `485ac16`, including full application, actual selfhost retained-data and preview-package gates, and merged as actual main `e048edb` at07:21:44UTC. This PR13 continuation incorporates that actual accepted main without bundling an unmerged branch. It preserves `./portal check`, complete local acceptance, explicit exact-SHA CMS publication and manual-only PR deployment metadata, together with the corrected pre-captured quote versions in the concurrent lifecycle fixture. No publication workflow is dispatched.

The complete PR13 source retains the English documentation, customer-neutral PR23 `7767564` product/migration27, all26released SQL bytes, current personal PR-only review snapshot and the unified12-case native port allocator correction. Both complete ledgers and every original branch head remain in normal ancestry. The next gates are final current-source local checks, one signed normal PR13 branch update, all15fresh exact-head GitHub checks and the directly authorised merge. Earlier checkpoints and externally changed rule modes below remain historical.

## Latest PR23 port-correction ancestry

PR23 advanced to `7767564` with an independently developed correction for the same duplicate-port failure. This normal merge preserves that actual head, both prior PR23 heads and the earlier reviewed port correction. The selector and complementary recycling, real-socket and cleanup regressions are reconciled into one implementation; all ownership/isolation/unique-port gates remain. The reconciled source passes all12candidate cases without skips, plus targeted ESLint, Prettier, syntax and whitespace checks. The original8boundary cases are unchanged on both sides; no Docker or ordinary service is invoked by this focused validation. Current evidence and the final combined PR13 checks govern acceptance. Older records below describe their exact named source checkpoints and do not establish the current live policy, source tree or complete final native pass.

## Current PR13 continuation — latest personal policy and native fixture

The verified06:42UTC correction restores active review27329000 with only User29256704 (`CarinaSchoppe`) in `pull_request` mode and its original independent-review conditions. There are no extra scanning/quality/Copilot rules in that layer. History/checks remain active, without bypass and with all15mandatory statuses/signatures. All older always/disabled/role-based records below are timestamped history; no server rule is written here.

Both current PR13 `eb001c4` and PR23 `8047b94` heads are preserved in the normal ancestry. The native candidate port selector now reserves all3loopback listeners together before releasing them; a deterministic recycling regression, failure-cleanup cases and real TCP group rebind pass (11candidate+3documentation cases). The incoming isolation/ownership/unique3guards remain. An independent read-only review finds no actionable defect; actual Docker handoff/native preservation still requires final CI. PR27's current-base acceptance and actual main merge remain the preceding release dependency; no unaccepted PR27 bundle is published in this branch.

Fresh local checks of the combined PR13/PR23 source pass254frontend tests in52files with unchanged coverage floors (S51.15/B46.15/F41.61/L52.96%),90runtime cases including14documentation/privacy/metadata cases, TypeScript, ESLint, source formatting, actionlint and the synthetic public-config PWA build. All26published SQL blobs and the entire incoming PR23 product/backend/operating/workflow/browser source remain intact. These checks do not claim complete database/API/browser/native acceptance; final required CI remains pending on the accepted current base.

Historical06:30UTC checkpoint: review enforcement was disabled externally while history/checks remained active. At that point source preserved the06:25UTC snapshot. The later06:42UTC readback supersedes both: active review, only CarinaSchoppe User29256704 in `pull_request` mode and no extra scanning/quality/Copilot rules in that layer. Source and present-tense guidance now follow that corrected configuration. No server rule is modified by this task.

## Final PR13/PR23 composition — acceptance remains separate

The actual PR13 remote moved to `af3bd61` with signed PR23 `d448fab`. Its product/catalogue/migration27/UI/browser changes are preserved alongside reviewed documentation candidate `84fc41c`. The earlier254frontend/88runtime checkpoint applies to its named unchanged-product source, not automatically to this composition. Actual accepted PR27/main, focused current-source checks and all15fresh mandatory GitHub outcomes are still required. The06:25UTC checkpoint granted only CarinaSchoppe User29256704 the personal `always` exception and additional review-layer rules (superseded at06:42UTC); signatures and history/check gates have no bypass. Older role-based source snapshots below are superseded.

## PR23 native setup: reproduced port allocation defect corrected

Run43814253694/d448fab passed complete application verify, then native failed before services/migrations: serially released ephemeral ports produced only2distinct values for3roles. The fix retains all3loopback listeners until collection finishes, then closes all owned resources in finally. Ten unit cases pass, including two real-socket regressions for simultaneous uniqueness, rebinding, and genuine bind-failure cleanup without touching an unrelated listener. The existing uniqueness assertion and all gates remain. Combined maintenance/M4 guards pass41cases;89runtime,lint/type/format/compiler checks pass. Accepted main319ab69 is preserved; no new complete/native-PWA pass is claimed until current-head CI finishes. Draft/no-auto-merge and the explicit local-PC/main-merge queue remain in force.

## PR23 current-main local run: failed transport, own course flows passed

Current-main0a6002a focused local checks pass254frontend/89runtime/type/lint/format/compiler inventory. Canonical3250296d is **FAIL**,90/92browsers: dashboard.desktop and a chat member's mobile context lost initial source/ReactDOM modules with `ERR_NETWORK_CHANGED`, leaving no login form before either business check began. All4course/source journeys pass;263SQL cases/groups,19real API suites plus Edge/Mailpit and restart persistence pass. Build/PWA were not reached. No permission assertion, retries0 or timeout was weakened.

Read-only host journal correlates container-interface creation19ms before the chat failure and1.5–1.8s before dashboard failures; exact owner/causal attribution remains unproven. A separate backend-free actual-React login-load diagnostic passes20fresh contexts with no failed module loads or observed network events. No new complete rerun bypasses the user's reserved PC-QA order. The earlier a793da4 complete CI/native/PWA success below remains separate evidence; later exact-head acceptance/merge is recorded on [PR23](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/23).

## PR23 complete accepted source and newer main baseline

[a793da4 / CI43809580902](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43809580902) against fabd71a passed249frontend,263SQL cases/groups,19real API suites plus Edge/Mailpit,92/92browsers,build and2/2PWA with checked cleanup. Native passed27migration main26→candidate upgrade, retained password/MFA/private event/file,20API/invitation suites,TLS/WSS,50claims and cleanup. Quality/security and runnable-preview gates passed. Six feature PNGs were downloaded/visually reviewed and OCR checked without the historical customer label. Actual mobile geometry is412×839/offset0 and both ordinary clicks pass.

Main then advanced to0a6002a. That guided-help/compiler source is integrated next; the prior green run is separate evidence, not current-base acceptance. PR27 has the next actual merge reservation for manual-only publication; PR23 auto-merge is disabled. Exact later CI/merge is recorded on [PR23](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/23). No hosted installation or production operation is asserted.

## PR23 exact mobile overflow reproduced and corrected

[Run43806035677](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43806035677) on `553acc4` failed84/86browser cases; its safe geometry and four downloaded partial PNGs informed diagnosis. Actual React with fictional loopback responses and `DejaVu Sans` reproduced the exact435×886layout versus412×839visual viewport/47pxoffset and failed ordinary clicks even without capture. Wrapping only the operations toolbar's translated tab group restores normal geometry and passes four source/run click probes. Four desktop/mobile real-source-CSS/covered-target/scroll/capture regressions pass locally; overflow checks now use document clientWidth. Mainfabd71a and all26published migration bytes are preserved. Type/lint/format/compiler graph and19catalogue/docs/metadata checks pass. Final complete application/native/security and visual acceptance is taken from [PR23](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/23), not assumed from these bounded fixtures.

## PR23 exact mobile failure and new diagnostic gate

Run43800695806 on `c752498` failed82/84browser acceptance after226frontend,239PostgreSQL,18real API suites/Mailpit and native restart persistence passed. The two mobile course clicks were intercepted; full build/PWA were not reached and the separate native gate was skipped. Local real-React/fictional-API probes did not reproduce the cause. Added pointer readiness and safe geometry telemetry retain every original ordinary click/business assertion; the new native covered-target/scroll/capture regression passes on desktop/mobile. Main43504b8 is preserved. Current complete acceptance and the authorised merge are recorded on [PR23](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/23); no fresh full pass is assumed here.

## Customer-neutral correction — independent main delivery in progress

Original-checkout focused checks passed: 244 frontend cases/52 files; TypeScript/lint/format/build, catalogue/source/documentation guards, five real migration-preservation and16existing catalogue SQL groups. Eight branded screenshots were removed. That baseline included independently open role/pricing work and is not claimed as acceptance of the now isolated main-based delivery. Independent main-based source passes226coverage cases (51.44%lines), type/lint/format and23catalogue/documentation/release guards plus the adapted5+16PostgreSQL groups. [PR23](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/23) owns the exact-source complete application/native/security outcomes and user-authorised merge record. The feature screenshot artifact contains only the six fictional building-block captures for visual review; no unobserved full pass is claimed by this submission record. The local complete command initially refused another checkout's active shared QA lock before startup.

The latest continuation evidence is first. Older M1 results below remain historical; they do not describe the current local service state. Full target/production acceptance remains pending.

## Accepted0950506 functional source; newer main integration pending

Later signed05b2c0d passed complete application/native/preview CI at06:46:19/06:51:58/06:52:12UTC:72stages,254frontend,102runtime,42Edge,76Python,62operatingNode,258SQLgroups including legacy,19APIs,94application+2PWA cases without skips/retries; actual26-migration/20-suite retained-data acceptance. Safe artifact14203058716 is `.local/functional-ci/pr12-05b2c0d/c67b0f78/acceptance.json`. The later3c88334remote reconciliation retains the executable source and has separately observed CI.

Actual PR27 maine048edb7 is now incorporated locally without executable-source changes over068b603. That source also passed real isolated local PostgreSQL suites:commission14groups/exit0 and lifecycle12groups/exit0, each26migrations and deterministic late-reader/claim checks. The768MiB/1CPU server had no network/host ports; own databases/container were verified removed and source bytes unchanged. Private0600report `.local/full-functional/independent-sql/52ef4460c8-result.json`. Its SQL Auth helpers do not establish native Auth/HTTP/browser acceptance. Complete PC/browser acceptance after the reserved PR31 run and exact final-head15CIgates remain pending; no publication dispatch was performed.

Signed09505062fa403542e64e36183d492f9c5a0c91aa passed all15required checks in [CI43808553155](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43808553155). Actual application/native/preview completion:05:37:12/05:43:24/05:43:33UTC. The source-bound report records **72passed stages;94application+2built-PWA browser cases with zero skips/retries**. Other totals:249frontend/52files,92runtime,42Edge,76Python,62operatingNode,257regular PostgreSQL groups+1legacy refusal,19real business API suites;63precache entries/2708.06KiB.

Native26-migration/20-suite acceptance preserves password/MFA/roles/private event/scanned bytes and passes actual TLS/WebSockets/50claims/Mailpit/cleanup. No image change or hosted installation is inferred. Security/metadata/separate CodeQL all pass;0annotations/new PR code-scanning alerts remain distinct from baseline dependency warnings. Safe artifact14200467458: `.local/functional-ci/pr12-0950506/6cbbfc50/acceptance.json`, source digest `1ae4017ad3f0f783c585321f3bf344cee740b0dd327b42005bfd8ffa3203ccea`. Preview14201096149's actual archive matches manifest digest `d047aac1edab159e89d26aeaaf3000ea9913c6db8b21cd03e7e3bf5d557570ec`; no package execution/publication was performed.

Subsequent actual main0a6002a5 contains new guided-experience source. It and the necessary PR27 publication-control candidate are prepared locally; `./portal check` passes254frontend cases/52files and build, all102runtime checks pass, and real discovery inventories94browser cases/28files. These are not a new full combined pass. The attempted earlier local full command was refused before startup by another checkout's legitimate QA lock; no competing process was stopped. Complete local acceptance, actual PR27 main ancestry and exact final15CIgates remain pending before merge. Earlier failures/successes below retain their own source scope.

Incoming30075c9 fixes the actual lifecycle SQL fixture race found by PR27: pre-read authorised tokens before50real claims, retain1winner/49filled/2sessions and prove a late reader can use reviewed consent after offer-list disappearance. No production SQL or fallback token changes. The local merged source passes syntax/lint/format/documentation checks; its full native/SQL acceptance is still pending. A second local invocation onbbd3238 was refused before startup by the customer-neutral checkout's legitimate lock; its exit1 is retained privately, without claiming a pass.

The separate commission fixture now also pre-reads10actual authorised quotes before10real parallel claims and deterministically verifies late visibility loss plus server-confirmed filled. Exact1winner/9filled/revenue/allocation/privacy checks remain intact. Syntax/lint/format pass locally; no new SQL pass is inferred. The kernel QA lock is currently held by the M7 integration checkout, so the complete local run must wait for natural release.

## Earlier PR18 integration preparation — historical pending checkpoint

Current combined source incorporates actual PR18 mainfabd71a, merged05:09:15UTC after its14required checks and independent26-migration/20-suite native acceptance passed. The actual-main merge changes no tree bytes over our signed correctedf010721 source before this evidence update. All migration/dependency bytes match accepted PR18; fresh full acceptance of this functional branch remains pending.

Independent published be1ef25 [CI43804535426](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43804535426) failed at04:57:17UTC after63passed stages and **89/90browser cases, zero skips/retries/flaky outcomes**. Desktop search alone chose the hidden mobile menu before the authenticated shell had rendered; its `isVisible()` check did not wait. Both mobile search and calendar/keyboard projects passed. The safe source-bound report is `.local/functional-ci/pr12-be1ef25/7f5d7279/acceptance.json`; SHA-256 `9b64235c87c68fa1eceebb85075370ec1bf29c3e90982b13fc4864e13400b9a2`. Built-PWA/native were not accepted. The readiness correction must pass a new full combined run; earlier successes do not override this result.

Corrected search navigation waits for the actual visible desktop link/mobile disclosure and visible destination link, retaining all assertions. ESLint/format/strict TypeScript pass. A real Chromium diagnostic on delayed responsive markup passes desktop1440/mobile412 with exactly1navigation click and zero page errors; correct desktop-hidden/mobile-open disclosure state is verified. This diagnostic uses no business service and does not replace full acceptance. Private result `.local/search-navigation-probe/result.json`.

Published PR12be1ef25 incorporates actual PR15 main43504b8 after formal release. PR18 source0675bb9 is prepared on this owned branch while its explicit main-merge hold remains active. Both new migrations, private policy/role-bound quotes and welcome/preview functions are preserved alongside all functional regressions. Actual local combined checks pass **92runtime and249frontend cases/52files**, TypeScript, ESLint, formatting and actionlint; coverage is S50.81/B45.79/F41.56/L52.63 with unchanged floors.

The repricing refusal now reaches the actual accepted-history guard and verifies exact unchanged deal/revenue fields. Executable runner fixtures provide the real hashing/evidence dependencies, retaining persistence-before-fictional-seed and abort/cleanup assertions. These focused results do not establish combined browser/API/native acceptance. That requires the signed final source, actual PR18 main ancestry and a fresh complete CI. Historical results below must not be substituted for that gate.

## Earlier combined application — 90 browser workflows and native acceptance passed

Signed `f7453a6f7efda9f593774460094c5898158d90a8`, including incoming main's guided demo/help, passed [full CI43799280625](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43799280625). Application verification completed at **2026-11-16T03:59:20Z**, actual native retained-data compatibility at **04:04:45Z** (13:59/14:04 Australia/Brisbane).

Actual final-source totals: **68 passed stages;226 Vitest cases/49 files;60 runtime;42 Edge;76 Python;61 operating Node;234 SQL;18 business API suites;90 application browser workflows plus2 built-PWA cases, zero skips/retries**. Build has63 public precache entries/2686.68KiB. Native24-migration proof retains password/MFA/roles/private event/scanned bytes, passes19 suites including invitation,50 claims,TLS/WebSockets,private Mailpit and owned cleanup;changedImages[] does not establish an image upgrade. Security, separately generated CodeQL and current metadata pass without new PR alerts.

Safe artifact14195564209 is `.local/functional-ci/pr12-f7453a6/3d77713e/acceptance.json`, source SHA-256 `0052ca2eb438fef1b9656455ac926a7d95108edaf974b8b533323de8083ff45c`,03:38:52.397–03:59:16.222UTC. Counts were extracted from actual final logs, not inferred from the earlier78-case implementation.

Main subsequently advanced only its GitHub metadata catalogue/workflow and documentation through d4c1f49. That current metadata was reconciled on this branch, retaining both work-log/plan sections. Actual source comparison against acceptedf7453a6 shows **no changes to application, migrations, dependencies, browser journeys or complete test runner**. All63 current runtime cases, including11metadata cases, and actionlint pass locally. Exact new CI may repeat after this administrative reconciliation; its current state is on PR12 and is not invented here. Carina's coordinated pause prohibits merging this PR into main until the PR15 coordinator releases it. No production/hosted/real-mail action was performed.

## Corrected functional and native acceptance — all checks passed

GitHub-verified signed implementation `1e72507ff2ca774048fe93c9a95dae31805c47b5` passed [Portal CI43795517565](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43795517565), including the separate actual image/retained-data job. Full application verification completed at **2026-11-16T03:21:47Z**, native compatibility at **03:27:28Z** (13:21/13:27 Australia/Brisbane).

| Check | Actual result on this source |
| --- | --- |
| Source | Build/type/lint/format/reachability;197 Vitest cases/46 files;coverage floors preserved with the new sensor included |
| Runtime/Edge |58 runtime cases;42 Edge cases and3 entry-point checks |
| Operating boundaries |76 Python and61 Node cases;actual Envoy/Caddy HTTP checks |
| Database/API |24 migrations;234 PostgreSQL cases including legacy refusal;all18 business API suites plus actual captured-mail invitation |
| Browser |**78/78 passed**, desktop/mobile;zero skips/retries;long-column keyboard/cancel/drop regression passes both projects |
| Build/PWA |56 public precache entries/2601.72KiB;**2/2** built-PWA cases, zero skips/retries |
| Native retained data |Password/MFA/roles/private event/scanned bytes preserved;real TLS/WebSockets,50 competing claims,private Mailpit,18 API suites plus invitation and owned cleanup pass |
| Security/metadata |Dependency Review,3 CodeQL analyses,separate CodeQL and current PR metadata pass;zero new changed-code alerts/annotations, distinct from existing main warnings |

Safe artifact14194274558 records all **68 passed stages**,78 application/2PWA cases, source SHA-256 `0c4b44d7a5c7dd4a10d80b9b952c6b2d83846b1b8e5ffb1dfb2e83fbd76a93a4`, start03:02:08.506Z/end03:21:45.010Z. Private evidence: `.local/functional-ci/pr12-1e72507/`, including0600verify/native logs and `f40829f9/acceptance.json`. Native `changedImages` is empty; no runtime image upgrade is invented.

Corrected local run04 safely returned1before startup because another checkout owned the shared QA lock; no competing resource was modified. Corrected full acceptance comes from independently successful exact-source CI, supported by the real local Chromium/dnd-kit comparison. Earlier local and failed-CI records below remain accurate.

The final report follow-up counts each browser result independently, so a failed shared spec cannot relabel a passed sibling project. Seven focused guard cases pass, including actual Playwright skipped/focused/single-project-failure probes and credential-free summaries. Application, migrations, dependencies and user journeys are unchanged from accepted1e72507. Subsequent exact-head check state is on [PR12](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/12). Full remaining product/platform/manual/production scope stays in the plan. No production/hosted/public-website/real-mail operation was performed.

## Independent functional sweep — mobile keyboard board failure reproduced by CI

The subsequent source correction passed an actual isolated Chromium/dnd-kit DOM comparison: legacy2522px/one arrow leaves the destination offscreen; the actual new sensor targets a visible allowed column, respects boundaries/filled exclusion, cancels and drops successfully, with zero page errors. Owned random-port fixture/browser were cleaned. The test now awaits the genuine cancellation-animation finished promises before a second pickup; it uses no arbitrary delay. Full corrected business/CI/native acceptance remains pending.

Exact signed `b93b400` [CI43791915492](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43791915492) failed after all SQL/API stages: **77/78 browser cases passed**, with mobile `job-capacity.spec.ts:83` failing to target the published column by keyboard. New calendar and aggregate search pass in both projects. Built PWA was not reached remotely; native compatibility was skipped. The complete local pass below remains valid local evidence, not a substitute for this independent failure.

The installed keyboard sensor moves10px per arrow and disables autoscroll; the existing100-arrow limit therefore depends on total stacked-column height and retained browser fixtures. Product keyboard navigation and a deterministic long-column regression are being corrected. No blind rerun, skip or weakened claim/state assertion replaces the failed case. Reduced artifact14193437363 is retained privately at `.local/functional-ci/pr12-b93b400/938368b6/acceptance.json`; it records63passed stages and the failed browser stage. New failure-summary handling now preserves safe case counts/identities without copying error payloads or credentials;6guard checks pass.

## Functional/integration sweep — complete local acceptance passed

Signed implementation `b93b400bbd3b26fca0d31886c446cf05b35d58bd` passed `./portal test` at **2026-11-16T02:37:51.154Z** (12:37 Australia/Brisbane). Independent detached wrapper `.local/full-functional/run03.exit` records **0**. Private result `.local/tests/3346a7e6/RESULT.txt` is PASS; machine evidence `acceptance.json` identifies sanitized source SHA-256 `19e5bf96ca69f74d148a1c0afb72e288bd5532eebc0eaa2cb8d77fde85a888bf` and all **68 passed stages**. Later changes are evidence documentation and actual fictional screenshots only.

| Check | Actual result |
| --- | --- |
| Source | Lint/type/format;197 Vitest cases/46 files |
| Runtime/Edge |57 runtime cases including real negative Playwright probes;42 Edge cases and3 entry-point typechecks |
| Operating boundaries |76 Python and61 Node guards;11 real Envoy routes/10 real Caddy HTTP cases |
| Database |All24 migrations; SQL lint/security/performance advisors;234 PostgreSQL cases including legacy refusal and real50-way concurrency |
| Native interfaces |All18 real Auth/MFA/REST/Storage/WebSocket business suites, including expanded knowledge/chat/contracts/qualification/cancellation flows; actual idempotent Edge/Mailpit invitation |
| Persistence |Genuine stop/start retained password, verified MFA, edited profile/timezone, private event and exact private Storage bytes |
| Browsers |**78/78 passed** across24 application spec files/desktop and mobile Chromium;7.7 minutes;zero skipped/retried cases |
| Build/PWA |56 public precache entries/2600.81KiB;**2/2** built-PWA cases passed in2.3 seconds;offline shell/no private cache |
| Cleanup |Final exit0 only after owned stack cleanup; no remaining containers/volumes for3346a7e6; normal development resources not targeted |

Actual application and PWA discovery/execution JSON and HTML remain separately in `browser/application/` and `browser/pwa/`; neither report overwrote the other. Reduced evidence has0600permissions and no environment/credential/raw-log fields. A separate actual passing nested Playwright probe also confirmed the validator accepts first-attempt passes; the negative runtime-skip probe demonstrates that Playwright exit0alone is insufficient.

New real workflows and their limits are in [FUNCTIONAL_ACCEPTANCE](FUNCTIONAL_ACCEPTANCE.md). Actual [desktop search](screenshots/functional-desktop-search.png) and [mobile search](screenshots/functional-mobile-search.png) screenshots were visually inspected. This is acceptance of the implemented slice, not completion of all outstanding master-spec features, physical PWA/platform acceptance or production release. Independent exact-source GitHub/native results remain to be recorded on [PR12](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/12). No hosted/production/public-website or real-mail operation was performed.

## PR13 current-main conflict-resolution checkpoint

The conflict resolution integrates main `0a6002a`, including the accepted delegated-role/private-pricing/welcome and guided-experience changes. All product/backend/operating source, dependencies, assets, data and26released migration bytes remain identical to that main source. Documentation, label/ruleset snapshots and the existing heading-link test are the only changed surfaces. Fresh local validation passes254frontend cases/52files with S51.15/B46.15/F41.61/L52.96%,88runtime cases including all13documentation/metadata cases, TypeScript, ESLint, source/.github/changed-document formatting, source integrity/exports, actionlint and a63-entrysynthetic public-config PWA build. A broader formatting probe reports8unchanged baseline documents outside this delta; no unrelated formatting update is included. Full mutating local database/API/browser acceptance is not claimed for this documentation-only increment; exact-head required CI remains separate evidence. Current policy is15mandatory checks with no history/check bypass and the sole User29256704 (`CarinaSchoppe`) PR-only review exception. The later personal-only decision supersedes the initial f723 role-based review snapshot. Earlier14-check/App-exception and24-migration figures below are historical snapshots.

## PR13 conflict correction — current source and policy

The new isolated integration preserves PR13's English additions and actual main0a6002a. All22focused documentation/metadata/integrity guards, targeted ESLint, formatting and whitespace checks pass; application, released migrations, dependencies and workflows match main exactly. Current source rule snapshots match15mandatory checks with strict current base, no history/check bypass and only Maintain/Admin PR-only review exceptions. Earlier14-check/App-exception readbacks below describe historical configurations.

The prepared final composition includes signed PR23 d448fab. All29focused documentation/metadata/catalogue/integrity cases pass, including the combined heading/link/privacy checks and the new root documentation. Application, migrations, dependencies, workflows and browser cases remain byte-identical to d448fab. Fresh final-head GitHub application/native/security/package acceptance remains pending; focused passes and earlier full runs do not substitute for those results. No production, hosting, real email or persistent business data was changed by this correction.

## English documentation and repository verification

Exact 24-migration source e7cf92a completed [CI43793778452](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43793778452) successfully:197unit/component tests,53runtime guards,18actual API suites,72desktop/mobile browser cases,2built-PWA cases, actual restart/scoped cleanup and the separate genuine selfhost/retained-data job. [Security43793778386](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43793778386) and CodeQL's zero-new-alert/zero-annotation outcome passed; findings30/31are fixed, not dismissed. A later documentation/catalogue-only follow-up includes all36managed live labels after parallel classifications otherwise made the older30-label source reject metadata. No application/backend/package source changes in that follow-up. Its focused validator/link checks and latest exact PR results remain distinct from this completed full application record.

[PR #13](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/13) contains English general documentation/forms/labels, roadmap/changelog/index/decision notes and an extended real-document heading-link check. It changes no application, database migration, package or backend source relative to accepted main `1341b16`. The authoritative master prompt is unchanged. Original concurrent work and active PRs #10/#12 are independent.

Actual local checks: clean `npm ci`;197Vitest cases/46files; coverage S47.09/B41.59/F37.07/L48.89%; ESLint, TypeScript, formatting, synthetic-public production build and56PWAprecache entries/2600.80KiB; compiler connectivity/exports;10documentation/PRmetadata plus8connectivity/private-snapshot regressions; form/label structural comparisons and diff whitespace checks. The full local command returned1 before starting services because another checkout holds the global QA lock; no competing process or data was altered.

On signed first head `8e14e9e`, all6quality gates in [CI43792083385](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43792083385), all4jobs in [Security43792083378](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43792083378) and current PRmetadata passed. The complete application and native retained-data jobs are tracked on the [exact current PR checks](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/13/checks); this checkpoint does not substitute an earlier revision's success for an unobserved run. Baseline main1341b16 independently passed all9CIjobs in43788369925.

Latest live API readback after concurrent02:33UTC activation and02:45UTC extension verifies main `protected:true`, all three active rulesets, Maintainer/Admin PR-only review bypass and all 14 strict required checks without human bypass, App5776881bypass, private vulnerability reporting enabled,30managed English label descriptions plus9preserved originals and valid type/risk/area categories on all11pre-existing PRs. Alerts2–4are fixed without dismissals, leaving25open CodeQL hints(10high/15medium). Test success, scanner success and finding closure are separate claims. Existing4low build-tool audit entries remain documented; no complete bug-free/security/physical-device/production certification is asserted.

## Current roles/pricing/welcome/PR-preview extension — combined acceptance pending

[PR18](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/18) preserves accepted M6 and all historical commercial records. The current combined run is a separate gate. Focused frontend:215cases/49files, S48.61/B43.47/F38.76/L50.43%; lint/type/format/build and the source graph pass. Preview/runtime/community guard combination passes36cases; three additional execution-based QA bootstrap cases pass.

Actual signed-source `a55089b` local `.local/tests/98a4eba3/RESULT.txt` and [CI43795741418](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43795741418) both return **exit1** after all26migrations, schema lint/advisors, **257 individual SQL cases**, genuine retained password/MFA/profile/private-event/Storage bytes and four actual API suites. The first course-building-block commissioned-offer API correctly rejects missing private policy. The QA bootstrap had been filtered out by intentionally sanitized nested startup; the corrected runner explicitly seeds its fictional policy with its own QA identity after the persistence proof. No normal development or production policy is chosen by seeding. Native API/browser/build-PWA completion is still required after this test-environment correction.

Earlier CI43794432854 exposed wrapper fixture dependence on the outer QA port overlay, fixed and covered by an actual nested-process regression. CI43794974281 exposed legacy test expectations that allowed one equal-role administrator suspension; assertions now require both denied and both accounts unchanged. No permission/assertion was relaxed to accept either behavior. Current captured-offer duplication, role-bound consent, private configuration and stale-policy UI reload have independent regressions. Source/test existence and previous milestone acceptance are not labelled complete acceptance for this extension.

## Subsequent theme regression — actual defect fixed, new CI pending

Repeated documentation CI43774441712 rejected one taxonomy contrast check(69/70passed). Actual served M6markup/styles reproduced first-state button contrast1.841/1.037 during background interpolation; stable themes pass. Removing that interpolation retains transform feedback and gives immediate dark9.104/13.982 on the same actual page. New effect-based desktop/mobile regression samples the first computed theme states; exact new PR9 CI remains required. The historical accepted M6counts below are not rewritten as if this later run passed.

## M6 application acceptance — passed on exact signed source

Source `9d9bc567e70cdb3100a7ea6d78920d90a735cbba`: local runner report `.local/tests/977d0761/RESULT.txt` PASS at 2026-11-15T22:49:34.605Z; independent exact-source [CI43770187739](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43770187739) application `verify` succeeded at 22:53:22Z. The separate retained-image compatibility job also succeeded at 22:59:09Z; [PR8](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/8) merged at 23:05:43Z as `dc8e9a7e65c96076038bf7067791676578d121d4`.

| Check               | Actual result                                                                                                                 |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Source and graph    | Lint/type/format;177 Vitest/45 files;105reachable modules/30routes; zero unused runtime exports, broken imports/routes/assets |
| Runtime/Edge        | 52 runtime,42 Edge tests and3 entry-point typechecks                                                                          |
| Operating guards    | 76 Python,60 Node, real Envoy/Caddy boundaries; real age encryption fixtures                                                  |
| Database            | 24migrations, lint/security/performance advisors and234 PostgreSQL cases                                                      |
| Business interfaces | 18 actual Auth/MFA/REST/Storage/WebSocket suites plus real idempotent Edge/Mailpit invitation                                 |
| Persistence         | Actual password/MFA/profile/private-event/object bytes survived stop/start                                                    |
| Browsers            | 70/70 desktop/mobile Chromium workflows, zero skipped;6.6 minutes; DE/EN/dark/offline/axe and real DnD/claim/storno/reopen    |
| Build/PWA           | 56 public precache entries/2600.83 KiB;2/2 built-PWA checks in2.2 seconds                                                     |
| Cleanup             | Owned random stack/network/volumes/markers removed; normal development records not targeted                                   |

Actual inspected fictional screenshots: [desktop dashboard](screenshots/m6-desktop-dashboard.png), [mobile dashboard](screenshots/m6-mobile-dashboard.png).

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

| Check       | Actual result                                                                                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source      | Lint, TypeScript, formatting; **117 Vitest cases / 34 files**                                                                                                              |
| Connections | **85 modules /25 routes /175 runtime exports**, no unreachable module, unused runtime export, broken relative import/literal route/static asset                            |
| Runtime     | **33 Node cases**, including real child timeout/abort, stop acknowledgement, kernel QA contention/crash release, busy legacy listener and actual Vite watcher              |
| Edge        | **42 tests /3 entry-point typechecks**; updated Office validation plus all invitation/account/avatar/TCP/HTTPS regressions                                                 |
| Schema/SQL  | All **18 migrations**, lint/security/performance advisors; **174 real PostgreSQL cases** including six finite-schedule and six API/security inventory cases                |
| APIs        | All **12 actual suites** plus Edge/Mailpit invitation; the corrected native HTTP test retains exact `23514` and unchanged old event instants                               |
| Restart     | Actual password/MFA/profile/private-event/object bytes preserved across stop/start; probe cleanup passed                                                                   |
| Browser     | **54/54 desktop/mobile Chromium cases**, zero skipped, 4.8 minutes; 12-second actual idle-file/no-reload budget and blocked-storage DE/EN/dark/retained-draft cases passed |
| Build/PWA   | Build; **47 public precache entries / 2415.14 KiB**; **2/2 built-PWA** registration/offline/private-cache checks, 2.2 seconds                                              |
| Cleanup     | Owned services/network/volumes/markers cleaned; normal development data not targeted                                                                                       |

Reproduced/fixed behavior and measurements are in [SYSTEM_AUDIT](SYSTEM_AUDIT.md): unbounded timestamps, excessive settled metadata requests, stuck scan polls, stale/cross-actor attachment metadata, version-history/download consistency, failed read receipt retries, duplicate immutable-avatar bytes, realtime burst invalidations, blocked preference storage, private local drafts across account switches, dishonest timeout/stop success, cross-checkout QA collisions and generated-HTML HMR reloads. Timing/memory and invalidation measurements retain their exact synthetic/component scope; they are not whole-platform hosted-throughput claims.

Earlier failed checkpoints remain in WORKLOG: run01 server acceptance with 53/54 browsers and actual startup `ERR_NETWORK_CHANGED`; run02 stopped before services on a legitimately occupied legacy-test port; run03 reached 174 SQL and failed a nondeterministic new HTTP fixture because the existing conflict trigger ran before the desired CHECK. No ordinary business assertion or retry was weakened. Run04 corrected the fixture and passed fully.

After the incoming daily-maintenance merge, actual targeted guards passed **38 updater + 13 maintenance + 22 backup Python tests**, no crypto skips, and **60 Node release/review/package/scanner/maintenance/recovery tests**. Real local `age`/`age-keygen`1.3.2 tools were made available in the user's bin without changing existing files or copying any recovery identity. Production Edge source lint passed ten files with require-await active; seven fixture files passed with Promise-shaped async doubles allowed. Those checks now join `./portal test`. Native selfhost image/retained-data compatibility remains a separate required CI job; its final result belongs to the exact PR record.

No M5 hosted installation or production publication was performed. The historical bounded M4 review tool remains 14→17 and deliberately refuses an 18-migration manifest. Actual installed history must be inspected before a separately authorised deployment. Physical mobile/other browsers/manual accessibility, real hosted maximum-load/capacity/SMTP, legal retention and full remaining product scope stay in the plan.

## M4 combined functional acceptance — complete command passed

`./portal test` passed on **2026-11-15 at 17:31:03.771UTC (16 November 03:31 Australia/Brisbane)** against frozen signed source `4c7c897`, including concurrent main through `1f9a114`. Project `luminovia-portal-test-7c2dd978`; private report `.local/tests/7c2dd978/RESULT.txt`. The wrapper explicitly captured **exit 0** in `.local/m4-test-04.exit`, and the execution session also returned 0. Subsequent local changes are documentation and actual fictional screenshots; exact submitted-source CI and the final merge are recorded on [PR #4](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/pull/4).

| Check               | Actual combined result                                                                                                                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source              | Lint, strict TypeScript and formatting; **91 Vitest cases / 28 files** passed                                                                                                                                       |
| Connections/runtime | **21 Node cases**: environment/ownership/persistence guards, catalogue delimiters, compiler import/export/route/asset/RPC graph, local documentation links and two actual-copy private snapshot fixtures            |
| Edge                | **37 tests**, all three entry-point typechecks passed; avatar PNG/revocation and private HTTPS/TCP scan boundaries retained                                                                                         |
| Release controls    | **28 Python updater +35 Node** cases (M3 review 6, M4 review 8, package 7, scanner HTTP/TCP 14), plus **11 actual Envoy routes / 10 actual Caddy HTTP checks**; fixture-only/owned-resource cleanup                 |
| Fresh backend       | All **17 migrations** replayed; SQL lint/security/performance advisors passed                                                                                                                                       |
| SQL                 | **165 PostgreSQL cases**: core 25, accounts 11, API surface 3, avatars 10, course-building-block 16, chat 17, comments 11, commercial 14, commission 14, documents 12, knowledge 14, M4 preservation 4, profiles 14 |
| Actual APIs         | All **12 suites** passed, including new avatars/course-building-block/comments and all earlier Auth/TOTP/REST/RPC/WebSocket/Storage/ClamAV regressions                                                              |
| Mail                | Actual Edge invitation, durable retry and exactly one Mailpit delivery; no real recipient                                                                                                                           |
| Restart             | Actual stop/start retained password, verified MFA, profile/timezone, private appointment and exact private Storage object bytes; probe cleanup passed                                                               |
| Browser             | **52/52 desktop/mobile Chromium journeys**, zero skipped,4.3 minutes; new source-link/offer/image/comment workflows and existing regressions passed                                                                 |
| Build/PWA           | Build passed; **47 public static precache entries / 2413.56 KiB**; **2/2 built-PWA** SW/offline-deep-link/no-private-cache cases,2.2 seconds                                                                        |
| Cleanup             | Owned random services/network/volumes removed; normal persistent development stack was not targeted                                                                                                                 |

All 24 original supplied PDF bytes independently matched 22 canonical course-building-block codes and 24 source revisions. M4 preserves both LPC3/LPC4 variants, exact source/session identity, trusted source fingerprints and financial-only run offers. Real API/browser evidence includes stale preview rejection, concurrent/idempotent offers, actual whole-block allocation, private gross/net and revoked memberships. Raw PDFs/personal source paths are not published. Weekday planning does not decide holiday/break arrangements automatically.

Avatar evidence includes real JPEG-with-metadata conversion to bounded canonical PNG, actual clean scanner/Storage bytes/hash, scoped authenticated viewing, replacement/removal and access changed during download. The invalid-replacement screenshot intentionally retains the previous blue fictional avatar and shows the retry error. Comment evidence uses separate author/peer/moderator contexts and covers persistence, safe literal text, stale edits, MFA hide/restore and author withdrawal. New DE/EN/light/dark screens passed automated axe/overflow checks; actual desktop/mobile screenshots were visually inspected. Mobile full-page captures include the fixed navigation at the viewport position.

The final frontend inventory contains 84 connected modules, 25 registered routes and 172 runtime exports with **no unreachable module, genuinely unused export, unresolved import, invalid literal route or missing literal asset**. The compiler discovers 99 frontend literal RPC references (74 unique names), bound to the migrated API surface; the generated reference documents 106 public functions. Runtime/headless/vendor/migration interfaces remain deliberate and documented. These static checks do not prove every dynamic branch runs or certify a completely bug-free product.

**Hosted boundary:** no M4 installation was performed. The unchanged ordinary updater stops the avatar constraint replacement and course-building-block procedural import for operator review. The [read-only M4 plan](REVIEWED_M4_MIGRATIONS.md) verifies exact 14/17 history/source/package inventories without an apply mode. Its 4-case disposable preservation rehearsal proves old-row/column/ID/role/quota retention and atomic rollback; Auth is an id/email stub and file metadata only, so it does not establish native password/MFA or physical object preservation on the CMS. The separate restart probe above uses actual local Auth/Storage. Remaining product, physical/mobile/cross-browser/manual/privacy/production gates stay in the plan. No public website, hosted record, real email or bank transfer was changed.

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
