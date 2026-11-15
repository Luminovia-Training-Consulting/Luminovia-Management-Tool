# Deployment and operations runbook

Status: development milestone; no production deployment authorised. Target architecture is a static Vite frontend on approved existing Hostinger hosting and a separate managed Supabase backend. Do not change the public Luminovia marketing website. A working localhost preview is not a production deployment.

## Configuration boundaries

Frontend variables in `.env.example` are public build configuration. The browser may receive only Supabase project URL and publishable key (or local legacy anon key) plus non-sensitive configuration. Service-role/secret keys, SMTP passwords and database credentials are server-only or developer-local and must never use a `VITE_` variable. Keep `.env.local`, `.env.test.local` and generated test credential files ignored and permission-restricted.

Staging and production use separate Supabase projects, keys, Auth redirect allowlists and storage. On 15 November 2026 the connected project inventory returned no hosted projects. Do not select/create a billable hosted project or populate it with real data implicitly. Confirm ownership, approved region (EU such as Frankfurt where available), processor/privacy implications and plan limits first.

## Local operation

Run `./portal start` for complete persistent local operation and `./portal test` for complete isolated verification. The launcher handles lockfile dependencies, migrations, insert-only fictional bootstrap and real service readiness; see [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md). Inspect evolving CLI help rather than guessing flags. Bind previews to loopback. Local Auth emails are captured by the local test mail service, not sent to real people. Generated local accounts are test accounts, not real invitations. Never run a local reset/seed harness against hosted data.

Use `./portal stop` when the local background system is no longer required; the command preserves Auth/database/Storage data. `./portal start` resumes that data. Preserve source/migrations/plan/log, not running-process promises. Do not remove an existing unrelated stack or delete stored data as cleanup.

## Pinned CLI semantics

This project pins Supabase CLI `3.1.0`. CLI v3 defaults database/storage operations to local, uses `[local_smtp]`, and requires explicit hosted selection/consent. Before any managed action, inspect the pinned command's `--help` and reviewed target; do not reuse remembered v2 flags. See [official sources](REFERENCE_SOURCES.md). Browser-facing Edge Functions must implement their own approved-origin CORS/preflight handling under CLI3.1.0 local behaviour.

## Staging preparation

1. Select an approved separate managed Supabase staging project and inspect existing tables, auth/storage settings, logs and advisors before changes.
2. Review migration diff and permissions; back up existing staging data if applicable. Apply versioned migrations using the reviewed CLI/connector workflow. Record migration versions and rollback plan.
3. Disable public/anonymous signup. Set exact staging site and implemented invitation/recovery callback URLs. Configure MFA and session settings; verify active-user/capability/AAL2 enforcement in actual Data API calls.
4. Configure approved transactional SMTP with server-only credentials and approved sender/domain. Review deliverability/rate limits, DE/EN templates and minimal notification contents. Send only authorised test messages.
5. Seed fictional staging fixtures only. Bootstrap the first administrator through a controlled server-side process, verify MFA, then audit granted capabilities. No browser role self-assignment.
6. Build frontend with staging public values. Run source, DB/RLS/concurrency, actual browser and accessibility tests. Record stage-specific differences, not merely localhost results.
7. Review all remaining product/security/privacy acceptance, document actual storage limits/scanning, monitoring, backups and recovery before presenting a production candidate.

## Invitation function controls and recovery

The `invite-lecturer` Edge Function is disabled unless its server environment explicitly enables invitations with `PORTAL_INVITES_ENABLED=true`, sets `PORTAL_APP_ORIGIN`, and includes that origin in `PORTAL_ALLOWED_ORIGINS`. Configure exact approved origins; do not use a wildcard. Supabase server-only URL/anon/service credentials are read in the function runtime, not bundled in the frontend. The browser requires a current Auth session, AAL2 and `users.manage`; requested roles are not accepted from callers.

A database reservation precedes email send. Idempotent retries and a unique normalised email prevent duplicate sends, with five new invitations per inviter per fifteen minutes. A result of `in_progress` or `failed` is not proof that no email was sent. If delivery or DB completion is uncertain, stop automatic resend: inspect the scoped invitation/audit row, local mail capture or approved provider delivery record, and actual Auth user/role state. An authorised operator must reconcile the specific request before any recovery send or completion. Do not invent success or clear reservations blindly. Full resend/expiry/deactivation administration remains follow-up scope.

The Auth email redirect, exact allowlist and implemented app route must agree. Install the reviewed `supabase/templates/invite.html` and `supabase/templates/recovery.html` explicitly into the approved hosted Auth email settings; local `content_path` configuration does not publish hosted templates. The invitation template uses a token hash and explicit `/auth/callback` acceptance followed by `verifyOtp`/password setup so it works in a new browser with the PKCE-configured client. Recovery retains the standard `ConfirmationURL` to preserve its PKCE challenge/verifier. Do not revert to the default implicit invitation redirect without a new integration review. Use no-referrer behaviour and redact token-hash authentication query strings from hosting/access logs. Verify invitation acceptance, password creation, assigned lecturer capability and subsequent sign-in in the same reviewed environment. Local captured messages to `.invalid` test accounts are not production email deliverability.

## Hostinger static hosting preparation

Use a distinct approved portal document root/subdomain. Keep the marketing site's root and repository deployment configuration unchanged. Confirm hosting supports HTTPS, SPA fallback to `index.html` for client routes and compatible response headers. A direct deep link such as `/jobs/<id>` must load the app. Do not cache `index.html` or service-worker update metadata so aggressively that clients remain on old builds; hashed static assets may receive long-lived immutable caching.

Verify a CSP appropriate to the actual bundled assets/Supabase endpoints and Auth flows. Avoid permissive wildcard origins and inline script exceptions unless demonstrated necessary. Configure security headers on the actual host and test them. Ensure manifest scope/start URL and icon paths work at the final base path. Do not silently host the portal under the public website's build output.

## Production approval and release

All of the following require evidence before requesting final production approval:

- A specific reviewed commit/build artifact and visible staging demonstration, with implemented/remaining scope stated honestly.
- Passing relevant tests, migration/RLS and fifty-way concurrency results, dependency/advisory review and resolved material findings.
- Actual DE/EN, accessibility, supported mobile/browser/PWA and offline-sensitive-cache checks.
- Approved production project/hosting/DNS/auth/SMTP settings, initial administrator/MFA and privacy/legal/retention review.
- A consistent backup of PostgreSQL **and actual Storage file objects**, successful isolated restore drill and tested rollback.

Request approval for the concrete release and its migration/hosting changes. The initial development request does not authorise production publishing, real invitations, purchases or marketing-site changes.

After approval: take the documented backups; apply reviewed compatible migrations; deploy the exact built artifact to the approved portal root; verify HTTPS/deep links/auth/RLS/claim/calendar/reconnect and service-worker updates; monitor redacted errors and key business invariants. Record literal created URLs only after actual deployment succeeds.

## Backup, restore and rollback

Define accountable owners, frequency, retention, encrypted off-site storage and access policy before production. PostgreSQL backup alone omits Supabase Storage binaries. Back up object files and metadata consistently, preserve version/hash information, and verify an authorised download after restoring an isolated copy. Restore drills must check roles/permissions, accepted claims/allocations, event deduplication and file authorisation, not only database startup.

Keep the previous signed/reviewed static artifact and configuration for frontend rollback. Prefer forward-compatible migrations; destructive database reversal needs separate review and data reconciliation. Preserve accepted assignments/terms, invoices and audit history. If a release fails: disable affected writes through a reviewed reversible control, restore previous frontend where safe, assess migration/data compatibility, follow the tested recovery procedure and communicate actual impact. Do not improvise by deleting production tables.

## Monitoring and incident handling

Collect structured redacted application/API errors with correlation IDs where available. Do not log tokens, passwords, private message/document bodies or signed URLs. Monitor Auth/claim failures, duplicate-allocation invariants, notification retries, storage scan queue and backup success as modules mature. Document incident contacts and authority, revoke affected access explicitly, and retain only necessary evidence under the approved policy.
