# Find jobs and save private views

The `/jobs` marketplace searches on the server and loads 50 results at a time. **Load more jobs** fetches the next page. It does not collect a complete catalogue in the background or raise the global 1,000-row Data API limit. The interface shows the number actually loaded; it calls the current search complete only when no next page remains.

The former `jobsQuery` loaded an unpaginated table and then filtered in the browser. `supabase/config.toml` limits those responses to 1,000 rows. The native API check reproduces that limit with 1,057 owned offers before reading the same authorised inventory completely through the new API. Authored checks and actual native acceptance are documented separately in [QA_RESULTS](QA_RESULTS.md).

## Using and understanding filters

Enter the desired values and choose **Apply filters**. Typing alone does not trigger another job query. Filters remain copyable as URL parameters and can be reopened through normal browser navigation.

- Search and customer text are compared literally and case-insensitively. `%`, `_` and brackets are text, not search operators. Search also covers labels/aliases of linked expertise topics.
- Multiple topics, tools or programming languages mean that an offer must require all selected identifiers. Existing archived selections remain recognisable; new selections use active catalogue entries.
- Calendar dates use the explicitly chosen IANA zone. At least one actual session must overlap a selected local calendar day. An unscheduled gap between day 1 and day 10 does not match. A session crossing midnight can match both actually occupied days. Day boundaries are calculated by zone rather than as fixed 24-hour intervals.
- Teaching duration is the sum of actual session intervals, including fractional minutes. It is not the elapsed period from the first to the last course day.
- Money bounds and sorting require an original currency. Unit prices also require a fee unit. EUR/AUD or hourly/daily rates are not silently compared or converted. Returned amounts describe the current actor's authorised prospective compensation per position, not raw public-table sentinels or a gross/platform projection.
- **No conflicts in my calendar** checks only the actor's own private events, active allocations and blocked periods. Free published future positions with an open claim deadline must also exist. A positive result reserves nothing. Qualification, contract, terms and all current conflicts are still checked only by the atomic claim.

Sorting supports newest/oldest creation in the inventory, next start, title, teaching duration and explicitly comparable total/unit fees. Every sort uses the job UUID as its unique second key. Equal timestamps or amounts therefore do not produce an indeterminate page order.

## Current role-priced quotes and consent

Role-priced offers use each offer's captured private compensation policy and the current actor's eligible tier. Discovery, exact detail and dashboard suggestions share the same authorised amount, total and quoted terms version. Legacy offers retain their existing net amounts. A later global policy update does not silently reprice an existing captured offer, and none of these reads rewrites an accepted assignment. [Private role-pricing rules](DELEGATED_ROLES_PRICING.md) explain the underlying policy and claim contract.

Raw `jobs.amount` and `jobs.total_amount` zero sentinels are not authoritative prospective quotes for role-priced offers. The authorised projection can return `null` for nonlecturer management or an unconfigured policy. The strict [discovery DTO](../src/features/jobs/discovery-api.ts) preserves that absence without numeric coercion. Cards and detail display restricted compensation, and an unpriced claim is disabled. An explicitly returned numeric zero remains a real quote rather than a missing value. The projection exposes neither gross amounts, policy percentages nor another tier's quote.

Price filters and monetary sorting use the same actor-specific quote shown in the result. Unknown amounts do not match price bounds, including a minimum of zero. Monetary sorts place unknowns last in either direction; their internal cursor-order sentinel is never returned as compensation. Original-currency and fee-unit requirements still apply.

The detail checkbox binds consent to the exact displayed job identifier, quoted version, amount, total, currency, fee unit and terms. A refreshed quote cannot reuse consent for different displayed values. The claim sends the quoted terms version and idempotency key to the existing server transaction; the browser supplies no recipient role or accepted price authority. Existing own claims continue displaying their immutable accepted snapshots. A retry remains subject to current access checks and refers to its original claim identity and current status, not a newly confirmed allocation.

Observed role changes reset the infinite-page query key. Independently, the server binds cursor fingerprints to the current actor/tier and global policy version as well as the canonical filters. A cursor captured under a different quote context is rejected and requires a fresh search. A policy-context change invalidates the old cursor without rewriting an existing offer's captured quote. These checks do not make several HTTP pages a frozen snapshot.

## Private saved views

**Save applied filters** stores the currently applied URL search under a chosen name. Unapplied form inputs are not silently included. Select a saved view to load its filters and sorting into the URL and form. **Rename view** changes its name; **Remove view** removes only that personal filter selection.

Views persist in PostgreSQL, at most 20 per account. Reloading or signing in again does not remove them. Other accounts and ordinary administrative permissions do not open another person's views. A version conflict remains visible and cannot overwrite a newer state. Reload the current view list and review the selection again. An identical creation retry after a lost response uses the same UUID and creates no second view. These writes are disabled offline.

Filters are stored as closed, type-checked JSON. Browser roles, user identifiers, unknown fields or alternative gross amounts provide no additional filtering permissions. A saved filter expands neither job nor calendar access. Current roles/account suspension are checked on every API request; client-only/participant-only accounts do not load lecturer jobs or saved lecturer views here.

## Connections and preserved interfaces

The detail view queries exactly the requested permitted UUID through [jobDetailQuery](../src/features/jobs/discovery-api.ts) and the `/jobs/:id` route. An older job therefore remains accessible through its link even if absent from the former unpaginated 1,000-row response. Atomic claiming, idempotency, capacity and cancellation/reopening history remain authoritative, with current role-priced consent as described above. The quote replacement is additive; it does not rewrite earlier migration bodies or accepted records.

The dashboard receives complete authorised counts and at most two job suggestions through [jobDashboardQuery](../src/features/jobs/discovery-api.ts) and its own aggregate RPC. It does not confuse a small preview with the total count. Own allocation counts and at most five upcoming-session metadata records also come from that query. Management counts are returned only with current management permission. The dashboard does not request a lecturer overview for client-only/participant-only accounts. Suggestions use the same private item helper and nullable quote schema as discovery and detail; they do not calculate a price from the raw job table.

The calendar fetches only permitted titles for the actor's own confirmed allocations. Without own allocations, it starts no job-title query. It does not load the marketplace to label old sessions. This grants neither foreign titles nor private calendar entries, including to administrators. Global courses and private-event editing remain separate existing workflows.

The file/chat job selectors use a [dedicated purpose-bound paginated search](JOB_PICKERS.md). It uses actual upload or course-chat permission and loads no full marketplace records. Revision-specific native acceptance belongs in [QA_RESULTS](QA_RESULTS.md); this documentation change does not rerun it. The administrative M6 Kanban remains explicitly limited to the newest 500 offers and discloses that limit; older permitted offers can be edited through search and details.

## API and database

The original API, public invoker wrappers, saved-view table and discovery indexes come from [20261116080735_job_discovery_and_saved_views.sql](../supabase/migrations/20261116080735_job_discovery_and_saved_views.sql). The later [20261116080748_role_aware_job_discovery.sql](../supabase/migrations/20261116080748_role_aware_job_discovery.sql) owns the current private quote/context helpers and replaces `job_discovery_candidates`, `job_discovery_item` and `job_discovery`. It preserves the public signatures and saved-view operations. Existing `job_detail` and `job_dashboard` implementations call the replaced item helper, so their prices and consent versions follow the same projection.

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

Cursors contain sort value, UUID and a fingerprint of the canonical filters plus current server-derived quote context. Cursors from a different search, actor/eligibility-tier context or global policy revision, nonfinite values and invalid page sizes are rejected. A page is a currently authorised query, not a database snapshot frozen across multiple HTTP requests. New or reordered offers may require reloading the search. The new quote/context helpers have no direct execution grants for PUBLIC, anon, authenticated or service-role callers; discovery grants no additional access to private policies.

## Verification

Focused commands:

```bash
npx vitest run src/features/jobs src/features/dashboard/dashboard.test.tsx src/features/calendar/calendar.test.tsx
PORTAL_DB_CONTAINER=<owned-test-container> node scripts/job-discovery-db-tests.mjs
PORTAL_DB_CONTAINER=<owned-test-container> node scripts/role-aware-job-discovery-db-tests.mjs
PORTAL_DB_CONTAINER=<owned-test-container> node scripts/api-surface-db-tests.mjs
./portal test
```

The SQL suite uses only owned temporary UUID databases. It checks more than 1,000 records sharing timestamps, complete stable pages, exact older detail identifiers, original currencies/units, actual session gaps/zones, own calendar conflicts, private views/quotas, concurrent CAS changes and role/account revocation. The generic API check continues validating all actual public references, RLS, invoker boundaries, absence of anonymous grants and empty definer search paths.

`job-discovery-api-check.mjs` adds actual Auth/REST acceptance, including the old 1,000-row limit and signing in through a new session. `job-discovery.spec.ts` covers desktop/mobile, actual subsequent pages, saved views surviving reload, private account boundaries, DE/EN, dark mode and axe. Existing claim/lifecycle browser tests retain actual booking and snapshot checks; their detail refresh now waits for the precise new detail API. Authored tests alone do not constitute passed native acceptance.

The [role-aware database suite](../scripts/role-aware-job-discovery-db-tests.mjs) covers captured regular/senior quotes, original-currency monetary ordering and paging, restricted manager prices, consistent detail/dashboard versions, stale tier/policy cursors and helper access boundaries. [role-aware-job-discovery-api-check.mjs](../scripts/role-aware-job-discovery-api-check.mjs) supplies the corresponding native Auth/REST entry point. The [DTO](../src/features/jobs/discovery-api.test.ts), [card](../src/features/jobs/card.test.tsx), [detail](../src/features/jobs/jobs.test.tsx) and [discovery](../src/features/jobs/discovery.test.tsx) component regressions cover nullable values without coercion, genuine numeric zero, restricted rendering, changed-quote consent and resetting observed-role pages. These links identify existing tests; they do not claim that this documentation update reran SQL, API, browser or retained-data acceptance. Use the exact-source results in [QA_RESULTS](QA_RESULTS.md).
