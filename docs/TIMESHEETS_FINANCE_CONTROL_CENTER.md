# Actual teaching time, financial facts and Control Center

Migration `20261116091017_timesheets_finance_and_control_center.sql` adds a private teaching-time ledger, printable financial facts and capability-scoped operational projections. The frontend routes are `/timesheets` and `/control-center`; every string supports German and English. Author-written notes and agreement text retain their authored language.

## Teaching-time workflow

Lecturers record completed actual teaching intervals inside their own confirmed, unreleased assignment sessions. Times are explicit instants, interpreted in the displayed account IANA zone; nonexistent or ambiguous local DST times are rejected in the form. Break minutes are integral and leave positive net teaching time. A session has one timesheet and active time intervals cannot overlap, including across assignments. Actual time never reprices an accepted compensation snapshot.

Saving uses a client-generated UUID and expected version, with identical lost-response creation retries handled idempotently. The lecturer submits a draft. Financial review requires current `finance.manage` plus MFA and may approve or reject a submitted version. Submitted and approved versions cannot be directly edited. An approved correction requires an explicit financial-review action and reason; the earlier approval remains in append-only history before the owner creates a corrected draft. Any invoice-item history freezes further time changes, including cancelled/inactive invoice history. The existing lecturer mutex serializes this with invoice creation.

The UI preserves conflicting input, offers an explicit refresh, waits for server confirmation and disables writes/downloads offline. The history view shows recorded before/after states and review notes. Fresh authorised CSV downloads use the existing formula-safe exporter. Assignment-confirmation and earnings-statement PDFs use the protected document Edge function, with a current-identity check before download; they are not browser print placeholders. Approved time is supporting invoice evidence. Invoice preparation continues to use the unchanged accepted compensation.

The public APIs are:

- `timesheets(p_from date, p_until date, p_all boolean default false)` → `{time_zone, can_review, items, sessions}`. Own scope is the default; all-lecturer scope requires current financial permission and MFA.
- `save_timesheet(p_id uuid, p_payload jsonb, p_expected_version integer default 0)` → the confirmed row. Exact payload: `{session_id, starts_at, ends_at, break_minutes, note}`; actor and state fields are rejected.
- `manage_timesheet(p_id uuid, p_action text, p_expected_version integer, p_request_id uuid, p_reason text default '')` → the confirmed row. Actions: `submit`, `approve`, `reject`, `request_correction`.
- `timesheet_history(p_id uuid)` → owned or currently authorised financial history.

All periods use `[from, until)` in the current account zone and are finite, with a maximum of 93 calendar days. Oversized time/statement results fail explicitly and require a shorter period; financial totals are not silently truncated. Direct private-table access is revoked and RLS is enabled as defence in depth. No user-editable metadata confers financial permission.

## Printable facts and financial scenarios

`assignment_confirmation(p_claim_id uuid)` and `finance_statement(p_from date, p_until date, p_all boolean default false)` return `{data, hash}`. The SHA-256 hash covers deterministic canonical JSON facts, excluding changing generation timestamps. Assignment facts include the exact accepted original-currency compensation/terms and retained sessions/status. Own financial statements contain only the caller's accepted net deals, current invoice status, approved minutes and currency-separated totals. The statement period selects assignments by their first session; payments are the current recorded amounts associated with those assignments, not a fabricated period cashbook.

Recorded invoice payments are allocated across their claim items in exact original-currency cents using a deterministic largest-remainder allocation. The allocation totals match the actual payment ledger without independent-rounding drift. They do not represent customer receipts into Luminovia's bank account.

`finance_forecast(p_from date, p_until date, p_pipeline_probability numeric default 0)` requires current financial permission and MFA. Its monthly buckets separate accepted lecturer costs, known accepted gross/margin, unknown gross claims, probability-weighted open offer costs/gross and recorded lecturer invoice payments. Gross values, margins and unconverted customer-request amounts require the additional current `finance.gross.read` capability. The probability is an explicit scenario assumption from zero to one, not a company commission rule or a booking commitment. Original currencies are never silently converted; legacy gross values are not invented.

## Operational projection

`control_center(p_from date, p_until date)` requires current `jobs.manage` plus MFA. It returns bounded, date-filtered lists of unstaffed offers, missing clean teaching materials, recent cancellations/handovers, currently readable overdue tasks and customer-request metadata. Contract and qualification expiry data require their separate explicit capabilities. Course preparation and aggregate quality require course management; averages stay hidden below three feedback responses. Private tasks and revoked/private message-derived tasks remain protected by the task's current owning authorisation helper.

The UI includes actionable links to jobs, tasks/history, contracts, qualification profiles, course workspaces and the administrative audit. Each operational list displays at most 200 records and asks users to narrow the period when necessary. Financial scenarios use an accessible table and explicit probability control; privileged gross columns are omitted when not authorised.

The review notification kind is `timesheet_reviewed`, under reminder preferences. `private.timesheet_notification_target(uuid)` resolves only an owned or explicitly financial-authorised row and creates a date-scoped internal `/timesheets` link in the recipient's current IANA zone. External delivery stays generic.

## Evidence

Fourteen native PostgreSQL groups passed for exact own-session fields, real concurrent CAS, idempotent submission, MFA review, protected approval/correction history, invoice-history freeze, unchanged compensation, stable owned facts/hashes, exact-cent payment allocation, independent no-overlap enforcement, probability-weighted future costs, three-response quality thresholds, gross/currency separation and Control Center private-task isolation. Seven meaningful frontend cases passed for real confirmation timing, protected submitted state, conflicting review input, owned PDF requests, scenario controls, permission gating and period validation. The actual REST/MFA suite and desktop/mobile DE/EN/axe/PDF workflow are defined in `scripts/timesheets-finance-api-check.mjs` and `tests/e2e/timesheets-finance.spec.ts`; their full isolated execution is a separate acceptance gate. No production installation, real mail, accounting/tax certification or bank integration is implied by source checks.
