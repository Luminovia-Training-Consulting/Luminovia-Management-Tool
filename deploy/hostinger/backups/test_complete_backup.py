# Owned synthetic sets exercise permissions, ownership, locks and retention. Native age round trips verify authenticated extraction without customer data.
import datetime as dt
import fcntl
import hashlib
import importlib.util
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).parent
spec = importlib.util.spec_from_file_location("complete_backup", HERE / "complete_backup.py")
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
sys.modules.setdefault("complete_backup", b)
import unpack_complete as recovery

AGE = os.environ.get("AGE_TEST_BINARY") or shutil.which("age")
KEYGEN = os.environ.get("AGE_KEYGEN_TEST_BINARY") or shutil.which("age-keygen")


# Build a minimal owned encrypted-set inventory for freshness/retention cases.
def synthetic_set(root, ordinal, *, hours=0):
    directory = root / ("20260101T0000" + str(ordinal).zfill(2) + "Z-" + str(ordinal).zfill(12))
    b.private_dir(directory)
    parts = {}
    for name in ["catalog.json.age", "globals.sql.age", "files.tar.gz.age", "database-000.dump.age", "database-001.dump.age"]:
        path = directory / name
        path.write_bytes(b"age-encryption.org/v1\nSYNTHETIC-CIPHERTEXT-FOR-RETENTION-ONLY")
        path.chmod(0o600)
        parts[name] = {"sha256": b.digest(path), "bytes": path.stat().st_size}
    stamp = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=hours)).isoformat()
    b.write_json(directory / "manifest.json", {"format": b.FORMAT, "status": "complete", "databaseCount": 2, "completedAt": stamp, "parts": parts})
    return directory


# Exercise privacy, locks, freshness and bounded retention using synthetic sets, not real instances.
class BackupSafetyTests(unittest.TestCase):
    # Create owned temporary fixture paths without reusing existing operational data.
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="luminovia-backup-test-")
        self.root = Path(self.temp.name)
        self.destination = self.root / "sets"
        b.private_dir(self.destination)
        self.portal = self.root / "portal"
        (self.portal / "www").mkdir(parents=True)
        self.backup = b.CompleteBackup(self.portal, self.destination, reserve=0, host_root=self.root / "host")

    # Remove only temporary resources created by this case.
    def tearDown(self):
        self.temp.cleanup()

    # Build fictional completed PostgreSQL proof with its exact historical source chain.
    def postgres_proof_fixture(self):
        # Fictional guard inputs: never a claim that a future engine was tested.
        self.backup.host_root = self.root / "host"
        self.backup.root = self.backup.host_root / "opt/luminovia-portal"
        source = self.backup.root / "source"
        directory = source / "supabase/migrations"
        directory.mkdir(parents=True)
        history = []
        for version, title in [("20260101000000", "first"), ("20260102000000", "second")]:
            text = "-- Fictional " + title + " SQL\n"
            (directory / (version + "_" + title + ".sql")).write_text(text)
            history.append({"version": version, "source": text, "statementCount": 1})
        inventory = [{"path": "supabase/migrations/20260101000000_first.sql", "sha256": hashlib.sha256(history[0]["source"].encode()).hexdigest()}]
        target = "supabase/postgres:17.13.0.000@sha256:" + "a" * 64
        proof = {"schemaVersion": 1, "postgresMajor": 17, "requiresLiveDataPreflight": True, "sourceCommit": "b" * 40,
                 "sourceImage": "supabase/postgres:17.12.0.000@sha256:" + "c" * 64, "targetImage": target,
                 "migrationInventory": inventory, "migrationInventorySha256": hashlib.sha256(json.dumps(inventory, separators=(",", ":")).encode()).hexdigest(),
                 "validation": {"kind": "isolated-selfhost-upgrade-fixture", "passed": True, "migrationSourcesExact": True, "existingCredentialsAndFileExact": True, "roleAndMembershipExact": True}}
        path = source / "deploy/hostinger/selfhost/postgres-candidate-proof.json"
        path.parent.mkdir(parents=True)
        path.write_text(json.dumps(proof))
        return target, proof, path, history

    def test_future_image_requires_installed_completed_proof_and_exact_live_sources(self):
        target, proof, path, history = self.postgres_proof_fixture()
        with patch.object(self.backup, "sql", return_value=json.dumps(history)):
            witness = self.backup.recovery_image_evidence(target)
            self.assertEqual(len(witness["appliedMigrationInventory"]), 2)
            self.assertEqual(witness["proofSha256"], b.digest(path))
            self.assertEqual(witness["proofPath"], "opt/luminovia-portal/source/deploy/hostinger/selfhost/postgres-candidate-proof.json")
            history[1]["source"] += "changed"
            with patch.object(self.backup, "sql", return_value=json.dumps(history)):
                with self.assertRaisesRegex(b.BackupError, "live_migration_recovery_source_differs"):
                    self.backup.recovery_image_evidence(target)

    def test_future_image_rejects_incomplete_or_rewritten_historical_proof(self):
        target, proof, path, history = self.postgres_proof_fixture()
        proof["validation"]["passed"] = False
        path.write_text(json.dumps(proof))
        with self.assertRaisesRegex(b.BackupError, "invalid_installed_postgres_recovery_proof"):
            self.backup.recovery_image_evidence(target)
        proof["validation"]["passed"] = True
        proof["migrationInventory"][0]["sha256"] = "d" * 64
        path.write_text(json.dumps(proof))
        with patch.object(self.backup, "sql", return_value=json.dumps(history)):
            with self.assertRaisesRegex(b.BackupError, "postgres_recovery_proof_history_differs"):
                self.backup.recovery_image_evidence(target)

    def test_missing_future_proof_rejects_while_original_images_remain_supported(self):
        target = "supabase/postgres:17.13.0.000@sha256:" + "a" * 64
        with self.assertRaisesRegex(b.BackupError, "missing_installed_postgres_recovery_proof"):
            self.backup.recovery_image_evidence(target)
        self.assertIsNone(self.backup.recovery_image_evidence(next(iter(b.LEGACY_IMAGES))))

    def test_ciphertext_set_checksums_and_file_modes(self):
        directory = synthetic_set(self.destination, 1)
        self.assertEqual(b.verify_complete(directory)["databaseCount"], 2)
        part = directory / "globals.sql.age"
        part.write_bytes(part.read_bytes() + b"changed")
        with self.assertRaisesRegex(b.BackupError, "checksum"):
            b.verify_complete(directory)

    def test_world_readable_or_symlink_artifact_is_rejected(self):
        directory = synthetic_set(self.destination, 1)
        part = directory / "globals.sql.age"
        part.chmod(0o644)
        with self.assertRaisesRegex(b.BackupError, "unsafe_private_file"):
            b.verify_complete(directory)
        part.chmod(0o600)
        data = part.read_bytes()
        part.unlink()
        external = self.root / "external"
        external.write_bytes(data)
        part.symlink_to(external)
        with self.assertRaisesRegex(b.BackupError, "unsafe_private_file"):
            b.verify_complete(directory)

    def test_missing_database_archive_is_not_complete(self):
        directory = synthetic_set(self.destination, 1)
        manifest = json.loads((directory / "manifest.json").read_text())
        del manifest["parts"]["database-001.dump.age"]
        b.write_json(directory / "manifest.json", manifest)
        with self.assertRaisesRegex(b.BackupError, "missing_database"):
            b.verify_complete(directory)

    def test_adaptive_retention_keeps_last_valid_set(self):
        for n in [1, 2, 3]:
            synthetic_set(self.destination, n)
        free = lambda: (3 - len(b.retained_sets(self.destination))) * 100
        b.make_room(self.destination, 150, reserve=50, free_bytes=free)
        self.assertEqual(len(b.retained_sets(self.destination)), 1)
        with self.assertRaisesRegex(b.BackupError, "last_valid"):
            b.make_room(self.destination, 9999, reserve=50, free_bytes=free)
        self.assertEqual(len(b.retained_sets(self.destination)), 1)

    def test_retention_preserves_unknown_corrupt_and_external_evidence(self):
        good = synthetic_set(self.destination, 1)
        bad = synthetic_set(self.destination, 2)
        (bad / "globals.sql.age").write_text("CORRUPT")
        foreign = self.destination / "foreign-evidence"
        foreign.mkdir()
        (foreign / "keep").write_text("keep")
        linked = self.destination / "20260101T000003Z-000000000003"
        linked.symlink_to(foreign, target_is_directory=True)
        with self.assertRaises(b.BackupError):
            b.make_room(self.destination, 100, reserve=50, free_bytes=lambda: 0)
        self.assertTrue(good.exists() and bad.exists() and (foreign / "keep").exists() and linked.is_symlink())

    def test_retention_caps_at_three_valid_sets(self):
        for n in [1, 2, 3, 4, 5]:
            synthetic_set(self.destination, n)
        b.prune_after_success(self.destination, reserve=0)
        self.assertEqual([p.name[13:15] for p in b.retained_sets(self.destination)], ["03", "04", "05"])

    def test_freshness_is_verified_ciphertext_not_just_status_timestamp(self):
        directory = synthetic_set(self.destination, 1, hours=25)
        self.assertTrue(self.backup.fresh(max_age_hours=26))
        self.assertFalse(self.backup.fresh(max_age_hours=24))
        (directory / "database-000.dump.age").write_bytes(b"broken")
        self.assertFalse(self.backup.fresh(max_age_hours=26))

    def test_shared_updater_lock_excludes_backup_without_stopping_services(self):
        b.private_dir(self.backup.lock.parent)
        lock = os.open(self.backup.lock, os.O_CREAT | os.O_WRONLY, 0o600)
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(self.backup, "create") as create:
                with self.assertRaisesRegex(b.BackupError, "lock_busy"):
                    self.backup.execute(lock_wait=0)
                create.assert_not_called()
        finally:
            os.close(lock)

    def test_global_lock_is_first_and_blocks_all_backup_mutation(self):
        descriptor = os.open(self.backup.global_lock, os.O_CREAT | os.O_WRONLY, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with patch.object(self.backup, "create") as create:
                with self.assertRaisesRegex(b.BackupError, "lock_busy"):
                    self.backup.execute(lock_wait=0)
                create.assert_not_called()
            self.assertFalse(self.backup.maintenance.exists())
        finally:
            os.close(descriptor)

    def test_updater_contention_releases_earlier_global_lock(self):
        b.private_dir(self.backup.lock.parent)
        descriptor = os.open(self.backup.lock, os.O_CREAT | os.O_WRONLY, 0o600)
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(b.BackupError):
                self.backup.execute(lock_wait=0)
            probe = os.open(self.backup.global_lock, os.O_WRONLY)
            try:
                fcntl.flock(probe, fcntl.LOCK_EX | fcntl.LOCK_NB)
            finally:
                os.close(probe)
        finally:
            os.close(descriptor)

    def test_pending_reboot_refuses_new_backup_before_mutation(self):
        self.backup.reboot_pending.parent.mkdir(parents=True)
        self.backup.reboot_pending.write_text("coordinated reboot")
        with patch.object(self.backup, "create") as create:
            with self.assertRaisesRegex(b.BackupError, "reboot_pending"):
                self.backup.execute(lock_wait=0)
            create.assert_not_called()
        self.assertFalse(self.backup.maintenance.exists())
        self.assertEqual(self.backup.reboot_pending.read_text(), "coordinated reboot")

    def test_existing_maintenance_is_never_overwritten_or_removed(self):
        self.backup.maintenance.write_text("operator maintenance")
        with self.assertRaisesRegex(b.BackupError, "maintenance_already"):
            self.backup.quiesce()
        self.backup.resume()
        self.assertEqual(self.backup.maintenance.read_text(), "operator maintenance")

    def test_symlinked_maintenance_flag_is_not_followed(self):
        target = self.root / "unrelated"
        target.write_text("untouched")
        self.backup.maintenance.symlink_to(target)
        with self.assertRaises(b.BackupError):
            self.backup.quiesce()
        self.assertEqual(target.read_text(), "untouched")

    def test_only_previously_running_services_are_stopped_and_resumed(self):
        self.backup.containers = [{"Name": "/" + b.DB, "State": {"Running": True}}, {"Name": "/luminovia-supabase-auth-1", "State": {"Running": True}}, {"Name": "/luminovia-supabase-rest-1", "State": {"Running": False}}]
        commands = []

        def fake(arguments, **_kwargs):
            commands.append(arguments)
            if arguments[:2] == ["docker", "inspect"]:
                return json.dumps([{"State": {"Running": True, "Health": {"Status": "healthy"}}}]).encode()
            return b""

        with patch.object(b, "run", fake), patch.object(self.backup, "sql", return_value="[]"):
            self.backup.quiesce()
            self.assertTrue(self.backup.flag_owned)
            self.assertEqual(stat.S_IMODE(self.backup.maintenance.lstat().st_mode), 0o600)
            self.assertEqual(self.backup.stopped, ["luminovia-supabase-auth-1"])
            self.backup.resume()
        stops = [c[-1] for c in commands if c[:2] == ["docker", "stop"]]
        starts = [c[-1] for c in commands if c[:2] == ["docker", "start"]]
        self.assertEqual(stops, ["luminovia-supabase-auth-1"])
        self.assertEqual(starts, stops)
        self.assertFalse(self.backup.maintenance.exists())
        self.assertFalse(self.backup.flag_owned)

    def test_recovery_roots_exclude_recursive_backups_keys_caches_and_live_pgdata(self):
        self.assertTrue(self.backup.excluded(self.portal / "private/update-backups/old/storage.tar"))
        self.assertTrue(self.backup.excluded(self.portal / "private/updates/staging/release/file"))
        self.assertTrue(self.backup.excluded(self.portal / "source/.local/ACCOUNTS.txt"))
        self.assertTrue(self.backup.excluded(self.portal / "private/backups/recovery.agekey"))
        self.assertFalse(self.backup.excluded(self.portal / "data/storage/legitimate-document.zip"))
        self.assertFalse(self.backup.excluded(self.portal / "private/selfhost.env"))
        self.assertFalse(
            self.backup.excluded(
                self.portal / "private/selfhost.env.notification.env"
            )
        )

    def test_failed_quiescence_resumes_and_preserves_existing_valid_backup(self):
        valid = synthetic_set(self.destination, 1)
        b.private_dir(self.backup.control)
        (self.backup.control / "recipient.txt").write_text("age1" + "a" * 58)
        (self.backup.control / "recipient.txt").chmod(0o600)
        resumed = []

        def fake_sql(query, **_kwargs):
            if "json_agg(json_build_object('name'" in query:
                return json.dumps([{"name": n} for n in ["postgres", "_supabase", "template1"]])
            return "0"

        with patch.object(self.backup, "inspect", return_value=next(iter(b.LEGACY_IMAGES))), patch.object(self.backup, "paths", return_value=([], [], [])), patch.object(self.backup, "sql", fake_sql), patch.object(self.backup, "quiesce", side_effect=b.BackupError("controlled_failure")), patch.object(self.backup, "resume", side_effect=lambda: resumed.append(True)):
            with self.assertRaisesRegex(b.BackupError, "controlled_failure"):
                self.backup.create()
        self.assertEqual(resumed, [True])
        self.assertTrue(valid.exists())
        self.assertFalse(any(p.name.endswith(".partial") for p in self.destination.iterdir()))
        self.assertEqual(json.loads(self.backup.status.read_text())["status"], "failed")


# Use real age with owned temporary data to verify authenticated decryption and file bytes.
@unittest.skipUnless(AGE and KEYGEN, "Native age/age-keygen required for authenticated encryption acceptance")
class NativeEncryptionTests(unittest.TestCase):
    # Create owned temporary fixture paths without reusing existing operational data.
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="luminovia-age-test-")
        self.root = Path(self.temp.name)
        self.identity = self.root / "test.agekey"
        subprocess.run([KEYGEN, "-o", str(self.identity)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.recipient = subprocess.check_output([KEYGEN, "-y", str(self.identity)], stderr=subprocess.DEVNULL).decode().strip()

    # Remove only temporary resources created by this case.
    def tearDown(self):
        self.temp.cleanup()

    # Create only this case's synthetic recovery data, encrypted with a real age identity.
    def recovery_set(self, *, unsafe_path=False):
        directory = self.root / "complete-set"
        b.private_dir(directory)
        source = self.root / "source-config"
        source.mkdir()
        (source / "private.env").write_bytes(b"FICTIONAL_RECOVERY_SECRET=not-for-logs\n")
        (source / "private.env").chmod(0o600)
        backup = b.CompleteBackup(self.root / "portal", directory, age=AGE, reserve=0, host_root=self.root / "host")
        metadata, inventory = backup.archive_files([source], directory / "files.tar.gz.age", self.recipient)
        parts = {"files.tar.gz.age": metadata}
        for name in ["globals.sql.age", "database-000.dump.age", "database-001.dump.age"]:
            part = b.EncryptedPart(directory / name, self.recipient, age=AGE, reserve=0)
            part.write(b"Fictional component bytes\n")
            parts[name] = part.finish()
        if unsafe_path:
            inventory[0]["path"] = "../outside-extraction"
        catalog = {"format": b.FORMAT, "image": "fictional-test-image", "parts": parts, "files": inventory, "databases": [{"name": "postgres"}, {"name": "_supabase"}]}
        part = b.EncryptedPart(directory / "catalog.json.age", self.recipient, age=AGE, reserve=0)
        part.write(json.dumps(catalog).encode())
        all_parts = {**parts, "catalog.json.age": part.finish()}
        b.write_json(directory / "manifest.json", {"format": b.FORMAT, "status": "complete", "databaseCount": 2, "completedAt": b.utc(), "parts": {name: {"sha256": item["sha256"], "bytes": item["bytes"]} for name, item in all_parts.items()}})
        return directory

    def test_real_complete_extraction_keeps_secrets_private_and_hashes_exact(self):
        directory = self.recovery_set()
        output = self.root / "restored"
        result = recovery.unpack(directory, self.identity, output, age=AGE)
        self.assertEqual(result["status"], "decrypted_and_files_verified")
        catalog = json.loads((output / "catalog.json").read_text())
        secret = next(item for item in catalog["files"] if item["type"] == "file")
        restored = output / "filesystem" / secret["path"]
        self.assertEqual(hashlib.sha256(restored.read_bytes()).hexdigest(), secret["sha256"])
        self.assertEqual(stat.S_IMODE(restored.stat().st_mode), 0o600)

    def test_authenticated_catalog_tamper_is_rejected_and_extraction_removed(self):
        directory = self.recovery_set()
        part = directory / "catalog.json.age"
        content = bytearray(part.read_bytes())
        content[-1] ^= 1
        part.write_bytes(content)
        manifest = json.loads((directory / "manifest.json").read_text())
        manifest["parts"][part.name]["sha256"] = b.digest(part)
        b.write_json(directory / "manifest.json", manifest)
        output = self.root / "restored"
        with self.assertRaisesRegex(b.BackupError, "authenticated_decryption"):
            recovery.unpack(directory, self.identity, output, age=AGE)
        self.assertFalse(output.exists())

    def test_traversal_inventory_is_rejected_without_touching_outside(self):
        directory = self.recovery_set(unsafe_path=True)
        output = self.root / "restored"
        with self.assertRaisesRegex(b.BackupError, "unsafe_recovery_member"):
            recovery.unpack(directory, self.identity, output, age=AGE)
        self.assertFalse(output.exists() or (self.root / "outside-extraction").exists())

    def test_real_authenticated_roundtrip_and_no_plaintext_dump_file(self):
        path = self.root / "globals.sql.age"
        content = b"FICTIONAL-ROLE-PASSWORD-HASH-AND-PRIVATE-CONFIG\n"
        result = b.encrypt_command([sys.executable, "-c", "import sys;sys.stdout.buffer.write(" + repr(content) + ")"], path, self.recipient, age=AGE, reserve=0)
        self.assertEqual(result["plaintextSha256"], hashlib.sha256(content).hexdigest())
        self.assertNotIn(content, path.read_bytes())
        self.assertEqual(subprocess.check_output([AGE, "-d", "-i", str(self.identity), str(path)], stderr=subprocess.DEVNULL), content)
        self.assertEqual({p.name for p in self.root.iterdir()}, {"test.agekey", "globals.sql.age"})
        data = bytearray(path.read_bytes());
        data[-1] ^= 1;
        path.write_bytes(data)
        result = subprocess.run([AGE, "-d", "-i", str(self.identity), str(path)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        self.assertNotEqual(result.returncode, 0)

    def test_producer_failure_leaves_no_accepted_part(self):
        path = self.root / "failed.age"
        with self.assertRaises(b.BackupError):
            b.encrypt_command([sys.executable, "-c", "import sys;sys.stdout.write('partial');sys.exit(3)"], path, self.recipient, age=AGE, reserve=0)
        self.assertFalse(path.exists() or Path(str(path) + ".partial").exists())

    def test_file_archive_preserves_bytes_modes_links_and_secret_hashes(self):
        source = self.root / "files";
        source.mkdir()
        secret = source / "selfhost.env";
        secret.write_bytes(b"FICTIONAL_SECRET=never-print-this\n");
        secret.chmod(0o600)
        (source / "link").symlink_to("selfhost.env")
        os.link(secret, source / "hardlink")
        backup = b.CompleteBackup(self.root / "portal", self.root / "backups", age=AGE, reserve=0, host_root=self.root / "host")
        path = self.root / "files.tar.gz.age"
        metadata, inventory = backup.archive_files([source], path, self.recipient)
        decrypted = subprocess.check_output([AGE, "-d", "-i", str(self.identity), str(path)], stderr=subprocess.DEVNULL)
        with tarfile.open(fileobj=io.BytesIO(decrypted), mode="r:gz") as tar:
            entries = {member.name: member for member in tar}
            for item in inventory:
                member = entries[item["path"]]
                self.assertEqual(member.mode, item["mode"])
                if member.isfile():
                    self.assertEqual(hashlib.sha256(tar.extractfile(member).read()).hexdigest(), item["sha256"])
        self.assertEqual({item["type"] for item in inventory}, {"directory", "file", "symlink", "hardlink"})
        self.assertNotIn(b"FICTIONAL_SECRET", path.read_bytes())
        self.assertEqual(metadata["plaintextSha256"], hashlib.sha256(decrypted).hexdigest())


if __name__ == "__main__":
    unittest.main()