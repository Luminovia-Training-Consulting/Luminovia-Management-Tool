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
- `files.tar.gz.age`: physical Storage objects, stopped Mailpit data, private server/build/environment/JWT configuration (including the generated disabled `selfhost.env.notification.env`), deployed source/frontend/controller state, PostgreSQL custom/key volume, Caddy TLS/config volumes, explicit PostgreSQL configuration files and host recovery configuration (`/etc`, `/root`, `/home`, `/usr/local`, mail/spool and systemd state).

All noncache persistent Docker volumes from the reviewed two Compose projects are included. The Deno dependency cache and ClamAV signatures are explicitly reconstructible exclusions; recovery must pull recorded pinned images and refresh scanner signatures before accepting uploads. Existing backup directories, update staging/rollback/release caches, source `.git`/`.local`/`node_modules`, desktop recovery identities and recursive backup archives are excluded. User Storage documents, including
archives, are included.

A private catalog records operating system package versions/manual packages, installed units, actual immutable image identities and PostgreSQL configuration. These inventories support reconstruction; they are not a claim that deleted upstream packages/images can always be re-downloaded. Keep the provider full-disk recovery option separate and explicit.

The catalog also embeds the public, checksummed installation SQL/control files in `extension-recovery.json`, with original-image provenance and upstream licenses. The current PostgreSQL 17.12 binary image retains extension versions originally installed by the reviewed 17.6 image: notably `pg_net` 0.20.3 and `supabase_vault` 0.3.1. Recreating extensions from the newer image's defaults would change these versions and even some same-version function definitions. Recovery installs the original
captured installer bytes only in the owned isolated container and replays captured extension-member function settings omitted by `pg_dump`; it does not upgrade or change live extensions. Every restored extension version, function setting and permission must still match the source.

For a future approved PostgreSQL 17 patch image, the encrypted catalog must also embed the actual installed candidate-proof document and exact currently applied migration-source inventory. The explicit desktop recovery witness binds that completed proof to the captured proof/source file hashes, current immutable database pin, container content ID and image RepoDigest. Later application migrations may append to the unchanged proven prefix; every restored current migration source is checked again.
Missing/incomplete evidence, changed history, arbitrary tags and other major versions fail closed. The original explicitly reviewed 17.6/17.12 recovery paths remain supported. These guards do not claim that any future image has already passed a real upgrade test.

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

Install the distribution's official `age` package during coordinated maintenance. Install the reviewed Python controller, `database-summary.sql` and required public `extension-recovery.json` together in the source location used below. Before activating the strict systemd sandbox, create the root-owned 0700 directories:

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

The reviewed application writers, Mailpit and Caddy stop briefly while PostgreSQL remains available for logical dumps. The gateway and scanner stay running: they write no included application data, and scanner signatures are an excluded regenerable cache. Unexpected remaining database clients cause failure. The capture window has a 180-second bound, and a `finally` path resumes exactly the services that were running before it, waits for their health contracts and removes only this run's
maintenance flag. Existing operator maintenance is never overwritten. Failure retains the prior valid backup; a failed resumption leaves maintenance active and records that manual recovery is required.

Copy the **encrypted complete set** to a private desktop directory, verify it there and run:

```bash
node deploy/hostinger/backups/restore_complete.mjs \
  --backup .local/hostinger/complete-backups/SET_ID \
  --identity .local/hostinger/complete-backup-key/recovery.agekey
```

The desktop needs age, Docker and the exact recorded reviewed PostgreSQL image. The helper authenticates/decrypts all parts, restores all databases in an owned networkless container with no host ports, and compares password-bearing roles/attributes/memberships/grantors, database ACL/settings, every captured table count/RLS policy/function permission and actual file/config bytes. Source OID 10 remains `supabase_admin`; a separate temporary superuser executes recovery. The PostgreSQL database
itself is retained during the isolated drill because preloaded workers connect to it; schema/data are restored transactionally, and captured database ACL/grantor/settings are replayed only into that owned isolated cluster.

Filesystem contents are actually extracted to private 0700/0600 desktop scratch storage and hash-checked. Original archive owners/groups/modes/links/ACL/xattrs are captured and verified; privileged host ownership/ACLs and absolute symlinks are intentionally not applied on the desktop. No Auth/HTTP services are started against the restored copy. Original runtime secret files and signing/Vault/TLS key bytes are verified without printing them. Owned extraction/container/volume resources are removed
after the drill; a private `desktop-restore-result.json` is atomically replaced only after the native baseline passes. The report records its verification start/end and elapsed milliseconds for decrypt, extraction, PostgreSQL/extension/role and file verification. It also records a conservative backup age measured from the encrypted catalog's `startedAt` (the beginning of capture) through successful verification; this is a freshness observation, not a measured RPO guarantee. Older catalogs without a valid start time remain restorable but report no backup-age evidence (`null`). Report creation, optional migration callback, cleanup, service startup and live traffic are outside the native verification duration. An extraction must create its scratch directory exclusively. If another run has already claimed the same path, its files are preserved. This is not an automatic live disaster restore or an approval to overwrite the VPS.

The recovered private environment's database password is checked against all five runtime roles' actual restored SCRAM hashes. When the generated notification environment is present, its service-role key, internal relay username/password and loopback port are compared with the recovered server environment; no credential is printed. A trusted desktop caller may pass the ignored saved fictional-account ledger to verify the three existing Auth bcrypt passwords as well. An imported `inspectRestored`
callback can run a reviewed migration rehearsal only after the independent native baseline passes and its result is saved. There is deliberately no CLI arbitrary SQL/apply mode; callback results do not replace baseline recovery evidence.

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

After obtaining both locks, a new backup refuses with `reboot_pending` if `/run/luminovia-reboot-pending` exists. This keeps an approved pending reboot from racing with a new quiescence window; read-only freshness checks remain available.

Retention keeps **up to three** verified complete local sets, adapting to disk use. Before a new capture, the oldest may be pruned only when at least two verified complete sets exist, preserving at least one valid set. Capture also reserves at least **5 GiB** for the operating system/runtime and fails safely when estimated space or the live reserve is insufficient. Unknown/corrupt/partial/external evidence is not silently deleted. This does not make three 10 GiB backups fit a 50 GB VPS. The
future 100 GB document capacity and production retention/off-site recovery plan remain separate sizing work.

A local VPS recovery set is not off-site retention. A manually downloaded desktop set is an off-server copy at that point; this module does not promise recurring desktop uploads while the desktop is offline. Configure provider/off-site retention only through the separately authorised service.

### Read-only check of a copied replica

An authorised reader can check a fully copied encrypted set without a decryption key or any write operation:

```bash
python3 deploy/hostinger/backups/complete_backup.py \
  --verify-replica /srv/authorised-reader/complete-backups/SET_ID \
  --manifest-sha256 TRUSTED_SOURCE_MANIFEST_SHA256 \
  --max-age-hours 26
```

Obtain the SHA-256 of the source `manifest.json` through a separately authenticated channel before relying on the copy; never calculate the trust pin from the replica itself. The verifier first pins the exact manifest bytes, then validates every declared encrypted file's name, private permissions, age header, byte length and SHA-256. It requires zoned `startedAt`/`completedAt` evidence in order, rejects future timestamps and exits unsuccessfully if the completion is older than the requested limit (1–48 hours). Success emits `replica_ciphertext_verified`, the pin and observed age, and explicitly reports `decryptionPerformed: false`; no age identity, database, or plaintext is needed.

This proves only that the observed directory matches the trusted manifest and passes ciphertext/freshness checks at that time. It does not establish that the reader is physically or administratively independent, that a scheduled transfer/monitor/alert exists, or that the replica can be decrypted or restored. A successful command must not be reported as a restore or production RPO/RTO test.

## Executed implementation checks

All 31 Python backup tests passed, including authenticated tamper rejection, private extraction/traversal guards, no plaintext dump artifacts, adaptive retention, both lock contention paths, the pending-reboot guard, future-image proof/source binding, preserving existing maintenance, resuming only previously running services, and replica pin/freshness rejection. Three additional desktop witness tests exercise unchanged-prefix acceptance and rejection of altered/incomplete/mismatched proofs, current files,
restored ledger, container identities, tags and major versions. A real disposable encrypted fixture passed a complete three-database restore, password-bearing roles/grantors and nondefault database ACL/settings/comment, RLS/table counts, secret configuration/key/TLS/mail/object hashes. It also uses genuine legacy extension installers/settings, checks the saved fixture SCRAM password and rejects a wrong password. The fixture contains fictional data and does not replace the actual VPS
backup/restore drill.

The latest native fixture also copied its complete encrypted set into a separate reader directory and passed `--verify-replica` using the source manifest's exact SHA-256 pin obtained before the copy. The fixture's complete decrypt/restore then passed for 3 databases and 8 files (native verification 5,693 ms; catalog-based age 10 seconds). These synthetic results validate the implementation paths only, not recurring replication, physical independence, off-site freshness or production RPO/RTO.

Actual VPS acceptance on 15 November 2026: the self-contained encrypted set completed at **18:41:10 UTC** (20,979,948 ciphertext bytes, 45.8 seconds for the service). Its isolated desktop restore passed at **18:42:32 UTC**, covering three databases, 1,817 physical files/38,090,950 bytes, exact source globals/permissions/settings/extension versions, the embedded original installers, all five runtime database credentials and all three saved fictional Auth passwords. The separate earlier first set
also passed recovery after the legacy-extension gap was identified and fixed. No live database was restored.

The daily timer was then read back as **enabled and active**, next run **16 November at 02:00 UTC**, with successful service exit and the 26-hour freshness gate passing. Daily server verification remains ciphertext-only. Subsequent canonical HTTPS saved-password/account/private-file/admin-denial and WSS revocation checks passed; three existing users/profiles, 14 migrations, one stored private document/object and the 10 GiB/1 GiB quotas were preserved. Detailed encrypted artifacts and safe result
records are retained only in ignored private desktop storage.

The final post-automatic-update schema18set `20261115T201015Z-566a76ede5b4` completed20:10:56.676307UTC,24,991,480 ciphertext bytes / six parts. Its actual native desktop recovery passed20:13:18.322UTC:all 3 databases,1,990 files/48,121,876 bytes, all 5 runtime / 3 saved Auth credentials, exact permissions/function settings/extensions and configuration/keys. All18restored SQLsources and captured deployed files match main bb322746. Original 3 users/profiles/roles,1 private 114-byte
object/document,10/1GiBquotas and22blocks/24sources/22templates remain. Final inspection was SELECT-only; owned container/volume/plaintext cleanup completed. No live restore, Auth/HTTP recovery stack or post-boot disaster reconstruction is claimed by this native drill. The02UTC daily timer remains enabled/active; recurring off-site service remains separate and unpurchased.

```bash
python3 -m unittest discover -s deploy/hostinger/backups -p 'test_*.py'
node --test deploy/hostinger/backups/*.test.mjs
node deploy/hostinger/backups/test_complete_restore.mjs
```

The full GitHub `verify-selfhost` profile installs the official `age` package and executes the complete fictional encrypted restore before the retained-data/selfhost compatibility run. Its step summary reports the measured native-verification duration and conservative backup age. The fixture checks an incorrect key both before evidence exists and after a successful report: a failed decrypt must neither create nor alter `desktop-restore-result.json`. It also checks that the report is mode 0600 and contains the returned measurement.

Native crypto cases require `age`/`age-keygen`; environment variables `AGE_TEST_BINARY`/`AGE_KEYGEN_TEST_BINARY` can point to independently verified local executables. A skipped crypto test is not acceptance. The fixture uses a synthetic catalog and fictional accounts in owned networkless containers; it does not prove the current off-site copy, a recurring restore timer, restoration of Auth/HTTP services, or production RTO/RPO.

Official references: [age](https://github.com/FiloSottile/age), [PostgreSQL logical dumps](https://www.postgresql.org/docs/17/app-pgdump.html), [cluster globals](https://www.postgresql.org/docs/17/app-pg-dumpall.html), [pg_restore](https://www.postgresql.org/docs/17/app-pgrestore.html).
