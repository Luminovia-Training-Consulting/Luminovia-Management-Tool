# Verification plan and acceptance evidence

Run the checks relevant to the changed slice, fix observed failures, then record exact commands/results in [QA evidence](QA_RESULTS.md). A planned test is not a passed test. Use the lockfile and actual package scripts; inspect `--help` before using evolving Supabase CLI commands. No real customer/person records or production endpoints in tests.

## GitHub quality and measured coverage

Separate Build, Typecheck, Lint, Formatting, Code quality and Tests and coverage checks complement the complete command. `npm run test:coverage` measures all executable frontend source, includes untested modules and enforces global plus critical-module floors. HTML/LCOV/JSON reports are inspectable; real SQL/HTTP/Edge/maintenance/browser results are separate evidence, not part of the V8 percentage. CodeQL and dependency review add static security/supply-chain checks. See [CI_QUALITY](CI_QUALITY.md) for exact scopes and thresholds.

## Canonical complete command

[Functional acceptance](FUNCTIONAL_ACCEPTANCE.md) maps implemented module slices to real SQL/API/browser suites. The complete runner rejects skipped, flaky, retried, empty or incomplete browser selections and preserves separate application/PWA evidence plus a source-bound machine-readable acceptance summary. A real Playwright negative probe verifies that exit-zero skips cannot pass the acceptance guard.

Run `./portal test` for all mutating integration/browser verification. It creates a sanitized temporary checkout with a random independent Supabase project, separate ports/volumes and scoped cleanup, preserving the normal local development instance. It includes actual restart persistence, all `*-db-tests.mjs` / `*-api-check.mjs`, all Edge tests, browser/axe and a separate built-PWA stage. Reports stay in ignored `.local/tests/<run>/`. Main/manual CI uses the complete command. Full-profile PR CI partitions its unchanged stage set into independent `--phase system` and `--phase browser` stacks; neither partial phase alone is a complete pass. Documentation-only and ordinary frontend profiles perform narrower checks, as described in [CI_QUALITY](CI_QUALITY.md).

Individual `npm run test:e2e` and legacy broad API checks are guarded against accidental normal-development mutation. Use isolated mode through the canonical runner. `./portal start` / `stop` are persistent development operations, never test reset commands.

## Automated source checks

```sh
npm ci
npm run typecheck
npm run lint
npm test
./portal check
```

`./portal check` also performs source/GitHub formatting, compiler integrity, coverage and a production build using synthetic public configuration. A standalone `npm run build` needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; it does not start a backend. Use `npm run format:check` for source formatting. Do not repeat passing unchanged checks without a reason. Dependency audit results should record severity/scope and actual resolution, not imply that scanning alone proves security.

## Local backend setup and data tests

The development scripts and README own exact current setup. Use local Supabase/Docker, isolated fictional fixtures, local keys and a generated ignored credential file. `npm run test:db` checks core invariants and SQL/advisors; the canonical runner additionally discovers every domain `*-db-tests.mjs`. Never repoint a destructive local reset/seed/test operation at a hosted project.

Required database/API cases:

1. Apply every migration to a clean local schema; inspect grants/RLS and advisory results. Anonymous access to private tables/RPCs fails.
2. Sign in as distinct active lecturers, participant, management and suspended user. Self-service cannot change roles, identity, activity or qualification verification. Forged IDs and metadata confer no authority.
3. Create customer/course/run/five sessions/job through authorised management RPC at AAL2. AAL1 management and lecturers cannot publish. Job requirements/rate/zone/deadline constraints reject invalid payloads.
4. Launch fifty simultaneous claims at one single-slot, five-session job. Assert exactly one success/winner, five allocations, one immutable accepted snapshot and one committed notification/event set. Losers receive a truthful filled/conflict/eligibility result. Repeat winner request and check no duplication.
5. Run one lecturer's parallel claims across overlapping jobs. Assert at most one succeeds; adjacent non-overlapping sessions may succeed. Reject overlaps with own private events, missing/expired verification, expired contracts and stale terms version.
6. Attempt direct changes to accepted terms, claim actor and allocation records; deny. Edit future job data and prove accepted monetary/currency/terms snapshot does not change.
7. Lecturer and admin cannot read or mutate another lecturer's private event. Published global events never derive from private events. Deactivated users are denied with existing JWTs.
8. Invitation handler/unit/type checks: `npx --no-install deno test --allow-env supabase/functions/invite-lecturer/handler_test.ts supabase/functions/files/handler_test.ts` and Deno checks for all invitation/files/accounts entry points (automatically discovered by the canonical runner). Add actual Edge HTTP tests for approved/forged origins and preflight, disabled configuration, current Auth+AAL2 capability, fixed lecturer role, durable deduplication/throttling, local captured email, implemented redirect, password setup and subsequent login. Mocked handler dependencies do not replace this journey.
9. As later modules land, add contract/CV/invoice/file guessed-path tests, DM/course participant membership/realtime revocation, rich-content XSS tests and permission-aware search.

Real PostgreSQL locking tests are required; a mocked reducer or sequential loop does not establish concurrency. A local stack result does not establish hosted SMTP, managed configuration or production acceptance.

## Unit/component tests

Regression cases from independent review: a refetch after accepting terms must require fresh consent or preserve/pass the exact previously reviewed version; navigating to another job must not retain a previous confirmation or idempotency request identity; a block with sessions on days 1 and 10 must not match a session-range filter for days 5–6; profile validation must match the 4,000-character database cap; switching authenticated actors must clear the previous actor's private query state; unfinished MFA enrollment must be recoverable.

Test server-result mapping and rejected claim UX, schema validation, bilingual keys/state preservation, combined filter logic, localised fee units and money, timezone conversion with actual IANA rules, protected-route behaviour, error/loading/empty states, query invalidation and no optimistic allocation. Verify Berlin summer/winter and DST boundaries versus Brisbane; invalid/nonexistent local times must not silently shift.

## Browser/E2E and accessibility

Entry point: `./portal test`; its isolated browser stage invokes `npm run test:e2e`. Use actual Supabase Auth and Data API for the principal journeys; mocks may isolate error rendering but must be labelled. Store screenshots of fictional data only. Verify:

- Invitation/recovery → sign-in → own profile/expertise save → reload persistence → sign-out/private deep link.
- Admin MFA enrollment/challenge → create offered job → lecturer combined search/detail → accept current terms/claim → confirmed calendar → repeat/conflict error.
- Own event add/edit/delete and horizontal denial; explicit zone indicators and week/month/agenda layouts as implemented.
- German/English switch preserves form and navigation state; light/dark/system on desktop and narrow mobile; keyboard focus and control names; automated axe plus manual keyboard/contrast review.
- Offline app shell works without private caches. Claims/messages/uploads require connectivity. Confirm reconnection/update messaging without false success or form loss.
- Inspect manifest/icons/service worker build. Test actual installation on supported platforms before marking installability accepted; a generated manifest alone is insufficient.

Cross-browser smoke tests and real mobile/installed PWA acceptance remain release gates when only local Chromium has been exercised.

## Evidence ledger

Record date, source commit (when available), exact command, environment, counts/result and limitations in QA_RESULTS. Do not mark all modules complete because M1 checks pass. Production gates include staging demo, security/privacy review, real SMTP, DB+storage restore drill and reviewed rollback.

## Approved M3 account/profile/commission acceptance

- Accounts: actual Auth-issued JWTs, closed own-profile payload, native timezone validation, bounded directory including explicit NULL RPC inputs, current roles/MFA, self/last-admin protection under concurrent role/activation edits, scoped organisation links/revocation, invitation role/org/idempotency binding and inviter-authority recheck. Exercise both the new HTTP façade and direct RPC paths; legacy invitation compatibility uses the same ledger.
- Financial tenancy: client A/B separation, revoked memberships/current roles, default/custom split and cent rounding, distinct EUR/AUD, private gross absent from lecturer REST/RPC/UI and unexposed private tables, atomic accepted revenue with concurrent claims/rollback. Legacy net-only snapshots stay unchanged with unknown gross. Draft offers cannot inflate published spend.
- Documents/invoices: real clean/quarantine ClamAV PDF path, net-only immutable invoice from the accepted claim, bounded labels, combined search/status/currency/label filters and formula-safe filtered CSV, MFA review/manual payment tracking. No real bank transfer or tax computation.
- Profiles/reviews: authored labels/languages/experience validation and intentional safe projections; actual current/upcoming/past assignment instants; viewer-authorised course links; manager enrolment; only completed real attendance/assigned lecturer can review; no self review or ordinary reviewer-identity disclosure; optimistic edits/withdrawals and reasoned MFA moderation; immediate revocation/suspension.
- Integration/audit: delivered literal frontend RPC names resolve to executable migrated invoker APIs; all public tables retain RLS; new owner/admin functional roles preserve private DM/calendar boundaries. Late initial Auth lookup cannot restore a signed-out/prior actor. Real desktop/mobile browser actors use separate BrowserContexts to avoid sharing Supabase login storage.

Executed counts and exact pass/fail checkpoints belong in QA_RESULTS, not this plan. `scripts/generate-api-reference.mjs` derives the API inventory from a disposable database; it is an explicit documentation task, not a mutating implicit test step.

## M4 templates, avatars, comments and integration

- Course building blocks: verify all24 original source hashes and22 canonical codes, preserve alternate LPC3/LPC4 revisions, reject unsafe importer delimiters, and render source lineage on direct job navigation. Exercise template→dated run→financial-only offer with actual session IDs, changed preview rejection, idempotent/concurrent creation, immutable accepted context and gross/net isolation. Test weekday planning against actual time-zone/DST rules; generated dates still need the operator's holiday/break review.
- Avatars: reject unsupported/oversized sources before decoding; independently validate bounded canonical PNG bytes/server scan status. Test actual image conversion/upload/select/reload/view/remove, invalid replacement retaining the former picture, same-actor/version cache ownership, access removed during byte download, and no private offline cache.
- Resource comments: prove actual template/job access rather than general login alone; actor/resource-bound retry, real concurrent posting/edit conflicts, cursor/rate boundaries, own withdrawal, reasoned MFA moderation, archived history and immediate role/suspension revocation. Use independent browser identities for author, peer and moderator.
- Audit/error paths: recovery Enter, pending/rejected SDK operations, MFA initialization/enrolment/challenge retry, bilingual notices, logout failure and committed search-URL changes. Compiler fixtures must detect disconnected modules/exports/routes/assets and renamed/transitive RPC wrappers; bind literal calls to actual migrated APIs. Keep functional headless/server/vendor interfaces rather than deleting them solely because the browser does not import them.
- Local/release boundaries: copy a synthetic tree and assert nested real env/private/site paths stay outside the scratch snapshot while source/example configuration remains. Discover scanner HTTP/TCP, package/review and Python updater tests, then run actual isolated Envoy/Caddy checks in the same canonical command. The exact M4 history/source review and disposable rollback/old-row preservation probe are documented in [REVIEWED_M4_MIGRATIONS](REVIEWED_M4_MIGRATIONS.md); neither authorises a hosted installation.

Run counts and failures remain in QA_RESULTS. The combined full command and exact PR CI are required after integrating concurrent hosting source; the earlier isolated application run alone does not accept that integration.

## M5 system and performance regressions

Check blocked/full preference storage during actual boot and language/theme changes; bounded idle/scan/stuck-scan metadata loads; actor/abort/revocation and exact document-version bytes; immutable avatar focus/reconnect behavior; failed chat receipts and bounded realtime bursts without delayed old callbacks. Exercise finite schedules at SQL and actual HTTP boundaries with complete rollback and preserved accepted work. Validate Office files with real ZIP cases and label synthetic resource measurements honestly. Real child-process timeout/cancellation and stop-acknowledgement fixtures must be discovered by the same complete command. [System audit and evidence scope](SYSTEM_AUDIT.md).


## Optional job contact/reference checks

The job-briefing SQL/API/browser entry points cover empty existing jobs, current management MFA, explicit reference publication, default confirmed-assignee contact visibility, optional offer-viewer release, cancellation/current-role revocation, strict closed payloads and URL/email/bounds, stable retries/concurrent CAS, safe duplication/archive, and unchanged accepted money/terms. Desktop/mobile tests exercise actual editing, online claim/cancellation-driven refresh, literal authored text, safe links, German/English, dark theme and axe. Unit tests cover retained drafts, denied-data hiding, explicit reload, network/offline refusal and confirmed versions. Run only through the documented disposable fixtures; ordinary development data are outside these mutating checks.
