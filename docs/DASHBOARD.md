# Personal dashboard overview

The dashboard connects the existing job, calendar and earnings cards with personal previews. The large brand area remains at the entry point. Data comes from existing authorised APIs; no new database permissions or additional server-side data copy are introduced.

## Content by account and permission

| Area                               | Content and boundary                                                                                                                                                                                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Suggested jobs                     | Published jobs with a claim deadline that remains valid. Verified, unexpired expertise prioritises matching requirements. Authoritative eligibility, contract and conflict checks still occur on the server during the actual claim.                                                                   |
| Calendar                           | The actor's own private events in the next 30 days and own confirmed assignment sessions, sorted together by start. The preview shows at most five entries. Administrative permissions do not extend this query to other people's private appointments.                                                |
| Messages and notifications         | Unread messages from the actor's own permitted chat rooms, the unread notification count and at most three recent notices. Full contents and currently checked links remain in chat or the inbox.                                                                                                      |
| Personal contract acknowledgements | Only the actor's own currently effective active contracts with a document version/hash and an outstanding receipt acknowledgement. Acknowledged, expired or future-effective contracts do not appear as outstanding tasks. This remains receipt acknowledgement, with no claimed electronic signature. |
| Recent files                       | At most five recently added, clean, unarchived file metadata records that the current actor may read. The filename opens the filtered file centre; file contents are not downloaded in the background.                                                                                                 |
| Management follow-ups              | Only with a currently returned `jobs.manage` capability: drafts, open jobs past their claim deadline and unfilled jobs with at least one session beginning in the next 14 days. The source is already authorised job rows, with no additional access to other people's calendars or gross fees.        |

Client-only and participant-only accounts do not load lecturer job, allocation, expertise or contract lists for the dashboard. Their entry point leads to the client portal or course overview. Personal appointments, accessible files and permitted messages remain available. Multiple-role behaviour follows actual roles and capabilities; a display label alone cannot expand database permissions.

Existing finance cards retain their own permission checks: platform revenue, client spend or personal net compensation is returned according to role as before. Role-priced job projections expose only the current lecturer's applicable quote; management without gross-finance permission receives no monetary values for those offers. The preview cards request no additional gross-revenue or other-person contract list. Private policy percentages are not dashboard defaults. See [delegated roles and private compensation](DELEGATED_ROLES_PRICING.md).

The dashboard can also show the permission-aware [welcome guide](WELCOME_GUIDE.md). Its progress is private to the account and changes only after online server confirmation. It remains distinct from the explicit Portal tour's per-account tab-session progress and the public fictional demo. Opening guidance grants no role, completes no business action and exposes no other account's data.

## Freshness without extra history queries

The notification preview uses exactly the same actor key and API as the shell. Only the shell runs the 30-second interval; the dashboard observer creates no second polling timer. The room preview also loads neither message history nor an additional three-second interval. Focus and reconnect use normal stale-data revalidation.

File and private-calendar queries are limited to five metadata records and have no polling interval. Their keys use the existing `documents` and `events` invalidation prefixes, so own file mutations and calendar changes continue to update the preview. The calendar preview also has a labelled refresh button. Published content or additional notices may appear at the next normal revalidation; the preview does not claim immediate synchronisation of all data.

All previews remain in the existing in-memory cache. A failed optional area offers its own retry without hiding other dashboard sections. Retained old preview values are not displayed after an error. Switching accounts uses different actor keys; the existing Auth boundary also clears the cache and resets private local state.

## Presentation and verification

The new cards use existing brand colours, responsive grids, semantic lists and named regions. Dates and times follow the profile time zone; `Europe/Berlin` is used if the profile zone is invalid. The interface supports DE/EN throughout; personal titles and filenames retain their authored language.

The ten component tests verify actual query calls and DOM behaviour: account/role boundaries, personal contract filters, bounded clean file metadata, calendar-error isolation, hiding old metadata after access errors or actor changes, management capability, expertise/deadline suggestions, one shared notification interval and language changes without additional requests.

```bash
npx vitest run src/features/dashboard/dashboard.test.tsx
```

Two additional browser journeys in `tests/e2e/dashboard.spec.ts` use only the canonical disposable test data. They cover actual own/other calendars, a real DM with unread counters, an actually scanned upload and its file-centre link, DE/EN/dark mode, mobile width/axe and MFA management access. Authored scenarios and actually passed browser runs are documented separately in [QA_RESULTS](QA_RESULTS.md) and [WORKLOG](WORKLOG.md).
