# Functional and integration acceptance

The complete command is `./portal test` (`npm run test:all`). It runs the real application against disposable PostgreSQL, Auth/MFA, REST/RPC, Storage, Realtime, Edge, ClamAV and captured Mailpit mail. It preserves the ordinary development instance. Unit coverage alone cannot establish that these connected functions work.

## What a passing complete run means

- Source checks, operating guards, all migrations, PostgreSQL permissions/concurrency, all discovered domain API suites, actual invitations, retained-data restart, desktop/mobile browser workflows and built-PWA checks passed.
- Browser discovery independently inventories every `tests/e2e/**/*.spec.ts` in both supported projects. Application and built-PWA execution must exactly match their respective discovered workflow keys. Zero cases, missing files/projects, skips, expected failures, flaky results, retries and interrupted cases fail acceptance. Focused `.only` tests are forbidden.
- `.local/tests/<run>/acceptance.json` records the sanitized source SHA-256, stage commands/status/times and actual browser workflow outcomes. It does not contain environment variables, response bodies, stdout or attachments. GitHub retains this summary as `portal-functional-acceptance-<run>-<attempt>`.
- Private local evidence separates `browser/application/` and `browser/pwa/`, each with discovery JSON, execution JSON, HTML and failure artifacts. The PWA stage cannot overwrite the application's HTML report or traces. These raw artifacts stay local; only the reduced summary is uploaded.
- `RESULT.txt` becomes PASS only after the owned stack is cleaned up. A failed run is retained as failed; planned/discovered cases are never represented as passed.

The source fingerprint identifies the actual copied bytes, including uncommitted and untracked source. Git HEAD alone would misidentify an uncommitted working tree. It is an audit identifier, not a signed build attestation or a code coverage percentage.

## Existing module slices and their connected suites

This maps the authoritative specification A–N to executable evidence. Each row describes the **implemented slice**. The full remaining feature list in [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md) is still required; these suite associations do not claim that every target feature or every branch already exists or is covered.

| Module                            | Real API/database suites under `scripts/`                                                         | Browser files under `tests/e2e/`                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| A Dashboard/navigation/search     | `local-api`, `notifications-api`, per-domain permission cases                                     | `dashboard`, `search`, `preferences`, `portal`                 |
| B Accounts/Auth/profiles          | `accounts`, `profiles`, `avatars` API/DB; actual invitation                                       | `accounts`, `onboarding`, `people`, `avatars`, `portal`        |
| C Topic/tool/language catalogue   | `taxonomy` API/DB                                                                                 | `taxonomy`                                                     |
| D Customers and contacts          | `operations-api`, `commission` API/DB                                                             | `operations`, `commission`                                     |
| E Courses/runs/sessions           | `operations-api`, `cbw`, `profiles` API/DB                                                        | `operations`, `cbw`, `people`, `calendar`                      |
| F Jobs/claims/capacity/lifecycle  | core `db-rpc`, `schedule-db`, `local-api`, `jobs-capacity`, `jobs-lifecycle`, `commission` API/DB | `portal`, `job-capacity`, `job-lifecycle`, `cbw`, `commission` |
| G Personal/global calendar        | core `db-rpc`, `schedule-db`, `availability` API/DB                                               | `calendar`, `portal`, `availability`, `dashboard`              |
| H Private/group/course chat       | `chat` API/DB with actual WebSockets/revocation                                                   | `chat`, `search`                                               |
| I Private scanned/versioned files | `documents`, `avatars`, `chat`, `commercial` API/DB                                               | `files`, `avatars`, `chat`, `commercial`, `search`             |
| J Personal contracts              | `commercial` API/DB; live qualification/contract claim prerequisites                              | `commercial`, `commission`                                     |
| K Wiki/forum                      | `knowledge` API/DB                                                                                | `knowledge`, `search`                                          |
| L Compensation/invoices/payments  | `commercial`, `commission` API/DB                                                                 | `commercial`, `commission`                                     |
| M Inbox/preferences/reminders     | `notifications` API/DB; domain deduplication cases                                                | `notifications`, `dashboard`, `job-lifecycle`                  |
| N Administration/audit            | `accounts`, `admin-audit`, `taxonomy`, `comments` API/DB                                          | `accounts`, `admin-audit`, `taxonomy`, `comments`, `portal`    |

SQL discovery includes every `*-db-tests.mjs`; API discovery includes every `*-api-check.mjs`. The core database runner and real Edge invitation run separately. HTTP tests use actual Auth-issued identities and genuine MFA, rather than trusting role metadata or faking RPC success.

The delegated-role extension also supplies `delegated-pricing-db-tests`, actual `welcome-api`/`welcome-db` checks and browser `roles-pricing`/`welcome-guide` journeys. Commission fixtures use explicitly fictional private policies and actor-bound consent tokens; production percentages are neither supplied nor inferred. The combined run must discover and execute these incoming suites together with this matrix. Accepted-history repricing must fail for that specific reason and leave the complete accepted deal and private revenue projection unchanged. Current exact-source results remain in the evidence ledger.

## Added lifecycle and boundary checks

Calendar workflows cover rejected nonexistent/ambiguous Berlin times and reversed intervals without writes; Brisbane instants/zones; real create/edit/delete/reload; disabled offline writes; other-lecturer and current-MFA administrator isolation; explicitly published global events and exact course navigation.

Aggregate search uses six real sources with permitted and forbidden records. It checks foreign DM/file/wiki-draft isolation, unpublished jobs, literal `%`, `_` and backslash queries, bilingual input preservation, URL/reload state, real result navigation, axe and mobile overflow.

Expanded API flows cover versioned bilingual knowledge categories, current-only search versus private revision history, forum edits/subscriptions and deduplicated durable notices; chat membership projections/revocation; private commercial people; verified/expired/revoked qualifications and contract expiry/reactivation affecting actual claims; client-request cancellation/retry, organisation boundaries and cancelled/published lifecycle refusal.

The browser-evidence guard has adversarial report fixtures and a genuine Playwright negative probe: a runtime-skipped suite normally exits zero, but complete acceptance rejects it; an actual focused suite is rejected by Playwright.

Independent CI also exposed the old board keyboard's fixed10px/100-arrow limitation on long mobile columns. The correction uses real dnd-kit sensor activation/collision/drop with semantic next/previous allowed columns and a visible destination. The real capacity workflow seeds16drafts, enforces a gap over1000px on mobile, checks boundaries/filled-column exclusion, Escape with zero mutations/unchanged version and exactly one server-confirmed drop. The correction passed full application and actual retained-image CI on signed1e72507; the earlier local pass did not override the intervening CI failure. Failed reduced reports retain actual passed/failed/skipped workflow identities/counts without raw errors or credentials.

## Limits and required continuation

Current automated browser acceptance is desktop/mobile Chromium emulation. It is not physical Android/iOS installation, Safari/Firefox, complete manual accessibility, production load, real external SMTP, legal/privacy certification or production deployment. A passed existing slice does not implement outstanding saved views, resource models, structured mentions, scheduled delivery, announcements, permission editing, retention or the other full-specification requirements. Every new function must extend its connected database/API/browser journey and pass a new combined run.

Actual counts and pass/fail history belong in [QA_RESULTS](QA_RESULTS.md) and [WORKLOG](WORKLOG.md).

Local frozen `b93b400` passed the complete command with exit0 on16November2026:78application and2built-PWA cases, all18native business API suites and234SQL cases, with no browser skips/retries. Actual visually inspected examples: [desktop search](screenshots/functional-desktop-search.png), [mobile search](screenshots/functional-mobile-search.png). Remote/remaining platform acceptance is tracked separately in the evidence ledger.
