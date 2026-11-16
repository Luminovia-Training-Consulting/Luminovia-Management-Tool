# Find jobs and save private views

The `/jobs` marketplace searches on the server and loads 50 results at a time. **Load more jobs** fetches the next page. It does not collect a complete catalogue in the background or raise the global 1,000-row Data API limit. The interface shows the number actually loaded; it calls the current search complete only when no next page remains.

The former `jobsQuery` loaded an unpaginated table and then filtered in the browser. `supabase/config.toml` limits those responses to 1,000 rows. The native API check reproduces that limit with 1,057 owned offers before reading the same authorised inventory completely through the new API. Authored checks and actual native acceptance are documented separately in [QA_RESULTS](QA_RESULTS.md) and [WORKLOG](WORKLOG.md).

## Using and understanding filters

Enter the desired values and choose **Apply filters**. Typing alone does not trigger another job query. Filters remain copyable as URL parameters and can be reopened through normal browser navigation.

- Search and customer text are compared literally and case-insensitively. `%`, `_` and brackets are text, not search operators. Search also covers labels/aliases of linked expertise topics.
- Multiple topics, tools or programming languages mean that an offer must require all selected identifiers. Existing archived selections remain recognisable; new selections use active catalogue entries.
- Calendar dates use the explicitly chosen IANA zone. At least one actual session must overlap a selected local calendar day. An unscheduled gap between day 1 and day 10 does not match. A session crossing midnight can match both actually occupied days. Day boundaries are calculated by zone rather than as fixed 24-hour intervals.
- Teaching duration is the sum of actual session intervals, including fractional minutes. It is not the elapsed period from the first to the last course day.
- Money bounds and sorting require an original currency. Unit prices also require a fee unit. EUR/AUD or hourly/daily rates are not silently compared or converted. Public amounts remain lecturer compensation per position, not a gross/platform projection.
- **No conflicts in my calendar** checks only the actor's own private events, active allocations and blocked periods. Free published future positions with an open claim deadline must also exist. A positive result reserves nothing. Qualification, contract, terms and all current conflicts are still checked only by the atomic claim.

Sorting supports newest/oldest creation in the inventory, next start, title, teaching duration and explicitly comparable total/unit fees. Every sort uses the job UUID as its unique second key. Equal timestamps or amounts therefore do not produce an indeterminate page order.

## Private saved views

**Save applied filters** stores the currently applied URL search under a chosen name. Unapplied form inputs are not silently included. Select a saved view to load its filters and sorting into the URL and form. **Rename view** changes its name; **Remove view** removes only that personal filter selection.

Views persist in PostgreSQL, at most 20 per account. Reloading or signing in again does not remove them. Other accounts and ordinary administrative permissions do not open another person's views. A version conflict remains visible and cannot overwrite a newer state. Reload the current view list and review the selection again. An identical creation retry after a lost response uses the same UUID and creates no second view. These writes are disabled offline.

Filters are stored as closed, type-checked JSON. Browser roles, user identifiers, unknown fields or alternative gross amounts provide no additional filtering permissions. A saved filter expands neither job nor calendar access. Current roles/account suspension are checked on every API request; client-only/participant-only accounts do not load lecturer jobs or saved lecturer views here.

## Connections and preserved interfaces

The detail view queries exactly the requested permitted UUID. An older job therefore remains accessible through its link even if absent from the former unpaginated 1,000-row response. M6 claiming, terms acceptance, idempotency, capacity and cancellation/reopening history remain unchanged. The existing 24 migrations were not edited for this work.

The dashboard receives complete authorised counts and at most two job suggestions from its own aggregate query. It does not confuse a small preview with the total count. Own allocation counts and at most five upcoming-session metadata records also come from that query. Management counts are returned only with current management permission. The dashboard does not request a lecturer overview for client-only/participant-only accounts.

The calendar fetches only permitted titles for the actor's own confirmed allocations. Without own allocations, it starts no job-title query. It does not load the marketplace to label old sessions. This grants neither foreign titles nor private calendar entries, including to administrators. Global courses and private-event editing remain separate existing workflows.

The M8 source replaces the former file/chat job selectors with a [dedicated purpose-bound paginated search](JOB_PICKERS.md). It uses actual upload or course-chat permission and loads no full marketplace records. Native M8 acceptance must still be demonstrated separately. The administrative M6 Kanban remains explicitly limited to the newest 500 offers and discloses that limit; older permitted offers can be edited through search and details.

## API and database

Migration: `20261116022732_job_discovery_and_saved_views.sql`.

| Public RPC                                                | Purpose                                                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `job_discovery(p_filters,p_cursor,p_limit)`               | Up to 100 authorised offers, `has_more`, next-page cursor and canonical filters in a bounded JSON response. |
| `job_detail(p_job_id)`                                    | One permitted job with sessions, requirements and aggregate position counts.                                |
| `job_dashboard()`                                         | Authorised counts, two suggestions and bounded own upcoming allocations.                                    |
| `assignment_job_titles(p_job_ids)`                        | Only titles of own confirmed allocations, at most 1,000 requested identifiers.                              |
| `saved_job_views()`                                       | At most 20 own versioned views.                                                                             |
| `save_job_view(p_id,p_name,p_filters,p_expected_version)` | Creation with a stable UUID/version 0 or update of an observed own version.                                 |
| `remove_job_view(p_id,p_expected_version)`                | Removal of an observed own version.                                                                         |

Public invoker entry points call restricted private implementations with an empty search path. Internal filter/projection helpers have no execution grants for PUBLIC/anon/authenticated. The private views table has RLS and no direct browser grants. Job access uses the existing `can_read_job` boundary; discovery neither resets accepted compensation nor introduces administrator access to other people's private calendars.

Cursors contain sort value, UUID and a fingerprint of the canonical filters. Cursors from a different search, nonfinite values and invalid page sizes are rejected. A page is a currently authorised query, not a database snapshot frozen across multiple HTTP requests. New or reordered offers may require reloading the search.

## Verification

Focused commands:

```bash
npx vitest run src/features/jobs src/features/dashboard/dashboard.test.tsx src/features/calendar/calendar.test.tsx
PORTAL_DB_CONTAINER=<owned-test-container> node scripts/job-discovery-db-tests.mjs
PORTAL_DB_CONTAINER=<owned-test-container> node scripts/api-surface-db-tests.mjs
./portal test
```

The SQL suite uses only owned temporary UUID databases. It checks more than 1,000 records sharing timestamps, complete stable pages, exact older detail identifiers, original currencies/units, actual session gaps/zones, own calendar conflicts, private views/quotas, concurrent CAS changes and role/account revocation. The generic API check continues validating all actual public references, RLS, invoker boundaries, absence of anonymous grants and empty definer search paths.

`job-discovery-api-check.mjs` adds actual Auth/REST acceptance, including the old 1,000-row limit and signing in through a new session. `job-discovery.spec.ts` covers desktop/mobile, actual subsequent pages, saved views surviving reload, private account boundaries, DE/EN, dark mode and axe. Existing claim/lifecycle browser tests retain actual booking and snapshot checks; their detail refresh now waits for the precise new detail API. Authored tests alone do not constitute passed native acceptance.
