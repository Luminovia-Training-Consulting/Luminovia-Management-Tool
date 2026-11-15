# Daily verified maintenance

The authorised KVM1 development instance checks official stable application and runtime dependencies daily. It never deploys an untested `latest` tag or rebuilds software on the small VPS. CI tests candidates on GitHub runners; the VPS pulls bounded immutable releases.

## Update sequence

`.github/workflows/daily-maintenance.yml` runs at 02:41 UTC and supports manual dispatch. Each npm ecosystem group, lockfile refresh, Node compiler, runtime image and Edge JSR pin has an independent candidate. Coordinated peers stay together. Prereleases and downgrades are excluded. A rebuilt multi-platform index matching the installed amd64 image is a no-op. The vendor Supabase bundle remains a preserved reference; the active composition is maintained separately.

Every changed candidate must pass `./portal test` and the actual ten-container self-hosted baseline-to-candidate check using retained fictional accounts, MFA, permissions and file bytes. Passing components are combined and tested again. Failed candidates remain on the working version and are retried on later daily scans. Failed combined verification uses a separately re-tested single passing candidate as a bounded fallback; it does not force conflicting packages together.

The privileged promotion job accepts only fixed dependency/version/image files with exact tested base hashes and an unchanged main parent. It cannot change scripts, workflows, authorisation code or runtime secrets. GitHub signs the GraphQL commit. An explicit exact-revision CI dispatch follows because pushes made with GITHUB_TOKEN do not trigger push workflows. The normal CI again verifies the application and actual self-host images before publishing an immutable release. The existing five-minute server timer installs only the release for exact current main with successful whole CI, immutable tag/assets and every archive hash checked. Transient network failures back off without permanently suppressing that revision.

## PostgreSQL and automatic recovery

PostgreSQL stays on the supported Supabase 17 series. A future 17.x pin needs a real retained-data candidate proof bound to both image digests and the exact migration inventory. PostgreSQL 18 requires a separately designed major migration. An unavailable or incompatible latest candidate is held visibly rather than labelled installed.

For full updates the server closes the public API, stops all six backend writers and makes its existing update backup. `atomic_recovery.py` then captures a private physical checkpoint of the stopped PostgreSQL cluster and its keys, Storage, Mailpit and affected persistent runtime volumes. Caddy is briefly paused for coherent TLS/config capture; unchanged ClamAV stays running. Exact Compose labels, known mount paths, same-device layout, free space and copy hashes are required. The privileged Docker controller uses ProtectSystem=full (read-only /usr, /etc and /boot); separate writable bind-mount carve-outs would break cross-directory atomic renames even on one filesystem. The helper itself accepts only the fixed owned mount paths.

An engine change additionally runs `pg_preflight.py`: while the public API is fenced, it copies a stopped whole cluster, resumes the old engine, and starts the candidate only against the private copy, with no network or published ports. All connectable databases, data/role/policy/function digests and actual collation versions must agree. The development gate currently caps this physical probe at 1 GiB PGDATA; larger clusters require reviewed capacity work.

Before opening access, every runtime container, private Auth health/JWKS and exact HTTPS frontend must pass. If activation fails before public access resumes, source and physical checkpoint are restored automatically, old services are recreated, and private health must pass before reopening. Failed candidate data remain privately preserved. Once public writers have been allowed, an automatic database rewind is forbidden: it could discard new user writes. Such a later unresolved fault retains maintenance and recovery evidence for an operator. The system does not claim it can repair arbitrary incompatible upstream changes.

Static/controller-only releases keep the existing zero-restart path, without a database backup or service stop.

## Daily OS and complete recovery sets

[Complete encrypted backups](../backups/README.md) run at 02:00 UTC with a persistent timer. `configure-os-daily.sh --apply` configures official Ubuntu stable/security/updates packages at 03:00 UTC, including distribution-provided Docker. No distribution release upgrade, proposed/backports or additional repository is enabled. A fresh complete verified backup is required before maintenance; failed backup creation blocks OS updates. The global maintenance lock coordinates OS, app, complete backup and database work.

A separate required-reboot timer runs under the same maintenance lock with a fresh complete backup; unattended-upgrade itself cannot schedule an asynchronous reboot. A /run marker fences new maintenance until boot. Necessary reboots are scheduled for 03:30 UTC (04:30 Frankfurt winter / 13:30 Brisbane). This activates newly installed kernels and can briefly interrupt the development portal. Do not describe a scheduled reboot as an already tested reboot. The OS installer validates the effective APT policy and a genuine unattended dry run before enabling the timer.

Daily encrypted sets are local to the VPS unless separately configured off-site; the first desktop recovery drill is an independent off-server copy. The paid Hostinger daily full-VM backup requires its specific purchase approval. No recurring desktop upload is promised while the desktop is offline. Preserve the off-server age recovery identity securely.

## Operations

Inspect `systemctl list-timers luminovia-update.timer luminovia-complete-backup.timer apt-daily-upgrade.timer luminovia-required-reboot.timer`, their service journals, `private/updates/state.json` and `private/backups/state.json`. GitHub daily workflow summaries identify held/failed candidates. Never print environment values, role dumps or secret configuration. Normal operation needs no Git clone on the VPS and introduces no new resident update daemon.

Meaningful guards: Python updater/preflight/recovery/backup tests; Node component-policy/promotion/package tests; canonical application acceptance; actual old-to-new selfhost fixture; and a separate authenticated decrypt/three-database restore drill. Record first live results and exact workflow revisions in WORKLOG rather than treating implementation tests as installed operation.
