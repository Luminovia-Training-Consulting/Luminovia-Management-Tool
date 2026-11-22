"""Recovery safety and an actual encrypted round-trip in independent temporary paths."""
import io
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

import recovery

AGE = shutil.which("age")
AGE_KEYGEN = shutil.which("age-keygen")
POSTGRES_TEST_BIN = os.environ.get("ACADEMY_RECOVERY_POSTGRES_TEST_BIN")
PIN = "postgres:17.12@sha256:" + "1" * 64
STORAGE = "storage:v1@sha256:" + "2" * 64


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class FixtureDocker:
    def __init__(self, source, target=None):
        self.source = source
        self.target = target
        self.created = {}
        self.failure = False

    def backup_state(self, _root):
        return {"db": PIN, "storage": STORAGE}, self.source

    def require_unused_namespace(self):
        if self.created:
            recovery.fail("dedicated Compose namespace is already in use")

    def create_empty_volume(self, kind):
        if self.failure and self.created:
            recovery.fail("injected volume creation failure")
        path = self.target / kind
        path.mkdir()
        self.created[kind] = path
        return path

    def remove_volume(self, kind):
        shutil.rmtree(self.created.pop(kind))


@unittest.skipUnless(AGE and AGE_KEYGEN, "age is required for real encryption checks")
class RecoveryRoundTrip(unittest.TestCase):
    def setUp(self):
        self.owned = tempfile.TemporaryDirectory(prefix="academy-recovery-test-")
        self.addCleanup(self.owned.cleanup)
        self.scratch = Path(self.owned.name).resolve()
        self.settings = patch.dict(recovery.COMMAND_ENV, {
            "PATH": str(Path(AGE).parent) + ":" + recovery.COMMAND_ENV["PATH"],
        })
        self.settings.start()
        self.addCleanup(self.settings.stop)
        self.root = self.scratch / "academy"
        self.identifier = str(uuid4())
        self.revision = "a" * 40
        self.expected = recovery.identity_for(self.root, self.identifier, self.revision)
        self.edition = "customer-self-hosted"
        self._write_runtime()
        self.volumes = {}
        for kind in recovery.VOLUMES:
            directory = self.scratch / ("source-" + kind)
            directory.mkdir()
            (directory / "volume.txt").write_text(kind)
            self.volumes[kind] = directory
        self.docker = FixtureDocker(self.volumes, self.scratch)
        self.key = self.scratch / "checkpoint.agekey"
        self.recipient = self.new_identity(self.key)

    def new_identity(self, path):
        subprocess.run([AGE_KEYGEN, "-o", path], check=True, capture_output=True)
        return subprocess.run([AGE_KEYGEN, "-y", path], check=True,
                              capture_output=True, text=True).stdout.strip()

    def _write_runtime(self):
        self.root.mkdir(mode=0o700)
        for directory in ("browser", "data", "backups"):
            (self.root / directory).mkdir(mode=0o700)
        for directory in ("data/postgres", "data/storage"):
            (self.root / directory).mkdir(mode=0o700)
        (self.root / "data/postgres/PG_VERSION").write_text("17")
        (self.root / "data/postgres/fictional").write_bytes(b"retained-postgresql")
        object_file = self.root / "data/storage/handout"
        object_file.write_bytes(b"retained-object\x00\x12")
        object_file.chmod(0o640)
        project = self.expected["compose_project"]
        source = {
            "version": 1,
            "installation_id": self.identifier,
            "edition": self.edition,
            "compose_project": project,
            "backend_network": project + "-backend",
            "data_directory": str(self.root / "data"),
            "backup_directory": str(self.root / "backups"),
            "browser_directory": str(self.root / "browser"),
        }
        (self.root / "installation.json").write_text(json.dumps(source))
        (self.root / "browser/release.json").write_text(json.dumps({
            "version": 1, "state": "browser-staged",
            "release": {"installation_id": self.identifier, "edition": self.edition,
                        "source_revision": self.revision},
        }))
        settings = {
            "COMPOSE_PROJECT_NAME": project,
            "ACADEMY_INSTALLATION_ID": self.identifier,
            "ACADEMY_EDITION": self.edition,
            "PORTAL_DATA_DIR": source["data_directory"],
            "PORTAL_WWW_DIR": source["browser_directory"],
            "PORTAL_BACKEND_NETWORK": source["backend_network"],
            "POSTGRES_DB": "postgres",
            "JWT_SECRET": "fictional-recovery-secret",
        }
        (self.root / "runtime.env").write_text("".join(f"{key}='{value}'\n" for key, value in settings.items()))
        for suffix in ("public", "notification"):
            (self.root / f"runtime.env.{suffix}.env").write_text("KEY='fictional'")
        for name in (*recovery.RUNTIME_FILES, "browser/release.json"):
            (self.root / name).chmod(0o600)
        (self.root / "backups/old-backup.age").write_bytes(b"excluded recursively")

    def snapshot(self):
        receipt = recovery.backup(self.root, self.expected, self.recipient, self.docker)
        bundle = Path(receipt["bundle"])
        assert stat.S_IMODE(bundle.stat().st_mode) == 0o600
        assert bundle.stat().st_nlink == 1
        assert b"fictional-recovery-secret" not in bundle.read_bytes()
        assert b"retained-object" not in bundle.read_bytes()
        archived = self.scratch / "external.age"
        bundle.rename(archived)
        self.root.rename(self.scratch / "original")
        return archived

    def test_restores_whole_private_runtime_files_and_volumes_into_empty_target(self):
        for kind in ("caddy_data", "caddy_config"):
            directory = self.volumes[kind] / "caddy"
            directory.mkdir()
            directory.chmod(0o1777)
            (directory / "volume.txt").write_text(kind)
        archive = self.snapshot()
        original = self.scratch / "original"
        restored = recovery.restore(self.root, self.expected, archive, self.key, digest(archive), self.docker)
        self.assertFalse(restored["services_started"])
        self.assertEqual(restored["images"], {"db": PIN, "storage": STORAGE})
        self.assertEqual((self.root / "runtime.env").read_bytes(), (original / "runtime.env").read_bytes())
        self.assertEqual((self.root / "data/postgres/fictional").read_bytes(), b"retained-postgresql")
        handout = self.root / "data/storage/handout"
        self.assertEqual(handout.read_bytes(), b"retained-object\x00\x12")
        self.assertEqual(stat.S_IMODE(handout.stat().st_mode), 0o640)
        self.assertEqual(list((self.root / "backups").iterdir()), [])
        self.assertFalse((self.root / "runtime.env.webhooks.env").exists())
        self.assertFalse((self.root / "runtime-handoff.json").exists())
        for kind, path in self.docker.created.items():
            self.assertEqual((path / "volume.txt").read_text(), kind)
            if kind in ("caddy_data", "caddy_config"):
                self.assertEqual((path / "caddy/volume.txt").read_text(), kind)
                self.assertEqual(stat.S_IMODE((path / "caddy").stat().st_mode), 0o1777)
        with self.assertRaisesRegex(recovery.RecoveryError, "new runtime"):
            recovery.root_directory(str(self.root), existing=False)
        with self.assertRaisesRegex(recovery.RecoveryError, "new runtime"):
            recovery.restore(self.root, self.expected, archive, self.key, digest(archive), self.docker)

    def test_preserves_the_private_webhook_worker_and_receiver_configuration(self):
        name = "runtime.env.webhooks.env"
        config = self.root / name
        payload = (b"PORTAL_WEBHOOK_SERVICE_KEY=fictional-operator-fixture\n"
                   b"PORTAL_WEBHOOK_DESTINATIONS='{}'\n")
        config.write_bytes(payload)
        config.chmod(0o600)
        handoff = self.root / "runtime-handoff.json"
        receipt = json.dumps({"installation_id": self.identifier, "source_revision": self.revision})
        handoff.write_text(receipt)
        handoff.chmod(0o600)
        archive = self.snapshot()
        self.assertNotIn(payload, archive.read_bytes())
        recovery.restore(self.root, self.expected, archive, self.key, digest(archive), self.docker)
        self.assertEqual(config.read_bytes(), payload)
        self.assertEqual(stat.S_IMODE(config.stat().st_mode), 0o600)
        self.assertEqual(handoff.read_text(), receipt)

    def test_rejects_an_unprotected_or_linked_optional_webhook_configuration(self):
        config = self.root / "runtime.env.webhooks.env"
        outside = self.scratch / "unrelated-config"
        outside.write_text("unchanged")
        config.symlink_to(outside)
        with self.assertRaisesRegex(recovery.RecoveryError, "symbolic link"):
            recovery.backup(self.root, self.expected, self.recipient, self.docker)
        config.unlink()
        config.touch()
        config.chmod(0o644)
        with self.assertRaisesRegex(recovery.RecoveryError, "must be private"):
            recovery.backup(self.root, self.expected, self.recipient, self.docker)
        self.assertEqual(outside.read_text(), "unchanged")
        self.assertFalse(list((self.root / "backups").glob("recovery-*")))

    def test_wrong_key_release_and_ciphertext_fail_without_touching_target(self):
        archive = self.snapshot()
        wrong = self.scratch / "wrong.agekey"
        self.new_identity(wrong)
        with self.assertRaises((recovery.RecoveryError, tarfile.TarError)):
            recovery.restore(self.root, self.expected, archive, wrong, digest(archive), self.docker)
        with self.assertRaisesRegex(recovery.RecoveryError, "different target or release"):
            recovery.restore(self.root, {**self.expected, "source_revision": "b" * 40},
                             archive, self.key, digest(archive), self.docker)
        original = archive.read_bytes()
        archive.write_bytes(original[:-2] + bytes([original[-2] ^ 1, original[-1]]))
        with self.assertRaisesRegex(recovery.RecoveryError, "recorded SHA-256"):
            recovery.restore(self.root, self.expected, archive, self.key, hashlib.sha256(original).hexdigest(), self.docker)
        with self.assertRaises((recovery.RecoveryError, tarfile.TarError)):
            recovery.restore(self.root, self.expected, archive, self.key, digest(archive), self.docker)
        self.assertFalse(self.root.exists())
        self.assertEqual(self.docker.created, {})

    def test_restore_failure_rolls_back_only_owned_new_volumes(self):
        archive = self.snapshot()
        (self.scratch / "unrelated").mkdir()
        self.docker.failure = True
        with self.assertRaisesRegex(recovery.RecoveryError, "injected"):
            recovery.restore(self.root, self.expected, archive, self.key, digest(archive), self.docker)
        self.assertFalse(self.root.exists())
        self.assertEqual(self.docker.created, {})
        self.assertTrue((self.scratch / "unrelated").is_dir())

    def test_backup_rejects_running_database_and_symbolic_links(self):
        pid = self.root / "data/postgres/postmaster.pid"
        pid.write_text("42")
        with self.assertRaisesRegex(recovery.RecoveryError, "cleanly shut down"):
            recovery.backup(self.root, self.expected, self.recipient, self.docker)
        pid.unlink()
        (self.root / "data/storage/unsafe").symlink_to(self.scratch)
        with self.assertRaisesRegex(recovery.RecoveryError, "linked"):
            recovery.backup(self.root, self.expected, self.recipient, self.docker)
        self.assertFalse(list((self.root / "backups").glob("recovery-*")))

    def test_an_authenticated_but_unsafe_archive_cannot_escape_private_extraction(self):
        metadata = recovery.bundle_metadata(self.expected, self.edition,
                                            {"db": PIN, "storage": STORAGE}, self.volumes)
        payload = io.BytesIO()
        with tarfile.open(fileobj=payload, mode="w:gz") as archive:
            header = json.dumps(metadata).encode()
            entry = tarfile.TarInfo("metadata.json")
            entry.size = len(header)
            archive.addfile(entry, io.BytesIO(header))
            evil = tarfile.TarInfo("runtime/data/../../escape")
            evil.size = 2
            archive.addfile(evil, io.BytesIO(b"no"))
        archive = self.scratch / "unsafe.age"
        subprocess.run([AGE, "-r", self.recipient, "-o", archive], input=payload.getvalue(),
                       check=True, capture_output=True)
        archive.chmod(0o600)
        self.root.rename(self.scratch / "original")
        with self.assertRaisesRegex(recovery.RecoveryError, "unexpected archive path"):
            recovery.restore(self.root, self.expected, archive, self.key, digest(archive), self.docker)
        self.assertFalse((self.scratch / "escape").exists())
        self.assertFalse(self.root.exists())

    @unittest.skipUnless(POSTGRES_TEST_BIN, "provide a private PostgreSQL 17 test toolchain")
    def test_native_cold_postgres_reopens_with_auth_and_storage_metadata(self):
        postgres = self.root / "data/postgres"
        shutil.rmtree(postgres)
        socket = self.scratch / "socket"
        socket.mkdir(mode=0o700)

        def pg(tool, *args):
            return subprocess.run([Path(POSTGRES_TEST_BIN) / tool, *args], check=True,
                                  capture_output=True, text=True, timeout=25).stdout.strip()

        def start():
            pg("pg_ctl", "-D", postgres, "-l", self.scratch / "postgres.log", "-w",
               "-o", f"-k {socket} -h '' -p 55499", "start")

        def stop():
            if (postgres / "postmaster.pid").exists():
                pg("pg_ctl", "-D", postgres, "-w", "-m", "fast", "stop")

        def sql(statement):
            return pg("psql", "-XqAt", "-h", socket, "-p", "55499", "-U", "postgres",
                      "-v", "ON_ERROR_STOP=1", "-c", statement)

        pg("initdb", "-D", postgres, "-U", "postgres", "--no-locale", "--auth=trust")
        self.addCleanup(stop)
        start()
        sql("""
          create role supabase_auth_admin login password 'Fictional recovery test password';
          create schema auth;
          create table auth.users (username text, encrypted_password text);
          insert into auth.users values ('fictional-learner', 'opaque-password-hash');
          create schema storage;
          create table storage.objects (name text);
          insert into storage.objects values ('handout');
        """)
        expected = sql("""
          select (select rolpassword from pg_authid where rolname = 'supabase_auth_admin')
          || ':' || (select username || ':' || encrypted_password from auth.users)
          || ':' || (select name from storage.objects);
        """)
        stop()
        source = self.snapshot()
        recovery.restore(self.root, self.expected, source, self.key, digest(source), self.docker)
        start()
        self.assertEqual(sql("""
          select (select rolpassword from pg_authid where rolname = 'supabase_auth_admin')
          || ':' || (select username || ':' || encrypted_password from auth.users)
          || ':' || (select name from storage.objects);
        """), expected)
        self.assertEqual((self.root / "data/storage/handout").read_bytes(), b"retained-object\x00\x12")


class RecoveryArchiveTypes(unittest.TestCase):
    def test_sticky_bit_is_allowed_only_for_caddy_directories(self):
        caddy = "volumes/caddy_data/caddy"
        for path, kind, mode in (
            (caddy, tarfile.DIRTYPE, 0o2777),
            (caddy, tarfile.DIRTYPE, 0o4777),
            (caddy, tarfile.REGTYPE, 0o1660),
            (caddy, tarfile.SYMTYPE, 0o777),
            ("runtime/data/postgres", tarfile.DIRTYPE, 0o1777),
        ):
            with self.subTest(path=path, kind=kind, mode=oct(mode)):
                member = tarfile.TarInfo(path)
                member.type = kind
                member.mode = mode
                with self.assertRaisesRegex(recovery.RecoveryError, "special, linked or privileged"):
                    recovery.allowed_tar_type(member)


class DockerOwnership(unittest.TestCase):
    def test_rejects_recovery_resources_with_wrong_project_or_ownership(self):
        with tempfile.TemporaryDirectory(prefix="academy-docker-test-") as temp:
            root = Path(temp).resolve()
            instance = recovery.Docker.__new__(recovery.Docker)
            instance.project = "academy-" + uuid4().hex
            instance.recovery_id = uuid4().hex
            instance.root = root
            name = instance.project + "_db-config"
            mount = root / "volumes" / name / "_data"
            mount.mkdir(parents=True)
            volume = {"Name": name, "Driver": "local", "Mountpoint": str(mount), "Options": None,
                      "Labels": {"com.docker.compose.project": instance.project,
                                 "com.docker.compose.volume": "db-config"}}
            instance.command = lambda *_: json.dumps([volume])
            self.assertEqual(instance.volume("db-config"), mount)
            with self.assertRaisesRegex(recovery.RecoveryError, "ownership"):
                instance.volume("db-config", created=True)
            volume["Labels"]["com.docker.compose.project"] = "foreign"
            with self.assertRaisesRegex(recovery.RecoveryError, "ownership"):
                instance.volume("db-config")

    def test_rejects_containers_with_writable_mounts_into_owned_data(self):
        temporary = Path(tempfile.gettempdir()).resolve()
        root = temporary / "approved-academy"
        docker = recovery.Docker.__new__(recovery.Docker)
        container = {"Mounts": [{"RW": True, "Source": str(root.parent)}]}
        docker.containers = lambda **_: [container]
        with self.assertRaisesRegex(recovery.RecoveryError, "writable access"):
            docker.no_writers([root])
        container["Mounts"][0]["RW"] = False
        docker.no_writers([root])

    def test_backup_requires_exited_database_and_matching_bind_mounts(self):
        with tempfile.TemporaryDirectory(prefix="academy-mount-test-") as temp:
            root = Path(temp).resolve()
            docker = recovery.Docker.__new__(recovery.Docker)
            docker.project = "academy-" + uuid4().hex
            config_volume = root / "db-config"
            records = [
                {"State": {"Status": "exited", "ExitCode": 0},
                 "Config": {"Image": PIN, "Labels": {"com.docker.compose.service": "db"}},
                 "Mounts": [
                     {"Destination": "/var/lib/postgresql/data", "Type": "bind",
                      "Source": str(root / "data/postgres")},
                     {"Destination": "/etc/postgresql-custom", "Type": "volume",
                      "Source": str(config_volume)},
                 ]},
                {"State": {"Status": "exited", "ExitCode": 143},
                 "Config": {"Image": STORAGE, "Labels": {"com.docker.compose.service": "storage"}},
                 "Mounts": [{"Destination": "/var/lib/storage", "Type": "bind",
                             "Source": str(root / "data/storage")}]},
            ]
            docker.containers = lambda **_: records
            docker.no_writers = lambda _: None
            docker.volume = lambda _: config_volume
            docker.volume_names = lambda: {docker.project + "_db-config"}
            self.assertEqual(docker.backup_state(root), (
                {"db": PIN, "storage": STORAGE}, {"db-config": config_volume},
            ))
            records[0]["State"]["Status"] = "running"
            with self.assertRaisesRegex(recovery.RecoveryError, "stop the entire"):
                docker.backup_state(root)
            records[0]["State"]["Status"] = "exited"
            records[1]["Mounts"][0]["Source"] = str(root / "foreign")
            with self.assertRaisesRegex(recovery.RecoveryError, "service mount"):
                docker.backup_state(root)


if __name__ == "__main__":
    unittest.main()
