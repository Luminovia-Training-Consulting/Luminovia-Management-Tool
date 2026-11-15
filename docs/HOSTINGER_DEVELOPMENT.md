# Hostinger self-hosted development instance

Updated 16 November 2026, Australia/Brisbane. This is an actual development/setup deployment, not acceptance for 100 GB or 15–25 production users.

## Target and boundaries

- Portal: <https://cms.luminovia.org>
- Supabase API: <https://cms.luminovia.org/backend>
- Existing Hostinger VM 2163645, KVM 1, Frankfurt: one CPU, 4 GB RAM, 50 GB disk. No agent purchase or upgrade. The user explicitly chose to retain this size for development.
- Portal, PostgreSQL, Auth, Storage objects, Realtime, Edge Functions and ClamAV run together on this VM. There is no managed Supabase dependency in the deployed application.
- Ubuntu 26.10 was the installed system selected during provisioning. Docker and Compose came from its official Ubuntu repositories. A 2 GiB swap file supports setup; it is not a substitute for production RAM.
- Only SSH and web ports are publicly reachable. PostgreSQL, API gateway, Auth, Storage, Edge and ClamAV have no published host ports. The development Mailpit web interface binds only to server loopback.
- `cms` is a new A record, TTL 300, pointing to this VM. The apex/`www` marketing site and all MX/SPF/DKIM/DMARC records were preserved by exact readback comparison. Pre-change DNS snapshot: `168730836`. No nameserver change.

The initially approved free Cloud project was created before the user clarified self-hosting. Work on it stopped. It is unused, has no users/files/functions/mail and is not a configured application dependency; it has not been deleted without approval.

## Files and configuration

On the server, `/opt/luminovia-portal/source` holds the initial source snapshot and current reviewed runtime files; it is not a continuously mirrored Git checkout. Compiled web releases live under `www/releases`, with their deployed commit recorded in `private/updates/state.json`. `/opt/luminovia-portal/data` stores the persistent database/objects/mail capture; `/opt/luminovia-portal/private` stores restricted environment files and operational logs. The two Compose projects are `luminovia-supabase` and `luminovia-portal`; their private network is `luminovia-portal-backend`.

Caddy mounts the stable `/opt/luminovia-portal/www` directory read-only at `/srv`. `/srv/current` is a symlink to a release below `www/releases`; it supplies the SPA shell and ordinary public files. Hashed assets are served from the shared `www/assets` directory and Workbox bundles from `www`, so a client with an older loaded shell can still fetch its immutable assets after the current release changes. Do not bind-mount a changing symlink target as the document root. `www/maintenance.enabled` is the explicit reversible API maintenance flag: while present, the public `/backend` route returns 503 with `Retry-After: 60`; it is absent in the accepted running state. Mail templates have a separate read-only mount. Private configuration, source, database files and backups never belong in `www`.

The local ignored `.local/hostinger` directory contains restricted server/build configuration, bootstrap account credentials and deployment/backup evidence. Never copy it into Git or a document root. `ACCOUNTS.txt` is the private handoff for the three fictional development accounts. The primary administrator has no pre-enrolled MFA factor so its owner can enroll through the application.

The safe generator in `deploy/hostinger/selfhost/generate-env.mjs` creates new configuration once and refuses overwrite. **Do not rerun it to change domains**: preserve the existing keys/passwords and update only endpoint fields. The self-host README documents each server variable. The frontend receives only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`; server/database/JWT keys never enter its build.

The pinned official production Supabase base bundle and original image digests are under `deploy/hostinger/supabase`, with original licence, release commit and SHA-256 provenance. That vendor snapshot remains unchanged. The active `selfhost/compose.yml` has a separately reviewed PostgreSQL patch pin, recorded in [postgres-upgrade-provenance.json](../deploy/hostinger/selfhost/postgres-upgrade-provenance.json):

```text
supabase/postgres:17.12.0.000@sha256:8630950b489ecc70563300180287a98c192a4a48f5ae00b4febdaeea1abe85de
```

The actual running engine reports PostgreSQL 17.12. The earlier 17.6 image remains recorded as the historical backup source; it is no longer the active VM engine. This deployment does not run `supabase start` as its hosted backend. The self-host composition omits Studio, analytics, meta and the external connection pooler. The public Caddy route allowlists application API prefixes, blocks Auth admin routes, strips referrers, enforces private API cache headers and omits access logging of token-bearing URLs.

## Development Auth and storage

Public and anonymous signup, phone signup and phone MFA are disabled. Admin changes still require database capabilities and TOTP/AAL2. Auth redirects, invitation/recovery templates and Edge allowed origins use the exact CMS origin and `/backend` API prefix.

SMTP points to private **Mailpit**, not a real mail recipient/provider. Invitations and recovery messages are captured on the VM; nothing is sent to real people. This is deliberate development configuration and must be replaced with separately approved transactional mail settings before real onboarding.

All fourteen application migrations are applied with source verification in `supabase_migrations.schema_migrations`. `deploy/hostinger/apply-migrations.mjs --development-vps` refuses drift, requires initialized Auth/Storage/Realtime, and never resets data or seeds accounts. It explicitly reapplies development quotas, so it is not a production maintenance command.

The current instance allocates **10 GiB total / 1 GiB per owner**, counting all document versions, including archived/rejected/quarantined versions. Server-only `private.document_storage_limits` controls those allocations. The source maximum is 100 MiB per file; this ceiling does not establish a successful 100 MiB load test on KVM 1. Uploads are scanned on private TCP; scan failure leaves them quarantined. Neither a logical quota nor an application limit increases the VM's physical disk.

For the future approximately 100 GB of documents, provision enough separate headroom for the operating system, images, database/WAL, versions and updates. KVM 2's entire 100 GB disk would be insufficient for that stated end state. No capacity upgrade is authorised by the current development setup.

## Operation

Inspect with SSH and `docker compose ps`, using the corresponding project directory, Compose file and environment file. Never print a rendered Compose config or environment values; `config --quiet` validates safely.

```bash
ssh root@72.61.20.240
docker compose --project-directory /opt/luminovia-portal/source/deploy/hostinger/selfhost --env-file /opt/luminovia-portal/private/selfhost.env -f /opt/luminovia-portal/source/deploy/hostinger/selfhost/compose.yml ps
docker compose --project-directory /opt/luminovia-portal/source/deploy/hostinger --env-file /opt/luminovia-portal/private/web.env -f /opt/luminovia-portal/source/deploy/hostinger/compose.yml ps
```

`restart: unless-stopped` and the enabled Docker service preserve operation across normal restarts. Persistent application data are outside the source directory. Never use `down --volumes`, remove data directories, reinstall the VM or reset the database as routine cleanup.

Current test and persistence/backup results are recorded in WORKLOG after actual execution. The offline validators do not replace hosted acceptance. Production still requires complete product/release scope, real SMTP, off-site retention, monitoring, supported-client checks and recovery acceptance.

## Executed development checks

After the controlled PostgreSQL 17.12 image upgrade, all eight actual CMS API suites passed again: public JWKS separation, sign-in/AAL1 restrictions, real temporary-manager TOTP/AAL2, private Mailpit invitation/password setup and PKCE recovery, calendar/RLS/role-forgery rejection, Edge origin/authentication checks, real clean/EICAR scanning and fifty online claim requests from two lecturers. The claims produced exactly one committed winner, all five session allocations and an idempotent winner retry. Only UUID-scoped test fixtures were removed.

The existing persistence probe passed after the upgrade using the saved passwords and exact private file bytes; another administrator still received 403. Final independent inspection confirmed the exact reviewed 17.12 image, eight healthy Supabase backend services, three existing Auth accounts, eleven migrations and one retained clean private file. Existing profiles/passwords/MFA were not reset. Every connectable database (`postgres`, `_supabase`, `template1`) had stored and actual ICU collation version 153.121, with zero explicit collation mismatches; no collation reindex was required. The protected non-connectable `template0` was left unchanged.

Earlier actual service stop/start also preserved passwords and the private file, and an actual browser successfully signed in at the CMS URL. The API suites do not replace full hosted DE/EN/mobile/PWA/platform and future-capacity acceptance.

The actual WSS check passed again after the PostgreSQL patch on the canonical CMS domain: permitted owner/member message delivery, no nonmember-admin delivery, and immediate loss of subsequent messages plus REST/RPC access after removal of an already-connected member. Temporary test data and connections were cleaned.

`node deploy/hostinger/backup.mjs --development-vps --quiescent` created an actual off-site database and object backup while development writes were quiescent. `node deploy/hostinger/restore-check.mjs --latest-development-vps` restored that backup into its original pinned 17.6 image and passed exact source roles/memberships/grantor/options, RLS, permissions, migration history, table counts, quotas and every object hash. Before the live patch, `--latest-development-vps-upgrade` restored the same backup into the exact reviewed 17.12 candidate and additionally compared all eleven stored migration SQL sources with repository files. The retained 114-byte private object matched its original SHA-256.

These are actual networkless local PostgreSQL recovery drills, with no published ports; owned temporary containers/volumes and extracted files were removed. They never restore over the VPS. The helper explicitly accepts only the reviewed 17.6 and 17.12 immutable images; normal recovery follows the image recorded in the backup manifest, and backup records the actual running image/version. An arbitrary candidate or floating tag is rejected. The initial PG17 bootstrap-role replay issue is fixed and documented in WORKLOG.

A logical restore rebuilds indexes and does not alone establish safe in-place engine compatibility. Check actual database/explicit collation versions and the official release's index/extension requirements before each reviewed engine patch; rebuild affected indexes before refreshing a changed collation version. The 17.12 candidate and actual updated VM both matched the existing default collation. HTTP/Auth/Storage/Realtime acceptance was performed separately on the updated VM as recorded above.

Keep runtime environment secrets separately recoverable: the backup deliberately excludes passwords, JWT material and Vault encryption keys. Current artifacts contain fictional development data and have restricted local permissions; they are not a configured recurring encrypted production retention service.

The concurrently merged M3 account/profile/commission extension required a separately pinned historical migration backfill: its three source versions predate the installed storage-capacity migration. A real backup clone passed both deliberate-data-change rollback and exact11-to14 application/idempotence before the frozen live application. Existing data columns/quotas and prior grants were preserved. The accounts worker is read-only mounted and allowlisted in Envoy/runtime. Actual CMS `/v1/me`, AAL1 directory denial, CORS/internal-path rejection, private-file persistence and WSS revocation passed after resumption. This one-off reviewed exception does not loosen the automatic updater's migration-order guard. See [automatic updates](HOSTINGER_AUTOMATIC_UPDATES.md).

Automatic GitHub installation was accepted for signed source7da12e5 after green main CI43733156166: the VPS downloaded the immutable public release, verified every member, backed up data/runtime and served the exact new HTTPS index. Accounts/private-file/WSS checks passed after recreation; all existing accounts/quotas survived. The active five-minute timer, daily OS security policy and recovery controls are documented in [automatic updates](HOSTINGER_AUTOMATIC_UPDATES.md). No manual repository clone is required for later tested main releases.
