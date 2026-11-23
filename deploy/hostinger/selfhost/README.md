# Self-hosted development setup on the purchased Hostinger KVM1

This is the user's selected development/setup configuration for the existing KVM1 (4 GB RAM, one CPU, 50 GB disk). No upgrade is assumed. It is not production-capacity acceptance, and this disk does not provide the future 100 GB document target.

All backend services and actual document bytes run on the Hostinger VM. This composition uses the official production Supabase Docker distribution as its base, rather than exposing the Supabase CLI development stack. Supabase Cloud is not part of this deployment.

## Source and modifications

Base release: self-hosted/v0.8.4, commit 189adda99d1b56da55fc5a6ee3f849354aaea92a. The complete unchanged official docker directory, license and per-file hashes are preserved next door in ../supabase/. Its images.lock.json records registry-manifest digests for all eleven upstream base images.

The vendor snapshot is retained as historical provenance. The active PostgreSQL image is the separately reviewed patch `supabase/postgres:17.12.0.000@sha256:8630950b489ecc70563300180287a98c192a4a48f5ae00b4febdaeea1abe85de`; actual engine 17.12, candidate restore and subsequent CMS acceptance are recorded in [postgres-upgrade-provenance.json](postgres-upgrade-provenance.json). The earlier 17.6 image is only a historical approved backup/restore source.

This composition retains PostgreSQL, Auth, PostgREST, Realtime, Storage, Edge Runtime and Envoy; it omits Studio, postgres-meta, Supavisor, imgproxy, Analytics/Vector and external S3 services. A pinned, app-owned private SMTP relay serves Auth and the host notification worker; its upstream SMTP/optional IMAP credentials are stored in Supabase Vault and remain unset until an administrator configures them. Mailpit remains the capture sink for local and isolated candidate Auth mail, never for real
recipients.

The local Envoy files preserve upstream API-key translation, JWT enforcement and function-owned CORS. Removed routes include Studio, metadata/SQL, GraphQL and Realtime administration. Only the reviewed application Edge functions (`files`, `invite-lecturer`, `accounts`, `course-documents`, `calendar-feed`, `website-enquiries`, `mail-admin`) are routed; slash boundaries allow account API subpaths while similarly named/unknown paths return 404. `mail-admin` requires JWT verification and a live SQL
mail-administration permission on every request. No gateway access logger is configured, so authentication query strings do not enter an access log. The official Envoy bootstrap and internal cluster definitions are retained, with only the required API clusters.

runtime/index.ts and memory-pressure.ts derive from the pinned official main function router. Local adaptations are the explicit seven-worker allowlist and worker memory ceiling: files 1024 MiB, other functions 128 MiB. The container default ceiling is 1280 MiB, shared by the main worker and all workers. These are limits, not preallocated RAM. The small machine can still run out of memory; future large-file processing has no acceptance claim. Root deployment owns host swap and actual resource
observations.

## Host/network agreement

The external Docker network is luminovia-portal-backend by default. Create it before starting either Compose project. Caddy and ClamAV join this same network. Caddy mounts `/opt/luminovia-portal/www` at `/srv`, follows `/srv/current` for the active release, and serves shared immutable assets from `/srv/assets`. Keep that parent mount stable when switching releases; never put secrets or data under it.

Caddy proxies the public API prefix /backend/ to api:8000 while stripping /backend. Envoy's service has aliases api, api-gw, envoy and kong. All backend service ports stay inside Docker except the worker SMTP port, which is published only as `127.0.0.1:2526`; Mailpit's web/API is likewise loopback-only on `127.0.0.1:8025`. There is no public mailbox UI, SMTP listener or mail-relay control endpoint.

Caddy must allow only the intended Auth, REST, Realtime WebSocket, Storage and named Functions API routes. In particular, block Auth administration from the public Caddy route; the application Edge functions can still use Auth's administrator API over the internal gateway. Do not expose Studio, SQL, metadata or private files through another Caddy route.

ClamAV has no host port. Functions use PORTAL_CLAMAV_HOST=clamav and PORTAL_CLAMAV_PORT=3310. Both HTTPS scanner variables are intentionally absent; even an empty PORTAL_SCANNER_URL or PORTAL_SCANNER_TOKEN would select HTTPS configuration and fail closed. Preserve the reusable HTTPS code for another architecture, but do not introduce a separate public scanner endpoint here.

## Create configuration once

Run from the repository root, using an ignored private output path:

    node deploy/hostinger/selfhost/generate-env.mjs \
      --output .local/hostinger/selfhost.env \
      --portal-origin https://cms.luminovia.org \
      --api-origin https://cms.luminovia.org/backend \
      --data-dir /opt/luminovia-portal/data

The command creates three mode-0600 files: the private server file, `<server-env>.notification.env` for the disabled worker, and a `.public.env` containing only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. The notification file has only its own service-role key and generated internal relay credential; provider mail passwords remain in Vault. Existing files are never overwritten. Credential values are never printed. Do not copy either private file into a frontend build or static
document root.

For an installation that already has a private server environment, first inspect the dry run, then use the additive migration only after the normal backup/change review:

    node deploy/hostinger/selfhost/migrate-mail-relay-env.mjs \
      --env-file /opt/luminovia-portal/private/selfhost.env
    sudo node deploy/hostinger/selfhost/migrate-mail-relay-env.mjs \
      --env-file /opt/luminovia-portal/private/selfhost.env --apply

`--apply` requires root, writes a 0600 `.pre-mail-relay` copy before atomically updating the SMTP endpoint, and creates the disabled `.notification.env`. A conflicting existing backup or worker configuration fails without exposing either credential value. It does not import prior provider credentials into Vault; an administrator must configure and test the upstream under Administration > Mail before Auth email delivery is enabled. Do not run the apply command against a production installation without its separately authorized upgrade and recovery procedure.

All server variable names are listed in .env.example. The safe generator implements the key formats from official generate-keys.sh and add-new-auth-keys.sh without their credential-bearing terminal output. It generates:

- PostgreSQL password; legacy JWT secret, anon and service-role tokens.
- EC P-256 private/public signing material and compatible JWT/JWKS configuration.
- New opaque publishable/secret API keys with the upstream checksum format.
- Internal ES256 anon/service-role translation tokens.
- Realtime encryption and secret-key-base material, unused dashboard protection and Storage S3-protocol access credentials.
- Independent random internal SMTP-relay login/password and control token; the notification-worker file is generated disabled by default.

JWKS includes a legacy symmetric verification key and is therefore itself server-secret configuration; never publish the entire JWKS environment value. The Auth JWKS HTTP endpoint is responsible for returning the appropriate public signing information.

Keep generated credentials, PostgreSQL custom/key volumes and deployment configuration in secure recovery backups.

## Correct Auth URLs for the /backend prefix

For the current canonical origin, the generator sets:

    SUPABASE_PUBLIC_URL=https://cms.luminovia.org/backend
    API_EXTERNAL_URL=https://cms.luminovia.org/backend/auth/v1
    SITE_URL=https://cms.luminovia.org
    MAILER_URLPATHS_INVITE=/backend/auth/v1/verify
    MAILER_URLPATHS_CONFIRMATION=/backend/auth/v1/verify
    MAILER_URLPATHS_RECOVERY=/backend/auth/v1/verify
    MAILER_URLPATHS_EMAIL_CHANGE=/backend/auth/v1/verify

This is required by the actual Auth v2.197.0 implementation: it resolves the configured mail path against the external URL. A leading /auth/v1/verify without /backend would discard the API prefix. X-Forwarded-Prefix does not repair that construction. Leave GOTRUE_MAILER_EXTERNAL_HOSTS unset; the configured external API URL remains authoritative.

Exact frontend redirect URLs are /auth/callback and /auth/password at the selected frontend origin, without wildcard allowlists. Public signup, anonymous accounts and phone signup are disabled. Email login remains enabled and email autoconfirm stays off. TOTP, phone MFA and WebAuthn MFA enrollment/verification are all explicitly disabled. Current database capabilities, active-account status and resource scope remain authoritative.

Auth templates are loaded from the selected frontend origin's /mail-templates/invite.html and /mail-templates/recovery.html. Root must serve the existing repository templates there before accepting invitations/recovery. CLI content_path configuration does not install self-hosted mail templates. The recovery template also provides a one-time password setup link when account provisioning requests it. Keep the ordinary recovery ConfirmationURL/PKCE branch. Configure the SMTP sender for the installation, for example `cms@luminovia.org` when the provider authorizes that address.

Self-host Auth points to the private relay and fails closed for outbound delivery until an admin saves and verifies provider credentials under Administration > Mail transport. SMTP checks perform TLS/login/NOOP without sending a test message; optional IMAP checks do not read mailbox content. The isolated candidate overrides Auth SMTP to Mailpit port 1025, and ordinary local Supabase development retains its own Mailpit configuration. These are fictional capture paths; do not configure real
recipients or enable the separate notification worker without authorization.

## Exact Compose command and source layout

The repository directory layout must remain intact on the VM. The function binds resolve three levels up to the repository's actual supabase/functions/ directories. Mounts do not include local environment or account files.

Set task-specific absolute shell variables and use explicit project/env paths:

    portal_repo=/opt/luminovia-portal/source
    portal_env=/opt/luminovia-portal/private/selfhost.env
    portal_notification_env=/opt/luminovia-portal/private/selfhost.env.notification.env
    docker compose \
      --project-name luminovia-supabase \
      --project-directory "$portal_repo/deploy/hostinger/selfhost" \
      --env-file "$portal_env" \
      -f "$portal_repo/deploy/hostinger/selfhost/compose.yml" \
      config --quiet

The separate notification timer reads `portal_notification_env` through its systemd `EnvironmentFile`; the generated setting is disabled. Do not enable the timer until a reviewed relay configuration and notification policy are in place.

For actual authorized startup, use the same flags with up -d --wait. Do not run down -v or an upstream reset script. Recreating containers preserves the bind-mounted PostgreSQL/Storage/Mailpit data and named PostgreSQL custom-key/Edge cache volumes.

PORTAL_DATA_DIR is an absolute root-owned persistent-data directory outside the source checkout. PostgreSQL's bootstrap manages its own PGDATA ownership/permissions. Inspect effective owner access for Storage and Mailpit at startup; do not grant broad host permissions to make an error disappear.

## Migration and readiness order

The Compose dependency chain waits for PostgreSQL, Auth, PostgREST, Storage and the API gateway; Auth waits for the internal relay process. The relay connects to PostgREST only when forwarding mail or consuming a version-bound connection check. Candidate Auth mail is directed to Mailpit instead of the provider relay. Edge Functions use the reviewed router plus the current application source. No fictional fixtures or development account files are seeded automatically.

Before applying application migrations, verify Auth and Storage have completed their own migrations: auth.users, storage.buckets and storage.objects must exist. Verify the supabase_realtime publication exists. The existing app document/chat migrations conditionally skip missing external-service schemas/publications, so SQL success alone would not prove integration if applied prematurely.

Apply every current repository SQL migration in filename order with psql ON_ERROR_STOP, and maintain an exact version/hash ledger. Never run the project's local seed/reset/API mutation harness against this instance. Inspect RLS/grants, private buckets and publication membership after migration. The new private document capacity configuration should use the root task's development quotas, rather than assuming the future 100 GB target fits the purchased disk.

Bootstrap only the reviewed initial operator through the server-side Auth admin API and audited database roles. Verify the operator can sign in with the configured password and that the database grants only intended capabilities. Keep public secret/service keys out of browser configuration.

## Verification and limits

Run the offline check:

    node deploy/hostinger/selfhost/validate.mjs

It verifies actual HMAC/ECDSA signatures and opaque-key checksums, /backend mail URL resolution, public-secret separation, exclusive 0600 writes, Compose bind sources and the no-public-backend-port/Auth configuration. It does not start containers or contact Supabase Cloud.

Historical hosted acceptance on this development instance included TOTP/AAL2 before the product changed to password-only authentication. That record does not verify the current no-MFA configuration or current release. Re-run the current hosted acceptance after its forward migration and reviewed release. Earlier evidence, including private invitations, RLS rejection, malware scans, complete job claims, file persistence and WSS revocation, remains historical and is documented
in [HOSTINGER_DEVELOPMENT](../../../OPERATIONS.md#section-hostinger-development).

The real off-site database plus object backup passed an isolated restore with exact roles/membership grantors/options, RLS, counts, quotas and private object SHA-256. A separate candidate restore into 17.12 also matched all eleven migration SQL sources. Neither drill overwrote the VPS. Backup/restore helpers accept only reviewed immutable 17.6/17.12 images and default recovery to the backup's own image. Secrets and Vault encryption material require their separate protected recovery source.

Hosted scanner-outage behavior, complete DE/EN/mobile/PWA/platform checks, maximum-size throughput and future 100 GB/member-load recovery remain separate acceptance work. Large-file maximums and configurable quotas are code limits, not tested KVM1 throughput or space. Mailpit capture does not establish external SMTP deliverability.

Back up PostgreSQL, actual Storage object bytes, signing/encryption keys and deployment settings consistently. A database-only dump omits the documents. No production acceptance is implied by development startup.

## Official references

- https://github.com/supabase/supabase/releases/tag/self-hosted/v0.8.4
- https://github.com/supabase/supabase/tree/189adda99d1b56da55fc5a6ee3f849354aaea92a/docker
- https://supabase.com/docs/guides/self-hosting/docker
- https://supabase.com/docs/guides/self-hosting/self-hosted-auth-keys
- https://supabase.com/docs/guides/self-hosting/self-hosted-functions
- https://github.com/supabase/auth/blob/v2.197.0/internal/mailer/templatemailer/templatemailer.go
- https://github.com/supabase/auth/blob/v2.197.0/internal/api/middleware.go
