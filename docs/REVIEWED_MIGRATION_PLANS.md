# Explicit reviewed migration plans

The ordinary five-minute updater keeps its strict SQL classifier. A plan file is never discovered automatically. An operator may explicitly approve one complete, immutable current-main release with `--once --package … --manifest … --reviewed-migration-plan …` after reviewing its exact pending SQL. This route uses the existing stopped-writer backup, physical checkpoint, runtime installation, transactional migration, private-health and rollback lifecycle. It does not run manual SQL beside that lifecycle.

This document describes source behavior and local test evidence. It does not assert that this controller, any plan, a migration or notification worker has been installed on a VPS. Normal deployment authorisation and current coordination holds still apply.

## What a plan authorises

The plan binds one instance root, installed commit, target commit, complete manifest hash, archive hash, the full installed migration version/source hashes, and every pending migration path/version/source hash. It records which pending statements the unattended classifier rejects. Changed history, missing history, source drift, backdated pending versions, a different manifest or installed commit all fail closed. Review cannot rewrite already applied sources or bypass the existing PostgreSQL-major/collation/runtime gates.

The plan requires existing source history and a distinct installed commit; it is not an initial bootstrap mechanism. Its default lifetime is one hour, bounded to 60–7200 seconds. Application requires a root-owned regular file with exact mode `0600`, one hard link, no symlink, and a direct path under `/opt/luminovia-portal/private/updates/reviewed-migrations/`. The instance root, private directory, update directory and plan directory must be root-owned and not writable by group or others. Root ownership is the local trust boundary; there is no public/browser approval API or unattended approval flag.

At application time, the target must still be the exact current `main`, with successful exact-SHA CI and an immutable release. The local manifest must equal that published release's full manifest; its archive and every extracted file must verify. The updater repeats the release/history/file checks after backup and checkpoint, immediately before consuming the plan. It rechecks the lifetime again after the last network request, immediately before exclusive reservation. An intervening main promotion or history change aborts before reviewed SQL.

The reviewed SQL still requires one explicit `BEGIN;`/`COMMIT;` transaction with the established own-line delimiters. Nested top-level transaction control, parser string-mode changes, `ALTER SYSTEM` and `COPY … PROGRAM` are rejected. SQL inside function/DO bodies remains inside PostgreSQL's enclosing transaction. The exact source history is inserted before the same commit, under the migration advisory lock.

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

## Review and apply once

Inspect the plan's installed/target commits, complete manifest/archive hashes, full applied inventory and every pending source digest/review reason. Review the corresponding exact SQL bytes in that verified package together with the migration guide, permissions, data changes and rollback implications. Hashes identify the concrete work; they do not replace SQL review. Creating or printing a plan alone does not approve execution. Passing its path explicitly at application is the operator's approval of that concrete review.

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

## Failure and retry

Before public access resumes, the normal physical checkpoint/runtime rollback remains available. A consumed plan stays consumed after rollback because its tombstone is outside the physical data mounts. Existing failure state and `manualRecoveryRequired` remain authoritative. After public writes resume, automatic database rewind remains forbidden.

A retry after a failed, consumed attempt needs a newly constructed and reviewed plan with a new UUID, current live installed history/state and valid lifetime. Use `--retry-failed` with the same explicit local package, manifest and new reviewed plan. The target must equal the recorded failed commit and still be the eligible immutable current main. If main has moved, resolve recovery and prepare a fresh ordinary review for the eligible target; do not erase failure evidence or reuse the consumed file.

The unattended timer never reads a plan or relaxes its classifier. A normal timer rejection therefore cannot silently activate a file an operator previously prepared.

## Local verification evidence

`python3 -m unittest discover -s deploy/hostinger/updates -p 'test_*.py'` runs the existing updater suite plus 25 focused reviewed-plan cases (63 total at this source). The cases cover strict unattended policy, all identity/source bindings, CRLF preservation, no-overwrite/root/mode/link/TTL validation, one-shot consumption across rollback, exact-SHA retry, complete-backup/checkpoint ordering, pre-mutation drift, actual process `flock` contention/inheritance and read-only CLI behavior.

`node scripts/reviewed-updater-db-tests.mjs` creates and drops an owned local PostgreSQL test database. Its five groups prove ordinary rejection, reviewed exact-source commit, full rollback on a later statement failure, PostgreSQL rejection of concealed transaction termination, and concurrent duplicate-history rollback without a second data rewrite. The fixture uses the real updater's SQL envelope; it does not claim a real VM physical restore or deployment acceptance.
