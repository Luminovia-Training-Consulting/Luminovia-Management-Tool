# Calendar: private events, assignments and published global events

`/calendar` offers month, week, day and list views in the personal IANA time zone. Own private events remain editable; confirmed allocations link to the specific job. The title query loads only the actor's own confirmed job identifiers. Availability and blocked periods remain a separate connected workflow at `/availability`.

## Shared calendar

**Global events** shows explicitly published, unarchived global events and the still-authorised published course runs. Private appointments are not copied into this calendar. The display uses the profile time zone; event details additionally show the stored event zone, description and, where present, an explicitly clickable HTTPS link. Descriptions are plain text, not HTML.

Global events are queried only for the actually visible FullCalendar range. The start is inclusive and the end exclusive; an event must actually overlap the range. Switching month/week/day or navigating backwards/forwards changes the query through `datesSet` without remounting the calendar. A window is limited to 93 days. Pages of 50 results, an explicit **Load more events** action and `(updated_at,id)` as a unique descending cursor prevent a silent full-catalogue fetch or the former confusion of the global 1,000-row REST limit with a complete inventory. The displayed number counts loaded global events, excluding separately displayed course sessions.

The existing course-run/template query retains its own resource authorisation and integration. It has not also been converted into a new paginated course API here. Own private events and confirmed allocations keep their existing queries. There is no automatic background loop over other calendar ranges.

## Manage global events

Accounts with **current `courses.manage` permission and MFA/AAL2** see management controls for the visible global-calendar range. They can:

- Create a draft with title, description, start/end, IANA zone and optional HTTPS link.
- Edit an observed draft and explicitly publish it.
- Withdraw publication.
- Archive an event and recover it as an unpublished draft.
- Search literally by title/description within the time window and load subsequent pages.

**Saving explicitly creates a draft.** Editing a published event withdraws its publication. Only another click on **Publish** makes the saved version visible. Archiving preserves the UUID and its version/request history. Recovery publishes nothing automatically. This intentionally differs from the separate unpublished-revision model for announcements. The interface explains this workflow before saving. An event saved outside the visible time window appears after navigating to its window.

Every change uses an observed version and a stable request UUID. An unchanged retry after a lost response returns the same confirmed server state. Different content with the same request UUID is rejected; concurrent versions do not overwrite one another. A version conflict preserves the draft for review. Authoritative access revocation immediately hides the private list and dialog, including during subsequent network failures. Only a successful authorised refresh opens a clean view again. Writes are not confirmed offline.

## Time and links

Database values are finite absolute instants with a stored IANA zone. New API payloads contain an explicit UTC/offset component and four-digit years. Form input is converted according to its zone. Nonexistent local times during the DST jump and ambiguous new local times during the fallback are rejected. Unchanged existing time fields retain their exact seconds and already unambiguously stored DST offsets during text-only edits.

Optional links accept only `https://` with ASCII DNS names or a complete IPv4 address and a valid optional port. Credentials, whitespace/control characters, backslashes, invalid hosts/ports and other protocols are rejected server-side and client-side. The browser opens links with `noopener noreferrer`. The platform does not fetch the destination server-side or claim to check its availability or external content.

## API and permissions

Additive migration created with the actually pinned Supabase CLI: `20261116003733_global_calendar_publications.sql`. Existing `global_events` rows and IDs remain; description, link, archive state and version/update metadata are added.

| RPC                                                                                     | Purpose                                                                                                                                                    |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `global_calendar_events(p_from,p_to,p_manage,p_search,p_before_at,p_before_id,p_limit)` | Authorised overlap within a bounded range; at most 100 records, `has_more` and a tuple cursor. `p_manage=true` requires current management permission/MFA. |
| `manage_global_event(p_id,p_action,p_expected_version,p_request_id,p_payload)`          | Versioned/idempotent `save`, `publish`, `unpublish`, `archive`, `recover` actions. New drafts use `p_id=null`, version 0.                                  |

Public functions are invoker entry points into private implementations with an empty search path. Internal helpers are not executable by PUBLIC/anon/authenticated. Private request history has RLS and no browser table grants. Ordinary active client/participant/lecturer accounts may read only current publications. Direct table queries remain RLS-bound. A `p_manage` flag, foreign UUIDs or editable JWT user metadata grant no permissions.

Writes first lock the actor's profile `FOR SHARE`. The explicitly VOLATILE implementation then checks current roles, activation and MFA in a separate statement before acquiring request/event locks. Existing role management locks the same profile `FOR UPDATE`; an already-running role revocation therefore wins before a waiting write. There is no administrative bypass into other people's private calendars.

The audit projection adds exactly `calendar.global_save`, `calendar.global_publish`, `calendar.global_unpublish`, `calendar.global_archive`, `calendar.global_recover` and preserves the existing allowlist, including announcements. The viewer still returns only actor name, action, resource UUID and timestamp; descriptions, URLs and JSON details are not disclosed.

## Checks and boundaries

Actually executed focused checks: **11 RTL/unit cases**, **9 PostgreSQL groups** in owned temporary UUID databases and **6 generic API-surface groups**. Coverage includes more than 1,000 equal sort values, complete pages, permissions/MFA, actual concurrent CAS updates, controlled public role revocation against a waiting write, safe links, finite bounds, archive/publication workflow, private-calendar boundaries and safe audit filters. Frontend cases check preserved DE/EN/CAS drafts, lost responses, revocation, DST and range changes without remounting the calendar.

```bash
npx vitest run src/features/calendar
PORTAL_DB_CONTAINER=<owned-test-container> node scripts/calendar-global-db-tests.mjs
PORTAL_DB_CONTAINER=<owned-test-container> node scripts/api-surface-db-tests.mjs
./portal test
```

`calendar-global-api-check.mjs` is authored for actual Auth/MFA/REST checks; `calendar-global.spec.ts` adds desktop/mobile, publication/draft, description/link, DE/EN, offline write prevention, dark mode and axe. These native scenarios were **not executed** during focused implementation. Their acceptance and combined PWA/persistence/CI results are documented separately by the later complete run in `QA_RESULTS.md` and `WORKLOG.md`.

This does not mark global-event attachments, invitations, background reminders, SMTP/push delivery, automatic publication, ICS subscriptions or private-event drag editing complete. They remain in the full master-prompt plan. Production services, real people and the public website were not changed.
