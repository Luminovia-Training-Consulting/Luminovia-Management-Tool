# Daily complete encrypted recovery sets

This module backs up the authorised self-hosted development VPS. It is a recovery set of application data, secrets, configuration and software inventories. A provider full-disk snapshot is a separate service; this module does not duplicate the operating system binaries or Docker image layers and does not call a paid storage API.

The daily unit runs at **02:00 UTC**, with a persistent catch-up timer. Operating system maintenance can run at 03:00 UTC after the freshness gate. The controller acquires `/run/lock/luminovia-maintenance.lock` **first**, then `private/updates/updater.lock`, matching the application/OS maintenance order. Do not add a second outer global `flock` to the backup unit. Concurrent maintenance waits rather than changing Docker or data during the backup.

## Recovery coverage and format

Root-owned mode 0700 sets live under `/var/backups/luminovia-complete`; every artifact is mode 0600. A timestamp/UUID directory is complete only after encrypted parts and their SHA-256/lengths pass verification and an atomic directory rename finishes. Partial or unknown sets are never treated as valid retention candidates.

Each set contains:

- `manifest.json`: nonsecret format/completion timestamps and ciphertext checksums/lengths.
- `catalog.json.age`: encrypted database identities/settings/summaries, all original file hashes/modes/owners/groups/links/ACL/xattr metadata, effective PostgreSQL configuration, actual container configuration, package/unit/image inventories and reconstruction exclusions.
- `globals.sql.age`: password-bearing PostgreSQL global role definitions, attributes, memberships and grantors. The role stream goes directly from `pg_dumpall` to age; no plaintext role or database dump file is written on the VPS.
- `database-NNN.dump.age`: a custom-format logical dump of **each connectable database**, currently `postgres`, `_supabase` and `template1`. A raw live PGDATA copy is not a recovery method. Pristine non-connectable `template0` is recreated by the exact PostgreSQL image.
- `files.tar.gz.age`: physical Storage objects, stopped Mailpit data, private server/build/environment/JWT configuration, deployed source/frontend/controller state, PostgreSQL custom/key volume, Caddy TLS/config volumes, explicit PostgreSQL configuration files and host recovery configuration (`/etc`, `/root`, `/home`, `/usr/local`, mail/spool and systemd state).

All noncache persistent Docker volumes from the reviewed two Compose projects are included. The Deno dependency cache and ClamAV signatures are explicitly reconstructible exclusions; recovery must pull recorded pinned images and refresh scanner signatures before accepting uploads. Existing backup directories, update staging/rollback/release caches, source `.git`/`.local`/`node_modules`, desktop recovery identities and recursive backup archives are excluded. User Storage documents, including archives, are included.

A private catalog records operating system package versions/manual packages, installed units, actual immutable image identities and PostgreSQL configuration. These inventories support reconstruction; they are not a claim that deleted upstream packages/images can always be re-downloaded. Keep the provider full-disk recovery option separate and explicit.

## Encryption key boundary

Generate the identity once **on the desktop**, into an ignored private directory:

```bash
python3 deploy/hostinger/backups/create_recovery_key.py \
  --directory .local/hostinger/complete-backup-key
```

This requires the official `age-keygen` executable. The helper refuses root execution, nonignored destinations, key replacement or a mismatched existing recipient. It prints no key material. `recovery.agekey` and `recipient.txt` have mode 0600; their parent is mode 0700. Preserve an additional independent secure copy of the identity: losing it makes encrypted sets unrecoverable.

**Copy only `recipient.txt` to the VPS** at `/opt/luminovia-portal/private/backups/recipient.txt`, root-owned 0600. Never copy `recovery.agekey` to the server, a release artifact, GitHub Actions or an archive. The VPS stores only the public X25519 recipient. Key rotation requires preserving the old identity for old retained backups.

Daily VPS verification checks successful age producer exits, ciphertext headers, lengths and SHA-256. It cannot decrypt without the off-server identity. A desktop decrypt/restore drill is a separate recorded result; daily ciphertext verification is never labelled a daily restore test.

## Install and first actual acceptance

Install the distribution's official `age` package during coordinated maintenance. Install the reviewed Python controller and `database-summary.sql` together in the source location used below. Before activating the strict systemd sandbox, create the root-owned 0700 directories:

```bash
install -d -m0700 \
  /var/backups/luminovia-complete \
  /opt/luminovia-portal/private/backups \
  /opt/luminovia-portal/private/updates
```

Install the public recipient with mode 0600 and the two provided units under `/etc/systemd/system`. Run `systemd-analyze verify` and `systemctl daemon-reload`. The service executes Python directly and acquires both locks internally; `/run/lock` is its explicit writable lock directory.

First run one actual set:

```bash
python3 /opt/luminovia-portal/source/deploy/hostinger/backups/complete_backup.py --run
```

The reviewed application writers, Mailpit and Caddy stop briefly while PostgreSQL remains available for logical dumps. The gateway and scanner stay running: they write no included application data, and scanner signatures are an excluded regenerable cache. Unexpected remaining database clients cause failure. The capture window has a 180-second bound, and a `finally` path resumes exactly the services that were running before it, waits for their health contracts and removes only this run's maintenance flag. Existing operator maintenance is never overwritten. Failure retains the prior valid backup; a failed resumption leaves maintenance active and records that manual recovery is required.

Copy the **encrypted complete set** to a private desktop directory, verify it there and run:

```bash
node deploy/hostinger/backups/restore_complete.mjs \
  --backup .local/hostinger/complete-backups/SET_ID \
  --identity .local/hostinger/complete-backup-key/recovery.agekey
```

The desktop needs age, Docker and the exact recorded reviewed PostgreSQL image. The helper authenticates/decrypts all parts, restores all databases in an owned networkless container with no host ports, and compares password-bearing roles/attributes/memberships/grantors, database ACL/settings, every captured table count/RLS policy/function permission and actual file/config bytes. Source OID 10 remains `supabase_admin`; a separate temporary superuser executes recovery. The PostgreSQL database itself is retained during the isolated drill because preloaded workers connect to it; schema/data are restored transactionally, and captured database ACL/grantor/settings are replayed only into that owned isolated cluster.

Filesystem contents are actually extracted to private 0700/0600 desktop scratch storage and hash-checked. Original archive owners/groups/modes/links/ACL/xattrs are captured and verified; privileged host ownership/ACLs and absolute symlinks are intentionally not applied on the desktop. No Auth/HTTP services are started against the restored copy. Original runtime secret files and signing/Vault/TLS key bytes are verified without printing them. Owned extraction/container/volume resources are removed after the drill; a private `desktop-restore-result.json` records the result. This is not an automatic live disaster restore or an approval to overwrite the VPS.

After the first actual backup/decrypt/restore acceptance, enable the timer:

```bash
systemctl enable --now luminovia-complete-backup.timer
systemctl list-timers luminovia-complete-backup.timer
```

The initial implementation tests alone do not establish installed daily operation. Record literal first-live results and timer readback in the work log after execution.

## Freshness, retention and monitoring

Read-only gate:

```bash
python3 /opt/luminovia-portal/source/deploy/hostinger/backups/complete_backup.py \
  --check-fresh --max-age-hours 26
```

An OS maintenance `ExecStartPre` can call `--ensure-fresh --max-age-hours 26` **before** obtaining its own global lock. A recent complete, hash-verified set passes; otherwise the backup controller takes its own locks and creates one. Failure blocks dependent maintenance. Status is `/opt/luminovia-portal/private/backups/state.json`; it contains no secret values. Inspect the service journal/status and the private manifest, without printing environment or role files.

Retention keeps **up to three** verified complete local sets, adapting to disk use. Before a new capture, the oldest may be pruned only when at least two verified complete sets exist, preserving at least one valid set. Capture also reserves at least **5 GiB** for the operating system/runtime and fails safely when estimated space or the live reserve is insufficient. Unknown/corrupt/partial/external evidence is not silently deleted. This does not make three 10 GiB backups fit a 50 GB VPS. The future 100 GB document capacity and production retention/off-site recovery plan remain separate sizing work.

A local VPS recovery set is not off-site retention. A manually downloaded desktop set is an off-server copy at that point; this module does not promise recurring desktop uploads while the desktop is offline. Configure provider/off-site retention only through the separately authorised service.

## Executed implementation checks

The implementation passed 21 safety/native-age tests, including authenticated tamper rejection, private extraction/traversal guards, no plaintext dump artifacts, adaptive retention, both lock contention paths, preserving existing maintenance and resuming only previously running services. A real disposable encrypted fixture passed a complete three-database restore, password-bearing roles/grantors and nondefault database ACL/settings/comment, RLS/table counts, secret configuration/key/TLS/mail/object hashes. The fixture contains fictional data and does not replace the first actual VPS backup/restore drill.

```bash
python3 -m unittest discover -s deploy/hostinger/backups -p 'test_*.py'
node deploy/hostinger/backups/test_complete_restore.mjs
```

Native crypto cases require `age`/`age-keygen`; environment variables `AGE_TEST_BINARY`/`AGE_KEYGEN_TEST_BINARY` can point to independently verified local executables. A skipped crypto test is not acceptance.

Official references: [age](https://github.com/FiloSottile/age), [PostgreSQL logical dumps](https://www.postgresql.org/docs/17/app-pgdump.html), [cluster globals](https://www.postgresql.org/docs/17/app-pg-dumpall.html), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).
