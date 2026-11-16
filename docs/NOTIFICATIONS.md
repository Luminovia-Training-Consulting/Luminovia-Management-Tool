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

The [email extension](NOTIFICATION_DELIVERY_DATABASE.md) adds explicit per-account consent, IANA-zone quiet hours and a transactional outbox. The versioned settings are stored server-side. The [finite Hostinger mail worker](NOTIFICATION_MAIL_OPERATIONS.md) generates due reminders for opted-in active accounts and processes newly queued events; manual reminder refresh can also queue a new email. Existing inbox history is never replayed.

[Web Push](WEB_PUSH.md) adds explicit per-device consent, private subscriptions and a finite encrypted delivery worker. The in-app attention settings below remain independent of external delivery quiet hours. Committed task, assignment, course, finance and qualification events resolve their current resource permissions again before dispatch. Generic external payloads contain no private message bodies or document links.

Worker templates and timers ship disabled; source changes do not install or activate them. Real SMTP authentication, external delivery and physical desktop/mobile push acceptance require their separate operational evidence. Digests remain pending. In-app notices and mandatory receipts remain available independently of external channels. Combined verification of the integrated M7 and connected operations source is recorded only when actually executed in [QA_RESULTS](QA_RESULTS.md) and [WORKLOG](WORKLOG.md).

## Personal in-app quiet hours

The second form at `/settings` stores an own daily quiet period with an enable switch, start, end and IANA zone. Language changes preserve its draft. Its separate save button is **Save quiet hours**; the four existing category switches and their original API/version contract remain independent.

Quiet hours affect only the attention shown by the **bell counter**. During the active window, it continues counting unread binding booking, cancellation and new-contract notices. The connected announcements module additionally includes explicitly important, currently authorised portal announcements; archived, expired or no-longer-authorised revisions do not count. The inbox and its preview still contain every authorised notification; nothing is deleted, discarded, moved or automatically marked read. For example, 17 optional notifications plus three important receipts remain 20 unread notifications, while the bell counts three important notices. Its accessible label also states the active quiet period and complete unread count. Disabling quiet hours returns the bell to the full count. Only an explicit read/unread action changes read state.

The start is inclusive and the end exclusive. Different endpoints may span midnight. Actual local clock minutes in the selected IANA zone govern the rule: skipped DST minutes do not occur; both occurrences of a repeated minute use the same quiet-hours rule. No server or browser clock is changed. A saved quiet period retains its explicitly selected zone. Before anything is saved, the default uses the current own profile zone with a disabled 22:00–07:00 window.

The server calculates `quiet_active` from its current time when the inbox is fetched. `attention_count` is added only during an active window. The complete `unread_count` remains unchanged. The shell uses its existing 30-second interval and normal revalidation; the interface claims neither millisecond-precise transitions nor additional delivery technology. This feature is **not** SMTP, email, push or background-delivery scheduling.

The additive migration `20261115231704_notification_attention_preferences.sql` creates a separate private preferences table. `attention_preferences()` reads only the current active account. Before the first save, the own version is 0 without creating a row. `save_attention_preferences(p_payload, p_expected_version)` accepts exactly `enabled`, `start_time`, `end_time` and `time_zone`; the account comes from `auth.uid()`. An account-bound transaction lock also serialises concurrent first saves. Stale versions are rejected with `40001`; the draft remains until explicitly reloaded. Unknown fields, invalid times/zones and equal endpoints are rejected. Ordinary accounts, administrators and existing suspended sessions receive no other person's quiet hours. Direct table access and anonymous function execution are not granted.

`scripts/attention-db-tests.mjs` checks SQL boundaries, including actual IANA/DST cases. The additional **authored** scenarios `scripts/attention-api-check.mjs` and `tests/e2e/attention.spec.ts` cover actual Auth/REST accounts, initial and subsequent version conflicts, unchanged category preferences, 17 optional plus three important notices, account/admin/suspension boundaries and explicit read state. Browser cases include UI save/reload, DE/EN drafts, offline operation, dark mode, mobile width and axe. Actual native execution and results still belong in [QA_RESULTS](QA_RESULTS.md) and [WORKLOG](WORKLOG.md); the existence of these files does not claim a passed run.

## API and verification

The existing inbox/category contract comprises the five public functions `notification_inbox`, `mark_notifications`, `notification_preferences`, `save_notification_preferences` and `refresh_my_notifications`. The two attention RPCs described above extend this contract. Complete parameters are in [API_REFERENCE](API_REFERENCE.md). Focused checks:

```bash
npx vitest run src/features/notifications
PORTAL_DB_CONTAINER=<owned-test-container> node scripts/notifications-db-tests.mjs
./portal test
```

The SQL groups cover ownership, atomic batches, version conflicts, cursor limits, current resource permissions, mandatory notices, reminder windows, released allocations and qualification expiry. `scripts/notifications-api-check.mjs` verifies actual Auth/MFA/REST calls. `tests/e2e/notifications.spec.ts` covers desktop/mobile, a paginated inbox, settings surviving reload, language, dark mode, offline operation and axe. Authored tests do not constitute passed acceptance; combined checks actually executed are recorded in [QA_RESULTS](QA_RESULTS.md) and [WORKLOG](WORKLOG.md).
