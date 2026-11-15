# Automatic development updates

This policy applies only to the authorised self-hosted development instance at <https://cms.luminovia.org>. It does not upgrade the Hostinger plan or declare production acceptance.

## What is updated

The GitHub `Portal checks` workflow runs the complete isolated application verification plus release/updater/proxy checks. A successful push to `main` then builds the CMS frontend with the two public repository variables `CMS_SUPABASE_URL` and `CMS_SUPABASE_PUBLISHABLE_KEY`. It packages the frontend, application Edge Functions, complete migration history and reviewed, digest-pinned runtime configuration. No server environment, SSH key, database password or service-role key is sent to GitHub.

The workflow publishes a draft only after uploading both `cms-release.tar.gz` and `cms-release.json`, then makes it an immutable prerelease tagged `cms-dev-<full source SHA>`. Repository immutable releases are enabled. The VPS downloads public artifacts directly; it does not need a GitHub token or a fresh clone.

`luminovia-update.timer` checks approximately every five minutes, with a short random delay. The updater accepts only an immutable release whose tag and manifest match the exact current `main` SHA and a completed successful push run of `.github/workflows/ci.yml`. A failed or superseded build is not installed. Every archive member is checked against its path, length and SHA-256; links and traversal paths are rejected. The public endpoint/key hash must match the existing instance configuration.

Application updates include the self-hosted Supabase functions and compatible new application migrations. Existing migration sources must match exactly. The updater never resets or seeds the database, changes existing passwords/keys, or reapplies development quotas. Destructive/top-level data-rewrite SQL, changed historical migrations, unreviewed runtime changes, PostgreSQL major upgrades and unexpected collation changes stop for operator review. Container images remain pinned; this does not blindly follow Docker `latest` tags or automatically merge upstream dependencies.

## Installation and recovery sequence

Before changing the running system, the updater verifies disk headroom and compares the actual installed runtime bytes and image configuration. A release with unchanged runtime and no pending migrations takes the site/controller-only path: it validates history/configuration, prepares/promotes static files and checks HTTPS without stopping containers, pulling images, scanning Storage or creating a redundant data backup. A failed promotion restores the previous static pointer. It records this mode explicitly; the previous data backup is retained rather than mislabelled as newly created.

For backend/runtime changes, it pulls the reviewed images. It prepares a separate static release. That full path then briefly returns a bilingual 503 maintenance response for backend calls, stops the six backend writers, and backs up the application database, password-free roles and physical Storage objects. These backups are private **on the same VPS**, with at most two complete generations. They protect update operations but are not an off-site backup service. Environment secrets must be recovered separately.

The updater copies runtime files, starts/checks the database, verifies actual collation versions, applies eligible pending migrations transactionally with their exact source history, and starts the backend/web services. It atomically promotes the relative `www/current` symlink and verifies Auth, public JWKS and the exact frontend entrypoint over HTTPS. Shared hashed assets and Workbox files remain available for existing browser sessions.

An ordinary same-runtime failure attempts to restore previous runtime files and the static symlink. A database/runtime change that cannot safely be undone leaves maintenance active and sets `manualRecoveryRequired`. There is no automatic database downgrade or blind database restore. A failed SHA is suppressed until an operator explicitly retries it or a new release is published. A valid database migration is never silently removed by a frontend rollback.

Ubuntu package indexes/security upgrades run through the enabled `apt-daily`/`apt-daily-upgrade` timers. Automatic reboot is disabled. Apt upgrades and CMS updates share `/run/lock/luminovia-maintenance.lock` so package/service restarts do not overlap a deployment. The provisioned unsupported Monarx feed was preserved and disabled only after confirming no Monarx package/service was installed; the tested application ClamAV remains active.

## Operator commands

On the VPS:

```bash
systemctl status luminovia-update.timer --no-pager
systemctl list-timers luminovia-update.timer apt-daily.timer apt-daily-upgrade.timer --no-pager
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

[Main CI43733156166](https://github.com/Luminovia-Training-Consulting/Luminovia-Management-Tool/actions/runs/43733156166) passed and published immutable `cms-dev-7da12e5005f6407d4646f6f1a25146cc26f8ef22`. The real network-driven systemd installation completed at2026-11-15T16:13:58UTC. Its backup hashes/recovery map and exact live HTTPS index were verified. Post-install accounts/private-file/WSS-revocation checks passed; three existing accounts, fourteen migration entries and10GiB/1GiB quotas remained unchanged. The first run applied no migrations because the reviewed backfill was already complete. Bootstrap approval is cleared and the five-minute timer remains active.
