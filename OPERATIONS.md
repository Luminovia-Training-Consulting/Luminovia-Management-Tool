# Operations

Consolidated reference. Source and tests remain authoritative for current behavior.

<a id="section-deployment-runbook"></a>

<a id="section-deployment-runbook-deployment-and-operations-runbook"></a>

# Deployment and operations runbook

Configured environment: authorised self-hosted development at **https://cms.luminovia.org** on the existing **Hostinger KVM 1**. The user explicitly requested that frontend, Supabase and files run together at Hostinger and declined a paid upgrade during setup. Follow [HOSTINGER_DEVELOPMENT](OPERATIONS.md#section-hostinger-development) for this instance's exact configuration, Compose commands, backup/restore checks and limits. The managed-backend steps below are retained reference from the
earlier architecture, not the current target. Full production acceptance remains separate. Do not change the public Luminovia marketing website.

Current workflow: run `./portal check` and `./portal test` for local acceptance. After the exact-current-main push passes both Portal checks and Security analysis, the trusted automatic workflow may publish an immutable development release. The separate manual exact-SHA publication remains available. PR deployment metadata is manual-only; see [PR_PREVIEWS](DEVELOPMENT.md#section-pr-previews). The existing five-minute VPS updater independently checks the release, migrations, backup and health; a
published release is not proof of installation.

<a id="section-deployment-runbook-configuration-boundaries"></a>

## Configuration boundaries

Frontend variables in `.env.example` are public build configuration. The browser may receive only Supabase project URL and publishable key (or local legacy anon key) plus non-sensitive configuration. Service-role/secret keys, SMTP passwords and database credentials are server-only or developer-local and must never use a `VITE_` variable. Keep `.env.local`, `.env.test.local` and generated test credential files ignored and permission-restricted.

Keep development, staging and production credentials, Auth redirect allowlists and database/object data separate, including when self-hosted. The 15 November empty managed-project inventory is historical; a later initially approved free Cloud project is unused after the self-hosting decision. Do not make it an implicit dependency or select a billable project. Production ownership, region/processor terms, real SMTP and capacity remain separate release requirements.

<a id="section-deployment-runbook-current-self-hosted-vps-operation"></a>

## Current self-hosted VPS operation

The versioned selfhost configuration pins the reviewed immutable PostgreSQL 17.12 image in `deploy/hostinger/selfhost/compose.yml`; [patch provenance](deploy/hostinger/selfhost/postgres-upgrade-provenance.json) contains the exact digest, official release sources, candidate restore and successful live acceptance. Preserve the unchanged upstream vendor snapshot as historical provenance. Do not replace the active image with a floating tag, assume a tag proves a security backport, or treat a
PostgreSQL major upgrade as an ordinary restart.

Caddy mounts `/opt/luminovia-portal/www` at `/srv`, reads the active shell through `www/current` into `www/releases`, and serves shared immutable assets from `www/assets`. Keep the parent bind mount stable, retain assets still referenced by loaded clients, and keep source, environment files, backups and database/object data outside `www`. The separate mail-template mount serves the reviewed bilingual templates. The actual Compose projects, private paths and inspection commands are
in [HOSTINGER_DEVELOPMENT](OPERATIONS.md#section-hostinger-development).

The reviewed Caddy configuration returns 503/`Retry-After: 60` for public `/backend` requests while `www/maintenance.enabled` exists. Remove the flag only after the intended services are healthy. A proxy flag alone does not prove quiescence of in-flight requests, WebSocket sessions or internal service writers; the operator must establish quiescent writes before accepting a consistent backup or applying maintenance. Never use reset, seed, reinstall or `down --volumes` for routine deployment.

The last recorded hosted acceptance used three fictional accounts, private Mailpit and 10 GiB shared/1 GiB owner document allocation. Inspect the current private configuration and installed commit before operating it; repository source is not a live inventory. After the 17.12 patch, eight actual CMS API suites, 50 online claims with one complete winner, existing-password/private-file persistence and actual WSS membership revocation passed. This does not establish real email delivery, a 100 GB
document capacity, 15–25-user load or a production release.

<a id="section-deployment-runbook-local-operation"></a>

## Local operation

Run `./portal start` for complete persistent local operation, `./portal check` for fast quality/coverage/build feedback and `./portal test` for complete isolated verification before delivery. `./portal github test` verifies freshly fetched main locally, while `./portal github` starts its separate persistent preview; no GitHub deployment or self-hosted Actions runner is needed. The launcher handles lockfile dependencies, migrations, insert-only fictional bootstrap and real service readiness;
see [LOCAL_DEVELOPMENT](DEVELOPMENT.md#section-local-development). Inspect evolving CLI help rather than guessing flags. Bind previews to loopback. Local Auth emails are captured by the local test mail service, not sent to real people. Generated local accounts are test accounts, not real invitations. Never run a local reset/seed harness against hosted data.

Use `./portal stop` when the local background system is no longer required; the command preserves Auth/database/Storage data. `./portal start` resumes that data. Preserve source/migrations/roadmap/evidence, not running-process promises. Do not remove an existing unrelated stack or delete stored data as cleanup.

Run `./portal reset` and confirm the exact project to erase the local database, Auth, Storage, Mailpit, scanner state and generated credentials. The command verifies Docker ownership and removes the selected project’s persistent volumes after successful shutdown. The portal stays stopped. Run `./portal start` when you want to create a new local installation.

<a id="section-deployment-runbook-pinned-cli-semantics"></a>

## Pinned CLI semantics

This project pins Supabase CLI `3.1.0`. CLI v3 defaults database/storage operations to local, uses `[local_smtp]`, and requires explicit hosted selection/consent. Before any managed action, inspect the pinned command's `--help` and reviewed target; do not reuse remembered v2 flags. See official sources. Browser-facing Edge Functions must implement their own approved-origin CORS/preflight handling under CLI3.1.0 local behaviour.

<a id="section-deployment-runbook-managed-staging-reference--superseded-for-this-vps"></a>

## Managed staging reference — superseded for this VPS

These earlier managed-backend steps are reference only; do not apply them as setup instructions for the running self-hosted development VM.

1. Select an approved separate managed Supabase staging project and inspect existing tables, auth/storage settings, logs and advisors before changes.
2. Review migration diff and permissions; back up existing staging data if applicable. Apply versioned migrations using the reviewed CLI/connector workflow. Record migration versions and rollback plan.
3. Disable public/anonymous signup. Set exact staging site and implemented invitation/recovery callback URLs. Verify active-user and capability enforcement in actual Data API calls. If adopting privileged TOTP, stage the installation-wide policy before enforcing it.
4. Configure approved transactional SMTP with server-only credentials and approved sender/domain. Review deliverability/rate limits, DE/EN templates and minimal notification contents. Send only authorised test messages.
5. Seed fictional staging fixtures only. Bootstrap the first administrator through a controlled server-side process, then audit granted capabilities. No browser role self-assignment.

For a new dedicated White-Label academy, prepare the empty database with the verified licence using `node scripts/academy-installation.mjs LICENCE TRUSTED_PUBLIC_KEY INSTALLATION_UUID EDITION RELEASE_COMMIT`. Create the intended administrator using the dedicated instance's private Supabase Auth administration interface and confirm their email address. Run the same local operator command with `--first-admin AUTH_UUID` appended. The command uses the explicitly configured libpq connection and checks the exact installation and active release before recording the administrator. Its response confirms the assigned Auth UUID. Keep credentials in the private Auth and database environment.

After preparation, the operator can run the command with `--course-access on` to open the licence-bound course API profile on a dedicated test installation, or `--course-access off` to close that release. Activation requires an active licence and confirms the exact installation, edition and release. Deactivation also accepts that release's expired signed licence. The customer browser remains gated by separate release readiness checks.
6. Build frontend with staging public values. Run source, DB/RLS/concurrency, actual browser and accessibility tests. Record stage-specific differences, not merely localhost results.
7. Review all remaining product/security/privacy acceptance, document actual storage limits/scanning, monitoring, backups and recovery before presenting a production candidate.

<a id="section-deployment-runbook-invitation-function-controls-and-recovery"></a>

## Invitation function controls and recovery

The `invite-lecturer` Edge Function is disabled unless its server environment explicitly enables invitations with `PORTAL_INVITES_ENABLED=true`, sets `PORTAL_APP_ORIGIN`, and includes that origin in `PORTAL_ALLOWED_ORIGINS`. Configure exact approved origins; do not use a wildcard. Supabase server-only URL/anon/service credentials are read in the function runtime, not bundled in the frontend. The browser requires a current Auth session and `users.manage`; requested roles are not accepted from
callers.

A database reservation precedes email send. Idempotent retries and a unique normalised email prevent duplicate sends, with five new invitations per inviter per fifteen minutes. A result of `in_progress` or `failed` is not proof that no email was sent. If delivery or DB completion is uncertain, stop automatic resend: inspect the scoped invitation/audit row, local mail capture or approved provider delivery record, and actual Auth user/role state. An authorised operator must reconcile the specific
request before any recovery send or completion. Do not invent success or clear reservations blindly. Full resend/expiry/deactivation administration remains follow-up scope.

The Auth email redirect, exact allowlist and implemented app route must agree. On the running self-hosted VM, Auth loads the separately mounted `deploy/hostinger/mail-templates` from the exact CMS `/mail-templates/` URLs, and private Mailpit captures all delivery. For a separately approved managed backend, install the reviewed `supabase/templates/invite.html` and `supabase/templates/recovery.html` explicitly into the approved hosted Auth email settings; local `content_path` configuration does
not publish hosted templates. The invitation template uses a token hash and explicit `/auth/callback` acceptance followed by `verifyOtp`/password setup so it works in a new browser with the PKCE-configured client. Recovery retains the standard `ConfirmationURL` to preserve its PKCE challenge/verifier. Do not revert to the default implicit invitation redirect without a new integration review. Use no-referrer behaviour and redact token-hash authentication query strings from hosting/access logs.
Verify invitation acceptance, password creation, assigned lecturer capability and subsequent sign-in in the same reviewed environment. Local captured messages to `.invalid` test accounts are not production email deliverability.

## Authenticator rollout for administrators and owners

Every installation starts with the authenticator policy disabled. To enable it on a reviewed self-hosted portal or dedicated academy, apply the release migrations and set `PORTAL_TOTP_ENABLED=true` in that installation's private backend environment. Set `PORTAL_TOTP_SECURITY_MAIL_ENABLED=true` if the reviewed SMTP sender should deliver bilingual security notices when an authenticator is added or removed. Recreate the `auth` service from the installation's existing Compose model and exact environment. The Auth service uses the same reviewed SMTP transport as invitations and password resets.

The PostgreSQL operator opens pairing with `select private.set_authenticator_policy('enrolment');`. In **Settings → Authenticator app**, each active administrator and owner scans the QR code or enters the key manually, then confirms a fresh six-digit code. A paired account requires its authenticator for new sessions from that point. Verify both a successful sign-in with the app and denial of protected requests before the app code. On the password reset link, a paired account confirms the authenticator before saving the new password.

After all active administrators and owners have paired a verified authenticator, run `select private.set_authenticator_policy('required');`. The database refuses enforcement while any active privileged account is unpaired. The database also rejects unpaired privileged role grants in required mode. Use the enrolment stage for an approved new privileged account or to restore access after independently verifying the identity of an account with a lost authenticator. Revoke the lost Auth session and remove the lost factor with the private Auth administration process. Have the account pair again and confirm that required mode can be restored. These operations are scoped to the installation. Keep provider flags enabled while the database policy expects authenticator proof.

<a id="section-deployment-runbook-static-frontend-hosting"></a>

## Static frontend hosting

The running VPS uses Caddy at the distinct CMS subdomain with the stable `www/current` layout above. For any future alternative host, use a distinct approved portal document root/subdomain. Keep the marketing site's root and repository deployment configuration unchanged. Confirm hosting supports HTTPS, SPA fallback to `index.html` for client routes and compatible response headers. A direct deep link such as `/jobs/<id>` must load the app. Do not cache `index.html` or service-worker update
metadata so aggressively that clients remain on old builds; hashed static assets may receive long-lived immutable caching.

Verify a CSP appropriate to the actual bundled assets/Supabase endpoints and Auth flows. Avoid permissive wildcard origins and inline script exceptions unless demonstrated necessary. Configure security headers on the actual host and test them. Ensure manifest scope/start URL and icon paths work at the final base path. Do not silently host the portal under the public website's build output.

<a id="section-deployment-runbook-production-approval-and-release"></a>

## Production approval and release

All of the following require evidence before requesting final production approval:

- A specific reviewed commit/build artifact and visible staging demonstration, with implemented/remaining scope stated honestly.
- Passing relevant tests, migration/RLS and fifty-way concurrency results, dependency/advisory review and resolved material findings.
- Actual DE/EN, accessibility, supported mobile/browser/PWA and offline-sensitive-cache checks.
- Approved production project/hosting/DNS/auth/SMTP settings, initial administrator and privacy/legal/retention review. Decide and verify the installation’s administrator and owner authenticator policy before launch.
- A consistent backup of PostgreSQL **and actual Storage file objects**, successful isolated restore drill and tested rollback.

Request approval for the concrete release and its migration/hosting changes. The initial development request does not authorise production publishing, real invitations, purchases or marketing-site changes.

After approval: take the documented backups; apply reviewed compatible migrations; deploy the exact built artifact to the approved portal root; verify HTTPS/deep links/auth/RLS/claim/calendar/reconnect and service-worker updates; monitor redacted errors and key business invariants. Record literal created URLs only after actual deployment succeeds.

### Release decision — 22 November 2026

**NO-GO for real-user onboarding and Premium activation.** The release owner must keep Premium OFF for any proposed launch. A core-only launch requires its own explicit scope approval and evidence for the shared release gates. The current Hostinger installation is authorised for development. Its frontend is still at `5f89986cbd7d47592563b609e869021468fe6d1a`. Its last recorded update attempt reported `unsafe_release_path`. The installed validator accepted that release manifest in a read-only replay, so the failed job's cause remains open. The host has a fresh encrypted backup and a healthy scanner. Auth uses the development Mailpit relay, and the target's external delivery and alert routing still need evidence.

Before changing this decision, the release owner records the approved target and scope, exact deployed commit and artifact, completed application and security jobs for that commit, target health and provider evidence, and the isolated recovery result from an approved retained-data backup. The recovery must include Auth identities, tenant memberships, commercial records, course data and exact private file bytes. The acceptance owner signs off the scoped role, browser, API and privacy evidence. Both owners record the decision and the evidence references before onboarding starts.

If an update fails, the deployment operator pauses writes and scheduled delivery, records the UTC time, release identifiers, migration history and health findings, and alerts the release owner. The operator preserves the rollback artifact and the latest consistent encrypted database and object backup. The previous signed frontend can be reinstated after the operator verifies compatibility with the migration ledger. Where that compatibility is missing, the operator rehearses a forward fix or restores into an isolated target. If writes have already resumed, the operator reconciles changes made since the backup before any cutover. The release owner approves reopening after health, authentication, scoped reads and writes, private file bytes, notifications and accounting invariants pass. The owner responsible for customer communications handles any notification using the confirmed impact and approved disclosure process.

<a id="section-deployment-runbook-backup-restore-and-rollback"></a>

## Backup, restore and rollback

The actual development off-site backup contains a PostgreSQL custom archive, password-free source role definitions, manifest/checksums and actual Storage bytes. Original-image recovery passed, and the same actual backup passed a networkless restore into the reviewed 17.12 candidate before the live patch, including exact source roles/membership grantors/options, eleven migration SQL sources, RLS/counts/quotas and every object hash. The actual retained 114-byte private file also downloaded
unchanged after the live patch, with cross-admin access denied. These drills used owned disposable local resources; they did not overwrite the VPS.

Use `node deploy/hostinger/backup.mjs --development-vps --quiescent` only after establishing quiescent writes. `node deploy/hostinger/restore-check.mjs --latest-development-vps` follows the backup manifest's reviewed source image. `--latest-development-vps-upgrade` is restricted to the specific reviewed 17.6-to-17.12 candidate; it is not an arbitrary engine updater. A data backup deliberately excludes role passwords, environment/JWT signing material and Vault keys, which require a separate
protected recovery source. Logical restore rebuilds indexes; before an in-place engine patch compare database/explicit collation versions and release-specific index/extension requirements. Rebuild affected indexes before refreshing any changed collation version.

Define accountable owners, frequency, retention, encrypted off-site storage and access policy before production. PostgreSQL backup alone omits Supabase Storage binaries. Back up object files and metadata consistently, preserve version/hash information, and verify an authorised download after restoring an isolated copy. Restore drills must check roles/permissions, accepted claims/allocations, event deduplication and file authorisation, not only database startup.

Keep the previous signed/reviewed static artifact and configuration for frontend rollback. Prefer forward-compatible migrations; destructive database reversal needs separate review and data reconciliation. Preserve accepted assignments/terms, invoices and audit history. If a release fails: disable affected writes through a reviewed reversible control, restore previous frontend where safe, assess migration/data compatibility, follow the tested recovery procedure and communicate actual impact. Do
not improvise by deleting production tables.

<a id="section-deployment-runbook-monitoring-and-incident-handling"></a>

## Monitoring and incident handling

Collect structured redacted application/API errors with correlation IDs where available. Do not log tokens, passwords, private message/document bodies or signed URLs. Monitor Auth/claim failures, duplicate-allocation invariants, notification retries, storage scan queue and backup success as modules mature. Document incident contacts and authority, revoke affected access explicitly, and retain only necessary evidence under the approved policy.

<a id="section-operations"></a>

<a id="section-operations-customers-and-reusable-course-operations"></a>

# Customers and reusable course operations

This slice extends the actual M1 organisation/template/run/session tables. It does not replace the complete product scope. The interface is available at `/clients` and `/courses`, with German/English labels, keyboard-accessible dialogs and real RPC mutations.

<a id="section-operations-customer-privacy-and-administration"></a>

## Customer privacy and administration

Customers are configurable organisation records; no named customer is a required installation, course provider or privileged role. Create each actual organisation privately, reuse teaching templates across organisations, and select the relevant customer for each dated course run. Client logins require explicit current organisation memberships; knowing a catalogue code or source reference does not create that membership. Public instructions and examples use neutral wording or fictional records.

`organisations` contains business identity, industry, city, country/time zone, tags and a reversible archive timestamp. Private notes are in separate `organisation_private_details`; contact names, business email/phone and private notes are in `organisation_contacts`.

- All writes require the database capability `organisations.manage` and a currently active actor. RLS and column/table grants prevent direct caller writes.
- Organisation identities can be visible through an authorised course. Contact and note tables have their own capability-restricted SELECT policies, including when a lecturer knows the organisation ID from a public course.
- `save_organisation(p_id,p_payload)` and `save_organisation_contact(p_id,p_organisation_id,p_payload)` create or update records atomically, with bounded text/arrays, email validation, valid time zones and audit metadata. A null ID creates a new row.
- Archiving is reversible and does not delete accepted assignments or historical course links. Contact mailto/tel actions open the user's own client; development does not send real emails.

<a id="section-operations-course-templates-runs-and-sessions"></a>

## Course templates, runs and sessions

Reusable `course_templates` hold title, description, syllabus, prerequisites, archive state and dynamic `course_template_topics`. Actual `course_runs` hold the template/customer links, IANA time zone, delivery mode/venue, publication/archive state and `course_sessions` instants.

- Creation/editing requires `courses.manage` plus an active actor. Admins use `save_course_template` and `save_course_run`, passing validated explicit UTC/offset instants. Run session replacement is one transaction: malformed/overlapping input rolls back the whole schedule change.
- A run's schedule is protected as soon as any job references it, including a draft job. Its linked session records are not silently deleted or retimed. Templates used by published/filled jobs are also protected. The UI reports `course_locked` with a safe-copy instruction.
- `set_course_visibility` changes publication/archive state. A run with published/filled jobs cannot be archived through this workflow. Assigned lecturers retain legitimate course access through their confirmed assignment even if general publication is withdrawn.
- Lecturers browse published non-archived runs or their own assigned runs. Participants receive course data only through explicit membership of that run's participant course channel. Removing that membership revokes course reads immediately. This does not grant participants access to the commercial job/claim tables.
- Private security-definer visibility helpers are narrowly actor/resource scoped and not exposed as Data API tables. SQL wrappers use invoker security; execute grants exclude anonymous callers.

<a id="section-operations-safe-copies"></a>

## Safe copies

`duplicate_course_template(p_id,p_title)` copies content and topic links into a new active template with the caller's explicit title. `duplicate_course_run(p_id)` creates a new unpublished run and new session identities at the original instants. The administrator reviews/edits those dates before publication.

Copies do **not** copy jobs, accepted claims, compensation/contract records, lecturer or participant accounts, calendar allocations, chat rooms/memberships or documents. The course template reference and customer identity are retained when duplicating a run; changing the customer/dates is possible while the new run has no linked job.

<a id="section-operations-actual-validation-checkpoint"></a>

## Actual validation checkpoint

Executed on local Supabase with scoped fictional probe records, cleaned afterwards:

- `PORTAL_TEST_MODE=1 node scripts/operations-api-check.mjs`: **11 passed** with actual Auth-issued sessions and actual TOTP AAL2. Cases cover AAL1/lecturer denial, customer/contact/notes CRUD and privacy, invalid-input rollback, syllabus/topics, unpublished/published catalogue boundaries, safe copies, atomic overlap rollback, accepted-job schedule/terms protection, participant enrolment/revocation and recoverable archives/audit.
- `supabase db lint --schema public,private --fail-on warning`: passed after correcting a local variable/column ambiguity and an unused variable.
- Supabase security/performance advisors: no warning-level findings at this slice checkpoint.
- TypeScript and targeted ESLint: passed.
- In the second complete isolated `./portal test` run (`547a6f09`), all **4 operations browser cases passed**: read-only catalogue/private-directory denial and the full administrator mutation journey on desktop and mobile, with axe scans and no read-only horizontal overflow.

The actual complete UI mutation journey in `tests/e2e/operations.spec.ts` created temporary isolated administrator/customer/course data and passed on both viewports. It checked customer/contact persistence after reloading and reselecting the saved organisation, actual MFA, course creation, two sessions, literal safe syllabus text and an unpublished copy. The private-directory component test ensures no private query is even requested before the management permission resolves. This is
operations-specific evidence: that integrated run still had six browser failures in other features, so it was not a passing whole-system result.

<a id="section-operations-remaining-broader-scope"></a>

## Remaining broader scope

Bulk operations/export, customer document linkage, richer catalogue aliases/hierarchies, full course enrolment administration beyond explicit participant channels, attendance and richer course content/version history remain in the product plan. This slice does not alter accepted deals, provide legal review or establish production acceptance.

<a id="section-hostinger-development"></a>

<a id="section-hostinger-development-hostinger-self-hosted-development-instance"></a>

# Hostinger self-hosted development instance

This guide describes the configured development environment and preserves dated installation evidence. Its hosted observations were not refreshed by the 17 November documentation audit. The repository has advanced beyond the recorded deployed revision; use read-only state/health inspection before an authorised operation. No 100 GB or 15–25-user production acceptance is implied.

<a id="section-hostinger-development-last-recorded-hosted-acceptance--15-november-2026-utc"></a>

## Last recorded hosted acceptance — 15 November 2026 UTC

Main `bb322746`/18 source-verified application migrations was installed automatically at 2026-11-15T20:04:30UTC after exact CI43753910114 and immutable release checks. PostgreSQL 17.12 and all 10 required containers / 9 healthchecks are healthy, with no OOM/manual-recovery/maintenance flag. REST 16.5, Realtime 2.161.0, Storage 1.95.0, Edge 1.79.1, Envoy 1.40.2, Mailpit 1.33.1 and JSR jose 6.2.17 were genuinely tested together on retained data before rollout. All runtime pins remain immutable;
incompatible TypeScript 7/FullCalendar 7 candidates are held.

The five-minute release timer and daily complete backup 02 UTC, official OS 03 UTC and necessary reboot 03:30 UTC timers are enabled/active; GitHub component discovery runs 02:41 UTC. The actual20:10:56UTC encrypted complete set passed native desktop recovery20:13:18UTC:all 3 databases/1,990 files, credentials/RLS/source history/configuration/JWT/Vault/TLS/key/document bytes. A real VM physical checkpoint rollback also passed.
See [automatic updates](OPERATIONS.md#section-hostinger-automatic-updates), [complete backups](deploy/hostinger/backups/README.md) and exact QA evidence evidence.

Only the public age recipient is on the VPS. Daily complete sets are local, with up to 3 adaptive generations/5GiBreserve; desktop copies have been downloaded manually for recovery testing. Recurring off-site/provider daily full-VM retention is **not activated** and its priced approval remains pending. A future necessary boot into installed kernel7.3.0-10 is scheduled;7.3.0-9 still runs and actual boot acceptance is untested.

<a id="section-hostinger-development-target-and-boundaries"></a>

## Target and boundaries

- Portal: <https://cms.luminovia.org>
- Supabase API: <https://cms.luminovia.org/backend>
- Existing Hostinger VM 2163645, KVM 1, Frankfurt: one CPU, 4 GB RAM, 50 GB disk. No agent purchase or upgrade. The user explicitly chose to retain this size for development.
- Portal, PostgreSQL, Auth, Storage objects, Realtime, Edge Functions and ClamAV run together on this VM. There is no managed Supabase dependency in the deployed application.
- Ubuntu 26.10 was the installed system selected during provisioning. Docker and Compose came from its official Ubuntu repositories. A 2 GiB swap file supports setup; it is not a substitute for production RAM.
- Only SSH and web ports are publicly reachable. PostgreSQL, API gateway, Auth, Storage, Edge and ClamAV have no published host ports. The development Mailpit web interface binds only to server loopback.
- `cms` is a new A record, TTL 300, pointing to this VM. The apex/`www` marketing site and all MX/SPF/DKIM/DMARC records were preserved by exact readback comparison. Pre-change DNS snapshot: `168730836`. No nameserver change.
- `lms` uses an A record to the same VPS. `portal` uses a CNAME to `cms.luminovia.org`. Caddy obtains HTTPS certificates for both aliases and redirects HTTP and HTTPS to the canonical CMS with status 308, preserving the path and query. Keep the application and authentication URLs on the canonical host.

The initially approved free Cloud project was created before the user clarified self-hosting. Work on it stopped. It is unused, has no users/files/functions/mail and is not a configured application dependency; it has not been deleted without approval.

<a id="section-hostinger-development-files-and-configuration"></a>

## Files and configuration

On the server, `/opt/luminovia-portal/source` holds the initial source snapshot and current reviewed runtime files; it is not a continuously mirrored Git checkout. Compiled web releases live under `www/releases`, with their deployed commit recorded in `private/updates/state.json`. `/opt/luminovia-portal/data` stores the persistent database/objects/mail capture; `/opt/luminovia-portal/private` stores restricted environment files and operational logs. The two Compose projects are
`luminovia-supabase` and `luminovia-portal`; their private network is `luminovia-portal-backend`.

Caddy mounts the stable `/opt/luminovia-portal/www` directory read-only at `/srv`. `/srv/current` is a symlink to a release below `www/releases`; it supplies the SPA shell and ordinary public files. Hashed assets are served from the shared `www/assets` directory and Workbox bundles from `www`, so a client with an older loaded shell can still fetch its immutable assets after the current release changes. Do not bind-mount a changing symlink target as the document root. `www/maintenance.enabled` is
the explicit reversible API maintenance flag: while present, the public `/backend` route returns 503 with `Retry-After: 60`; it is absent in the accepted running state. Mail templates have a separate read-only mount. Private configuration, source, database files and backups never belong in `www`.

The local ignored `.local/hostinger` directory contains restricted server/build configuration, bootstrap account credentials and deployment/backup evidence. Never copy it into Git or a document root. `ACCOUNTS.txt` is the private handoff for the three fictional development accounts. The default development accounts use passwords and server-side active-account, role, resource-scope and RLS checks. The operator can stage native TOTP for administrators and owners.

The safe generator in `deploy/hostinger/selfhost/generate-env.mjs` creates new configuration once and refuses overwrite. **Do not rerun it to change domains**: preserve the existing keys/passwords and update only endpoint fields. The self-host README documents each server variable. The frontend receives only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; server/database/JWT keys never enter its build.

The pinned official production Supabase base bundle and original image digests are under `deploy/hostinger/supabase`, with original licence, release commit and SHA-256 provenance. That vendor snapshot remains unchanged. The active `selfhost/compose.yml` has a separately reviewed PostgreSQL patch pin, recorded in [postgres-upgrade-provenance.json](deploy/hostinger/selfhost/postgres-upgrade-provenance.json):

```text
supabase/postgres:17.12.0.000@sha256:8630950b489ecc70563300180287a98c192a4a48f5ae00b4febdaeea1abe85de
```

The actual running engine reports PostgreSQL 17.12. The earlier 17.6 image remains recorded as the historical backup source; it is no longer the active VM engine. This deployment does not run `supabase start` as its hosted backend. The self-host composition omits Studio, analytics, meta and the external connection pooler. The public Caddy route allowlists application API prefixes, blocks Auth admin routes, strips referrers, enforces private API cache headers and omits access logging of
token-bearing URLs.

<a id="section-hostinger-development-development-auth-and-storage"></a>

## Development Auth and storage

Public and anonymous signup and phone signup are disabled. TOTP, phone MFA and WebAuthn enrollment and verification are disabled. Admin changes require current database capabilities and resource scopes, with no MFA/AAL2 gate. Auth redirects, invitation/recovery templates and Edge allowed origins use the exact CMS origin and `/backend` API prefix.

SMTP points to private **Mailpit**, not a real mail recipient/provider. Invitations and recovery messages are captured on the VM; nothing is sent to real people. This is deliberate development configuration and must be replaced with separately approved transactional mail settings before real onboarding.

At the recorded `bb322746` installation, eighteen application migrations were applied with source verification in `supabase_migrations.schema_migrations`. The current repository inventory is documented in the [migration guide](DEVELOPMENT.md#section-migration-guide). Use the [reviewed update controller](#section-reviewed-migration-plans) for subsequent application migrations. It retains the installed storage allocation.

The current instance allocates **10 GiB total / 1 GiB per owner**, counting all document versions, including archived/rejected/quarantined versions. Server-only `private.document_storage_limits` controls those allocations. The source maximum is 100 MiB per file; this ceiling does not establish a successful 100 MiB load test on KVM 1. Uploads are scanned on private TCP; scan failure leaves them quarantined. Neither a logical quota nor an application limit increases the VM's physical disk.

For the future approximately 100 GB of documents, provision enough separate headroom for the operating system, images, database/WAL, versions and updates. KVM 2's entire 100 GB disk would be insufficient for that stated end state. No capacity upgrade is authorised by the current development setup.

<a id="section-hostinger-development-operation"></a>

## Operation

Inspect with SSH and `docker compose ps`, using the corresponding project directory, Compose file and environment file. Never print a rendered Compose config or environment values; `config --quiet` validates safely.

```bash
ssh root@72.61.20.240
docker compose --project-directory /opt/luminovia-portal/source/deploy/hostinger/selfhost --env-file /opt/luminovia-portal/private/selfhost.env -f /opt/luminovia-portal/source/deploy/hostinger/selfhost/compose.yml ps
docker compose --project-directory /opt/luminovia-portal/source/deploy/hostinger --env-file /opt/luminovia-portal/private/web.env -f /opt/luminovia-portal/source/deploy/hostinger/compose.yml ps
```

`restart: unless-stopped` and the enabled Docker service preserve operation across normal restarts. Persistent application data are outside the source directory. Never use `down --volumes`, remove data directories, reinstall the VM or reset the database as routine cleanup.

Current test and persistence/backup results are recorded in the relevant pull request checks after actual execution. The offline validators do not replace hosted acceptance. Production still requires complete product/release scope, real SMTP, off-site retention, monitoring, supported-client checks and recovery acceptance.

<a id="section-hostinger-development-historical-setup-checks--superseded-counts-retained-as-dated-evidence"></a>

## Historical setup checks — superseded counts retained as dated evidence

After the controlled PostgreSQL 17.12 image upgrade, all eight actual CMS API suites passed again: public JWKS separation, sign-in/AAL1 restrictions, real temporary-manager TOTP/AAL2, private Mailpit invitation/password setup and PKCE recovery, calendar/RLS/role-forgery rejection, Edge origin/authentication checks, real clean/EICAR scanning and fifty online claim requests from two lecturers. The claims produced exactly one committed winner, all five session allocations and an idempotent winner
retry. Only UUID-scoped test fixtures were removed.

The existing persistence probe passed after the upgrade using the saved passwords and exact private file bytes; another administrator still received 403. Final independent inspection confirmed the exact reviewed 17.12 image, eight healthy Supabase backend services, three existing Auth accounts, eleven migrations and one retained clean private file. Existing profiles/passwords/MFA were not reset. Every connectable database (`postgres`, `_supabase`, `template1`) had stored and actual ICU collation
version 153.121, with zero explicit collation mismatches; no collation reindex was required. The protected non-connectable `template0` was left unchanged.

Earlier actual service stop/start also preserved passwords and the private file, and an actual browser successfully signed in at the CMS URL. The API suites do not replace full hosted DE/EN/mobile/PWA/platform and future-capacity acceptance.

The actual WSS check passed again after the PostgreSQL patch on the canonical CMS domain: permitted owner/member message delivery, no nonmember-admin delivery, and immediate loss of subsequent messages plus REST/RPC access after removal of an already-connected member. Temporary test data and connections were cleaned.

`node deploy/hostinger/backup.mjs --development-vps --quiescent` created an actual off-site database and object backup while development writes were quiescent. `node deploy/hostinger/restore-check.mjs --latest-development-vps` restored that backup into its original pinned 17.6 image and passed exact source roles/memberships/grantor/options, RLS, permissions, migration history, table counts, quotas and every object hash. Before the live patch, `--latest-development-vps-upgrade` restored the same
backup into the exact reviewed 17.12 candidate and additionally compared all eleven stored migration SQL sources with repository files. The retained 114-byte private object matched its original SHA-256.

These are actual networkless local PostgreSQL recovery drills, with no published ports; owned temporary containers/volumes and extracted files were removed. They never restore over the VPS. The helper explicitly accepts only the reviewed 17.6 and 17.12 immutable images; normal recovery follows the image recorded in the backup manifest, and backup records the actual running image/version. An arbitrary candidate or floating tag is rejected. The initial PG17 bootstrap-role replay issue is fixed and
documented in the relevant pull request checks.

A logical restore rebuilds indexes and does not alone establish safe in-place engine compatibility. Check actual database/explicit collation versions and the official release's index/extension requirements before each reviewed engine patch; rebuild affected indexes before refreshing a changed collation version. The 17.12 candidate and actual updated VM both matched the existing default collation. HTTP/Auth/Storage/Realtime acceptance was performed separately on the updated VM as recorded above.

The older `backup.mjs` artifacts in this historical setup check deliberately excluded passwords/JWT/Vault keys. **The currently installed complete encrypted backup includes those secrets**, all connectable databases and actual files; its off-server age identity is required for recovery. Historical logical backup evidence is not the current complete-backup scope, nor a recurring off-site production retention service.

The concurrently merged M3 account/profile/commission extension required a separately pinned historical migration backfill: its three source versions predate the installed storage-capacity migration. A real backup clone passed both deliberate-data-change rollback and exact11-to14 application/idempotence before the frozen live application. Existing data columns/quotas and prior grants were preserved. The accounts worker is read-only mounted and allowlisted in Envoy/runtime. Actual CMS `/v1/me`,
AAL1 directory denial, CORS/internal-path rejection, private-file persistence and WSS revocation passed after resumption. This one-off reviewed exception does not loosen the automatic updater's migration-order guard. See [automatic updates](OPERATIONS.md#section-hostinger-automatic-updates).

Automatic GitHub installation was accepted for signed source7da12e5 after green main CI43733156166: the VPS downloaded the immutable public release, verified every member, backed up data/runtime and served the exact new HTTPS index. Accounts/private-file/WSS checks passed after recreation; all existing accounts/quotas survived. The active five-minute timer, daily OS security policy and recovery controls are documented in [automatic updates](OPERATIONS.md#section-hostinger-automatic-updates). No
manual repository clone is required for later tested main releases.

<a id="section-hostinger-automatic-updates"></a>

<a id="section-hostinger-automatic-updates-automatic-development-updates"></a>

# Automatic development updates

This policy applies only to the authorised self-hosted development instance at <https://cms.luminovia.org>. It does not upgrade the Hostinger plan or declare production acceptance.

<a id="section-hostinger-automatic-updates-daily-dependency-os-and-complete-backup-maintenance"></a>

## Daily dependency, OS and complete-backup maintenance

The newer daily request extends this original application-release mechanism. See [daily verified maintenance](deploy/hostinger/maintenance/README.md) and [complete encrypted recovery](deploy/hostinger/backups/README.md). Stable npm/Node/JSR and active selfhost images receive independent full-test gates, signed fixed-file promotion and exact-main CI. Full updates now keep public access closed through private health and can restore a validated physical checkpoint before public writes resume; a
database rewind after public activation remains forbidden. Transient network retries do not permanently suppress a release. The existing static/controller-only zero-restart path remains.

The new complete backup includes all connectable databases, role passwords and server/TLS/Vault/JWT configuration missing from the older update-only backup. Its age identity stays off-server. Native daily timers coordinate complete backup, official OS packages and necessary reboots under the same host lock. Installation/first-live acceptance is recorded in the relevant pull request checks; source implementation alone is not proof that a timer or purchase is active. Paid Hostinger off-site
full-VM backup is separate and awaits its specific approval. The operating rules below describe the versioned controller contract; the dated acceptance sections record past observations. They do not establish the currently installed commit or live timer state. Inspect the instance read-only before a separately authorised operation.

<a id="section-hostinger-automatic-updates-last-recorded-installed-acceptance--15-november-2026-utc"></a>

## Last recorded installed acceptance — 15 November 2026 UTC

Signed main `bb322746` passed [exact CI43753910114](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43753910114) and immutable release verification. The normal five-minute timer installed it automatically at 20:04:30UTC, including forward migration20261115180559 (18 total). All 10 containers / 9 healthchecks and actual post-install Auth/MFA/mail/recovery/RLS/scanning/50 claims/private-file/WSS checks passed. The preceding11448e4 maintenance release,
reviewed M4 transition and real VM physical rollback drill also passed; see QA evidence.

Complete backup 02:00 UTC, GitHub dependency maintenance 02:41 UTC, official OS 03:00 UTC and necessary reboot 03:30 UTC are configured; all server timers are enabled/active. The latest actual complete set restored successfully at 20:13:18UTC:3 databases / 1,990 files, credentials, permissions, all 18 SQL sources and physical configuration/key/document bytes. Running kernel 7.3.0-9 still awaits the scheduled necessary boot into installed 7.3.0-10; post-boot acceptance is not claimed. Recurring
paid provider/off-site backup is not activated.

GitHub's actual token signature probe passed. The first full compatible candidate run passed application/selfhost/combined gates but correctly stopped promotion when concurrent PR5 moved main. No bot main-promotion success is claimed from that stale-base run. TypeScript 7/FullCalendar 7 are held on actual incompatible peer dependencies; other components proceed independently.

<a id="section-hostinger-automatic-updates-release-builder-output-and-failure-recovery"></a>

## Release-builder output and failure recovery

The prepared [release builder](deploy/hostinger/updates/package.mjs) requires Linux with accessible procfs descriptor paths and GNU tar. Use a real output directory owned by the invoking UID, normally `0700` or `0755`, without group/other write permission; the output leaf must not be a symlink. Existing safe directories may contain unrelated files. The builder pins the directory descriptor, stages each attempt privately and publishes each final name exclusively; it does not silently chmod an
existing directory or overwrite another writer's artifacts.

`cms-release.tar.gz` and `cms-release.json` are **not published as an atomic pair**. A late collision or I/O error can leave an unpaired final archive. That attempt is a failure: stop, inspect the output and artifact ownership, and retry in a fresh owned output directory after resolving the cause. Never blindly remove final files or foreign/unverified files to make a retry pass. An archive alone, an erroring build or a successful unit test is not a valid release pair.

Failure cleanup removes only the builder's private attempt directory. It never unlinks a final output name, because another writer may already have replaced that directory entry.

The focused package suite passes 31 cases, including real competing producers, exact archive hashes, preserved permissions, descriptor failures and late-collision recovery. These results belong to the isolated quality correction, not an installed or published release. See QA evidence for its source boundary.

This local hardening and its tests authorise no release or deployment. Publication retains its separate authorised manual workflow and exact-current-source gates; no installed update, provider activation or production outcome is inferred.

<a id="section-hostinger-automatic-updates-what-is-updated"></a>

## What is updated

After a push to `main`, the separate `Automatic verified CMS release` workflow publishes only when both the complete `Portal checks` and `Security analysis` push runs have succeeded for the exact current main SHA. It rechecks main before publication and shares a per-SHA publication lock with the existing manual path. A failed, pending, missing or superseded check produces no automatic release. The authorised manual `Portal checks` dispatch with `publish_release=true` and exact `expected_commit`
remains available and keeps all its existing gates. Both paths build the CMS frontend with the public `CMS_SUPABASE_URL` and `CMS_SUPABASE_PUBLISHABLE_KEY`, and package the frontend, application Edge Functions, complete migration history and reviewed digest-pinned runtime configuration. No server environment, SSH key, database password or service-role key is sent to GitHub. Source configuration alone does not establish that the hosted workflow has run or a server update succeeded.

The publishing workflow creates a draft, uploads both `cms-release.tar.gz` and `cms-release.json`, and only then publishes the immutable prerelease tagged `cms-dev-<full source SHA>`. Repository immutable releases are enabled. The VPS downloads public artifacts directly; it does not need a GitHub token or a fresh clone.

`luminovia-update.timer` checks approximately every five minutes, with a short random delay. The updater accepts only an immutable release whose tag and manifest match the exact current `main` SHA and a completed successful exact-SHA push or explicit `workflow_dispatch` run of `.github/workflows/ci.yml`. A failed or superseded build is not installed. Every archive member is checked against its path, length and SHA-256; links and traversal paths are rejected. The public endpoint/key hash must
match the existing instance configuration.

Application updates include the self-hosted Supabase functions and compatible new application migrations. Existing migration sources must match exactly. The updater never resets or seeds the database, changes existing passwords/keys, or reapplies development quotas. Destructive/top-level data-rewrite SQL, changed historical migrations, unreviewed runtime changes, PostgreSQL major upgrades and unexpected collation changes stop for operator review. Container images remain pinned. The separate
daily workflow discovers official stable versions, tests independent candidates plus the combined result, and can promote only the fixed reviewed dependency/runtime files from an unchanged base. It never force-installs incompatible peers or blindly follows Docker `latest` tags.

<a id="section-hostinger-automatic-updates-installation-and-recovery-sequence"></a>

## Installation and recovery sequence

Before changing the running system, the updater verifies disk headroom and compares the actual installed runtime bytes and image configuration. A release with unchanged runtime and no pending migrations takes the site/controller-only path: it validates history/configuration, prepares/promotes static files and checks HTTPS without stopping containers, pulling images, scanning Storage or creating a redundant data backup. A failed promotion restores the previous static pointer. It records this mode
explicitly; the previous data backup is retained rather than mislabelled as newly created.

For backend/runtime changes, it pulls the reviewed images. It prepares a separate static release. That full path then briefly returns a bilingual 503 maintenance response for backend calls, stops the six backend writers, and backs up the application database, password-free roles and physical Storage objects. These backups are private **on the same VPS**, with at most two complete generations. They protect update operations but are not an off-site backup service. Separately scheduled complete
encrypted sets include the server environment, password-bearing globals and JWT/Vault/TLS keys; see [complete backups](deploy/hostinger/backups/README.md).

The updater copies runtime files, starts/checks the database, verifies actual collation versions, applies eligible pending migrations transactionally with their exact source history, and starts the backend/web services. It atomically promotes the relative `www/current` symlink and verifies Auth, public JWKS and the exact frontend entrypoint over HTTPS. Shared hashed assets and Workbox files remain available for existing browser sessions.

A full update captures a stopped physical checkpoint of PostgreSQL/keys, Storage and affected persistent runtime data before mutation. An engine patch additionally requires both genuine retained-data proof and a private live-data copy preflight. Public access stays closed through private health. Failure before reopening can restore the previous physical state/runtime and must pass old-service health before reopening. An unresolved failure leaves maintenance active and `manualRecoveryRequired`.
Once public writes have resumed, automatic database rewind is forbidden. Transient discovery/download/image-pull failures back off and retry; unsafe configuration, source-history or mutation failures remain held for review. A static-only rollback never silently removes an applied database migration.

Official Ubuntu base/security/updates run at 03:00UTC through the enabled `apt-daily`/`apt-daily-upgrade` timers after a fresh complete encrypted backup. Necessary reboot has a separate03:30UTC timer under the same `/run/lock/luminovia-maintenance.lock`; unattended-upgrade itself cannot schedule an asynchronous reboot. A pending-reboot marker fences new maintenance. Backup, Apt, reboot and CMS updates share the lock so their service/data changes cannot overlap. The provisioned unsupported Monarx
feed was preserved and disabled only after confirming no Monarx package/service was installed; the tested application ClamAV remains active.

<a id="section-hostinger-automatic-updates-operator-commands"></a>

## Operator commands

On the VPS:

```bash
systemctl status luminovia-update.timer --no-pager
systemctl list-timers luminovia-update.timer luminovia-complete-backup.timer apt-daily.timer apt-daily-upgrade.timer luminovia-required-reboot.timer --no-pager
journalctl -u luminovia-update.service -n 30 --no-pager
cat /opt/luminovia-portal/private/updates/state.json
python3 /opt/luminovia-portal/control/updater.py --check
```

The state and journal contain commit IDs and reason codes, not credential values. `--check` is read only. `systemctl start luminovia-update.service` performs one normal verified check through the shared lock. After inspecting and resolving a failed update, an operator can invoke `--once --retry-failed` through the same lock. Do not clear maintenance or recovery state before establishing why the update stopped.

Initial adoption uses a root-owned private state with `bootstrapApproved: true`, allowing the first real GitHub release to be adopted without inventing a current commit. A successful installation records `currentCommit` and clears that flag. The installed control program updates itself only from the same verified release. Unit/timer or OS policy changes remain a reviewed operator task.

Current operational evidence and the actual first GitHub installation are recorded in QA evidence. Development SMTP remains internal Mailpit; 100 GB capacity, recurring encrypted off-site retention and production operations remain separate work.

<a id="section-hostinger-automatic-updates-reviewed-initial-m3-history-exception"></a>

## Reviewed initial M3 history exception

PR#3 was merged while hosting work was being prepared. Its three migration versions precede the already installed capacity migration. The ordinary updater correctly rejects that order. `deploy/hostinger/reviewed-m3-backfill.mjs` is a separate operator-only exception for exactly those three source SHA-256 values, on this fixed development target with writers stopped. It verifies all existing historical source, fingerprints every existing data column, preserves prior permission grants, and runs
all three migrations plus exact source history in one transaction. A real backup clone demonstrated rollback on a deliberate protected-data mutation, successful11-to14 application and idempotent repeat. No seed/reset/password/quota changes are permitted. This exception does not weaken future automatic migration checks.

<a id="section-hostinger-automatic-updates-first-installed-release-acceptance"></a>

## First installed release acceptance

[Main CI43733156166](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43733156166) passed and published immutable `cms-dev-7da12e5005f6407d4646f6f1a25146cc26f8ef22`. The real network-driven systemd installation completed at 2026-11-15T16:13:58UTC. Its backup hashes/recovery map and exact live HTTPS index were verified. Post-install accounts/private-file/WSS-revocation checks passed; three existing accounts, fourteen migration entries and10GiB/1GiB quotas
remained unchanged. The first run applied no migrations because the reviewed backfill was already complete. Bootstrap approval is cleared and the five-minute timer remains active.

<a id="section-notification-delivery-database"></a>

<a id="section-notification-delivery-database-transactional-notification-email-delivery"></a>

# Transactional notification email delivery

Migration `20261116091007_notification_email_outbox.sql` adds an opt-in email channel to the existing committed inbox. It does not replay existing inbox history. Every new supported notification occurrence creates at most one private outbox row in the same transaction; a rolled-back claim or cancellation therefore produces no deliverable email. Renewed reopening occurrences are distinguished by the inbox occurrence timestamp. Marking a notification read does not queue another message.

<a id="section-notification-delivery-database-account-preferences"></a>

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

The response adds the positive integer `version`. Saving uses compare-and-swap; a stale version returns SQLSTATE `40001`. Quiet hours require either two nulls or two distinct `HH:MM` times, together with a current PostgreSQL IANA time-zone name. The interval includes its start and excludes its end. Midnight-spanning intervals and Berlin DST use local wall-clock times; Brisbane keeps its own zone. Quiet hours defer all opted-in email categories, including cancellation receipts. Existing in-app
receipts remain available independently.

There is no actor ID parameter and no administrator bypass. Private preference/outbox tables have RLS enabled and no direct authenticated, anonymous or service-role table grants. The exposed wrappers retain invoker security; reviewed implementations are isolated in `private` with empty search paths.

<a id="section-notification-delivery-database-worker-protocol"></a>

## Worker protocol

Only the actual `service_role` database role can execute these public wrappers or their private implementations. Browser-supplied JWT metadata cannot confer that role.

1. `refresh_notification_reminders(p_limit integer default 100)` scans at most 100 active, opted-in accounts with reminders enabled and no scan in the preceding 15 minutes. It creates unique inbox reminders for confirmed, unreleased sessions within 24 hours and active, unrevoked contracts expiring within 30 days. It returns the number of newly inserted inbox reminders. An external finite worker/timer must actually call it; the migration itself installs no scheduler.
2. `lease_notification_emails(p_limit integer default 20)` claims at most 100 due outbox rows using row locks and `SKIP LOCKED`. The JSON array contains only `{id, lease_token}`. Leases expire after five minutes. Each claim increases the attempt count, to a maximum of five safe attempts.
3. `prepare_notification_email(p_id uuid, p_lease_token uuid)` immediately rechecks the lease, current account activity, current primary Auth email, opt-in, category preferences and quiet hours. It also suppresses stale session/contract reminders, removed or muted chat memberships and unpublished job offers. It returns null when deferred/suppressed or a minimal `{id, lease_token, recipient, locale, kind, message_id}` object and changes the row to `sending` before SMTP starts. No course names,
   contract titles, document text or chat content are included. Resource links are resolved only after login through the existing inbox.
4. `finish_notification_email(p_id uuid, p_lease_token uuid, p_outcome text, p_error_code text default null)` accepts `accepted`, `retry`, `failed` or `uncertain` and returns whether that fenced outcome was recorded. Repeated identical completion is idempotent. Error codes permit only lowercase letters, digits and underscores; raw SMTP errors, recipients and credentials must never be recorded. Known safe retries use exponential backoff, starting at 60 seconds and bounded at one hour, with no
   more than five attempts.

`message_id` remains `<luminovia-notification.OUTBOX_UUID@luminovia.org>` across a safe retry. SMTP acceptance is not proof of final inbox delivery. SMTP cannot provide exactly-once atomic delivery with PostgreSQL: a worker crash or lost acknowledgement after DATA may leave the outcome unknown. Such rows become `uncertain` and are never blindly retried. Expired pre-send `leased` rows can be recovered with a new fencing token; expired `sending` rows become uncertain. This deliberately favors
avoiding duplicate cancellation/assignment mail over guessing delivery after an ambiguous failure. Operator reconciliation is separate from automated retry.

Credentials belong only in the server worker's protected environment/secret files. The migration creates no SMTP credential storage, connects to no SMTP server and sends no email. The finite worker and actual timer installation need separate execution and acceptance.

<a id="section-notification-delivery-database-executed-checks"></a>

## Executed checks

`PORTAL_DB_CONTAINER=supabase_db_luminovia-portal-test-m7 node scripts/notification-delivery-db-tests.mjs` passed 17 real PostgreSQL groups in a disposable database, including a 50-occurrence concurrent lease race, transaction rollback, no history replay, per-account CAS and ACLs, current recipient checks, quiet hours/DST, fencing, terminal uncertainty, safe retry bounds and scheduled-reminder cancellation/revocation. The helper drops its own database afterwards.

The existing notification suite passed 15 groups, and `scripts/api-surface-db-tests.mjs` passed all six security/interface groups against a complete migration replay. These are database checks, not proof of production installation, real Hostinger delivery, timer execution or browser acceptance.

`scripts/notification-delivery-api-check.mjs` additionally defines actual disposable-stack Auth/REST acceptance for account preferences, CAS, invalid quiet hours, untrusted metadata and administrative worker denial, current Auth recipient revalidation, fenced synthetic completion and post-lease opt-out. It never opens an SMTP connection. The separate email preference journey in `tests/e2e/notifications.spec.ts` covers German-to-English draft preservation, Brisbane quiet hours, persisted reload
and offline edits followed by an explicit online save. Both browser projects include that journey. The earlier complete smart-operations checkpoint executed actual API/browser flows; its named source and limits are recorded in the relevant pull request checks. Discovery or a source-only pass on a newer revision does not repeat that acceptance. Current source-to-suite mappings are in [FUNCTIONAL_ACCEPTANCE](DEVELOPMENT.md#section-functional-acceptance).

<a id="section-notification-mail-operations"></a>

<a id="section-notification-mail-operations-notification-email-delivery"></a>

# Notification email delivery

The application now has a finite server-side worker for the transactional notification outbox. It is separate from Supabase Auth invitations/recovery and from the browser. This source change does not install a timer, alter the running Hostinger Mailpit configuration, authenticate to a real mailbox or send a real email. The supplied environment template is disabled. Per-user email delivery is also opt-in and initially off.

<a id="section-notification-mail-operations-hostinger-connection"></a>

## Hostinger connection

The supported Hostinger upstream is `smtp.hostinger.com`, port **465** with implicit TLS or port **587** with mandatory STARTTLS. The Auth service and notification worker connect only to the private `mail-relay` bridge; it loads the current settings and credentials from Supabase Vault per operation, resolves public DNS once, pins the socket to a globally routable address and verifies the certificate against the configured DNS name. Internal, loopback and IP-literal provider hosts are rejected.
The bridge rewrites the From/envelope sender to the saved sender address. There is no plaintext upstream, port-25 fallback or automatic TLS downgrade. Mailbox credentials are write-only in Administration > Mail and are never stored in this repository.

Sources: [Hostinger email configuration](https://www.hostinger.com/support/1575756-how-to-get-email-account-configuration-details-for-hostinger-email/) and [Hostinger application setup](https://www.hostinger.com/support/4305847-set-up-hostinger-email-on-your-applications-and-devices/).

A saved SMTP test performs TLS, login and `NOOP` only; it does not submit an email. The optional IMAP test performs TLS, login and `NOOP` only; it does not read or modify mailbox contents. These checks establish the current server handshake, not inbox delivery, quotas, provider reputation or a real-recipient delivery witness. Local development and isolated candidates keep Auth messages in Mailpit; the candidate explicitly bypasses the real relay.

<a id="section-notification-mail-operations-configuration-and-activation"></a>

## Configuration and activation

The reviewed worker files are in [deploy/hostinger/notification-mail](deploy/hostinger/notification-mail). The self-host generator writes a separate `<server-env>.notification.env` with mode `0600`; keep it root-owned outside `www`, and supply it only to the separately installed, disabled-by-default worker. It contains a service-role key and the random internal relay credential, not the upstream mailbox password. The worker connects only to `127.0.0.1:2526`, published by the relay; upstream
credentials remain in Vault. Never use a `VITE_` variable or commit either generated environment file. A blank/unconfigured credential fails closed.

Configuration variables:

| Variable                              | Purpose                                                                                                                                                              |
|---------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `PORTAL_NOTIFICATION_MAIL_ENABLED`    | Only literal `true` permits a delivery run. Default/off values make no network calls.                                                                                |
| `PORTAL_NOTIFICATION_API_URL`         | Supabase API origin, optionally ending in `/backend`. HTTPS required except an exact loopback IP for a private local gateway. No URL credentials, query or fragment. |
| `PORTAL_NOTIFICATION_APP_ORIGIN`      | Reviewed portal origin for the generic `/notifications` link. No path, query or credentials.                                                                         |
| `PORTAL_NOTIFICATION_SERVICE_KEY`     | Server-only key for the narrowly granted worker RPCs; never a browser key.                                                                                           |
| `PORTAL_NOTIFICATION_SMTP_USERNAME`   | Random internal relay login generated for this installation.                                                                                                         |
| `PORTAL_NOTIFICATION_SMTP_PASSWORD`   | Matching random relay password, stored in the root-only generated worker file.                                                                                       |
| `PORTAL_NOTIFICATION_SMTP_PORT`       | Fixed loopback relay port `2526`; provider ports are configured in Administration > Mail.                                                                            |
| `PORTAL_NOTIFICATION_BATCH`           | Finite batch size, default 10 and maximum 20.                                                                                                                        |
| `PORTAL_NOTIFICATION_TIMEOUT_SECONDS` | Per-network-operation timeout, default 15 and maximum 20 seconds.                                                                                                    |

Calling the worker with no flags is a dry run and makes **zero API/SMTP calls**, even if the environment is enabled. `--check` validates configuration without leases or network calls. It requires enabled configuration to perform the validation; otherwise it reports disabled. `--run` and the environment flag together permit one finite batch. Do not put credentials in command arguments or paste them into shell history.

After reviewed migrations are applied, an operator may test private configuration with `python3 scripts/notification-mail-worker.py --check`. Installing/starting the supplied systemd service/timer is a separate activation action. It must use the exact reviewed source and private environment path, and an explicitly authorised recipient for any live delivery proof. No such activation or provider deliverability proof belongs to the source tests below. The timer attempts a finite batch approximately
every minute; it does not guarantee a one-minute delivery SLA or bypass provider quotas. Its shared existing maintenance lock prevents this database writer crossing an exclusive backup/update/restore operation. The worker enforces a Linux wall-clock batch budget of 240 seconds, including peers that drip response bytes. An interrupted SMTP operation gets one completion RPC bounded by at most 20 additional seconds. API interruption leaves the lease fenced. The outer service bound is 300 seconds;
forced termination may leave a sending row uncertain, which is intentional.

<a id="section-notification-mail-operations-delivery-and-recovery-semantics"></a>

## Delivery and recovery semantics

1. `refresh_notification_reminders(p_limit=100)` creates due reminder notifications for up to 100 active, email-opted-in accounts per run, respecting the reminders category and a 15-minute per-account scan interval. It considers confirmed, unreleased sessions within 24 hours and active, unrevoked contracts expiring within 30 days. `lease_notification_emails(p_limit)` then leases only due committed events. The browser cannot choose recipients or invoke worker RPCs. New events are enqueued
   transactionally; pre-existing inbox records are not retroactively mailed.
2. `prepare_notification_email(p_id,p_lease_token)` rechecks the current recipient account, current Auth email, opt-in, notification category preferences and local quiet hours. It returns `null` when suppressed/deferred, otherwise minimal locale/kind/recipient metadata and a deterministic Message-ID. Preparing transitions the lease to `sending` **before** SMTP begins.
3. The worker sends one generic DE/EN message, with a generic cancellation subject where relevant and an authenticated-portal link. It includes no course title, contract/document content, calendar details, private chat body, token or signed URL. All detailed access checks still happen in the signed-in portal.
4. The worker reports `accepted` only after SMTP returns `250` for DATA. This means the provider accepted the message; it does not prove inbox delivery or that the recipient read it. Known explicit temporary SMTP rejection or connection failure **before DATA** can retry with database backoff. A negative `4xx` DATA response also explicitly rejects acceptance and can retry safely. Permanent rejection is `failed`.
5. A lost connection/final response during DATA becomes `uncertain`. If SMTP accepted but the completion RPC failed, the worker never resends. An expired `sending` lease becomes `uncertain`, while an expired untouched lease can return to pending. A deterministic Message-ID supports investigation, but is not an exactly-once guarantee from SMTP providers.

Retries are database bounded (five attempts with increasing delay). Do not blindly reset `uncertain` or `failed` rows. Reconcile the exact outbox ID/Message-ID with a separately authorised provider record and the database state; make any recovery decision explicitly. There is no automatic resend API for uncertain rows in this slice. The mailbox/account status, provider limits and bounce processing remain operational follow-up; no bounce webhook or delivery/read tracking is claimed.

The worker emits only aggregate counts and fixed error codes, with no recipient addresses, server response text, message bodies, URLs or credentials. HTTP redirects are refused so service headers cannot be forwarded to a new destination. Failed/uncertain/RPC-error batches return exit 1; invalid configuration returns exit 2. A disabled/dry/configuration-check run returns exit 0. Timer/process health and uncertain queue counts need operational monitoring before relying on unattended live delivery.

<a id="section-notification-mail-operations-executed-source-verification"></a>

## Executed source verification

```bash
python3 -W error::ResourceWarning -m unittest scripts/test_notification_mail_worker.py
```

The current worker suite contains **31** cases, and the private relay suite contains **8** loopback-only cases; both run through the canonical runtime runner. The relay tests use mocked upstream SMTP/IMAP behavior and never contact a provider. The Deno `mail-admin` handler tests verify JWT forwarding, current SQL permission denial, request bounds and safe status redaction. These source tests do not prove a real Hostinger connection, real-recipient mail delivery or production provider readiness.
Real PostgreSQL lease/permission/backoff tests remain in `scripts/notification-delivery-api-check.mjs` and `scripts/notification-delivery-db-tests.mjs`; the guarded API check uses a fictional loopback SMTP capture.

Automatic mail delivery covers events actually produced by the application and the bounded reminder refresh above. Automatic reminder refresh requires an enabled scheduled worker and email opt-in; users without email opt-in retain the existing manual in-app reminder refresh. This worker does not implement Web Push, SMS/mobile OS alerts, or change invitation/recovery SMTP. Those remain separate product/activation work.

The immutable release now maps the exact tracked Python source into `deploy/hostinger/notification-mail/worker.py` and includes disabled unit/environment templates. The service uses `/opt/luminovia-portal/source/deploy/hostinger/notification-mail/worker.py`; the development CLI remains under `scripts/`. A functional archive test extracts and runs the delivered stdlib worker outside the source checkout with no flags, observing zero network calls. Workers and private credentials are excluded from
the public `site/` tree. Timer installation and server configuration still require the reviewed activation procedure.

<a id="section-security-privacy-checklist"></a>

<a id="section-security-privacy-checklist-security-and-privacy-release-checklist"></a>

# Security and privacy release checklist

Use this page to review security boundaries before a release. It describes the
maintained source and the evidence required to accept it. It does not certify a
running installation or legal compliance. Revision-specific results, failures and
stages not reached belong in QA evidence and the
[functional acceptance matrix](DEVELOPMENT.md#section-functional-acceptance). Remaining product work
stays in the [roadmap](ROADMAP.md) and [product specification](PRODUCT.md#section-product-spec).

Earlier versions of this checklist quoted the ten-migration M2 baseline and
43 tables as if they were current. Those figures are historical, not the schema
of the current application. Derive current schema, grants and RPCs from an actual
migration replay; use the [API reference](API_REFERENCE.md) and
[migration guide](DEVELOPMENT.md#section-migration-guide). Do not carry old checked boxes forward as
acceptance of new source.

<a id="section-security-privacy-checklist-review-map"></a>

## Review map

| Boundary                             | Maintained source and guide                                                                                                                                                          | Required evidence                                                                                                                              |
|--------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------|
| Authentication and account authority | `supabase/functions/accounts/`, migrations; [delegated roles](GUIDE.md#section-delegated-roles-pricing)                                                                              | Separate active/suspended accounts, subordinate-role restrictions, password-only sessions, invitation idempotency and rejected escalation      |
| Database API                         | Public RPC wrappers, private implementations, RLS and explicit grants; [architecture](DEVELOPMENT.md#section-architecture), [API](API_REFERENCE.md)                                  | Fresh and retained-data replay, effective privileges, invoker boundary, direct table/column denial and actual HTTP requests                    |
| Claims and accepted agreements       | [job lifecycle](GUIDE.md#section-job-lifecycle), commercial security, [urgent teaching cover](GUIDE.md#section-replacement-marketplace)                                            | Real competing claims, complete-session atomicity, conflicts, retry identity, role-bound consent and immutable financial/session history       |
| Private resources                    | chat security, [files](GUIDE.md#section-files), course document privacy                                                                                                              | Allowed and foreign actors, current membership, revocation with an existing session, exact-version bytes and direct Storage denial             |
| Qualifications and profiles          | [qualifications](GUIDE.md#section-qualifications), [avatars](GUIDE.md#section-profile-avatars), [staff contact visibility](GUIDE.md#section-staff-contact-visibility)                | Explicit evidence sharing, exact clean versions, appropriate reviewer permission and revoked access                                            |
| Calendar and availability            | [calendar](GUIDE.md#section-calendar), [availability](GUIDE.md#section-availability), [calendar connections](GUIDE.md#section-calendar-connections)                                  | Private-event isolation, explicit publication, conflict races, scoped subscription credentials and IANA/DST checks                             |
| Knowledge and discovery              | knowledge security, [job discovery](GUIDE.md#section-job-discovery)                                                                                                                  | Safe authored content, draft isolation, literal server-side search, pagination, safe links and immediate permission changes                    |
| Notifications and delivery           | [notifications](GUIDE.md#section-notifications), [email operations](OPERATIONS.md#section-notification-mail-operations), [Web Push](GUIDE.md#section-web-push)                       | Committed events only, recipient/source recheck, preference/quiet-hour handling, deduplication and uncertain-delivery recovery                 |
| Browser identity and PWA             | `src/features/auth/`, query keys, router and service worker; [test plan](DEVELOPMENT.md#section-test-plan)                                                                           | Actor-change cache reset, no private offline responses, no false offline mutation success, DE/EN and accessibility checks                      |
| Runtime, backup and recovery         | [operations](OPERATIONS.md#section-operations), [update controls](OPERATIONS.md#section-hostinger-automatic-updates), [deployment runbook](OPERATIONS.md#section-deployment-runbook) | Owned process/data targets, migration history, retained credentials/file bytes, encrypted complete restore and rollback within its safe window |
| Contribution and supply chain        | [CI quality](DEVELOPMENT.md#section-ci-quality), dependency audit, [GitHub rules](DEVELOPMENT.md#section-github-workflow)                                                            | Signed history, current-base required checks, dependency audit and separate assessment of security findings                                    |

Cancellation, reopening, capacity, directed replacements and delivery-worker
source now exist. They must be assessed through their actual feature guides and
source-specific tests; they are no longer accurately described as universally
unimplemented. Similarly, historical development backup/restore drills do not
accept a future production installation.

<a id="section-security-privacy-checklist-verify-every-changed-permission-boundary"></a>

## Verify every changed permission boundary

- [ ] Use trusted current database roles, activity and resource membership; this product has no MFA.
  Editable Auth metadata, a hidden button or a caller-supplied role never
  authorises a request.
- [ ] Check effective table, column and function grants as well as RLS. Public
  invoker wrappers must not accidentally acquire broad execution privileges;
  private privileged routines need narrow grants and an explicit search path.
- [ ] Verify both permitted access and denial by another actor, after revocation,
  through the real API. Include bytes, search results, realtime delivery and
  repeated requests where the change reaches them.
- [ ] Preserve the absence of a blanket administrator read bypass for private
  DMs, calendar events, personal evidence, contracts and invoices.
- [ ] Keep accepted commercial/session/contract snapshots immutable. Explicit
  audited amendments or substitutions must follow their dedicated workflow.
- [ ] Keep quarantine, real scanning, exact clean versions and download
  re-authorisation. Do not substitute public buckets, permanent file URLs or
  sensitive offline caches.
- [ ] Confirm a claim only after the successful online database transaction;
  test concurrency, whole-block allocation, eligibility, conflicts and retries.

<a id="section-security-privacy-checklist-verify-configuration-and-artifacts"></a>

## Verify configuration and artifacts

- [ ] Public builds contain only the public Supabase URL/key configuration.
  Service-role keys, passwords, JWTs and private traces stay out
  of browser code, Git, screenshots and published artifacts.
- [ ] Test with fictional records and disposable owned resources. Preserve normal
  local/hosted data and foreign processes; raw `.local` data is private.
- [ ] Run relevant checks against the exact candidate and identify the selected
  CI profile. A documentation/standard profile or test discovery is not
  evidence of full native/browser execution.
- [ ] Review current dependency and CodeQL results. A successful scanner job is
  distinct from resolution of its findings; historical triage
  is not the current alert inventory.
- [ ] Confirm the production CSP/HTTPS/cache headers, Auth redirects, gateway
  origins and private storage configuration on the actual approved target.
- [ ] Verify current backup coverage includes database data, Storage object bytes,
  configuration and recovery keys. Prove restore and define incident owners,
  monitoring, retention and recovery access on that target.

<a id="section-security-privacy-checklist-separate-operational-and-legal-acceptance"></a>

## Separate operational and legal acceptance

- [ ] Record the intended operators, capability owners and disclosed moderation
  policy; verify account recovery, session expiry and suspension procedures.
- [ ] Approve processor locations/agreements, lawful purposes, retention/deletion,
  data-subject handling and legal/privacy documents for the real operation.
- [ ] Approve any real SMTP/push activation and recipients separately. Worker
  source, an internal capture or SMTP acceptance does not prove inbox delivery.
- [ ] Complete manual keyboard, screen-reader, zoom, Safari/Firefox/iOS and
  physical PWA checks appropriate to the release. Automated axe and emulation
  do not certify every platform or full accessibility compliance.
- [ ] Obtain explicit approval for the concrete production release and any
  associated hosting, DNS, real-data or migration operation. A green PR and a
  merge do not publish or authorise it.

Contract receipts are acknowledgements, not an assertion of legally effective
signatures. Finance tracks assignments, invoices and payments; it does not claim
to be payroll, tax/accounting software or a bank integration.

<a id="section-reviewed-migration-plans"></a>

<a id="section-reviewed-migration-plans-explicit-reviewed-migration-plans"></a>

# Explicit reviewed migration plans

The ordinary five-minute updater keeps its strict SQL classifier. A plan file is never discovered automatically. An operator may explicitly approve one complete, immutable current-main release with `--once --package … --manifest … --reviewed-migration-plan …` after reviewing its exact pending SQL. This route uses the existing stopped-writer backup, physical checkpoint, runtime installation, transactional migration, private-health and rollback lifecycle. It does not run manual SQL beside that
lifecycle.

This document describes source behavior and local test evidence. It does not assert that this controller, any plan, a migration or notification worker has been installed on a VPS. Normal deployment authorisation and current coordination holds still apply.

<a id="section-reviewed-migration-plans-what-a-plan-authorises"></a>

## What a plan authorises

The plan binds one instance root, installed commit, target commit, complete manifest hash, archive hash, the full installed migration version/source hashes, and every pending migration path/version/source hash. It records which pending statements the unattended classifier rejects. Changed history, missing history, source drift, backdated pending versions, a different manifest or installed commit all fail closed. Review cannot rewrite already applied sources or bypass the existing
PostgreSQL-major/collation/runtime gates.

The plan requires existing source history and a distinct installed commit; it is not an initial bootstrap mechanism. Its default lifetime is one hour, bounded to 60–7200 seconds. Application requires a root-owned regular file with exact mode `0600`, one hard link, no symlink, and a direct path under `/opt/luminovia-portal/private/updates/reviewed-migrations/`. The instance root, private directory, update directory and plan directory must be root-owned and not writable by group or others. Root
ownership is the local trust boundary; there is no public/browser approval API or unattended approval flag.

At application time, the target must still be the exact current `main`, with successful exact-SHA CI and an immutable release. The local manifest must equal that published release's full manifest; its archive and every extracted file must verify. The updater repeats the release/history/file checks after backup and checkpoint, immediately before consuming the plan. It rechecks the lifetime again after the last network request, immediately before exclusive reservation. An intervening main
promotion or history change aborts before reviewed SQL.

The reviewed SQL still requires one explicit `BEGIN;`/`COMMIT;` transaction with the established own-line delimiters. Nested top-level transaction control, parser string-mode changes, `ALTER SYSTEM` and `COPY … PROGRAM` are rejected. SQL inside function/DO bodies remains inside PostgreSQL's enclosing transaction. The exact source history is inserted before the same commit, under the migration advisory lock.

### Full reset of the existing CMS installation

In an owned local portal started with `./portal start`, open **Administration → System operations → Reset platform** as an active administrator or owner. Verify the project shown, type `DELETE`, and enter your current password and authenticator code if enrolled. The browser invokes the same owned Docker reset as `./portal reset`. The web server stops during deletion. Check completion from your terminal with `./portal status`.

On the named CMS server, use `./portal reset-live --plan` from the verified checkout or `python3 -I /opt/luminovia-portal/source/deploy/hostinger/reset-live.py --plan` from the deployed package. The plan checks the exact installation, the active release, owned data mounts, applied migration source and a fresh complete encrypted backup. Apply with `--apply` in an interactive SSH terminal. The operator must have host-root access, a current active portal administrator or owner account, that account's verified authenticator and the fresh site-specific confirmation shown by the command. The operator supplies a new password for the replacement owner.

The reset stops the backend under the shared maintenance lock. It recreates PostgreSQL with the current installed schema and replaces local Storage bytes and private captured mail. The old data stays in a private quarantine until the fresh owner can sign in and the private runtime is healthy. An early failure attempts to restore the original data paths. Inspect `private/reset-state.json` before recovering an interrupted reset. The command keeps the deployed application, server configuration and separately managed encrypted backup sets. It does not access the public Website or third-party storage.

<a id="section-reviewed-migration-plans-prepare-concrete-release-and-history-evidence"></a>

## Prepare concrete release and history evidence

Use the reviewed controller from a verified source/package. Keep package and manifest files outside writable application data. The local files in the following examples must be the exact published immutable release, not a rebuild with the same claimed commit.

On the VPS, planning can read the actual installed state and SQL history without stopping services:

```bash
sudo python3 /opt/luminovia-portal/control/updater.py \
  --plan-migrations \
  --package /root/review/cms-release.tar.gz \
  --manifest /root/review/cms-release.json \
  --plan-output /opt/luminovia-portal/private/updates/reviewed-migrations/review-001.json
```

This creates a new file exclusively; it refuses to overwrite an existing review. Without `--plan-output`, it prints `{status, planSha256, plan}` and creates no instance directories. Plan construction verifies the complete archive and reads history, but never stops containers, applies SQL, consumes a plan or activates mail/push.

For offline review, export only migration version/source data and note the actual installed `currentCommit` separately. The history snapshot format is a JSON array of exact `{ "version": "…", "source": "…" }` rows, with no duplicate versions or missing sources. For example, an authorised operator can produce it using:

```bash
umask 077
sudo docker exec luminovia-supabase-db-1 psql -U postgres -d postgres -X -qAt \
  -c "SELECT coalesce(json_agg(json_build_object('version',version,'source',statements[1]) ORDER BY version),'[]'::json)::text FROM supabase_migrations.schema_migrations" \
  > migration-history.json
```

Then run the read-only builder locally, replacing the installed SHA with the actual value from the instance state:

```bash
python3 deploy/hostinger/updates/updater.py \
  --plan-migrations --root /opt/luminovia-portal \
  --package /absolute/review/cms-release.tar.gz \
  --manifest /absolute/review/cms-release.json \
  --history-file /absolute/review/migration-history.json \
  --installed-commit INSTALLED_40_CHARACTER_SHA
```

Offline input is evidence for preparing the review; it never replaces the live history checks during application. Transfer a final plan to the required private root-owned path, preserving its exact fields and `0600` mode, or create it there using the live builder. A file copied to a different instance root fails binding.

<a id="section-reviewed-migration-plans-review-and-apply-once"></a>

## Review and apply once

Inspect the plan's installed/target commits, complete manifest/archive hashes, full applied inventory and every pending source digest/review reason. Review the corresponding exact SQL bytes in that verified package together with the migration guide, permissions, data changes and rollback implications. Hashes identify the concrete work; they do not replace SQL review. Creating or printing a plan alone does not approve execution. Passing its path explicitly at application is the operator's
approval of that concrete review.

Before application, ensure the existing complete encrypted recovery set is fresh and verified. The updater requires it to be at most 26 hours old and rechecks ciphertext lengths/hashes. If needed, run the existing complete-backup operation **before** starting the reviewed updater; both operations take the shared maintenance lock and must not be nested. The updater also creates its normal fresh stopped-writer update backup and validates the physical checkpoint before consuming the plan.

```bash
sudo python3 /opt/luminovia-portal/source/deploy/hostinger/backups/complete_backup.py --ensure-fresh
sudo python3 /opt/luminovia-portal/control/updater.py \
  --once --package /root/review/cms-release.tar.gz \
  --manifest /root/review/cms-release.json \
  --reviewed-migration-plan /opt/luminovia-portal/private/updates/reviewed-migrations/review-001.json
```

The explicit reviewed command acquires `/run/lock/luminovia-maintenance.lock` before the updater-specific lock. It also recognises an already-held inherited `flock` descriptor and retains the caller's lock. Concurrent backup, OS maintenance or another updater cannot overlap this path. Reboot-pending, OS-update, active-maintenance and unresolved-recovery gates remain effective.

Immediately before runtime/SQL mutation, the updater durably creates a `0600` consumed record under `reviewed-migrations/used/<plan UUID>.json`, fsyncs it and records its hash/identity in update state. Copying or renaming the approved file cannot replay its UUID. A crash after consumption may leave an unused authorisation consumed; this deliberately requires a new review rather than a blind retry.

<a id="section-reviewed-migration-plans-failure-and-retry"></a>

## Failure and retry

Before public access resumes, the normal physical checkpoint/runtime rollback remains available. A consumed plan stays consumed after rollback because its tombstone is outside the physical data mounts. Existing failure state and `manualRecoveryRequired` remain authoritative. After public writes resume, automatic database rewind remains forbidden.

If the release was already open to public writes before a final check failed, the updater fences it again and records `forwardRetryAvailable`. An operator can pass `--once --retry-failed --package … --manifest …` for the exact failed release while it remains the eligible immutable current main. The complete migration ledger must already match. The updater takes a fresh checkpoint of the current data and checks the private runtime before reopening access. A failed attempt keeps maintenance active. If the updater cannot restore a private checkpoint successfully, resolve the recorded recovery state before retrying.

A retry after a failed, consumed attempt needs a newly constructed and reviewed plan with a new UUID, current live installed history/state and valid lifetime. Use `--retry-failed` with the same explicit local package, manifest and new reviewed plan. The target must equal the recorded failed commit and still be the eligible immutable current main. If main has moved, resolve recovery and prepare a fresh ordinary review for the eligible target; do not erase failure evidence or reuse the consumed
file.

The unattended timer never reads a plan or relaxes its classifier. A normal timer rejection therefore cannot silently activate a file an operator previously prepared.

<a id="section-reviewed-migration-plans-local-verification-evidence"></a>

## Local verification evidence

`python3 -m unittest discover -s deploy/hostinger/updates -p 'test_*.py'` runs the existing updater suite plus 25 focused reviewed-plan cases (63 total at this source). The cases cover strict unattended policy, all identity/source bindings, CRLF preservation, no-overwrite/root/mode/link/TTL validation, one-shot consumption across rollback, exact-SHA retry, complete-backup/checkpoint ordering, pre-mutation drift, actual process `flock` contention/inheritance and read-only CLI behavior.

`node scripts/reviewed-updater-db-tests.mjs` creates and drops an owned local PostgreSQL test database. Its five groups prove ordinary rejection, reviewed exact-source commit, full rollback on a later statement failure, PostgreSQL rejection of concealed transaction termination, and concurrent duplicate-history rollback without a second data rewrite. The fixture uses the real updater's SQL envelope; it does not claim a real VM physical restore or deployment acceptance.

`node scripts/reviewed-upgrade-retention-db-tests.mjs` separately starts with the exact 18 migration sources from release `bb322746`. It adds fictional retained accounts, a course, contract and invoice records, a partial payment, document version metadata and custom storage quotas. The real migration inventory and transaction wrapper advance the disposable database. The test compares the original records after the upgrade and a second application and checks invoice access for its owner and an unrelated learner. Use the complete backup and independent recovery procedure to verify physical files and hosted data.
## Company course webhooks

An administrator or owner opens **Admin → Companies → API integrations → Company webhooks** and subscribes an active company integration key to a receiver alias. Each alias is configured by the operator for that company. The subscription's signing key is displayed once at creation. Copy it into the receiver's secret store. Revoke a subscription and create a new one to rotate its signing key. Rotating, revoking or expiring the underlying integration key invalidates its subscriptions.

The course worker emits `course.published`, `course.updated` (template or time zone changes), `course.schedule_changed`, and `course.assignment_changed`. A real admin can additionally opt a subscription into Premium course events for an enabled company. These events cover changes in enrolment, exam publication, verified attendance, completion records and clean company-visible materials. Premium events are delivered only while the exact enqueue-time entitlement period remains current. The v1 JSON body contains `id`, `type`, `version`, `occurred_at` and `course_id`. Consumers can fetch a published course through the existing company integration API. The payload contains no course names, participant information, file paths, chat text, or pricing.

An internal administrator or owner with gross-finance authority can select **Customer accounting** and create a separate subscription with its own alias and signing key. The same worker sends `invoice.registered`, `payment.recorded`, `payment.reversed`, `credit_note.applied`, `credit_note.reversed`, `refund.recorded` and `refund.reversed` after the corresponding action commits. The v1 body contains `id`, `type`, `version`, `occurred_at` and `invoice_id`. The authorised portal accounting views retain the amounts, references and documents. The subscription applies to future events for that company. The worker checks the integration key and the issuing administrator's current authority before sending.

Use a private environment for the worker:

- `PORTAL_WEBHOOK_API_URL` is the backend base URL directly exposing `/rest/v1`, or the portal's `/backend` reverse proxy. Use HTTPS or the localhost development API.
- `PORTAL_WEBHOOK_SERVICE_KEY` is the corresponding server-only Supabase service-role credential.
- `PORTAL_WEBHOOK_DESTINATIONS` maps `<organisation-uuid>/<alias>` to a reviewed exact HTTPS URL. For example, use `{"11111111-2222-3333-4444-555555555555/course-sync":"https://example.invalid/webhooks/courses"}` in fictional configuration. Receivers must resolve only to public IPs. Redirects are not followed.
- Before starting delivery, run `node --env-file=/absolute/private/webhooks.env scripts/company-course-webhook-worker.mjs --check-destination '<organisation-uuid>/<alias>'`. The check uses the worker's exact destination map and DNS rules, pins a public address and verifies the certificate for the configured hostname. It needs the destination map alone. It opens a TLS connection and sends no HTTP request, event or credential. An unknown alias, unavailable DNS, private address or failed TLS check returns a status and exits nonzero. After `tls_verified`, use a fictional event on an approved staging installation to verify the receiver's signed HTTP acknowledgement and retry behaviour.

Install the checkout's locked dependencies. Run a single batch with `node scripts/company-course-webhook-worker.mjs`, or run the private worker in the foreground under a local supervisor:

```sh
node --env-file=/private/luminovia-webhook-worker.env scripts/company-course-webhook-worker.mjs --watch
```

Keep the environment file outside the checkout with access limited to the worker identity. The optional `PORTAL_WEBHOOK_POLL_SECONDS` sets the interval after each completed batch, from 15 to 3,600 seconds with a default of 60. The watcher stays idle between batches, retries transient batch failures and finishes the current leased item on SIGINT or SIGTERM before stopping. Each batch processes up to ten deliveries. Admins can refresh recent delivery status from the company form. The worker retries timeouts, throttles and server errors with increasing delay, up to five attempts and within 24 hours. It removes delivery history older than 30 days incrementally. Receiver implementations must acknowledge with HTTP 2xx, deduplicate by event ID and tolerate reordering. A revocation prevents subsequent sends after the authorization check. An HTTP request already in flight can finish.

Verify `X-Luminovia-Signature` using HMAC-SHA256 with the hex-decoded signing key. The signed UTF-8 content is the value of `X-Luminovia-Timestamp`, a period, and the exact raw HTTP body. Compare the lowercase hex digest in constant time after checking the `v1=` prefix. Reject delivery timestamps outside five minutes of the receiver's clock and match the signed JSON event ID to `X-Luminovia-Event-Id`. The [runnable Node.js receiver](scripts/examples/README.md#signed-course-webhook-receiver) uses the shared verifier and commits the v1 event to a private SQLite inbox before returning `204`. One row serves as both the event receipt and the pending work. Repeated deliveries are acknowledged from that row after restart.

Local acceptance is available through `node --test scripts/runtime-company-course-webhook{,-receiver}.test.mjs` and the isolated `scripts/company-course-webhooks-db-tests.mjs` and `scripts/company-accounting-webhooks-db-tests.mjs` suites used by the Portal test runner. The database suites run the worker against the migrated PostgreSQL outbox and send the signed requests to the runnable receiver over loopback. They confirm backoff, one durable receipt after a lost acknowledgement and receiver restart, and revocation before transmission. The worker uses its public HTTPS transport in a deployed configuration.
