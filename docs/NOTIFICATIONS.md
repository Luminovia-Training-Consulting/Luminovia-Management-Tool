# Notifications and preferences

The bell, dashboard and `/notifications` use the same account-bound source. The preview shows eight entries and the actual count of all unread notifications. On request, the inbox loads another 40 notifications using a stable timestamp/UUID cursor. Read/unread changes and bulk acknowledgement appear only after a successful server response. Bulk acknowledgement applies only through the previously fetched timestamp; newly arriving notifications remain unread.

`/settings` offers German/English language, light/dark colour scheme and four notification preferences: chat, forum, matching/reopened jobs and reminders. These four switches are stored server-side per account with a version number. A concurrent save does not overwrite a newer version; the draft remains available and can be explicitly reloaded. Language changes preserve the draft. Writes are disabled offline.

## Security and data flow

The additive migration `20261115204354_notification_inbox_and_preferences.sql` extends the existing notification table. Public invoker RPCs delegate to private definer functions with an empty search path, explicit execution grants and checks of the current active account identity. Administrative permissions do not open another person's inbox. Mixed own/foreign ID batches are rejected in full. The preferences table is private and permits no direct browser writes.

The API resolves resource links and titles against current resource permissions. After chat membership is revoked or a resource is removed, neither its old title nor a still-usable link is returned. The frontend validates the response structure; links must be internal paths. Authored text is rendered as text. A failed fetch does not continue displaying a previously cached private preview. Query keys contain account identity; requests support abort signals. Only the small preview polls every 30 seconds; dashboard and inbox create no further background polling cycle.

Optional new notifications respect preferences at insertion time. Turning a preference off does not delete existing notifications. Confirmation and cancellation of a binding allocation continue to be recorded independently of these switches.

Matching jobs are determined after the publication transaction completes, using the final topic/qualification set. Archived/expired offers, past sessions and inactive accounts are excluded; qualifications must remain valid through the final session. A notification is a hint and does not replace renewed contract, calendar, qualification and capacity checks during a binding claim.

## Reminders and boundaries

The explicit reminder-refresh action creates idempotent notices for the actor's own confirmed, unreleased sessions within 24 hours and own active contracts expiring within 30 days. A server-side limit prevents repeated calculation within one minute. A changed preference permits immediate recalculation. Released historical allocations and revoked contracts do not produce current reminders.

This version includes in-app notifications and manual reminder refresh. Automatic scheduling, quiet hours, email digests, web push and actual SMTP delivery remain further product work; they are not represented as existing features.

## API and verification

The five public functions are `notification_inbox`, `mark_notifications`, `notification_preferences`, `save_notification_preferences` and `refresh_my_notifications`. Complete parameters are in [API_REFERENCE](API_REFERENCE.md). Focused checks:

```bash
npx vitest run src/features/notifications
PORTAL_DB_CONTAINER=<owned-test-container> node scripts/notifications-db-tests.mjs
./portal test
```

The SQL groups cover ownership, atomic batches, version conflicts, cursor limits, current resource permissions, mandatory notices, reminder windows, released allocations and qualification expiry. `scripts/notifications-api-check.mjs` verifies actual Auth/MFA/REST calls. `tests/e2e/notifications.spec.ts` covers desktop/mobile, a paginated inbox, settings surviving reload, language, dark mode, offline operation and axe. Authored tests do not constitute passed acceptance; combined checks actually executed are recorded in [QA_RESULTS](QA_RESULTS.md) and [WORKLOG](WORKLOG.md).
