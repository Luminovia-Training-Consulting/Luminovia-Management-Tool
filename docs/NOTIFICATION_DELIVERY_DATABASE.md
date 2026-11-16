# Transactional notification email delivery

Migration `20261116021141_notification_email_outbox.sql` adds an opt-in email channel to the existing committed inbox. It does not replay existing inbox history. Every new supported notification occurrence creates at most one private outbox row in the same transaction; a rolled-back claim or cancellation therefore produces no deliverable email. Renewed reopening occurrences are distinguished by the inbox occurrence timestamp. Marking a notification read does not queue another message.

## Account preferences

Authenticated accounts can call `delivery_preferences()` and `save_delivery_preferences(p_payload jsonb, p_expected_version integer)`. The exact payload is:

```json
{
  "email_enabled": false,
  "quiet_start": null,
  "quiet_end": null,
  "time_zone": "Europe/Berlin"
}
```

The response adds the positive integer `version`. Saving uses compare-and-swap; a stale version returns SQLSTATE `40001`. Quiet hours require either two nulls or two distinct `HH:MM` times, together with a current PostgreSQL IANA time-zone name. The interval includes its start and excludes its end. Midnight-spanning intervals and Berlin DST use local wall-clock times; Brisbane keeps its own zone. Quiet hours defer all opted-in email categories, including cancellation receipts. Existing in-app receipts remain available independently.

There is no actor ID parameter and no administrator bypass. Private preference/outbox tables have RLS enabled and no direct authenticated, anonymous or service-role table grants. The exposed wrappers retain invoker security; reviewed implementations are isolated in `private` with empty search paths.

## Worker protocol

Only the actual `service_role` database role can execute these public wrappers or their private implementations. Browser-supplied JWT metadata cannot confer that role.

1. `refresh_notification_reminders(p_limit integer default 100)` scans at most 100 active, opted-in accounts with reminders enabled and no scan in the preceding 15 minutes. It creates unique inbox reminders for confirmed, unreleased sessions within 24 hours and active, unrevoked contracts expiring within 30 days. It returns the number of newly inserted inbox reminders. An external finite worker/timer must actually call it; the migration itself installs no scheduler.
2. `lease_notification_emails(p_limit integer default 20)` claims at most 100 due outbox rows using row locks and `SKIP LOCKED`. The JSON array contains only `{id, lease_token}`. Leases expire after five minutes. Each claim increases the attempt count, to a maximum of five safe attempts.
3. `prepare_notification_email(p_id uuid, p_lease_token uuid)` immediately rechecks the lease, current account activity, current primary Auth email, opt-in, category preferences and quiet hours. It also suppresses stale session/contract reminders, removed or muted chat memberships and unpublished job offers. It returns null when deferred/suppressed or a minimal `{id, lease_token, recipient, locale, kind, message_id}` object and changes the row to `sending` before SMTP starts. No course names, contract titles, document text or chat content are included. Resource links are resolved only after login through the existing inbox.
4. `finish_notification_email(p_id uuid, p_lease_token uuid, p_outcome text, p_error_code text default null)` accepts `accepted`, `retry`, `failed` or `uncertain` and returns whether that fenced outcome was recorded. Repeated identical completion is idempotent. Error codes permit only lowercase letters, digits and underscores; raw SMTP errors, recipients and credentials must never be recorded. Known safe retries use exponential backoff, starting at 60 seconds and bounded at one hour, with no more than five attempts.

`message_id` remains `<luminovia-notification.OUTBOX_UUID@luminovia.org>` across a safe retry. SMTP acceptance is not proof of final inbox delivery. SMTP cannot provide exactly-once atomic delivery with PostgreSQL: a worker crash or lost acknowledgement after DATA may leave the outcome unknown. Such rows become `uncertain` and are never blindly retried. Expired pre-send `leased` rows can be recovered with a new fencing token; expired `sending` rows become uncertain. This deliberately favors avoiding duplicate cancellation/assignment mail over guessing delivery after an ambiguous failure. Operator reconciliation is separate from automated retry.

Credentials belong only in the server worker's protected environment/secret files. The migration creates no SMTP credential storage, connects to no SMTP server and sends no email. The finite worker and actual timer installation need separate execution and acceptance.

## Executed checks

`PORTAL_DB_CONTAINER=supabase_db_luminovia-portal-test-m7 node scripts/notification-delivery-db-tests.mjs` passed 17 real PostgreSQL groups in a disposable database, including a 50-occurrence concurrent lease race, transaction rollback, no history replay, per-account CAS and ACLs, current recipient checks, quiet hours/DST, fencing, terminal uncertainty, safe retry bounds and scheduled-reminder cancellation/revocation. The helper drops its own database afterwards.

The existing notification suite passed 15 groups, and `scripts/api-surface-db-tests.mjs` passed all six security/interface groups against a complete migration replay. These are database checks, not proof of production installation, real Hostinger delivery, timer execution or browser acceptance.

`scripts/notification-delivery-api-check.mjs` additionally defines actual disposable-stack Auth/REST acceptance for account preferences, CAS, invalid quiet hours, untrusted metadata and administrative worker denial, current Auth recipient revalidation, fenced synthetic completion and post-lease opt-out. It never opens an SMTP connection. The separate email preference journey in `tests/e2e/notifications.spec.ts` covers German-to-English draft preservation, Brisbane quiet hours, persisted reload and offline edits followed by an explicit online save. Both browser projects discover that journey. Syntax, test discovery and formatting passed; actual API/browser acceptance belongs to the complete isolated `./portal test` execution and must be reported separately.
