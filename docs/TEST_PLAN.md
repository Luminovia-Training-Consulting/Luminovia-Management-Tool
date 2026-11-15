# Verification plan and acceptance evidence

Run the checks relevant to the changed slice, fix observed failures, then record exact commands/results in [WORKLOG.md](WORKLOG.md). A planned test is not a passed test. Use the lockfile and actual package scripts; inspect `--help` before using evolving Supabase CLI commands. No real customer/person records or production endpoints in tests.

## Canonical complete command

Run `./portal test` for all mutating integration/browser verification. It creates a sanitized temporary checkout with a random independent Supabase project, separate ports/volumes and scoped cleanup, preserving the normal local development instance. It includes actual restart persistence, all `*-db-tests.mjs` / `*-api-check.mjs`, all Edge tests, browser/axe and a separate built-PWA stage. Reports stay in ignored `.local/tests/<run>/`. CI uses the same command.

Individual `npm run test:e2e` and legacy broad API checks are guarded against accidental normal-development mutation. Use isolated mode through the canonical runner. `./portal start` / `stop` are persistent development operations, never test reset commands.

## Automated source checks

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Use `npm run format:check` for formatting validation where configured. Do not repeat passing unchanged checks without a reason. Dependency audit results should record severity/scope and actual resolution, not imply that scanning alone proves security.

## Local backend setup and data tests

The development scripts and README own exact current setup. Use local Supabase/Docker, isolated fictional fixtures, local keys and a generated ignored credential file. `npm run test:db` is the database test entry point when the harness is implemented. Never repoint a destructive local reset/seed/test operation at a hosted project.

Required database/API cases:

1. Apply every migration to a clean local schema; inspect grants/RLS and advisory results. Anonymous access to private tables/RPCs fails.
2. Sign in as distinct active lecturers, participant, management and suspended user. Self-service cannot change roles, identity, activity or qualification verification. Forged IDs and metadata confer no authority.
3. Create customer/course/run/five sessions/job through authorised management RPC at AAL2. AAL1 management and lecturers cannot publish. Job requirements/rate/zone/deadline constraints reject invalid payloads.
4. Launch fifty simultaneous claims at one single-slot, five-session job. Assert exactly one success/winner, five allocations, one immutable accepted snapshot and one committed notification/event set. Losers receive a truthful filled/conflict/eligibility result. Repeat winner request and check no duplication.
5. Run one lecturer's parallel claims across overlapping jobs. Assert at most one succeeds; adjacent non-overlapping sessions may succeed. Reject overlaps with own private events, missing/expired verification, expired contracts and stale terms version.
6. Attempt direct changes to accepted terms, claim actor and allocation records; deny. Edit future job data and prove accepted monetary/currency/terms snapshot does not change.
7. Lecturer and admin cannot read or mutate another lecturer's private event. Published global events never derive from private events. Deactivated users are denied with existing JWTs.
8. Invitation handler/unit/type checks: `npx --no-install deno test --allow-env supabase/functions/invite-lecturer/handler_test.ts supabase/functions/files/handler_test.ts` and Deno checks for both entry points. Add actual Edge HTTP tests for approved/forged origins and preflight, disabled configuration, current Auth+AAL2 capability, fixed lecturer role, durable deduplication/throttling, local captured email, implemented redirect, password setup and subsequent login. Mocked handler dependencies do not replace this journey.
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

Record date, source commit (when available), exact command, environment, counts/result and limitations in WORKLOG. Do not mark all modules complete because M1 checks pass. Production gates include staging demo, security/privacy review, real SMTP, DB+storage restore drill and reviewed rollback.
