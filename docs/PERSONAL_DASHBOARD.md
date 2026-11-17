# Personal dashboard and teaching day

The existing preview cards can be hidden, shown and ordered for the current account using labelled up/down controls. The five saved areas are teaching day, activity, own contract receipts, recent files and follow-ups. Current role/resource permissions still determine which areas may load data; presentation preferences never grant access. The greeting, navigation, financial overview, offer suggestions and calendar remain separate areas.

The dashboard now presents the existing metrics, financial cards, offer suggestions, calendar preview and readiness widget in a compact workspace layout. It removes the oversized introductory hero from the authenticated dashboard; the sign-in/onboarding experience remains the branded welcome surface. This is presentation-only and does not change the dashboard query or its permission boundaries.

`private.dashboard_preferences` is accessed through current-identity `dashboard_preferences` and `save_dashboard_preferences` RPCs. No administrator can edit another account's layout. CAS versions prevent silent overwrites; failed saves retain the draft and explicit reload lets the user review current state. The UI confirms the layout only after the server response.

<a id="mein-unterrichtstag"></a>

## My teaching day

`teaching_day` returns only the active current lecturer's own confirmed, unreleased assignment sessions overlapping today in the profile's IANA time zone. Both day boundaries are calculated independently, preserving DST transitions. The preview is bounded to 100 sessions; the day/zone and a refresh control are visible. Role withdrawal, cancellation and transferred/released intervals remove the session and its shared context on the next read. A safe HTTPS teaching link or venue and the original assignment details remain available.

The additive `20261116091027_teaching_day_course_workspace.sql` extends this existing RPC without changing the released `20261116091009` source or its public wrapper/grants. For a linked nonarchived course, each session additionally includes:

- The actual course-run ID and link to `/courses/:id/workspace`.
- Only the deliberately selected `course_workspace_settings.contact_id`, from the exact course organisation, with name/email/phone. Archived contacts/organisations are excluded. No first-contact fallback, internal notes, personal-profile contact or general customer-directory grant is introduced. The UI uses the existing safe mailto/tel helpers.
- Current shared preparation done/total counts from `course_preparation_items`. Zero items is labelled as no shared checklist, not as readiness or 100% complete.
- Up to ten currently permitted, clean, hash-bearing exact `course_resources` versions and an accurate permitted total. A later private current-version replacement never silently replaces the agreed shared version. Removed shares stop appearing. Each preview links to the existing protected workspace, where download still requires its own current authorization/hash check. No Storage path or reusable download token is returned.

The original job-material preview remains separately labelled and bounded to 20 rows, with a link to remaining assignment files when needed. Its existing file permissions remain authoritative. Course-resource preview access uses the existing `course_resource_allowed` helper; this change creates no new table or file grant.

The three versioned `teaching_preparation` checkboxes remain the current claimant's private notes: materials prepared, link/room checked and contact checked. They do not change the shared checklist, client progress or computed operational readiness. Shared status is read-only in this preview; editing follows the owning workspace's permissions. The separate PR24 Readiness Centre, when integrated, is a staff operational calculation and does not supply the explicitly selected contact or replace this private checklist.

## Payload and compatibility

The DTO validates UUIDs, instants, the IANA zone, hashes and preview bounds. Missing shared fields in an older payload become null/empty unavailable context. They do not manufacture a course, contact or completed shared checklist. Original fixture/checklist behavior remains supported. The query is account-keyed, and no offline mutation is treated as confirmed.

## Evidence and acceptance boundary

Actual focused checks for this extension: five disposable PostgreSQL groups passed, covering explicit same-organisation contact selection, foreign/archived contact denial, exact old reviewed versions versus private replacements, bounded resource totals, unchanged personal-file RLS, course archival and role/cancellation/transfer revocation. Six dashboard component cases and five existing contact cases passed, including DE/EN links, real shared counts versus private checkbox state and honest legacy-payload defaults. The existing nine personal-dashboard SQL groups are an additional regression entry point.

`scripts/dashboard-personal-api-check.mjs` now asserts the real Auth/RPC shared contact/resource/count projection and exact scoped cleanup. `tests/e2e/dashboard-personal.spec.ts` now asserts the actual course contact, safe actions, shared progress, resource workspace link and absence of internal notes, alongside persisted private checklist/layout, reload, DE/EN, mobile/desktop and axe checks. These native cases are authored; their combined execution is owned by the current complete `./portal test` run. Reviewed-version metadata fixtures do not claim a new object transfer; the existing course workspace suite separately exercises real quarantine/ClamAV/Storage/exact-byte downloads.

No hosted service, production record, private mailbox or external recipient is changed by this source extension. Current combined/retained-data/platform and activation outcomes belong in [QA_RESULTS](QA_RESULTS.md).
