# Deployment and operations runbook

Status: actual authorised self-hosted development at **https://cms.luminovia.org** on the existing **Hostinger KVM 1**. The user explicitly requested that frontend, Supabase and files run together at Hostinger and declined a paid upgrade during setup. Follow [HOSTINGER_DEVELOPMENT](HOSTINGER_DEVELOPMENT.md) for this instance's exact configuration, Compose commands, backup/restore checks and limits. The managed-backend steps below are retained reference from the earlier architecture, not the current target. Full production acceptance remains separate. Do not change the public Luminovia marketing website.

## Configuration boundaries

Frontend variables in `.env.example` are public build configuration. The browser may receive only Supabase project URL and publishable key (or local legacy anon key) plus non-sensitive configuration. Service-role/secret keys, SMTP passwords and database credentials are server-only or developer-local and must never use a `VITE_` variable. Keep `.env.local`, `.env.test.local` and generated test credential files ignored and permission-restricted.

Keep development, staging and production credentials, Auth redirect allowlists and database/object data separate, including when self-hosted. The 15 November empty managed-project inventory is historical; a later initially approved free Cloud project is unused after the self-hosting decision. Do not make it an implicit dependency or select a billable project. Production ownership, region/processor terms, real SMTP and capacity remain separate release requirements.

## Current self-hosted VPS operation

The actual database is the reviewed immutable PostgreSQL 17.12 image in `deploy/hostinger/selfhost/compose.yml`; [patch provenance](../deploy/hostinger/selfhost/postgres-upgrade-provenance.json) contains the exact digest, official release sources, candidate restore and successful live acceptance. Preserve the unchanged upstream vendor snapshot as historical provenance. Do not replace the active image with a floating tag, assume a tag proves a security backport, or treat a PostgreSQL major upgrade as an ordinary restart.

Caddy mounts `/opt/luminovia-portal/www` at `/srv`, reads the active shell through `www/current` into `www/releases`, and serves shared immutable assets from `www/assets`. Keep the parent bind mount stable, retain assets still referenced by loaded clients, and keep source, environment files, backups and database/object data outside `www`. The separate mail-template mount serves the reviewed bilingual templates. The actual Compose projects, private paths and inspection commands are in [HOSTINGER_DEVELOPMENT](HOSTINGER_DEVELOPMENT.md).

The reviewed Caddy configuration returns 503/`Retry-After: 60` for public `/backend` requests while `www/maintenance.enabled` exists. Remove the flag only after the intended services are healthy. A proxy flag alone does not prove quiescence of in-flight requests, WebSocket sessions or internal service writers; the operator must establish quiescent writes before accepting a consistent backup or applying maintenance. Never use reset, seed, reinstall or `down --volumes` for routine deployment.

The authorised KVM 1 environment has three fictional accounts, private Mailpit and 10 GiB shared/1 GiB owner document allocation. After the 17.12 patch, eight actual CMS API suites, 50 online claims with one complete winner, existing-password/private-file persistence and actual WSS membership revocation passed. This does not establish real email delivery, a 100 GB document capacity, 15–25-user load or a production release.

## Local operation

Run `./portal start` for complete persistent local operation and `./portal test` for complete isolated verification. The launcher handles lockfile dependencies, migrations, insert-only fictional bootstrap and real service readiness; see [LOCAL_DEVELOPMENT](LOCAL_DEVELOPMENT.md). Inspect evolving CLI help rather than guessing flags. Bind previews to loopback. Local Auth emails are captured by the local test mail service, not sent to real people. Generated local accounts are test accounts, not real invitations. Never run a local reset/seed harness against hosted data.

Use `./portal stop` when the local background system is no longer required; the command preserves Auth/database/Storage data. `./portal start` resumes that data. Preserve source/migrations/plan/log, not running-process promises. Do not remove an existing unrelated stack or delete stored data as cleanup.

## Pinned CLI semantics

This project pins Supabase CLI `3.1.0`. CLI v3 defaults database/storage operations to local, uses `[local_smtp]`, and requires explicit hosted selection/consent. Before any managed action, inspect the pinned command's `--help` and reviewed target; do not reuse remembered v2 flags. See [official sources](REFERENCE_SOURCES.md). Browser-facing Edge Functions must implement their own approved-origin CORS/preflight handling under CLI3.1.0 local behaviour.

## Managed staging reference — superseded for this VPS

These earlier managed-backend steps are reference only; do not apply them as setup instructions for the running self-hosted development VM.

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

The Auth email redirect, exact allowlist and implemented app route must agree. On the running self-hosted VM, Auth loads the separately mounted `deploy/hostinger/mail-templates` from the exact CMS `/mail-templates/` URLs, and private Mailpit captures all delivery. For a separately approved managed backend, install the reviewed `supabase/templates/invite.html` and `supabase/templates/recovery.html` explicitly into the approved hosted Auth email settings; local `content_path` configuration does not publish hosted templates. The invitation template uses a token hash and explicit `/auth/callback` acceptance followed by `verifyOtp`/password setup so it works in a new browser with the PKCE-configured client. Recovery retains the standard `ConfirmationURL` to preserve its PKCE challenge/verifier. Do not revert to the default implicit invitation redirect without a new integration review. Use no-referrer behaviour and redact token-hash authentication query strings from hosting/access logs. Verify invitation acceptance, password creation, assigned lecturer capability and subsequent sign-in in the same reviewed environment. Local captured messages to `.invalid` test accounts are not production email deliverability.

## Static frontend hosting

The running VPS uses Caddy at the distinct CMS subdomain with the stable `www/current` layout above. For any future alternative host, use a distinct approved portal document root/subdomain. Keep the marketing site's root and repository deployment configuration unchanged. Confirm hosting supports HTTPS, SPA fallback to `index.html` for client routes and compatible response headers. A direct deep link such as `/jobs/<id>` must load the app. Do not cache `index.html` or service-worker update metadata so aggressively that clients remain on old builds; hashed static assets may receive long-lived immutable caching.

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

The actual development off-site backup contains a PostgreSQL custom archive, password-free source role definitions, manifest/checksums and actual Storage bytes. Original-image recovery passed, and the same actual backup passed a networkless restore into the reviewed 17.12 candidate before the live patch, including exact source roles/membership grantors/options, eleven migration SQL sources, RLS/counts/quotas and every object hash. The actual retained 114-byte private file also downloaded unchanged after the live patch, with cross-admin access denied. These drills used owned disposable local resources; they did not overwrite the VPS.

Use `node deploy/hostinger/backup.mjs --development-vps --quiescent` only after establishing quiescent writes. `node deploy/hostinger/restore-check.mjs --latest-development-vps` follows the backup manifest's reviewed source image. `--latest-development-vps-upgrade` is restricted to the specific reviewed 17.6-to-17.12 candidate; it is not an arbitrary engine updater. A data backup deliberately excludes role passwords, environment/JWT signing material and Vault keys, which require a separate protected recovery source. Logical restore rebuilds indexes; before an in-place engine patch compare database/explicit collation versions and release-specific index/extension requirements. Rebuild affected indexes before refreshing any changed collation version.

Define accountable owners, frequency, retention, encrypted off-site storage and access policy before production. PostgreSQL backup alone omits Supabase Storage binaries. Back up object files and metadata consistently, preserve version/hash information, and verify an authorised download after restoring an isolated copy. Restore drills must check roles/permissions, accepted claims/allocations, event deduplication and file authorisation, not only database startup.

Keep the previous signed/reviewed static artifact and configuration for frontend rollback. Prefer forward-compatible migrations; destructive database reversal needs separate review and data reconciliation. Preserve accepted assignments/terms, invoices and audit history. If a release fails: disable affected writes through a reviewed reversible control, restore previous frontend where safe, assess migration/data compatibility, follow the tested recovery procedure and communicate actual impact. Do not improvise by deleting production tables.

## Monitoring and incident handling

Collect structured redacted application/API errors with correlation IDs where available. Do not log tokens, passwords, private message/document bodies or signed URLs. Monitor Auth/claim failures, duplicate-allocation invariants, notification retries, storage scan queue and backup success as modules mature. Document incident contacts and authority, revoke affected access explicitly, and retain only necessary evidence under the approved policy.
