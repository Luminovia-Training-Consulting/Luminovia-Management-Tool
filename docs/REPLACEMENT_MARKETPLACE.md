# Transactional replacement marketplace

This extension preserves the existing job/claim/calendar/chat/finance architecture. A lecturer or current MFA job manager may publish a reasoned replacement search for an existing confirmed, future, uninvoiced assignment. The original claim and every calendar allocation stay confirmed while the search is open. The private reason is visible only to that original lecturer and authorised management.

At `/replacements`, eligible lecturers see the entire block, original IANA time zone, their own current compensation quote and exact terms. Explicit consent binds all quote fields and session instants. Changing any of them clears consent. Open and selected-invitation modes and emergency marking are implemented. Selected invitations reject currently ineligible lecturers; eligibility is recomputed on every read and claim. No private appointment details, other lecturer's prices or contract records are returned.

## Atomic handover

`claim_replacement` locks both involved profiles/lecturers in a deterministic order, then the job, original claim and replacement. It checks current active roles, original allocation/version, complete future block, qualifications through the last session, applicable contract, calendar/private-event/unavailable-window conflicts and invoice history. The existing `private.claim_job` is the authoritative new-claim operation, preserving current quote/contract/revenue rules rather than duplicating those rules.

Within a database subtransaction, the original claim is cancelled and its allocation rows marked released, and the existing claim routine reserves every session for the replacement. Any unsuccessful result or exception rolls back that entire subtransaction. Successful handover also transfers lecturer-course and run-associated participant-course chat membership, which controls room materials, and changes current `job_after` document access through the existing confirmed-claim predicate. Accepted original prices, currencies, terms, revenue history, allocation rows and audit history remain intact. A replacement accepts a new immutable compensation snapshot.

Participant rooms have no job association; their `course_run_id` determines the
matching course. The transaction locks both relevant room kinds in room-ID order
before changing members. It revokes the old lecturer's participant membership
only when no other confirmed assignment in that run and no genuine enrolled or
completed enrolment remains. Removed enrolments and the cancelled source claim
retain no rights. The replacement receives membership, and room ownership moves
only when the previous owner was the old lecturer; another owner's role is
preserved. The same current-membership policy controls messages and room files,
including files originally uploaded by the removed lecturer.

The original vacancy deadline is temporarily removed inside the handover transaction and restored before commit. That historical recruitment deadline cannot make a new authorised replacement impossible; the entire block must still be in the future. The ordinary publication notifier is deferred and evaluates final committed job state. An unchanged filled job is never exposed as an available vacancy outside this transaction.

Exactly repeated actor/request inputs return the same successful result. Reusing a key for other inputs rejects. The whole-block database claim, constraints and actor locks remain the final guards against concurrent winners, duplicate calendars and booking conflicts. The public wrappers use SECURITY INVOKER; private RLS-enabled tables have no browser table grants. Minimal inbox targets recheck current authority; no real email is sent by this module.

## Boundaries still required

Already started, partly completed or invoiced work is explicitly refused and sent to contractual/financial review. This is a deliberate incomplete part of the full requested marketplace: partial delivery needs an approved amendment allocating remaining sessions and compensation, not guessed prorating or overwritten accepted fees. Waitlists, directed substitute invitations and external notification channels belong to the independently owned smart-operations source; they must be preserved and jointly verified when integrated. The UI states this module's limits. Management cannot use the marketplace to bypass eligibility or assign a lecturer without that lecturer accepting the current offer.

The role-pricing compatibility path calls the inspected private `role_net` / `role_quote_version` helpers only when a captured `role_split` offer exists. Legacy net-only jobs keep their existing quote. The independently owned pricing PR must pass integrated exact-source tests before this compatibility is claimed accepted. No business percentages are added to public source or defaults.

## Evidence

`PORTAL_DB_CONTAINER=supabase_db_luminovia-portal-test-extensions-20261116 node scripts/replacements-db-tests.mjs` passed **13 real PostgreSQL groups** in randomly named disposable databases with no published network ports. Tests cover ownership/MFA/suspension, no release at publication, private reasons, exact retries, two concurrent claimants, immutable original agreement, complete calendars/chat, current conflicts/expired or revoked qualifications/contracts, selected invitations, cancellation CAS, injected handover failure rollback, stale terms, started work, old recruitment deadlines and concurrent original cancellation.

`npm test -- src/features/replacements` passed **4 component/business tests** for bound consent, real server-result handling, stable retries and offline/English rendering. The whole-source checkpoint passed 257 tests and the unchanged coverage gates (52.04% statements, 47.09% branches, 42.28% functions, 53.86% lines). These are focused source results, not browser/backend acceptance.

The actual Auth/HTTP test is `scripts/replacements-api-check.mjs`; browser DE/EN/dark/axe/mobile and real online handover are in `tests/e2e/replacements.spec.ts`. They are authored and remain pending until the canonical `./portal test` and exact PR CI are observed passing. Shared local QA ownership must be respected. No merge, development VPS installation, production approval or physical PWA acceptance follows from the source checkpoint alone.

The access-composition correction passed all 13 existing replacement SQL groups
and zero-warning/error body diagnostics for 30 operational implementations.
`scripts/support-replacement-access-db-tests.mjs` passed 24 actual SQL groups:
eight each for current main plus operations, a stricter predecessor fixture, and
the chronological union with exact PR17 source
`00eaa5249a163618887f72683da362e785a5957f`. Each mode verifies raw message RLS,
protected chat history, document metadata and clean-version reads before and
after handover; sole assignment, another same-run assignment, enrolled/completed
enrolment and removed enrolment; source/recipient/outsider separation; owner
transfer; retained immutable original terms; complete calendars and exact retry.
Only disposable databases in the explicitly owned networkless fixture are used.
These SQL checks do not replace native Auth, HTTP/Storage-byte, browser or full
combined acceptance.
