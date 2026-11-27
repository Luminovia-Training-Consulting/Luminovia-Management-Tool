#!/usr/bin/env python3
# Encrypt all connectable databases, actual document bytes and recovery configuration. Streams go directly to age; only completed, hash-verified ciphertext sets count toward freshness and retention.
"""Encrypted, coordinated full recovery sets for the named development VPS.

No decryption identity or plaintext dump is written on the VPS. Each logical
archive and the file tar stream goes directly through age public-key encryption.
"""
import argparse
import datetime as dt
import fcntl
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import threading
import time
import uuid
from pathlib import Path

FORMAT = "luminovia-complete-backup-v1"
ROOT = Path("/opt/luminovia-portal")
DESTINATION = Path("/var/backups/luminovia-complete")
MIN_FREE = 5 * 1024 ** 3
RETAIN = 3
DB = "luminovia-supabase-db-1"
SERVICES = {"luminovia-supabase": {"db", "auth", "rest", "realtime", "storage", "functions", "api-gw", "mailpit"}, "luminovia-portal": {"web", "clamav"}}
REBUILDABLE_VOLUMES = {"/root/.cache/deno", "/var/lib/clamav"}
LEGACY_IMAGES = {
    "supabase/postgres:17.6.1.136@sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00",
    "supabase/postgres:17.12.0.000@sha256:8630950b489ecc70563300180287a98c192a4a48f5ae00b4febdaeea1abe85de",
}
SUMMARY_SQL = Path(__file__).with_name("database-summary.sql").read_text()


class BackupError(Exception):
    pass


# Return a UTC timestamp for the backup catalog and freshness checks.
def utc():
    return dt.datetime.now(dt.timezone.utc).isoformat()


# Reject target/ancestor symlinks, require current ownership and enforce 0700.
def private_dir(path):
    path = Path(path)
    if path.is_symlink() or any(parent.is_symlink() for parent in path.absolute().parents):
        raise BackupError("unsafe_private_directory")
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if not path.is_dir() or path.stat().st_uid != os.geteuid():
        raise BackupError("unsafe_private_directory")
    path.chmod(0o700)


# Accept only a private regular file owned by the executing user.
def private_file(path):
    s = Path(path).lstat()
    if not stat.S_ISREG(s.st_mode) or s.st_uid != os.geteuid() or s.st_mode & 0o077:
        raise BackupError("unsafe_private_file")


# Write recovery metadata through a new private temporary file and atomic replacement.
def write_json(path, value):
    private_dir(Path(path).parent)
    temporary = Path(str(path) + "." + uuid.uuid4().hex + ".partial")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as out:
        json.dump(value, out, sort_keys=True, indent=2)
        out.write("\n")
        out.flush()
        os.fsync(out.fileno())
    os.replace(temporary, path)
    descriptor = os.open(Path(path).parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


# Hash the complete file incrementally rather than loading large artifacts into memory.
def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


# Run a command with a timeout and no shell; keep process output out of stable backup error codes.
def run(arguments, *, data=None, timeout=300):
    try:
        return subprocess.run(arguments, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=timeout).stdout
    except (OSError, subprocess.SubprocessError) as error:
        # Never expose argv/environment/SQL or a command's potentially secret stderr.
        raise BackupError("command_failed_" + Path(arguments[0]).name) from error


# Own the age process and hash plaintext/ciphertext separately; accept a part only after successful finalization.
class EncryptedPart:
    # Exclusively create this partial ciphertext artifact and start its own age process.
    def __init__(self, path, recipient, *, age="age", reserve=MIN_FREE):
        self.path = Path(path)
        self.partial = Path(str(path) + ".partial")
        self.reserve = reserve
        self.plain_hash = hashlib.sha256()
        self.plain_bytes = 0
        self.error = bytearray()
        fd = os.open(self.partial, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        self.output = os.fdopen(fd, "wb")
        try:
            self.process = subprocess.Popen([age, "--encrypt", "--recipient", recipient], stdin=subprocess.PIPE, stdout=self.output, stderr=subprocess.PIPE)
        except OSError as error:
            self.output.close()
            self.partial.unlink(missing_ok=True)
            raise BackupError("age_unavailable") from error
        self.reader = threading.Thread(target=self._drain, daemon=True)
        self.reader.start()

    # Continuously drain age stderr while retaining only bounded private diagnostics.
    def _drain(self):
        while True:
            chunk = self.process.stderr.read(4096)
            if not chunk:
                return
            if len(self.error) < 16384:
                self.error.extend(chunk[:16384 - len(self.error)])

    # Write directly to age and update the plaintext hash/count after forwarding bytes; do not create a plaintext dump file.
    def write(self, content):
        if shutil.disk_usage(self.path.parent).free < self.reserve:
            raise BackupError("disk_reserve_reached")
        try:
            self.process.stdin.write(content)
        except (BrokenPipeError, OSError) as error:
            raise BackupError("encryption_stream_failed") from error
        self.plain_hash.update(content)
        self.plain_bytes += len(content)
        return len(content)

    # Forward flushing to the owned encryption process.
    def flush(self):
        self.process.stdin.flush()

    # Close input and require encryption/writer success before finalizing the checksum.
    def finish(self):
        try:
            self.process.stdin.close()
            status = self.process.wait(timeout=120)
            self.reader.join(timeout=5)
            self.process.stderr.close()
            self.output.flush()
            os.fsync(self.output.fileno())
            self.output.close()
            if status:
                raise BackupError("age_encryption_failed")
            with self.partial.open("rb") as data:
                if data.read(22) != b"age-encryption.org/v1\n":
                    raise BackupError("invalid_ciphertext_header")
            if shutil.disk_usage(self.path.parent).free < self.reserve:
                raise BackupError("disk_reserve_reached")
            os.replace(self.partial, self.path)
            return {"sha256": digest(self.path), "bytes": self.path.stat().st_size, "plaintextSha256": self.plain_hash.hexdigest(), "plaintextBytes": self.plain_bytes}
        except Exception:
            self.abort()
            raise

    # Abort only this incomplete encryption process and remove its unaccepted artifact.
    def abort(self):
        if self.process.poll() is None:
            self.process.kill()
            self.process.wait(timeout=10)
        try:
            self.process.stdin.close()
        except (OSError, BrokenPipeError):
            pass
        self.reader.join(timeout=5)
        self.process.stderr.close()
        self.output.close()
        self.partial.unlink(missing_ok=True)


# Pipe a real producer directly into age and require both processes to succeed.
def encrypt_command(arguments, path, recipient, *, age="age", reserve=MIN_FREE):
    part = EncryptedPart(path, recipient, age=age, reserve=reserve)
    process = None
    try:
        process = subprocess.Popen(arguments, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        for content in iter(lambda: process.stdout.read(1024 * 1024), b""):
            part.write(content)
        if process.wait(timeout=120):
            raise BackupError("backup_producer_failed")
        process.stdout.close()
        return part.finish()
    except Exception:
        if process is not None:
            process.stdout.close()
            process.kill()
            process.wait(timeout=10)
        part.abort()
        raise


# Check ciphertext parts, lengths, permissions and manifest completeness before accepting a set.
def verify_complete(path, *, expected_manifest_sha256=None):
    """Ciphertext integrity only. No private identity is present on the VPS."""
    path = Path(path)
    if path.is_symlink() or not path.is_dir():
        raise BackupError("unsafe_backup_set")
    directory = path.lstat()
    if directory.st_uid != os.geteuid() or directory.st_mode & 0o077:
        raise BackupError("unsafe_backup_set")
    manifest_path = path / "manifest.json"
    private_file(manifest_path)
    manifest_bytes = manifest_path.read_bytes()
    if expected_manifest_sha256 is not None and hashlib.sha256(manifest_bytes).hexdigest() != expected_manifest_sha256:
        raise BackupError("manifest_pin_mismatch")
    try:
        manifest = json.loads(manifest_bytes)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BackupError("invalid_backup_manifest") from error
    if manifest.get("format") != FORMAT or manifest.get("status") != "complete":
        raise BackupError("incomplete_backup_set")
    parts = manifest.get("parts", {})
    if not {"catalog.json.age", "globals.sql.age", "files.tar.gz.age"}.issubset(parts):
        raise BackupError("missing_backup_parts")
    database_parts = sorted(name for name in parts if name.startswith("database-"))
    if len(database_parts) < 2 or database_parts != ["database-" + str(i).zfill(3) + ".dump.age" for i in range(len(database_parts))] or manifest.get("databaseCount") != len(database_parts):
        raise BackupError("missing_database_archives")
    for name, item in parts.items():
        if not re.fullmatch(r"(?:catalog\.json|globals\.sql|files\.tar\.gz|database-\d{3}\.dump)\.age", name):
            raise BackupError("unsafe_backup_part_name")
        file = path / name
        private_file(file)
        with file.open("rb") as stream:
            if stream.read(22) != b"age-encryption.org/v1\n":
                raise BackupError("invalid_ciphertext_header")
        if file.stat().st_size != item["bytes"] or digest(file) != item["sha256"]:
            raise BackupError("ciphertext_checksum_mismatch")
    return manifest


# Require zoned, ordered completion evidence; a replica is fresh only when its pinned set is recent now.
def verify_replica(path, *, manifest_sha256, max_age_hours=26, now=None):
    if not isinstance(manifest_sha256, str) or not re.fullmatch(r"[0-9a-f]{64}", manifest_sha256):
        raise BackupError("invalid_manifest_pin")
    if not isinstance(max_age_hours, int) or not 1 <= max_age_hours <= 48:
        raise BackupError("invalid_backup_freshness_limit")
    manifest = verify_complete(path, expected_manifest_sha256=manifest_sha256)

    def parse_timestamp(value):
        if not isinstance(value, str):
            raise BackupError("invalid_replica_freshness_evidence")
        try:
            parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as error:
            raise BackupError("invalid_replica_freshness_evidence") from error
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            raise BackupError("invalid_replica_freshness_evidence")
        return parsed.astimezone(dt.timezone.utc)

    started = parse_timestamp(manifest.get("startedAt"))
    completed = parse_timestamp(manifest.get("completedAt"))
    measured_at = now or dt.datetime.now(dt.timezone.utc)
    if measured_at.tzinfo is None or measured_at.utcoffset() is None:
        raise BackupError("invalid_replica_clock")
    measured_at = measured_at.astimezone(dt.timezone.utc)
    if started > completed or completed > measured_at:
        raise BackupError("replica_backup_future_dated_or_unordered")
    age_seconds = int((measured_at - completed).total_seconds())
    if age_seconds > max_age_hours * 3600:
        raise BackupError("replica_backup_stale")
    return {
        "status": "replica_ciphertext_verified",
        "manifestSha256": manifest_sha256,
        "verifiedAt": measured_at.isoformat(),
        "backupAgeSeconds": age_seconds,
        "maxAgeHours": max_age_hours,
        "decryptionPerformed": False,
    }


# Consider only owned, complete, successfully verified sets for retention.
def retained_sets(destination):
    result = []
    for path in Path(destination).iterdir():
        if re.fullmatch(r"\d{8}T\d{6}Z-[0-9a-f]{12}", path.name):
            try:
                verify_complete(path)
                result.append(path)
            except (BackupError, ValueError, OSError, KeyError):
                continue  # Corrupt/unknown evidence is never deleted as a valid set.
    return sorted(result)


# Remove only known valid older sets while preserving a last usable recovery set.
def make_room(destination, required, *, reserve=MIN_FREE, free_bytes=None):
    free_bytes = free_bytes or (lambda: shutil.disk_usage(destination).free)
    valid = retained_sets(destination)
    while free_bytes() < required + reserve and len(valid) >= 2:
        old = valid.pop(0)
        verify_complete(old)
        shutil.rmtree(old)
    if free_bytes() < required + reserve:
        raise BackupError("insufficient_disk_with_last_valid_backup_preserved")


# Apply final retention only after a new set has actually succeeded.
def prune_after_success(destination, *, reserve=MIN_FREE):
    valid = retained_sets(destination)
    while len(valid) > RETAIN or (shutil.disk_usage(destination).free < reserve and len(valid) >= 2):
        old = valid.pop(0)
        verify_complete(old)
        shutil.rmtree(old)


# Coordinate quiescence, encrypted database/file streams and service resumption under the updater's maintenance locks.
class CompleteBackup:
    # Bind private paths and process/lock ownership to this backup instance.
    def __init__(self, root=ROOT, destination=DESTINATION, *, age="age", reserve=MIN_FREE, host_root=Path("/")):
        self.root = Path(root)
        self.destination = Path(destination)
        self.age = age
        self.reserve = reserve
        self.host_root = Path(host_root)
        self.control = self.root / "private/backups"
        self.maintenance = self.root / "www/maintenance.enabled"
        self.status = self.control / "state.json"
        self.lock = self.root / "private/updates/updater.lock"
        self.global_lock = Path("/run/lock/luminovia-maintenance.lock") if self.root == ROOT else self.root.parent / "global-maintenance.lock"
        self.reboot_pending = self.host_root / "run/luminovia-reboot-pending"
        self.containers = []
        self.stopped = []
        self.flag_owned = False
        self.started = None

    # Query known databases through the fixed container connection with an explicit database name.
    def sql(self, query, *, database="postgres"):
        return run(["docker", "exec", "-i", DB, "psql", "-U", "supabase_admin", "-d", database, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], data=query.encode()).decode().strip()

    # Check the expected service inventory and running immutable database image.
    def inspect(self):
        containers = []
        for project, expected in SERVICES.items():
            names = run(["docker", "ps", "-a", "--filter", "label=com.docker.compose.project=" + project, "--format", "{{.Names}}"]).decode().splitlines()
            rows = json.loads(run(["docker", "inspect", *names])) if names else []
            actual = {row["Config"]["Labels"]["com.docker.compose.service"] for row in rows}
            if project == "luminovia-supabase" and "mail-relay" in actual:
                config = self.root / "source/deploy/hostinger/selfhost/compose.yml"
                if config.is_file() and not config.is_symlink() and re.search(r"(?m)^  mail-relay:\s*$", config.read_text()):
                    expected = {*expected, "mail-relay"}
            if actual != expected or len(rows) != len(expected):
                raise BackupError("unreviewed_service_inventory")
            containers.extend(rows)
        self.containers = containers
        database = next(row for row in containers if row["Name"] == "/" + DB)
        image = database["Config"]["Image"]
        if not re.fullmatch(r"supabase/postgres:[0-9.]+@sha256:[a-f0-9]{64}", image) or not database["State"]["Running"]:
            raise BackupError("database_not_running_on_immutable_image")
        return image

    # Require installed completed proof and exact current migration source for later database images.
    def recovery_image_evidence(self, image):
        if image in LEGACY_IMAGES:
            return None  # Preserve the original explicitly reviewed recovery path.
        proof_path = self.root / "source/deploy/hostinger/selfhost/postgres-candidate-proof.json"
        if not proof_path.exists():
            raise BackupError("missing_installed_postgres_recovery_proof")
        if proof_path.is_symlink() or not proof_path.is_file() or proof_path.stat().st_size > 1024 ** 2:
            raise BackupError("unsafe_installed_postgres_recovery_proof")
        proof_text = proof_path.read_text()
        proof = json.loads(proof_text)
        image_pattern = r"supabase/postgres:17\.\d+\.\d+\.\d+@sha256:[a-f0-9]{64}"
        flags = ["passed", "migrationSourcesExact", "existingCredentialsAndFileExact", "roleAndMembershipExact"]
        if not (proof.get("schemaVersion") == 1 and proof.get("postgresMajor") == 17 and proof.get("requiresLiveDataPreflight") is True
                and re.fullmatch(r"[a-f0-9]{40}", str(proof.get("sourceCommit", "")))
                and all(re.fullmatch(image_pattern, str(proof.get(k, ""))) for k in ["sourceImage", "targetImage"])
                and proof["sourceImage"] != proof["targetImage"] and proof["targetImage"] == image
                and proof.get("validation", {}).get("kind") == "isolated-selfhost-upgrade-fixture"
                and all(proof["validation"].get(k) is True for k in flags)):
            raise BackupError("invalid_installed_postgres_recovery_proof")
        history = json.loads(self.sql("select json_agg(json_build_object('version',version,'source',statements[1],'statementCount',cardinality(statements)) order by version) from supabase_migrations.schema_migrations;"))
        inventory = []
        for entry in history or []:
            if not re.fullmatch(r"\d{14}", str(entry.get("version", ""))) or entry.get("statementCount") != 1 or not isinstance(entry.get("source"), str):
                raise BackupError("invalid_live_migration_recovery_inventory")
            matches = list((self.root / "source/supabase/migrations").glob(entry["version"] + "_*.sql"))
            if len(matches) != 1 or matches[0].is_symlink() or not matches[0].is_file() or matches[0].read_bytes() != entry["source"].encode():
                raise BackupError("live_migration_recovery_source_differs")
            inventory.append({"path": "supabase/migrations/" + matches[0].name, "sha256": hashlib.sha256(entry["source"].encode()).hexdigest()})
        proven = proof.get("migrationInventory")
        if not isinstance(proven, list) or not 0 < len(proven) <= len(inventory) or proven != inventory[:len(proven)] or any(set(e) != {"path", "sha256"} for e in proven):
            raise BackupError("postgres_recovery_proof_history_differs")
        if proof.get("migrationInventorySha256") != hashlib.sha256(json.dumps(proven, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest():
            raise BackupError("postgres_recovery_proof_inventory_digest_differs")
        return {"format": "luminovia-installed-postgres-recovery-proof-v1", "proofText": proof_text,
                "proofPath": proof_path.relative_to(self.host_root).as_posix(), "proofSha256": digest(proof_path),
                "appliedMigrationInventory": inventory}

    # Capture recovery roots and writable mounts while explicitly excluding reconstructible caches.
    def paths(self):
        paths = [self.root / name for name in ["source", "www", "private", "control", "data/storage", "data/mailpit"]]
        # Restore-critical configuration is captured separately; live PGDATA
        # heap/WAL files are deliberately never used as a physical backup.
        paths += [self.root / "data/postgres" / name for name in ["postgresql.auto.conf", "pg_hba.conf", "pg_ident.conf"] if (self.root / "data/postgres" / name).exists() and not (self.root / "data/postgres" / name).is_symlink()]
        paths += [self.host_root / name for name in ["etc", "root", "home", "usr/local", "var/spool", "var/mail", "var/lib/systemd"] if (self.host_root / name).exists()]
        volumes = []
        excluded = []
        for row in self.containers:
            for mount in row["Mounts"]:
                if mount["Type"] == "volume":
                    if mount["Destination"] in REBUILDABLE_VOLUMES:
                        excluded.append({"volume": mount["Name"], "destination": mount["Destination"], "reason": "Reconstructible dependency/signature cache; pull pinned image and refresh signatures before accepting uploads."})
                    else:
                        source = Path(mount["Source"])
                        if not re.fullmatch(r"/var/lib/docker/volumes/[A-Za-z0-9_-]+/_data", str(source)):
                            raise BackupError("unsafe_named_volume_source")
                        paths.append(source)
                        volumes.append({"name": mount["Name"], "source": str(source), "destination": mount["Destination"], "container": row["Name"]})
                elif mount["RW"]:
                    source = Path(mount["Source"])
                    if not source.is_relative_to(self.root):
                        raise BackupError("uncovered_writable_bind_mount")
        for path in paths:
            if not path.exists() or path.is_symlink():
                raise BackupError("missing_or_symlinked_recovery_root")
        return sorted(set(paths)), volumes, excluded

    # Exclude recursive backups, recovery identities, temporary rollback state and reconstructible checkout caches.
    def excluded(self, path):
        path = Path(path)
        if path.suffix == ".agekey":
            return True  # Recovery identities are never part of a recovery set.
        if path == self.destination or path.is_relative_to(self.destination):
            return True
        private = self.root / "private"
        if path.is_relative_to(private):
            relative = path.relative_to(private)
            if any(part in {"update-backups", "complete-backups", "staging", "rollback", "release-cache"} for part in relative.parts):
                return True
            if path.suffix in {".age", ".tar", ".tgz", ".zip"}:
                return True
        if path.is_relative_to(self.root / "source") and any(part in {".git", ".local", "node_modules"} for part in path.relative_to(self.root / "source").parts):
            return True
        if path.is_relative_to(self.host_root / "root") and any(part in {".cache", ".npm", ".cargo", ".rustup"} for part in path.relative_to(self.host_root / "root").parts):
            return True
        return False

    # Walk unique inventory paths with lstat; skip sockets and reject unsupported special files.
    def walk(self, roots):
        seen = set()
        for root in roots:
            todo = [root]
            while todo:
                path = todo.pop()
                if path in seen or self.excluded(path):
                    continue
                seen.add(path)
                state = path.lstat()
                if stat.S_ISSOCK(state.st_mode):
                    continue
                if not (stat.S_ISREG(state.st_mode) or stat.S_ISDIR(state.st_mode) or stat.S_ISLNK(state.st_mode)):
                    raise BackupError("unsupported_recovery_file_type")
                yield path, state
                if stat.S_ISDIR(state.st_mode):
                    todo.extend(sorted(path.iterdir(), reverse=True))

    # Acquire this maintenance marker exclusively and stop only previously running known writers before logical dumps.
    def quiesce(self):
        if self.maintenance.exists() or self.maintenance.is_symlink():
            raise BackupError("maintenance_already_active")
        # Caddy checks existence with stat; its matcher does not read this file.
        descriptor = os.open(self.maintenance, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, "w") as out:
            out.write("Daily encrypted recovery backup.\n")
        self.maintenance.chmod(0o600)
        self.flag_owned = True
        # Stop exactly the previously running application services. Database stays
        # running only for logical dumps; Caddy/TLS and SQLite Mailpit become stable.
        ordered = sorted(self.containers, key=lambda row: row["Name"] == "/luminovia-portal-web-1")
        for row in ordered:
            # Gateway has no persistent writes; scanner writes only its excluded
            # reconstructible signature cache. Keep both running throughout.
            if row["Name"] not in {"/" + DB, "/luminovia-supabase-api-gw-1", "/luminovia-portal-clamav-1"} and row["State"]["Running"]:
                name = row["Name"].lstrip("/")
                self.stopped.append(name)
                run(["docker", "stop", "--time", "45", name], timeout=90)
        writers = json.loads(self.sql("select coalesce(json_agg(json_build_object('state',state,'type',backend_type)),'[]'::json) from pg_stat_activity where backend_type='client backend' and pid<>pg_backend_pid();"))
        if writers:
            raise BackupError("database_clients_remain_after_quiescence")

    # Resume only services stopped by this backup, in dependency order, and verify their health.
    def resume(self):
        failures = []
        # The mail relay shares Auth's network namespace. Start Auth before the
        # relay, then wait for the existing health checks.
        order = ["clamav", "mailpit", "auth", "mail-relay", "rest", "realtime", "storage", "api-gw", "functions", "web"]
        for service in order:
            name = next((n for n in self.stopped if n.endswith("-" + service + "-1")), None)
            if name:
                try:
                    run(["docker", "start", name])
                except BackupError:
                    failures.append(name)
        deadline = time.monotonic() + 300
        while self.stopped and not failures:
            rows = json.loads(run(["docker", "inspect", *self.stopped]))
            if all(row["State"]["Running"] and row["State"].get("Health", {}).get("Status", "healthy") == "healthy" for row in rows):
                break
            if time.monotonic() > deadline:
                failures.append("readiness")
                break
            time.sleep(2)
        if failures:
            raise BackupError("previously_running_services_failed_to_resume")
        if self.flag_owned:
            self.maintenance.unlink(missing_ok=True)
            self.flag_owned = False
        self.stopped.clear()

    # Stream file bytes and original metadata/xattrs into the encrypted archive and authenticated catalog.
    def archive_files(self, roots, path, recipient):
        part = EncryptedPart(path, recipient, age=self.age, reserve=self.reserve)
        files = []
        try:
            with gzip.GzipFile(fileobj=part, mode="wb", compresslevel=1, mtime=0) as zipped:
                with tarfile.open(fileobj=zipped, mode="w|", format=tarfile.PAX_FORMAT, dereference=False) as tar:
                    for source, state in self.walk(roots):
                        name = source.as_posix().lstrip("/")
                        info = tar.gettarinfo(str(source), arcname=name)
                        attributes = {}
                        try:
                            import base64
                            for key in os.listxattr(source, follow_symlinks=False):
                                attributes[key] = base64.b64encode(os.getxattr(source, key, follow_symlinks=False)).decode()
                        except OSError:
                            raise BackupError("extended_attribute_capture_failed")
                        info.pax_headers["LUMINOVIA.xattrs"] = json.dumps(attributes, sort_keys=True)
                        item = {"path": name, "mode": stat.S_IMODE(state.st_mode), "uid": state.st_uid, "gid": state.st_gid, "type": "file" if info.isfile() else "directory" if info.isdir() else "hardlink" if info.islnk() else "symlink", "bytes": info.size, "link": info.linkname, "xattrs": attributes}
                        if info.isfile():
                            # Hash and archive the same opened bytes; detect changes
                            # despite quiescence instead of accepting mixed snapshots.
                            h = hashlib.sha256()

                            # Feed file bytes into tar and hash the same opened content.
                            class Reader:
                                # Hold only the already opened source stream for this archive entry.
                                def __init__(self, stream): self.stream = stream

                                # Hash the plaintext bytes actually consumed by tar for later comparison.
                                def read(self, size=-1):
                                    value = self.stream.read(size)
                                    h.update(value)
                                    return value

                            with source.open("rb") as stream:
                                tar.addfile(info, Reader(stream))
                            item["sha256"] = h.hexdigest()
                            after = source.lstat()
                            if (state.st_ino, state.st_size, state.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns):
                                raise BackupError("source_file_changed_during_backup")
                        else:
                            tar.addfile(info)
                        files.append(item)
            return part.finish(), files
        except Exception:
            part.abort()
            raise

    # Capture the complete encrypted set under quiescence and accept it only with a completed final manifest.
    def create(self):
        private_dir(self.control)
        private_dir(self.destination)
        recipient_file = self.control / "recipient.txt"
        private_file(recipient_file)
        recipient = recipient_file.read_text().strip()
        if not re.fullmatch(r"age1[0-9a-z]{58}", recipient):
            raise BackupError("invalid_public_age_recipient")
        image = self.inspect()
        recovery_evidence = self.recovery_image_evidence(image)
        roots, volumes, excluded = self.paths()
        databases = json.loads(self.sql("select json_agg(json_build_object('name',datname,'owner',pg_get_userbyid(datdba),'template',datistemplate,'encoding',pg_encoding_to_char(encoding),'localeProvider',datlocprovider,'locale',to_jsonb(d)->>'datlocale','collate',datcollate,'ctype',datctype,'collationVersion',datcollversion) order by datname) from pg_database d where datallowconn;"))
        if not {"postgres", "_supabase", "template1"}.issubset({d["name"] for d in databases}):
            raise BackupError("required_databases_missing")
        if self.sql("select count(*) from pg_tablespace where spcname not in('pg_default','pg_global');") != "0":
            raise BackupError("custom_tablespaces_require_reviewed_coverage")
        file_bytes = sum(state.st_size for _, state in self.walk(roots) if stat.S_ISREG(state.st_mode))
        database_bytes = int(self.sql("select sum(pg_database_size(oid)) from pg_database where datallowconn;"))
        make_room(self.destination, int((file_bytes + 2 * database_bytes) * 1.1) + 16 * 1024 ** 2, reserve=self.reserve)
        name = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:12]
        partial = self.destination / (name + ".partial")
        final = self.destination / name
        private_dir(partial)
        self.started = utc()
        extension_recovery = json.loads(Path(__file__).with_name("extension-recovery.json").read_text())
        if extension_recovery.get("format") != "luminovia-extension-recovery-v1":
            raise BackupError("invalid_extension_recovery_baseline")
        for filename, item in extension_recovery["files"].items():
            import base64
            content = base64.b64decode(item["base64"], validate=True)
            if hashlib.sha256(content).hexdigest() != item["sha256"] or len(content) != item["bytes"]:
                raise BackupError("extension_recovery_baseline_checksum_differs")
        catalog = {"extensionRecovery": extension_recovery, "postgresRecoveryEvidence": recovery_evidence, "format": FORMAT, "startedAt": self.started, "image": image, "databases": databases, "volumes": volumes, "excludedReconstructibleVolumes": excluded, "parts": {}}
        parts = {}
        error = None
        try:
            def timed_out(_signal, _frame):
                raise BackupError("quiescence_time_budget_exceeded")

            signal.signal(signal.SIGALRM, timed_out)
            signal.setitimer(signal.ITIMER_REAL, 180)
            self.quiesce()
            catalog["containerConfiguration"] = self.containers
            catalog["postgresConfiguration"] = json.loads(self.sql("select json_agg(json_build_object('path',path,'contents',pg_read_file(path))) from(select distinct sourcefile path from pg_file_settings where sourcefile is not null union select current_setting('config_file') union select current_setting('hba_file') union select current_setting('ident_file')) f;"))
            catalog["postgresEffectiveSettings"] = json.loads(self.sql("select json_agg(json_build_object('name',name,'value',setting,'unit',unit,'source',source,'context',context) order by name) from pg_settings;"))
            catalog["packageInventory"] = run(["dpkg-query", "-W", "-f=${binary:Package}\\t${Version}\\t${Architecture}\\n"]).decode()
            catalog["manualPackages"] = run(["apt-mark", "showmanual"]).decode()
            catalog["unitInventory"] = run(["systemctl", "list-unit-files", "--no-pager", "--no-legend"]).decode()
            catalog["imageInventory"] = json.loads(run(["docker", "image", "inspect", *sorted({row["Image"] for row in self.containers})]))
            catalog["parts"]["globals.sql.age"] = encrypt_command(["docker", "exec", DB, "pg_dumpall", "-U", "supabase_admin", "--globals-only"], partial / "globals.sql.age", recipient, age=self.age, reserve=self.reserve)
            for index, database in enumerate(databases):
                part_name = "database-" + str(index).zfill(3) + ".dump.age"
                database["part"] = part_name
                database["summary"] = json.loads(self.sql(SUMMARY_SQL, database=database["name"]))
                catalog["parts"][part_name] = encrypt_command(["docker", "exec", DB, "pg_dump", "-U", "supabase_admin", "-d", database["name"], "--format=custom", "--no-password"], partial / part_name, recipient, age=self.age, reserve=self.reserve)
                if database["summary"] != json.loads(self.sql(SUMMARY_SQL, database=database["name"])):
                    raise BackupError("database_changed_during_quiescent_backup")
            metadata, files = self.archive_files(roots, partial / "files.tar.gz.age", recipient)
            catalog["parts"]["files.tar.gz.age"] = metadata
            catalog["files"] = files
            # Every captured part is complete before normal traffic resumes.
        except Exception as caught:
            error = caught
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            try:
                self.resume()
            except Exception as caught:
                error = caught
        if error:
            write_json(self.status, {"format": FORMAT, "status": "failed", "failedAt": utc(), "errorCode": str(error) if isinstance(error, BackupError) else "backup_failed", "manualRecoveryRequired": bool(self.stopped)})
            shutil.rmtree(partial)
            raise error
        catalog["completedAt"] = utc()
        catalog["quiescence"] = "All previously-running application writers, Mailpit and Caddy stopped; PostgreSQL logical dumps only; unexpected database clients cause failure."
        catalog["reconstruction"] = "OS packages and pinned Docker images are recorded, not duplicated as OS binaries or image layers. Dependency and ClamAV signature caches must be regenerated. Non-connectable pristine template0 is recreated by the exact PostgreSQL image. No live PGDATA tar is a recovery method."
        part = EncryptedPart(partial / "catalog.json.age", recipient, age=self.age, reserve=self.reserve)
        try:
            part.write(json.dumps(catalog, sort_keys=True).encode())
            catalog_metadata = part.finish()
        except Exception:
            part.abort()
            shutil.rmtree(partial)
            raise
        for part_name, item in catalog["parts"].items():
            parts[part_name] = {k: item[k] for k in ["sha256", "bytes"]}
        parts["catalog.json.age"] = {k: catalog_metadata[k] for k in ["sha256", "bytes"]}
        write_json(partial / "manifest.json", {"format": FORMAT, "status": "complete", "startedAt": self.started, "completedAt": utc(), "databaseCount": len(databases), "parts": parts, "encryption": "age X25519; VPS public recipient only; identity retained separately off the VPS", "verification": "All age producers exited successfully and ciphertext SHA256/lengths verified. Actual decrypt+restore is a separate desktop drill, not a daily VPS claim.", "offSite": False})
        verify_complete(partial)
        os.replace(partial, final)
        descriptor = os.open(self.destination, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        prune_after_success(self.destination, reserve=self.reserve)
        write_json(self.status, {"format": FORMAT, "status": "complete", "lastSuccessAt": utc(), "lastBackup": final.name, "ciphertextBytes": sum(p["bytes"] for p in parts.values()), "manualRecoveryRequired": False, "offSite": False, "desktopDecryptRestoreVerified": False})
        return {"status": "complete", "backup": final.name, "parts": len(parts), "offSite": False}

    # Derive freshness from a verified ciphertext set, not only a status timestamp.
    def fresh(self, *, max_age_hours=26):
        if not self.destination.exists():
            return False
        candidates = retained_sets(self.destination)
        if not candidates:
            return False
        manifest = verify_complete(candidates[-1])
        try:
            stamp = dt.datetime.fromisoformat(manifest["completedAt"])
            age = (dt.datetime.now(dt.timezone.utc) - stamp).total_seconds()
            return 0 <= age <= max_age_hours * 3600
        except (KeyError, ValueError, TypeError):
            return False

    # Acquire the global lock before the updater lock; enforce reboot/space gates and resume services even after backup failure.
    def execute(self, *, lock_wait=1800):
        # Global host/Docker maintenance lock precedes the updater-specific lock,
        # exactly matching the app/system maintenance ordering. Never nest a global
        # flock wrapper around this command in its systemd unit.
        descriptors = []
        deadline = time.monotonic() + lock_wait
        try:
            for path in [self.global_lock, self.lock]:
                if path == self.lock:
                    private_dir(path.parent)
                elif not path.parent.is_dir() or path.parent.is_symlink():
                    raise BackupError("unsafe_global_lock_directory")
                descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
                descriptors.append(descriptor)
                state = os.fstat(descriptor)
                if not stat.S_ISREG(state.st_mode) or state.st_uid != os.geteuid():
                    raise BackupError("unsafe_maintenance_lock")
                os.fchmod(descriptor, 0o600)
                while True:
                    try:
                        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        break
                    except BlockingIOError:
                        if time.monotonic() >= deadline:
                            raise BackupError("coordinated_maintenance_lock_busy")
                        time.sleep(2)
            if self.reboot_pending.exists() or self.reboot_pending.is_symlink():
                raise BackupError("reboot_pending")
            return self.create()
        finally:
            for descriptor in reversed(descriptors):
                os.close(descriptor)


# Separate the documented operating modes and expose stable results/error codes without private process details.
def main():
    parser = argparse.ArgumentParser()
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--run", action="store_true")
    action.add_argument("--verify-ciphertext", type=Path)
    action.add_argument("--verify-replica", type=Path)
    action.add_argument("--check-fresh", action="store_true")
    action.add_argument("--ensure-fresh", action="store_true")
    parser.add_argument("--max-age-hours", type=int, default=26)
    parser.add_argument("--manifest-sha256")
    args = parser.parse_args()
    if not 1 <= args.max_age_hours <= 48:
        raise BackupError("invalid_backup_freshness_limit")
    os.umask(0o077)
    if args.manifest_sha256 is not None and args.verify_replica is None:
        raise BackupError("manifest_pin_requires_replica_mode")
    if args.verify_replica is not None:
        if args.manifest_sha256 is None:
            raise BackupError("replica_manifest_pin_required")
        return verify_replica(
            args.verify_replica,
            manifest_sha256=args.manifest_sha256,
            max_age_hours=args.max_age_hours,
        )
    if args.verify_ciphertext:
        verify_complete(args.verify_ciphertext)
        return {"status": "ciphertext_verified", "decryptionPerformed": False}
    backup = CompleteBackup()
    if args.check_fresh or args.ensure_fresh:
        if backup.fresh(max_age_hours=args.max_age_hours):
            return {"status": "fresh_complete_backup", "maxAgeHours": args.max_age_hours, "decryptionPerformed": False}
        if args.check_fresh:
            raise BackupError("fresh_complete_backup_required")
    if os.geteuid() != 0:
        raise BackupError("root_required_for_named_vps_backup")

    # A termination signal still enters the recovery finally block.
    # Route an interrupt into this backup's controlled cleanup/resumption path.
    def interrupt(_signal, _frame):
        raise BackupError("backup_interrupted")

    signal.signal(signal.SIGTERM, interrupt)
    signal.signal(signal.SIGINT, interrupt)
    return backup.execute()


if __name__ == "__main__":
    try:
        print(json.dumps(main(), sort_keys=True))
    except Exception as error:
        print(json.dumps({"status": "failed", "errorCode": str(error) if isinstance(error, BackupError) else "backup_failed_private_details_withheld"}), file=sys.stderr)
        sys.exit(1)