# Availability and blocked periods

At `/availability`, lecturers, management and administration accounts manage their own time windows. The private calendar links to this view. **Available** is a planning hint; **Unavailable** prevents new overlapping job allocations. A blocked period does not alter existing confirmed assignments: a conflicting new blocked period is rejected instead.

Windows have precise instants, an IANA time zone, a private note and an explicit management-sharing choice. Sharing is off by default. Language changes preserve the form draft. Nonexistent or ambiguous local DST times are not silently normalised; when time fields remain unchanged during an edit, the original seconds and already determined offsets are preserved.

## Privacy and management

Even administrators cannot read other people's windows or notes directly from the table. The own-record RLS policy uses the current active account. The separate management view requires `availability.read_shared` and verified MFA. It returns only explicitly shared periods, status, time zone and the display name of a still-active lecturer account. It reads neither private appointments nor private notes. Withdrawing sharing affects subsequent server requests; the view offers an explicit refresh action.

The interface limits a view to 93 local calendar days and returns at most 500 own or 1,000 shared windows. Server-side time bounds are also finite and limited; a small UTC allowance accommodates the DST fallback. The own-record API additionally allows up to 366 days per request. Availability is not a binding course commitment; only the existing atomic job claim confirms an assignment.

## Transactions and preserved history

The additive migration `20261115210134_lecturer_availability.sql` follows the introduction of released historical allocations. Availability changes and active allocations use exactly the same lock order as job claims: the profile row with `FOR SHARE`, followed by the existing user-specific transaction advisory lock. Upgrading to `FOR UPDATE` within allocation would risk a deadlock and is avoided.

A new allocation trigger rejects overlapping **Unavailable** windows with `23P01`. The existing claim error path therefore rolls back the entire multi-day block, including earlier partial allocations. Conversely, the window trigger rejects blocked periods over confirmed, unreleased allocations. Cancelled and released intervals remain in history and do not block a new period. A release exits the trigger before new profile locks and adds no occupied time. Private calendar appointments are neither duplicated nor converted.

Creation uses a UUID retained in the form. An identical retry after a lost response does not create a second record. Editing and removal check a version number; foreign identifiers, stale changes and existing sessions of suspended accounts remain rejected. There is no optimistic booking confirmation.

## API and tests

- `my_availability(p_from, p_to)` reads only the actor's own windows.
- `shared_availability(p_from, p_to)` returns the reduced opt-in management projection.
- `save_lecturer_availability(p_id, p_payload, p_version)` creates with version `0` or edits an observed version. The payload contains only `kind`, explicitly offset `starts_at`/`ends_at`, `time_zone`, `notes` and `share_with_management`.
- `remove_lecturer_availability(p_id, p_version)` removes the actor's own observed version.

Public RPCs are invoker functions; privileged operations are in the private schema with an empty search path and explicit execution grants. Direct client write grants are not provided.

Eight actual temporary PostgreSQL test groups include concurrent job claiming against blocked-period creation, rollback of a multi-day block that fails only at its final session, adjacent intervals, cancellation history, MFA/foreign-access/note protection, versions, retries and suspension with existing tokens. Component and date tests add DST, exact unchanged instants, draft preservation and actual pending save responses. `scripts/availability-api-check.mjs` and `tests/e2e/availability.spec.ts` are intended for the isolated complete command; claim actual native/API/browser acceptance only from [QA_RESULTS](QA_RESULTS.md) and [WORKLOG](WORKLOG.md).
