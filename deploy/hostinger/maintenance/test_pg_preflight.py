# Controlled process/Compose fixtures check prerequisites and private-cluster probe ordering. These unit cases do not replace the separate native image/data test.
import datetime as dt
import json
import shutil
import tempfile
import unittest
from pathlib import Path

import pg_preflight as pg

PIN = "supabase/postgres:17.12.0.000@sha256:" + "a" * 64
SNAPSHOT = {"tables": [{"name": "public.fixture", "rows": 1, "hash": "original"}], "roles": "protected", "memberships": "same", "policies": "same", "functions": "same"}


# Controlled cluster/Compose inventory records start/stop/copy ordering without accessing real data.
class Fixture:
    def __init__(self, root):
        self.root = Path(root)
        self.data = self.root / "data/postgres"
        self.config = self.root / "docker-config"
        self.data.mkdir(parents=True)
        self.config.mkdir()
        (self.data / "PG_VERSION").write_text("17\n")
        (self.data / "fixture").write_bytes(b"original private data")
        (self.config / "key").write_bytes(b"fixture encryption key")
        (self.root / "www").mkdir()
        (self.root / "www/maintenance.enabled").write_text("maintenance")
        backup = self.root / "private/update-backups/fresh"
        backup.mkdir(parents=True)
        (backup / "manifest.json").write_text(json.dumps({"status": "complete", "createdAt": dt.datetime.now(dt.timezone.utc).isoformat()}))
        self.state = {"lastBackup": str(backup)}
        self.calls = []
        self.changed = False
        self.copy_fails = False
        self.collation_mismatch = False
        self.created_name = None
        self.environment_file = None
        self.deleted_before_files = False

    def sql(self, sql, **kwargs):
        self.calls.append(("sql", kwargs.get("database", "postgres")))
        return json.dumps(["_supabase", "postgres", "template1"] if "json_agg(datname" in sql else SNAPSHOT)

    def compose(self, kind, args, **kwargs):
        self.calls.append(("compose", tuple(args)))
        if args[0] == "config":
            return json.dumps({"services": {"db": {"image": PIN, "environment": {"POSTGRES_PASSWORD": "fixture-private-password"}, "command": ["postgres", "-c", "shared_buffers=128MB"]}}}).encode()
        return b""

    # Run the supplied process without a shell and preserve a real failure status.
    def command(self, args, **kwargs):
        self.calls.append(tuple(args))
        if args[:2] == ["docker", "inspect"]:
            if args[3] == "{{.State.Running}}":
                return b"false\n"
            if args[3] == "{{json .Mounts}}":
                return json.dumps([{"Destination": "/var/lib/postgresql/data", "Source": str(self.data)}, {"Destination": "/etc/postgresql-custom", "Source": str(self.config)}]).encode()
            return self.created_name.encode()
        if args[0] == "cp":
            if self.copy_fails:
                raise RuntimeError("private command failed")
            shutil.copytree(Path(args[-2]), Path(args[-1]), dirs_exist_ok=True)
        if args[:2] == ["docker", "create"]:
            self.created_name = args[args.index("--name") + 1]
            self.environment_file = Path(args[args.index("--env-file") + 1])
            assert self.environment_file.stat().st_mode & 0o777 == 0o600
            assert "fixture-private-password" not in " ".join(args)
            assert args[args.index("--network") + 1] == "none"
            assert all(str(self.data) not in args[i + 1] for i, value in enumerate(args[:-1]) if value == "--mount")
        if args[:2] == ["docker", "exec"] and "psql" in args:
            sql = kwargs["data"].decode()
            if sql == "SHOW server_version_num;":
                return b"170012\n"
            if "cms_preflight_fingerprints" in sql:
                value = dict(SNAPSHOT)
                if self.changed:
                    value["roles"] = "unexpected permission drift"
                return json.dumps(value).encode()
            return b"1" if self.collation_mismatch else b"0"
        if args[:2] == ["docker", "rm"]:
            self.deleted_before_files = self.environment_file.exists()
        return b""


# Exercise prerequisites and failure paths of the private same-major preflight.
class PreflightTests(unittest.TestCase):
    def test_major_and_mutable_images_refused(self):
        for image in ["supabase/postgres:latest", PIN.replace(":17.", ":18.")]:
            with self.assertRaises(pg.PreflightError):
                pg.validate_image(image)

    def test_actual_private_copy_is_isolated_and_original_database_resumed_first(self):
        with tempfile.TemporaryDirectory() as directory:
            f = Fixture(directory)
            proof = pg.run_preflight(f, f.root / "candidate", PIN)
            self.assertEqual(proof["status"], "passed")
            self.assertEqual(proof["databasesChecked"], 3)
            self.assertTrue(proof["sourceClusterNeverMounted"])
            self.assertEqual((f.data / "fixture").read_bytes(), b"original private data")
            self.assertTrue(f.deleted_before_files)
            self.assertFalse(f.environment_file.exists())
            self.assertLess(f.calls.index(("compose", ("up", "-d", "--wait", "db"))), next(i for i, item in enumerate(f.calls) if item[:2] == ("docker", "create")))

    def test_changed_roles_or_collations_refuse_candidate_and_cleanup(self):
        for attribute in ["changed", "collation_mismatch"]:
            with self.subTest(attribute=attribute), tempfile.TemporaryDirectory() as directory:
                f = Fixture(directory)
                setattr(f, attribute, True)
                with self.assertRaises(pg.PreflightError):
                    pg.run_preflight(f, f.root, PIN)
                self.assertTrue(f.deleted_before_files)
                self.assertFalse(f.environment_file.exists())
                self.assertEqual((f.data / "fixture").read_bytes(), b"original private data")

    def test_copy_failure_always_restarts_old_database(self):
        with tempfile.TemporaryDirectory() as directory:
            f = Fixture(directory)
            f.copy_fails = True
            with self.assertRaises(RuntimeError):
                pg.run_preflight(f, f.root, PIN)
            self.assertIn(("compose", ("up", "-d", "--wait", "db")), f.calls)
            self.assertIsNone(f.created_name)

    def test_external_tablespace_is_refused_before_database_stop(self):
        with tempfile.TemporaryDirectory() as directory:
            f = Fixture(directory)
            (f.data / "external").symlink_to("/outside")
            with self.assertRaises(pg.PreflightError):
                pg.run_preflight(f, f.root, PIN)
            self.assertNotIn(("compose", ("stop", "db")), f.calls)

    def test_maintenance_and_fresh_backup_are_mandatory(self):
        for missing in ["maintenance", "backup"]:
            with self.subTest(missing=missing), tempfile.TemporaryDirectory() as directory:
                f = Fixture(directory)
                if missing == "maintenance":
                    (f.root / "www/maintenance.enabled").unlink()
                else:
                    f.state["lastBackup"] = str(f.root / "outside")
                with self.assertRaises(pg.PreflightError):
                    pg.run_preflight(f, f.root, PIN)
                self.assertNotIn(("compose", ("stop", "db")), f.calls)


if __name__ == "__main__":
    unittest.main()