# Luminovia Hostinger development deployment

The authorised instance is **https://cms.luminovia.org**, fully self-hosted on the existing **KVM 1**. No paid upgrade is authorised. See [the instance guide](../../docs/HOSTINGER_DEVELOPMENT.md) for architecture, private credentials, limits and actual checks.

- `maintenance/`: daily stable dependency/image candidates, exact signed CI promotion, live-data PostgreSQL preflight and pre-unblock physical recovery.
- `backups/`: coordinated daily encrypted all-database/data/secret/configuration recovery sets and authenticated desktop restore drills.
- `selfhost/compose.yml`: private official Supabase services and development Mailpit; active PostgreSQL 17.12 is pinned by immutable digest.
- `selfhost/postgres-upgrade-provenance.json`: official patch sources, exact pins and successful candidate/live 17.12 acceptance.
- `compose.yml` / `Caddyfile` / `clamd.conf`: static frontend, HTTPS/API allowlist and private scanner.
- `supabase/`: unchanged official production bundle, pinned image digests, licence and provenance.
- `instance.json`: nonsecret deployment identity and explicit development capacity.
- `apply-migrations.mjs --development-vps`: exact-source incremental application migrations; never reset/seed.
- `backup.mjs --development-vps --quiescent`: streaming off-site database/object backup with restricted files.
- `restore-check.mjs --latest-development-vps`: isolated database/object recovery using the manifest's reviewed image, never restoration over the VPS.
- `restore-check.mjs --latest-development-vps-upgrade`: bounded 17.6-to-17.12 candidate restore, including exact migration SQL/roles/file hashes.
- `scanner/`: optional authenticated HTTPS scanner adapter for other topologies; not an active service in this private-network deployment.

Generate secrets once with the selfhost generator into ignored private files. Keep server keys separate from the two public Vite build variables. Preserve existing secrets when changing URLs. Never place environment files, database dumps or account handoffs in a release artifact, the public `www/` directory or Git. Caddy mounts the stable VM directory `/opt/luminovia-portal/www` and serves its `current` release symlink; shared immutable assets remain available to older loaded clients.

Current development allocations are 10 GiB total and 1 GiB per owner. The 100-MiB file ceiling is not a full-sized upload/load acceptance on KVM 1. Approximately 100 GB documents and 15–25 members are future production sizing requirements.

Actual post-patch CMS acceptance passed all eight HTTP suites, fifty online claims with one complete winner, saved-password/private-file persistence and real WSS delivery/revocation. Off-site database plus object recovery passed both the original-image baseline and reviewed 17.12 candidate. This is development acceptance with fictional accounts and private Mailpit, not external SMTP or future-capacity acceptance.
