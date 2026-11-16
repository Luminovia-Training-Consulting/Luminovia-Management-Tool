# Automatic development updates

This policy applies only to the authorised self-hosted development instance at <https://cms.luminovia.org>. It does not upgrade the Hostinger plan or declare production acceptance.

## Daily dependency, OS and complete-backup maintenance

The newer daily request extends this original application-release mechanism. See [daily verified maintenance](../deploy/hostinger/maintenance/README.md) and [complete encrypted recovery](../deploy/hostinger/backups/README.md). Stable npm/Node/JSR and active selfhost images receive independent full-test gates, signed fixed-file promotion and exact-main CI. Full updates now keep public access closed through private health and can restore a validated physical checkpoint before public writes resume; a database rewind after public activation remains forbidden. Transient network retries do not permanently suppress a release. The existing static/controller-only zero-restart path remains.

The new complete backup includes all connectable databases, role passwords and server/TLS/Vault/JWT configuration missing from the older update-only backup. Its age identity stays off-server. Native daily timers coordinate complete backup, official OS packages and necessary reboots under the same host lock. Installation/first-live acceptance is recorded in WORKLOG; source implementation alone is not proof that a timer or purchase is active. Paid Hostinger off-site full-VM backup is separate and awaits its specific approval. The operating rules below describe the current installed controller; explicitly dated acceptance sections retain their historical scope.

## Installed acceptance — 15 November 2026 UTC

Signed main `bb322746` passed [exact CI43753910114](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43753910114) and immutable release verification. The normal five-minute timer installed it automatically at 20:04:30UTC, including forward migration20261115180559 (18 total). All 10 containers / 9 healthchecks and actual post-install Auth/MFA/mail/recovery/RLS/scanning/50 claims/private-file/WSS checks passed. The preceding11448e4 maintenance release, reviewed M4 transition and real VM physical rollback drill also passed; see [WORKLOG](WORKLOG.md).

Complete backup 02:00 UTC, GitHub dependency maintenance 02:41 UTC, official OS 03:00 UTC and necessary reboot 03:30 UTC are configured; all server timers are enabled/active. The latest actual complete set restored successfully at 20:13:18UTC:3 databases / 1,990 files, credentials, permissions, all 18 SQL sources and physical configuration/key/document bytes. Running kernel 7.3.0-9 still awaits the scheduled necessary boot into installed 7.3.0-10; post-boot acceptance is not claimed. Recurring paid provider/off-site backup is not activated.

GitHub's actual token signature probe passed. The first full compatible candidate run passed application/selfhost/combined gates but correctly stopped promotion when concurrent PR5 moved main. No bot main-promotion success is claimed from that stale-base run. TypeScript 7/FullCalendar 7 are held on actual incompatible peer dependencies; other components proceed independently.

## Release-builder output and failure recovery

The prepared [release builder](../deploy/hostinger/updates/package.mjs) requires Linux with accessible procfs descriptor paths and GNU tar. Use a real output directory owned by the invoking UID, normally `0700` or `0755`, without group/other write permission; the output leaf must not be a symlink. Existing safe directories may contain unrelated files. The builder pins the directory descriptor, stages each attempt privately and publishes each final name exclusively; it does not silently chmod an existing directory or overwrite another writer's artifacts.

`cms-release.tar.gz` and `cms-release.json` are **not published as an atomic pair**. A late collision or I/O error can leave an unpaired final archive. That attempt is a failure: stop, inspect the output and artifact ownership, and retry in a fresh owned output directory after resolving the cause. Never blindly remove final files or foreign/unverified files to make a retry pass. An archive alone, an erroring build or a successful unit test is not a valid release pair.

This local hardening and its tests authorise no release or deployment. Publication retains its separate authorised manual workflow and exact-current-source gates; no installed update, provider activation or production outcome is inferred.

## What is updated

The GitHub `Portal checks` workflow runs the complete isolated application verification plus release/updater/proxy checks. An explicitly authorised manual run on `main`, selecting `publish_release=true` and its exact current SHA through `expected_commit`, builds the CMS frontend with the two public repository variables `CMS_SUPABASE_URL` and `CMS_SUPABASE_PUBLISHABLE_KEY`. It packages the frontend, application Edge Functions, complete migration history and reviewed, digest-pinned runtime configuration. No server environment, SSH key, database password or service-role key is sent to GitHub.

The workflow creates a draft, uploads both `cms-release.tar.gz` and `cms-release.json`, and only then publishes the immutable prerelease tagged `cms-dev-<full source SHA>`. Repository immutable releases are enabled. The VPS downloads public artifacts directly; it does not need a GitHub token or a fresh clone.

`luminovia-update.timer` checks approximately every five minutes, with a short random delay. The updater accepts only an immutable release whose tag and manifest match the exact current `main` SHA and a completed successful exact-SHA push or explicit `workflow_dispatch` run of `.github/workflows/ci.yml`. A failed or superseded build is not installed. Every archive member is checked against its path, length and SHA-256; links and traversal paths are rejected. The public endpoint/key hash must match the existing instance configuration.

Application updates include the self-hosted Supabase functions and compatible new application migrations. Existing migration sources must match exactly. The updater never resets or seeds the database, changes existing passwords/keys, or reapplies development quotas. Destructive/top-level data-rewrite SQL, changed historical migrations, unreviewed runtime changes, PostgreSQL major upgrades and unexpected collation changes stop for operator review. Container images remain pinned. The separate daily workflow discovers official stable versions, tests independent candidates plus the combined result, and can promote only the fixed reviewed dependency/runtime files from an unchanged base. It never force-installs incompatible peers or blindly follows Docker `latest` tags.

## Installation and recovery sequence

Before changing the running system, the updater verifies disk headroom and compares the actual installed runtime bytes and image configuration. A release with unchanged runtime and no pending migrations takes the site/controller-only path: it validates history/configuration, prepares/promotes static files and checks HTTPS without stopping containers, pulling images, scanning Storage or creating a redundant data backup. A failed promotion restores the previous static pointer. It records this mode explicitly; the previous data backup is retained rather than mislabelled as newly created.

For backend/runtime changes, it pulls the reviewed images. It prepares a separate static release. That full path then briefly returns a bilingual 503 maintenance response for backend calls, stops the six backend writers, and backs up the application database, password-free roles and physical Storage objects. These backups are private **on the same VPS**, with at most two complete generations. They protect update operations but are not an off-site backup service. Separately scheduled complete encrypted sets include the server environment, password-bearing globals and JWT/Vault/TLS keys; see [complete backups](../deploy/hostinger/backups/README.md).

The updater copies runtime files, starts/checks the database, verifies actual collation versions, applies eligible pending migrations transactionally with their exact source history, and starts the backend/web services. It atomically promotes the relative `www/current` symlink and verifies Auth, public JWKS and the exact frontend entrypoint over HTTPS. Shared hashed assets and Workbox files remain available for existing browser sessions.

A full update captures a stopped physical checkpoint of PostgreSQL/keys, Storage and affected persistent runtime data before mutation. An engine patch additionally requires both genuine retained-data proof and a private live-data copy preflight. Public access stays closed through private health. Failure before reopening can restore the previous physical state/runtime and must pass old-service health before reopening. An unresolved failure leaves maintenance active and `manualRecoveryRequired`. Once public writes have resumed, automatic database rewind is forbidden. Transient discovery/download/image-pull failures back off and retry; unsafe configuration, source-history or mutation failures remain held for review. A static-only rollback never silently removes an applied database migration.

Official Ubuntu base/security/updates run at 03:00UTC through the enabled `apt-daily`/`apt-daily-upgrade` timers after a fresh complete encrypted backup. Necessary reboot has a separate03:30UTC timer under the same `/run/lock/luminovia-maintenance.lock`; unattended-upgrade itself cannot schedule an asynchronous reboot. A pending-reboot marker fences new maintenance. Backup, Apt, reboot and CMS updates share the lock so their service/data changes cannot overlap. The provisioned unsupported Monarx feed was preserved and disabled only after confirming no Monarx package/service was installed; the tested application ClamAV remains active.

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

Current operational evidence and the actual first GitHub installation are recorded in [WORKLOG](WORKLOG.md). Development SMTP remains internal Mailpit; 100 GB capacity, recurring encrypted off-site retention and production operations remain separate work.

## Reviewed initial M3 history exception

PR#3 was merged while hosting work was being prepared. Its three migration versions precede the already installed capacity migration. The ordinary updater correctly rejects that order. `deploy/hostinger/reviewed-m3-backfill.mjs` is a separate operator-only exception for exactly those three source SHA-256 values, on this fixed development target with writers stopped. It verifies all existing historical source, fingerprints every existing data column, preserves prior permission grants, and runs all three migrations plus exact source history in one transaction. A real backup clone demonstrated rollback on a deliberate protected-data mutation, successful11-to14 application and idempotent repeat. No seed/reset/password/quota changes are permitted. This exception does not weaken future automatic migration checks.

## First installed release acceptance

[Main CI43733156166](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43733156166) passed and published immutable `cms-dev-7da12e5005f6407d4646f6f1a25146cc26f8ef22`. The real network-driven systemd installation completed at 2026-11-15T16:13:58UTC. Its backup hashes/recovery map and exact live HTTPS index were verified. Post-install accounts/private-file/WSS-revocation checks passed; three existing accounts, fourteen migration entries and10GiB/1GiB quotas remained unchanged. The first run applied no migrations because the reviewed backfill was already complete. Bootstrap approval is cleared and the five-minute timer remains active.
