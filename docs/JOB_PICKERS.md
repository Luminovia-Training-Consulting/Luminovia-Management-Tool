# Purpose-scoped offer and course choices

The file upload and participant-channel dialogs use one bounded, server-side
picker. They no longer load the first 1,000 complete jobs, sessions and
requirements. The marketplace has its own separate discovery contract; its
lecturer eligibility is not the authority for an administrative file/course task.

## Connected UI behavior

- Ordinary file browsing and personal uploads start no privileged picker query.
  With current `jobs.manage`/MFA, choosing before-/after-claim material opens the
  offer picker. Search applies explicitly; **Load more choices** requests one more
  page. The existing file uploader appears only after the server resolves the
  exact selected job in the authorized response. MIME checks, quarantine, actual
  scanning, clean bytes, quotas, retry identity and download policy remain in the
  existing [file pipeline](FILES.md).
- Creating a topic chat starts no offer query. Switching to a participant channel
  with current `courses.manage`/MFA opens the course picker. Each linked course run
  appears once even if it has several historical offers. Labels use authorized
  course-template title, run organization, first course session and explicit
  IANA zone, with a short run reference. An unscheduled run is labeled honestly.
  Hidden job descriptions, customer quote fields and fees are not projected or
  searched by this purpose. The representative value remains a real job UUID for
  the existing `create_chat_group(p_job_id)` API; the resulting participant room
  has the real `course_run_id` and no commercial `job_id` link.
- A search preserves an already selected permitted value explicitly outside its
  result page. It does not silently select the first match. Exact selection is
  resolved in the same request, without a separate RPC per option. An older job
  binding for a run does not produce a second course choice.
- A `42501` response hides the options and connected operation immediately and
  stays hidden through later network failures until an authorized refresh succeeds.
  Ordinary transport errors preserve an existing operation draft. No private
  picker data are persisted in browser storage. Upload/group mutations still
  revalidate their own current permissions and report success only after commit.

Pure client/learner accounts have no privileged picker query. A separate explicit
capability can authorize a purpose without granting lecturer-marketplace access;
this does not grant job detail, fee or private-room access. Existing actual action
constraints, including eligible group members and one participant channel per run,
remain authoritative. Selection does not reserve an offer or alter a claim.

## API and database

The additive CLI-created migration is
`20261116080741_scoped_administrative_job_pickers.sql`. All previous 29 migration
sources are preserved. Other M8 feature migrations remain separate.

`job_picker(p_purpose,p_search,p_cursor,p_limit,p_selected_id)` returns:

```json
{
  "items": [
    {
      "id": "real-job-uuid",
      "title": "Authorized offer or course title",
      "customer_name": "Authorized customer or run organization",
      "course_run_id": "course-run-uuid-or-null",
      "starts_at": "first-session-instant-or-null",
      "time_zone": "Europe/Berlin"
    }
  ],
  "has_more": true,
  "next_cursor": {
    "at": "timestamp",
    "id": "sort-uuid",
    "fingerprint": "hash"
  },
  "selected": null
}
```

This is an illustrative shape; actual UUIDs/instants are validated. Closed purpose
`job_attachment` requires `jobs.manage`/MFA and includes existing jobs independently
of lecturer claim eligibility or publication state, matching upload registration.
`participant_course` requires `courses.manage`/MFA and includes only runs with a
real job binding. It returns course metadata, not a commercial job DTO. It adds
no silent published/nonarchived filter that the existing channel action lacks.

Search is literal, case-insensitive and at most 160 characters. `%`/`_` are text.
The UI requests 40 rows; the API permits 1–100. Cursor fingerprints bind purpose
and search. Stable order is job `(created_at,id)` descending for file choices,
course-run `(created_at,id)` descending for course choices. The earliest existing
job provides the latter's compatibility binding; later duplicate offers do not
create more course rows. Each page rechecks current rights and is not a frozen
multi-request database snapshot.

Indexes support job/run cursors, representative job lookup and first course
session lookup. Schedule projection is limited to returned choices and one
selected item; whole session lists are not returned. Public invoker RPC calls a
scoped private implementation with empty search path and explicit authenticated
execution grants. The internal candidate helper revokes PUBLIC/anon/authenticated
execution. Browser actor IDs and editable metadata confer no authority. Existing
`reserve_document`, `create_chat_group`, marketplace discovery and online whole-
block claim interfaces are unchanged. The unused legacy `jobsQuery` export was
removed after its final two production callers were replaced.

The administrative Kanban remains independently limited to its newest 500 offers,
with its existing DE/EN notice. It still needs its own paging/status-transition
model; this picker does not add per-card queries or claim through drag-and-drop.

## Verification and remaining acceptance

Focused executed checks use separate UUID databases in the explicitly owned,
network-disabled scratch container. Six PostgreSQL groups passed, including
1,062 equal-timestamp jobs, 1,057 distinct course runs, representative selection,
literal/cursor bounds, strict purpose permissions/MFA, no commercial projection,
first-session/IANA metadata, existing upload/channel API binding, duplicate-channel
refusal, current suspension/role withdrawal and private helper/anonymous ACLs.
Nine picker component/API-contract cases and the combined 55-case picker/file/chat
focused run passed. The generic API-surface suite also passed all six checks,
including actual frontend RPC binding, RLS, anonymous grants and empty definer
search paths. Final native combined acceptance belongs to the root QA record.

`scripts/job-picker-api-check.mjs` authors actual Auth/MFA/REST cap and purpose
checks, selected upload reservation and participant channel creation. A reservation
is quarantined metadata, not a claim that bytes were scanned. The two discovered
desktop/mobile cases in `tests/e2e/job-pickers.spec.ts` additionally author a real
scanned upload, paging, course deduplication, DE/EN, dark mode, axe, viewport fit
and ordinary-account query exclusion. These native API/browser cases have not yet
run for M8. Existing M7 acceptance does not cover this migration. Record the final
canonical and retained-data results in [QA_RESULTS](QA_RESULTS.md) and
[QA results](QA_RESULTS.md); no production or external delivery is claimed here.
