# Attendance and proof of teaching delivery

The workflow is present in accepted main's published migration `20261116121600_attendance_delivery.sql`, with its frontend, actual API fixtures and desktop/mobile journeys. Focused evidence below describes its original source checkpoint; current complete execution is recorded in [QA_RESULTS](QA_RESULTS.md) under the [functional acceptance contract](FUNCTIONAL_ACCEPTANCE.md). Source merge does not establish hosted installation or production acceptance.

## Daily workflow

At `/delivery`, a lecturer opens an assigned session, records actual start/finish instants in its intended IANA time zone, selects complete, partial, cancelled or interrupted delivery and saves a draft. Partial delivery, cancellation and interruption require explanatory notes. A cancelled session has no delivered interval. Actual intervals must be finite, ordered and no longer than 24 hours. The frontend rejects ambiguous/nonexistent DST wall times; the database requires explicit offsets and retains the intended zone.

The lecturer reviews the saved draft and explicitly submits it. Unsaved form edits disable submission so the screen cannot submit a different previously saved value without notice. Completed/partial/interrupted evidence cannot be submitted before its scheduled session begins or with an actual finish in the future. A cancellation may be reported before the scheduled date. No offline mutation is queued or displayed as successful.

Management selects its management overview to see missing and submitted evidence across assignments and compare scheduled with delivered minutes. A current course/finance manager with MFA can confirm, dispute or request correction. The reviewer cannot approve their own teaching evidence. Disputes/correction requests require explanations. Lecturer corrections carry a new reason and create a new immutable revision on submission. Prior submissions, review events and customer acknowledgements remain available in history.

An explicitly assigned customer representative may choose the customer confirmation view and confirm the latest management-confirmed revision for their organisation. Their projection omits draft fields, lecturer notes, correction explanations, internal review notes and invoice identifiers. A removed organisation membership or an unconfirmed newer correction removes that customer access immediately on the next server read. Confirmation of an old revision never automatically confirms the replacement revision.

## Data and permissions

The additive `attendance_delivery` migration creates four RLS-enabled private tables with no browser table grants:

| Record                         | Purpose                                                                                                      |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `private.delivery_records`     | Session identity, current workflow state, CAS version and editable unsubmitted draft                         |
| `private.delivery_submissions` | Immutable lecturer-authored numbered evidence, actual interval/zone and original scheduled interval snapshot |
| `private.delivery_events`      | Immutable submission/review/customer events, actor and timestamp with appropriate explanations               |
| `private.delivery_operations`  | Immutable actor/request receipts for exact idempotent retries                                                |

The existing `assignment_sessions → job_claims → jobs → course_runs` relationships determine ownership and customer scope. Browser-supplied user or role IDs never establish authority. Submitted evidence can be read by its lecturer even if the old assignment is subsequently cancelled/released; only their current confirmed unreleased assignment can receive a new draft/submission. Revoked or suspended actors cannot read or mutate delivery records. Current `courses.manage` or `finance.manage` and AAL2 determine management access; support permissions confer no such access.

All writes lock the claim and session and compare the expected record version. Concurrent first drafts/reviews have one winner. Idempotent response-loss retries return their original result, while a request key reused for different values is refused. Current authority is checked before returning a stored receipt. Immutable-evidence triggers prevent replacement or deletion of prior submissions/events/receipts even by ordinary direct SQL writes. New business operations never disable those triggers.

## SQL API

| RPC                                                                                 | Behavior                                                                                                 |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `delivery_sessions(p_scope, p_before_at, p_before_id, p_limit)`                     | Cursor-paged own, MFA management or organisation-scoped customer projection; explicit `has_more`         |
| `delivery_session(p_session_id)`                                                    | Exact currently authorized detail, including older notification deep links                               |
| `delivery_history(p_session_id)`                                                    | Revision and event history, redacted for customer representatives                                        |
| `save_delivery_draft(p_session_id, p_expected_version, p_payload, p_request_id)`    | Validated draft; payload contains outcome, actual_start, actual_end, time_zone, notes, correction_reason |
| `submit_delivery(p_session_id, p_expected_version, p_request_id)`                   | Freeze current saved draft in a new numbered submission                                                  |
| `review_delivery(p_session_id, p_expected_version, p_action, p_note, p_request_id)` | Independent confirm, dispute or request_correction decision                                              |
| `confirm_customer_delivery(p_session_id, p_expected_version, p_request_id)`         | Explicit confirmation of current management-confirmed submission                                         |

Public RPCs are invokers around isolated, empty-search-path private authority functions; anonymous execution is revoked. Protected tables are not exposed as an alternative write path. Invalid inputs/transition/idempotency conflicts use `22023`, denied access `42501` and stale versions `40001`. UI validation/errors, status/actions, screen-reader names and export headers are authored in German and English.

## Cross-module integration

The UI links the existing assignment and, when already present and authorized, its active invoice. The delivery feature does not generate invoices or modify accepted fees, original currency, tax, claim terms, invoice PDFs or payment history. An invoiced claim can retain additional corrected delivery evidence while its accepted invoice stays byte-identical. Any financial amendment remains the explicit commercial workflow's responsibility.

Submitted and reviewed evidence creates minimal committed inbox notifications and audit entries without copying private notes. `private.delivery_notification_target()` resolves event destinations under current permissions; the shared notification resolver must include it. SMTP delivery remains subject to the separately owned notification-outbox/provider setup, never inferred from insertion of an inbox row.

The CSV export reuses existing formula-safe serialization and includes the visibly loaded authorized session records, original canonical timestamps/zone, minutes and status/revision codes. Its text explains pagination; it does not falsely call a partially loaded list a full-period export. API responses, history and CSV contain no compensation amounts. No private delivery response is added to the PWA's public app-shell cache.

## Acceptance and continuation

Executed focused checks: `npx vitest run src/features/delivery` passes **7 tests across 2 files**; TypeScript and scoped ESLint pass. The owned networkless/no-published-port PostgreSQL container and UUID database pass **12 real groups** after the invoice linkage check, covering direct/anonymous/foreign denial, malformed fields, exact retry, immutable submissions, independent MFA review, concurrent CAS, customer isolation/revocation, explicit corrections, cancelled/interrupted delivery, stale versions, pagination, future evidence, suspension, historical access and preserved invoice/accepted AUD terms.

Commands:

```bash
PORTAL_DB_CONTAINER=supabase_db_luminovia-portal-test-extensions-20261116 node scripts/delivery-db-tests.mjs
npx vitest run src/features/delivery
npx tsc -b
npx eslint src/features/delivery scripts/delivery*.mjs tests/e2e/delivery.spec.ts --max-warnings 0
```

`scripts/delivery-api-check.mjs` exercises actual fictional Auth/MFA/REST submission, concurrent review, customer redaction, correction history and inactive-token denial. `tests/e2e/delivery.spec.ts` exercises saved-draft submission, independent correction/review, original revision history, DE/EN, dark mode, keyboard CSV export, axe and horizontal-overflow checks on both configured browser projects. Those scripts are authored, not reported as executed by the focused SQL/unit results. The canonical runner's shared lock must be respected; no foreign stack may be stopped to acquire it.

Remaining gates: exact combined `./portal test`, actual native retained-data/security CI, independent review, eligible merge and merged-source verification. Physical PWA platforms, other browsers and manual accessibility acceptance remain separate product-wide checks. Evidence identifies freelance teaching delivery; it does not assert employment, tax treatment or legal signature sufficiency.
