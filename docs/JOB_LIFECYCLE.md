# Jobs: lifecycle, lecturer positions and board

This module connects publication, whole-block acceptance, cancellation, reopening,
commercial reporting and course-chat membership. PostgreSQL authorizes every
change. A browser drag, selection or pending HTTP request never confirms a teaching
assignment.

## Offer and assignment states

An offer has `draft`, `published`, `filled` or `archived` status. Each accepted
lecturer position has a separate immutable `job_claims` snapshot and one
`assignment_sessions` row per session. The offer status describes remaining
vacancies; it does not revoke the other confirmed lecturers.

- Management with `jobs.manage` and verified MFA can create/publish/unpublish,
  edit and archive offers before any acceptance. Edits use the reviewed lifecycle
  version; a concurrent update rejects the stale request with `40001`.
- Metadata editing covers title, description, location, terms and claim deadline.
  Term changes use the existing terms-version trigger and require fresh consent.
  Session/date restructuring belongs to course planning or a new offer. No API
  silently rewrites accepted dates, currency, fees or contract/terms snapshots.
- A safe duplicate creates a new unpublished course run and fresh sessions,
  copying the source building-block reference and required qualifications.
  It copies no claims, documents, invoices, contracts or chat members. Copying
  course-backed jobs requires `courses.manage`; copying a gross-priced offer
  additionally requires gross-finance access. Past dates require a new plan.
- Offer creation/edit/reopening has an optional finite future claim deadline,
  no later than the first session, interpreted in the displayed IANA time zone.
  Empty means no claim deadline. There is no scheduled-publication worker.

## Explicit per-position pricing

New standalone administrator offers support **1–20 lecturer positions**. Each
quoted rate and total applies to one lecturer for the entire offered block. For
example, gross EUR 100.01 with three positions has maximum customer budget
EUR 300.03. At the default 50% platform share, the existing platform-first cent
rounding produces EUR 50.01 platform / EUR 50.00 lecturer for each accepted
position. Accepted rows retain their own exact rounded amounts.

`capacity_basis='per_position'` records this explicit meaning. All existing offers,
customer requests and course-originated offers retain
`capacity_basis='single_position'`, capacity one, and their original budget.
Existing customer totals are never multiplied retroactively. A new standalone
one-position offer also uses the explicit per-position basis.

Capacity can be changed with a version check only on explicit per-position offers
that have never been accepted. Fees remain per position; the maximum budget
preview changes. Financial reporting counts each course once, sums the active
accepted ledger rows, and lists all currently assigned lecturers. Historic
cancelled ledger rows remain immutable and are excluded from current assignment
spend. Original currencies are kept separate.

## Atomic acceptance

`claim_job` keeps its existing arguments and default single-position behavior.
Under an active profile shared lock and per-lecturer advisory lock, it locks the
job, checks remaining capacity, expertise/verification validity, required personal
contract, accepted terms version and every session. Existing personal appointments,
unavailable windows and active assignments block overlaps; management has no
private-calendar bypass.

A lecturer can hold at most one active position in a job. Every session is
reserved in one transaction or none is. A unique partial index protects the
job/lecturer pair, a capacity guard serializes accepted rows, and a partial
PostgreSQL exclusion constraint protects active calendar intervals. The offer
stays published until the last position is accepted. New attempts after it fills
return `filled`; attempts by an already assigned lecturer while positions remain
return `already_assigned`.

Idempotency keys belong to an operation. Retrying a previously confirmed key after
cancellation returns that cancelled historical claim, never a new confirmation.
The UI retires a successful claim key and derives confirmation from actual current
claims, allowing a new claim after an explicit reopening without a page reload.
A lost-response retry retains its original key.

## Cancellation and replacement

An active lecturer can cancel their own future assignment. A manager with
`jobs.manage` and MFA can cancel an authorized assignment. The reason is required
(5–1000 characters), and the whole block is cancelled together. Started blocks and
**any** invoice-item history are refused and require a separate financial review.
This workflow records no bank payment, refund or credit note.

Cancellation:

1. Marks the claim cancelled without changing its accepted money/terms snapshot.
2. Retains session rows and sets `released_at`, removing those intervals from
   future conflict checks and calendar allocations.
3. Moves the vacancy to draft. Other confirmed positions remain confirmed.
4. Removes the cancelled lecturer's course-chat membership. If they owned the
   room, another active, non-revoked confirmed member becomes owner; otherwise ownership is empty. A separately assigned management owner remains unchanged.
5. Records the cancellation reason in the audit log, a claim event and an in-app
   notification. The actor/request ledger makes exact retries idempotent.

Management explicitly reopens the remaining future position(s) with a reason and,
if needed, a refreshed/cleared deadline. A qualified replacement must claim online
under the same all-or-none checks. Each genuine audited reopening renews the single
optional in-app notice for previously cancelled lecturers: it becomes unread with a
fresh timestamp. Retrying that same completed request does not renew it again;
disabling optional job updates suppresses renewal. There is no automatic substitute selection or
administrator drag-to-confirm shortcut. Accepted resource/history read access
remains according to existing job policies; cancellation is not a general erasure
of legitimately accepted records. Private contracts/messages/calendar entries do
not gain broader administrator access.

Invoice submission now takes the same lecturer advisory lock before checking
confirmed claims and inserting invoice items. This closes the demonstrated race
where an invoice and cancellation could both commit against the same assignment.

## Board and API integration

The administrator board uses pinned `@dnd-kit/react` and `@dnd-kit/dom` 0.5.3,
localized announcements/instructions, pointer and keyboard controls, and a normal
status selector. Only never-accepted offers register as draggable. `filled` is a
read-only column. All changes call the versioned publication RPC; accepted and
cancelled history must be managed in the detail view.

`job_board()` fetches one bounded batch (latest 500), including title, status,
version and authorized aggregate position counts. Cards make no independent
requests and add no polling. Job mutations invalidate affected query families,
not every profile/document/wiki query in the application.

Public RPCs use authenticated invoker wrappers; the scoped private implementations
have an empty search path and explicit execution grants. Authentication comes from
`auth.uid()` and database permissions, never a caller-supplied role/user ID.

| RPC                                                                                           | Purpose                                                                                                                                           |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `job_lifecycle(p_job_id)`                                                                     | Authorized version, actions, position counts and own/managed claim history. Other lecturers' identities are not exposed through aggregate counts. |
| `manage_job_offer(p_job_id,p_action,p_expected_version,p_request_id,p_payload)`               | Versioned `draft`, `published`, `archived`, `edit`, `duplicate`, `reopen`; reopening requires `reason`.                                           |
| `cancel_job_assignment(p_claim_id,p_reason,p_request_id)`                                     | Audited own/authorized whole-block cancellation.                                                                                                  |
| `create_capacity_job(p_payload,p_capacity,p_request_id,p_organisation_id,p_platform_percent)` | Explicit new per-position standalone offer; the UI defaults to one position and the API platform share defaults to 50%.                           |
| `set_job_capacity(p_job_id,p_capacity,p_expected_version,p_request_id)`                       | Change explicit new offer capacity before acceptance.                                                                                             |
| `job_board()`                                                                                 | MFA-protected management board batch.                                                                                                             |

The legacy `set_job_status` remains for compatible never-accepted publication
changes. It cannot reopen cancelled work or bypass immutable history.
`commission_report` appends capacity; `client_requests` appends the
`assigned_lecturers` array while preserving the original first-lecturer scalar
fields for old API consumers.

## Migration and verification

The additive migrations are `20261115203956_job_lifecycle_audit.sql` and
`20261115210814_job_capacity_and_board.sql`. Delivered earlier migrations are
unchanged. They replace the active assignment exclusion constraint, single-slot
claim index and scoped RPC projections. An operator must review migration effects
and backups before any separately authorized hosted rollout. No production data
or hosted configuration was changed by this implementation.

Focused checks actually passed in a disposable PostgreSQL 17 database:

- `PORTAL_DB_CONTAINER=<owned-test-container> node scripts/jobs-lifecycle-db-tests.mjs`:
  12 groups, including repeated-reopening notification renewal/retry/preferences,
  a 50-way reopened single-position race, immutable accepted
  snapshots, exact idempotency, resource release, deadline/CAS and controlled
  invoice-vs-cancellation interleavings in both orders.
- `PORTAL_DB_CONTAINER=<owned-test-container> node scripts/jobs-capacity-db-tests.mjs`:
  8 groups, including usable owner re-election/management-owner retention and 50 concurrent requests for three positions (three distinct
  lecturers / six session allocations), duplicate-actor protection, private
  conflicts, budget/course counting and retained replacement ledgers.
- `npx vitest run src/features/jobs/lifecycle.test.tsx src/features/jobs/board.test.tsx src/features/commercial/commission-api.test.ts`:
  14 unit/component tests for server confirmation, failed-response keys,
  reviewed versions, translations, offline controls and per-position totals.

The SQL invoice fixture verifies transaction behavior using fictional clean PDF
metadata; it does not claim to scan actual bytes. The canonical commercial API
suite owns real upload/scanner acceptance.

`jobs-lifecycle-api-check.mjs`, `jobs-capacity-api-check.mjs` and Playwright
`job-lifecycle.spec.ts` / `job-capacity.spec.ts` are wired into the canonical
isolated suite. Their actual native/browser result is recorded by the combined
acceptance run in QA results; authored tests alone are not acceptance evidence.
The browser cases cover a lecturer page staying mounted through cancellation and
reopening, actual board input controls, partial capacity, DE/EN, dark mode and
mobile/desktop accessibility. Run the supported `./portal test` entry point for
complete native Auth/API/browser validation; do not point fixtures at development
or production data.

The complete product checklist remains in `ROADMAP.md`. This module
does not declare saved marketplace filters, automatic substitute selection,
scheduled publication, complete advanced marketplace filtering or all platform
production acceptance complete.
