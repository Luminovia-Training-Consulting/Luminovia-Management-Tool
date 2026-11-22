"""Exercise real Age encryption, customer identity and uninterrupted archive publication."""

from contextlib import contextmanager
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4
from zipfile import ZipFile

import offboard
import recovery

AGE = shutil.which("age")
AGE_KEYGEN = shutil.which("age-keygen")
PIN = "fictional:v1@sha256:" + "a" * 64


class ExportSource:
    def __init__(self, expected, edition, file_id):
        self.expected = expected
        self.edition = edition
        self.file_id = file_id
        self.document_id = str(uuid4())
        self.name = f"{uuid4()}/{self.document_id}/{file_id}"
        self.approved = "%PDF-1.4\nFictional roster\x00\xff\n".encode()
        self.canonical_name = self.name
        self.content = self.approved
        self.completed = True
        self.changed = False
        self.reads = []

    def export_state(self, _root):
        return {"db": "db", "storage": "other" if self.changed else "storage"}

    @contextmanager
    def database(self, _container):
        stream = io.BytesIO()
        stream.write(b"@metadata\n")
        stream.write(json.dumps({
            "installation_id": self.expected["installation_id"],
            "edition": self.edition,
            "release": self.expected["source_revision"],
            "captured_at": "2026-11-22T00:00:00Z",
        }).encode() + b"\n")
        for section in offboard.SECTIONS:
            stream.write(f"@{section}\n".encode())
            if section == "courses":
                stream.write('{"title":"Fiktiver Kurs – Å"}\n'.encode())
            if section == "attendance_evidence":
                stream.write(json.dumps({
                    "source": "academy_scan", "resource_id": None, "version_id": self.file_id,
                }).encode() + b"\n")
        stream.write(b"@files\n")
        stream.write(json.dumps({
            "id": self.file_id, "document_id": self.document_id, "object_path": self.name,
            "size_bytes": len(self.approved), "sha256": hashlib.sha256(self.approved).hexdigest(),
            "original_name": "../../original.pdf",
        }).encode() + b"\n")
        if self.completed:
            stream.write(b"@complete\n")
        stream.seek(0)
        yield stream

    @contextmanager
    def file(self, container, name):
        self.reads.append((container, name))
        yield io.BytesIO(self.content)


@unittest.skipUnless(AGE and AGE_KEYGEN, "Age is required for encryption")
class Offboarding(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="academy-export-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve() / "academy"
        self.root.mkdir(mode=0o700)
        identifier = str(uuid4())
        self.expected = recovery.identity_for(self.root, identifier, "b" * 40)
        self.edition = "customer-managed"
        self.file_id = str(uuid4())
        self.docker = ExportSource(self.expected, self.edition, self.file_id)
        settings = patch.dict(recovery.COMMAND_ENV, {
            "PATH": str(Path(AGE).parent) + ":" + recovery.COMMAND_ENV["PATH"],
        })
        settings.start()
        self.addCleanup(settings.stop)
        self.key = self.root.parent / "export.agekey"
        subprocess.run([AGE_KEYGEN, "-o", self.key], check=True, capture_output=True)
        self.recipient = subprocess.run([AGE_KEYGEN, "-y", self.key], check=True,
                                        capture_output=True, text=True).stdout.strip()

        for name in ("backups", "browser", "data", "data/postgres", "data/storage"):
            (self.root / name).mkdir(mode=0o700)
        (self.root / "data/postgres/PG_VERSION").write_text("17")
        (self.root / "data/postgres/postmaster.pid").write_text("123")
        project = self.expected["compose_project"]
        (self.root / "installation.json").write_text(json.dumps({
            "version": 1, "installation_id": identifier, "edition": self.edition, "compose_project": project,
            "backend_network": project + "-backend", "backup_directory": str(self.root / "backups"),
            "data_directory": str(self.root / "data"), "browser_directory": str(self.root / "browser"),
        }))
        (self.root / "browser/release.json").write_text(json.dumps({
            "version": 1, "state": "browser-staged",
            "release": {"installation_id": identifier, "edition": self.edition, "source_revision": "b" * 40},
        }))
        (self.root / "runtime.env").write_text(f"""COMPOSE_PROJECT_NAME={project}
ACADEMY_INSTALLATION_ID={identifier}
ACADEMY_EDITION={self.edition}
PORTAL_DATA_DIR={self.root / "data"}
PORTAL_WWW_DIR={self.root / "browser"}
PORTAL_BACKEND_NETWORK={project}-backend
POSTGRES_DB=postgres
SERVICE_ROLE_KEY=fictional-excluded-credential
""")
        for name in ("runtime.env.public.env", "runtime.env.notification.env"):
            (self.root / name).write_text("PRIVATE=fictional-excluded-key\n")
        for name in (*recovery.RUNTIME_FILES, "browser/release.json"):
            (self.root / name).chmod(0o600)

    def export(self):
        return offboard.export(self.root, self.expected, self.recipient, self.docker)

    def test_exact_portable_package_without_operational_credentials(self):
        receipt = self.export()
        bundle = Path(receipt["export"])
        self.assertEqual(stat.S_IMODE(bundle.stat().st_mode), 0o600)
        self.assertEqual(receipt["sha256"], hashlib.sha256(bundle.read_bytes()).hexdigest())
        plain = subprocess.run([AGE, "-d", "-i", self.key, bundle], check=True, capture_output=True).stdout
        with ZipFile(io.BytesIO(plain)) as archive:
            self.assertEqual(set(archive.namelist()), {
                "metadata.json", "files.jsonl", f"files/{self.file_id}",
                *(section + ".jsonl" for section in offboard.SECTIONS),
            })
            self.assertEqual(json.loads(archive.read("metadata.json"))["format"], offboard.FORMAT)
            self.assertEqual(json.loads(archive.read("courses.jsonl"))["title"], "Fiktiver Kurs – Å")
            self.assertEqual(archive.read(f"files/{self.file_id}"), self.docker.approved)
            metadata = json.loads(archive.read("files.jsonl"))
            self.assertEqual(metadata["original_name"], "../../original.pdf")
            self.assertNotIn("object_path", metadata)
            self.assertEqual(metadata["archive_path"], f"files/{self.file_id}")
            evidence = json.loads(archive.read("attendance_evidence.jsonl"))
            self.assertEqual(evidence, {
                "source": "academy_scan", "resource_id": None, "version_id": self.file_id,
            })
        self.assertEqual(self.docker.reads, [("storage", self.docker.name)])
        self.assertNotIn(b"fictional-excluded-credential", plain)

    def test_denies_wrong_database_identity_before_requesting_a_file(self):
        self.docker.expected = {**self.expected, "installation_id": str(uuid4())}
        with self.assertRaisesRegex(recovery.RecoveryError, "another installation"):
            self.export()
        self.assertEqual(self.docker.reads, [])
        self.assertEqual(list((self.root / "backups").iterdir()), [])

    def test_denies_unsafe_path_and_mismatched_or_missing_bytes(self):
        for unsafe in ("../wrong", "/foreign", "double//path", "path%2fother"):
            self.docker.name = unsafe
            with self.assertRaisesRegex(recovery.RecoveryError, "file metadata"):
                self.export()
        self.assertEqual(self.docker.reads, [])
        self.docker.name = self.docker.canonical_name
        for invalid in (b"", b"x" * len(self.docker.approved), self.docker.approved + b"x"):
            self.docker.content = invalid
            with self.assertRaisesRegex(recovery.RecoveryError, "bytes differ"):
                self.export()
        self.assertEqual(list((self.root / "backups").iterdir()), [])

    def test_aborted_snapshot_or_changed_container_leaves_no_archive(self):
        self.docker.completed = False
        with self.assertRaisesRegex(recovery.RecoveryError, "incomplete"):
            self.export()
        self.docker.completed = True
        original = self.docker.export_state

        def change_after_open(root):
            state = original(root)
            self.docker.changed = True
            return state

        self.docker.export_state = change_after_open
        with self.assertRaisesRegex(recovery.RecoveryError, "sources changed"):
            self.export()
        self.assertEqual(list((self.root / "backups").iterdir()), [])


class ContainerOwnership(unittest.TestCase):
    def test_only_bound_database_and_storage_may_serve_export(self):
        instance = offboard.ExportDocker.__new__(offboard.ExportDocker)
        instance.project = "academy-fixture"
        network = instance.project + "-backend"
        root = Path("/owned/private")
        records = []
        for service, directory, mount, identifier in (
            ("db", "postgres", "/var/lib/postgresql/data", "a" * 64),
            ("storage", "storage", "/var/lib/storage", "b" * 64),
        ):
            records.append({
                "Id": identifier,
                "State": {"Status": "running"},
                "Config": {"Image": PIN, "Labels": {
                    "com.docker.compose.project": instance.project,
                    "com.docker.compose.service": service,
                }},
                "Mounts": [{
                    "Destination": mount, "Type": "bind", "Source": str(root / "data" / directory),
                }],
                "NetworkSettings": {"Networks": {network: {}}, "Ports": {"5000/tcp": None}},
            })
        instance.containers = lambda **_: records
        self.assertEqual(instance.export_state(root), {"db": "a" * 64, "storage": "b" * 64})
        storage = records[1]
        storage["Mounts"][0]["Source"] = "/foreign"
        with self.assertRaisesRegex(recovery.RecoveryError, "mount"):
            instance.export_state(root)
        storage["Mounts"][0]["Source"] = str(root / "data/storage")
        records.append({
            "Config": {"Labels": None}, "NetworkSettings": {"Networks": {network: {}}}, "Mounts": [],
        })
        with self.assertRaisesRegex(recovery.RecoveryError, "another container"):
            instance.export_state(root)
        records.pop()
        storage["NetworkSettings"]["Ports"]["5000/tcp"] = [{"HostIp": "127.0.0.1", "HostPort": "4000"}]
        with self.assertRaisesRegex(recovery.RecoveryError, "private"):
            instance.export_state(root)


if __name__ == "__main__":
    unittest.main()
