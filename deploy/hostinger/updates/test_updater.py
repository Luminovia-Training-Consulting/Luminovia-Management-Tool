"""Offline update-policy and real archive/filesystem/lock regression tests."""

import copy
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import tarfile
import tempfile
import unittest
from unittest.mock import patch

import updater as u


COMMIT = "a" * 40
OLD = "b" * 40
PIN = "example/service:1.2.3@sha256:" + "c" * 64
KEY = "sb_publishable_" + "d" * 32


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fixture(directory, *, extra=None, members=None):
    files = {
        "site/index.html": b"<html>current CMS release</html>",
        "site/assets/app-abc123.js": b"console.log('immutable public code')",
        "deploy/hostinger/compose.yml": b"services: {}\n",
        "deploy/hostinger/Caddyfile": b"{$PORTAL_DOMAIN} { respond 200 }\n",
        "deploy/hostinger/selfhost/compose.yml": b"services: {}\n",
        "supabase/migrations/20261116120000_add_example.sql": b"BEGIN;\nCREATE TABLE public.example(id integer);\nCOMMIT;\n",
    }
    files.update(extra or {})
    manifest = {
        "schemaVersion": 1,
        "repository": u.REPOSITORY,
        "branch": "main",
        "commit": COMMIT,
        "archiveSha256": "0" * 64,
        "files": [{"path": name, "size": len(data), "sha256": sha(data)} for name, data in files.items()],
        "migrations": [{"version": name.rsplit("/", 1)[1][:14], "path": name, "sha256": sha(data)} for name, data in files.items() if name.startswith("supabase/migrations/")],
        "runtime": {"postgresMajor": 17, "reviewed": True, "images": [{"service": "db", "image": "supabase/postgres:17.12.0@sha256:" + "c" * 64}]},
        "publicBuild": {"apiUrl": "https://cms.luminovia.org/backend", "publishableKeySha256": sha(KEY.encode())},
    }
    archive = Path(directory) / "release.tar.gz"
    with tarfile.open(archive, "w:gz") as output:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            output.addfile(info, io.BytesIO(data))
        for info, data in members or []:
            output.addfile(info, io.BytesIO(data) if data is not None else None)
    manifest["archiveSha256"] = u.digest(archive)
    return archive, manifest, files


def instance(directory):
    root = Path(directory) / "instance"
    (root / "private").mkdir(parents=True)
    (root / "private/selfhost.env").write_text("SUPABASE_PUBLIC_URL='https://cms.luminovia.org/backend'\nSUPABASE_PUBLISHABLE_KEY='" + KEY + "'\nPORTAL_APP_ORIGIN='https://cms.luminovia.org'\n")
    (root / "source").mkdir()
    (root / "www/releases/bootstrap/assets").mkdir(parents=True)
    (root / "www/releases/bootstrap/index.html").write_text("old release")
    os.symlink("releases/bootstrap", root / "www/current")
    return root


def installed_runtime(root, files):
    for name, contents in files.items():
        if name.startswith("site/"):
            continue
        destination = root / "control/updater.py" if name == u.CONTROLLER else root / "source" / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(contents)


class FakeUpdater(u.Updater):
    def __init__(self, root):
        super().__init__(root)
        self.calls = []
        self.fail_health_once = False
        self.image_change = False
        self.busy = False
        self.collations = []
        self.pending = []

    def os_updates_busy(self):
        return self.busy

    def plan_migrations(self, tree, manifest):
        self.calls.append("migration-plan")
        return self.pending

    def verify_runtime(self, tree, manifest):
        return self.image_change, self.image_change

    def preflight_space(self, tree):
        self.calls.append("space-check")

    def backup(self, commit):
        self.calls.append("backup")
        return self.root / "private/update-backups/fixture"

    def compose(self, kind, arguments, *, tree=None):
        self.calls.append((kind, tuple(arguments)))
        return b"{}"

    def sql(self, source, **kwargs):
        self.calls.append("sql")
        return ""

    def collation_guard(self, manifest):
        self.calls.append("collation-check")

    def health(self, env, expected_index=None):
        self.calls.append("health")
        if self.fail_health_once:
            self.fail_health_once = False
            raise u.UpdateError("static_release_health_failed")


class ArchiveTests(unittest.TestCase):
    def test_real_archive_verifies_every_byte_without_extractall(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, files = fixture(directory)
            destination = Path(directory) / "extracted"
            u.unpack_verified(archive, manifest, destination)
            for name, data in files.items():
                self.assertEqual((destination / name).read_bytes(), data)
            self.assertEqual(destination.stat().st_mode & 0o777, 0o700)

    def test_traversal_symlink_hardlink_extra_and_duplicates_are_rejected(self):
        for name, kind, link in [("../escape", tarfile.REGTYPE, ""), ("site/link", tarfile.SYMTYPE, "/etc/passwd"), ("site/hard", tarfile.LNKTYPE, "site/index.html"), ("site/unlisted", tarfile.REGTYPE, ""), ("site/index.html", tarfile.REGTYPE, "")]:
            with self.subTest(name=name, kind=kind), tempfile.TemporaryDirectory() as directory:
                info = tarfile.TarInfo(name)
                info.type, info.linkname = kind, link
                data = b"malicious" if kind == tarfile.REGTYPE else None
                info.size = len(data) if data else 0
                archive, manifest, _ = fixture(directory, members=[(info, data)])
                with self.assertRaises(u.UpdateError):
                    u.unpack_verified(archive, manifest, Path(directory) / "out")
                self.assertFalse((Path(directory) / "escape").exists())

    def test_private_environment_and_manifest_hash_drift_fail_before_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, _ = fixture(directory)
            for path in ("site/.env", "deploy/hostinger/private/key", "/absolute", "site/../key", "site\\private"):
                bad = copy.deepcopy(manifest)
                bad["files"][0]["path"] = path
                with self.assertRaises(u.UpdateError):
                    u.validate_manifest(bad)
            bad = copy.deepcopy(manifest)
            bad["files"][0]["sha256"] = "e" * 64
            with self.assertRaisesRegex(u.UpdateError, "hash_mismatch"):
                u.unpack_verified(archive, bad, Path(directory) / "hash-out")
            bad = copy.deepcopy(manifest)
            bad["archiveSha256"] = "e" * 64
            with self.assertRaisesRegex(u.UpdateError, "archive_hash"):
                u.unpack_verified(archive, bad, Path(directory) / "archive-out")

    def test_wrong_build_key_and_postgres_major_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            _, manifest, _ = fixture(directory)
            updater = u.Updater(instance(directory))
            updater.verify_public_build(manifest)
            manifest["publicBuild"]["publishableKeySha256"] = "f" * 64
            with self.assertRaisesRegex(u.UpdateError, "configuration_mismatch"):
                updater.verify_public_build(manifest)
            manifest["runtime"]["postgresMajor"] = 18
            with self.assertRaisesRegex(u.UpdateError, "major"):
                u.validate_manifest(manifest)

    def test_untagged_immutable_clamav_digest_is_valid_but_latest_without_digest_is_not(self):
        with tempfile.TemporaryDirectory() as directory:
            _, manifest, _ = fixture(directory)
            manifest["runtime"]["images"].append({"service": "clamav", "image": "clamav/clamav@sha256:" + "1" * 64})
            u.validate_manifest(manifest)
            manifest["runtime"]["images"][-1]["image"] = "clamav/clamav:latest"
            with self.assertRaisesRegex(u.UpdateError, "unpinned"):
                u.validate_manifest(manifest)


class MigrationTests(unittest.TestCase):
    def test_sql_quoting_history_and_advisory_lock_preserve_exact_source(self):
        source = "-- begin; in a comment must not receive the lock\nBEGIN;\nCREATE FUNCTION public.example() RETURNS text LANGUAGE sql AS $$ SELECT 'regexp$' || 'delete from examples' $$;\nGRANT SELECT, UPDATE, DELETE ON public.example_table TO authenticated;\nCOMMIT;\n"
        command = u.migration_sql(source, "20261116120000", "example")
        self.assertTrue(command.startswith("-- begin; in a comment must not receive the lock\nBEGIN;\nSELECT pg_advisory"))
        self.assertIn(source, command)
        self.assertIn("regexp$'", command)
        self.assertTrue(command.endswith("COMMIT;\n"))

    def test_destructive_and_multi_transaction_sql_requires_review(self):
        commands = ["DELETE FROM profiles", "UPDATE profiles SET active=false", "TRUNCATE profiles", "DROP TABLE profiles", "ALTER TABLE profiles DROP COLUMN id", "ALTER TABLE profiles ALTER COLUMN id TYPE text", "DO $$ BEGIN DELETE FROM profiles; END $$", "WITH removed AS (DELETE FROM profiles RETURNING id) SELECT * FROM removed", "COMMIT; BEGIN", "SET standard_conforming_strings=off"]
        for command in commands:
            with self.subTest(command=command), self.assertRaises(u.UpdateError):
                u.compatible_migration("BEGIN;\n" + command + ";\nCOMMIT;\n")
        u.compatible_migration("BEGIN;\nCREATE TABLE example(id text CHECK(id <> 'DROP TABLE example'));\nCREATE POLICY own_delete ON example FOR DELETE USING(true);\nCOMMIT;\n")
        u.compatible_migration("BEGIN;\nALTER TABLE example ADD COLUMN description text;\nCOMMIT;\n")

    def test_applied_sources_must_exist_unchanged_and_no_quota_reset(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, files = fixture(directory)
            target = Path(directory) / "unpacked"
            u.unpack_verified(archive, manifest, target)
            updater = u.Updater(instance(directory))
            version = manifest["migrations"][0]["version"]
            source = files[manifest["migrations"][0]["path"]].decode()
            updater.current_history = lambda: {version: source}
            self.assertEqual(updater.plan_migrations(target, manifest), [])
            updater.current_history = lambda: {version: source + "-- changed"}
            with self.assertRaisesRegex(u.UpdateError, "source_drift"):
                updater.plan_migrations(target, manifest)
            updater.current_history = lambda: {"20261116130000": source}
            with self.assertRaisesRegex(u.UpdateError, "remove_applied"):
                updater.plan_migrations(target, manifest)


class ReleaseTests(unittest.TestCase):
    def test_only_immutable_current_main_successful_push_ci_is_eligible(self):
        with tempfile.TemporaryDirectory() as directory:
            updater = u.Updater(instance(directory))
            tag = "cms-dev-" + COMMIT
            release = {"tag_name": tag, "immutable": True, "assets": [{"name": name, "state": "uploaded", "browser_download_url": "https://github.com/" + u.REPOSITORY + "/releases/download/" + tag + "/" + name} for name in ("cms-release.tar.gz", "cms-release.json")]}
            run = {"head_sha": COMMIT, "head_branch": "main", "event": "push", "status": "completed", "conclusion": "success", "path": ".github/workflows/ci.yml"}
            calls = []
            def api(path):
                calls.append(path)
                if path.startswith("/releases"):
                    return [release]
                if path == "/branches/main":
                    return {"commit": {"sha": COMMIT}}
                if path.startswith("/git/ref"):
                    return {"object": {"type": "commit", "sha": COMMIT}}
                return {"workflow_runs": [run]}
            updater.api = api
            self.assertEqual(updater.candidate()["status"], "candidate")
            self.assertEqual(len(calls), 4)
            run["event"] = "pull_request"
            self.assertEqual(updater.candidate()["status"], "waiting_for_successful_main_checks")
            release["immutable"] = False
            with self.assertRaisesRegex(u.UpdateError, "immutable"):
                updater.candidate()

    def test_current_and_failed_sha_use_only_one_api_poll(self):
        with tempfile.TemporaryDirectory() as directory:
            updater = u.Updater(instance(directory))
            calls = []
            updater.api = lambda path: calls.append(path) or [{"tag_name": "cms-dev-" + COMMIT, "immutable": True}]
            updater.state = {"currentCommit": COMMIT}
            self.assertEqual(updater.candidate()["status"], "current")
            updater.state = {"failedCommit": COMMIT}
            self.assertEqual(updater.candidate()["status"], "failed_release_suppressed")
            self.assertEqual(len(calls), 2)


class InstallationTests(unittest.TestCase):
    def test_site_and_controller_only_update_has_no_container_or_backup_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, files = fixture(directory, extra={u.CONTROLLER: b"# reviewed new controller\n"})
            root = instance(directory)
            installed_runtime(root, files)
            (root / "control/updater.py").write_bytes(b"# previous actual controller\n")
            # The source copy is deliberately already current: classification
            # must compare the executable in control/, not this inactive copy.
            source_copy = root / "source" / u.CONTROLLER
            source_copy.parent.mkdir(parents=True, exist_ok=True)
            source_copy.write_bytes(files[u.CONTROLLER])
            original_env = (root / "private/selfhost.env").read_bytes()
            updater = FakeUpdater(root)
            updater.state = {"currentCommit": OLD, "lastBackup": "previous-private-backup"}
            # Real runtime consistency checks remain enabled on the fast path.
            image = manifest["runtime"]["images"][0]["image"]
            def images(tree):
                updater.calls.append(("backend", ("config", "--format", "json")))
                return {"db": image}
            updater.rendered_images = images
            updater.verify_runtime = lambda tree, value: u.Updater.verify_runtime(updater, tree, value)
            result = updater.apply(archive, manifest)
            self.assertEqual(result["mode"], "site_controller")
            self.assertEqual((root / "control/updater.py").read_bytes(), files[u.CONTROLLER])
            self.assertEqual((root / "control/updater.py").stat().st_mode & 0o777, 0o700)
            self.assertEqual((root / "private/selfhost.env").read_bytes(), original_env)
            self.assertEqual((root / "www/current/index.html").read_bytes(), files["site/index.html"])
            self.assertTrue(all(call[1][0] == "config" for call in updater.calls if isinstance(call, tuple)))
            self.assertFalse(any(call in updater.calls for call in ("backup", "space-check", "sql", "collation-check")))
            self.assertFalse(updater.maintenance.exists())
            state = json.loads(updater.state_file.read_text())
            self.assertEqual(state["lastUpdateMode"], "site_controller")
            self.assertFalse(state["backupCreatedForCurrentUpdate"])
            self.assertEqual(state["lastBackup"], "previous-private-backup")

    def test_fast_path_still_rejects_wrong_declared_runtime_images(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, files = fixture(directory)
            root = instance(directory)
            installed_runtime(root, files)
            updater = FakeUpdater(root)
            updater.rendered_images = lambda tree: {"db": "supabase/postgres:17.12.0@sha256:" + "e" * 64}
            updater.verify_runtime = lambda tree, value: u.Updater.verify_runtime(updater, tree, value)
            with self.assertRaisesRegex(u.UpdateError, "runtime_image_manifest_mismatch"):
                updater.apply(archive, manifest)
            self.assertEqual(os.readlink(root / "www/current"), "releases/bootstrap")
            self.assertNotIn("backup", updater.calls)

    def test_site_only_health_failure_rolls_back_without_touching_backend_or_controller(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, files = fixture(directory, extra={u.CONTROLLER: b"# new controller\n"})
            root = instance(directory)
            installed_runtime(root, files)
            previous_controller = b"# keep previous controller\n"
            (root / "control/updater.py").write_bytes(previous_controller)
            updater = FakeUpdater(root)
            updater.fail_health_once = True
            with self.assertRaisesRegex(u.UpdateError, "health_failed"):
                updater.apply(archive, manifest)
            self.assertEqual(os.readlink(root / "www/current"), "releases/bootstrap")
            self.assertEqual((root / "control/updater.py").read_bytes(), previous_controller)
            self.assertFalse(any(isinstance(call, tuple) for call in updater.calls))
            self.assertNotIn("backup", updater.calls)
            self.assertFalse(updater.maintenance.exists())
            state = json.loads(updater.state_file.read_text())
            self.assertEqual(state["lastAttemptMode"], "site_controller")
            self.assertFalse(state["manualRecoveryRequired"])

    def test_corrupt_shared_asset_blocks_site_only_promotion_without_backend_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, files = fixture(directory)
            root = instance(directory)
            installed_runtime(root, files)
            asset = root / "www/assets/app-abc123.js"
            asset.parent.mkdir()
            asset.write_bytes(b"older incompatible bytes")
            updater = FakeUpdater(root)
            with self.assertRaisesRegex(u.UpdateError, "immutable_asset_collision"):
                updater.apply(archive, manifest)
            self.assertEqual(os.readlink(root / "www/current"), "releases/bootstrap")
            self.assertEqual(asset.read_bytes(), b"older incompatible bytes")
            self.assertFalse(any(isinstance(call, tuple) for call in updater.calls))
            self.assertNotIn("backup", updater.calls)

    def test_changed_missing_or_removed_runtime_and_pending_sql_require_full_update(self):
        for reason in ("changed", "missing", "removed", "pending"):
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as directory:
                archive, manifest, files = fixture(directory)
                root = instance(directory)
                installed_runtime(root, files)
                updater = FakeUpdater(root)
                if reason == "changed":
                    (root / "source/deploy/hostinger/Caddyfile").write_bytes(b"old Caddy configuration")
                elif reason == "missing":
                    (root / "source/deploy/hostinger/selfhost/compose.yml").unlink()
                elif reason == "removed":
                    updater.state = {"installedRuntimeFiles": ["supabase/functions/legacy/index.ts"]}
                else:
                    item = manifest["migrations"][0]
                    updater.pending = [(item["version"], "add_example", files[item["path"]].decode())]
                result = updater.apply(archive, manifest)
                self.assertEqual(result["mode"], "full")
                self.assertIn("backup", updater.calls)
                self.assertIn(("backend", ("stop", *u.WRITERS)), updater.calls)
                self.assertTrue(json.loads(updater.state_file.read_text())["backupCreatedForCurrentUpdate"])
                web_calls = [call[1] for call in updater.calls if isinstance(call, tuple) and call[0] == "web"]
                self.assertFalse(any("--force-recreate" in args and "clamav" in args for args in web_calls))
                if reason == "changed":
                    self.assertTrue(any("--force-recreate" in args and args[-1] == "web" for args in web_calls))

    def test_only_changed_clamd_bind_requires_targeted_scanner_recreation(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, files = fixture(directory, extra={"deploy/hostinger/clamd.conf": b"MaxThreads 1\n"})
            root = instance(directory)
            installed_runtime(root, files)
            (root / "source/deploy/hostinger/clamd.conf").write_bytes(b"MaxThreads 4\n")
            updater = FakeUpdater(root)
            self.assertEqual(updater.apply(archive, manifest)["mode"], "full")
            self.assertIn(("web", ("up", "-d", "--wait", "--force-recreate", "--no-deps", "clamav")), updater.calls)
            self.assertIn(("web", ("up", "-d", "--wait", "web")), updater.calls)

    def test_existing_runtime_symlink_cannot_qualify_for_site_only_update(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, files = fixture(directory)
            root = instance(directory)
            installed_runtime(root, files)
            target = root / "source/deploy/hostinger/Caddyfile"
            target.unlink()
            external = Path(directory) / "outside-Caddyfile"
            external.write_bytes(files["deploy/hostinger/Caddyfile"])
            target.symlink_to(external)
            updater = FakeUpdater(root)
            with self.assertRaisesRegex(u.UpdateError, "unsafe_existing_source_path"):
                updater.apply(archive, manifest)
            self.assertEqual(os.readlink(root / "www/current"), "releases/bootstrap")
            self.assertNotIn("backup", updater.calls)

    def test_success_promotes_complete_site_and_preserves_private_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, files = fixture(directory, extra={"site/workbox-abc123.js": b"old service worker imports remain reachable"})
            root = instance(directory)
            original_env = (root / "private/selfhost.env").read_bytes()
            updater = FakeUpdater(root)
            result = updater.apply(archive, manifest)
            self.assertEqual(result["status"], "updated")
            self.assertEqual(os.readlink(root / "www/current"), "releases/" + COMMIT)
            self.assertEqual((root / "www/current/index.html").read_bytes(), files["site/index.html"])
            self.assertEqual((root / "www/assets/app-abc123.js").read_bytes(), files["site/assets/app-abc123.js"])
            self.assertEqual((root / "www/workbox-abc123.js").read_bytes(), files["site/workbox-abc123.js"])
            self.assertEqual((root / "private/selfhost.env").read_bytes(), original_env)
            self.assertFalse((root / "www/maintenance.enabled").exists())
            state = json.loads(updater.state_file.read_text())
            self.assertEqual(state["currentCommit"], COMMIT)
            self.assertLess(updater.calls.index("backup"), updater.calls.index("sql"))

    def test_first_automatic_install_requires_explicit_private_bootstrap_approval(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, _ = fixture(directory)
            root = instance(directory)
            updater = FakeUpdater(root)
            self.assertEqual(updater.once()["status"], "not_initialized")
            u.atomic_json(updater.state_file, {"bootstrapApproved": True})
            updater.candidate = lambda: {"status": "candidate", "commit": COMMIT, "assets": {"cms-release.json": "manifest", "cms-release.tar.gz": "archive"}}
            def download(url, destination, limit):
                if url == "manifest":
                    Path(destination).write_text(json.dumps(manifest))
                else:
                    shutil.copy2(archive, destination)
            updater.download = download
            self.assertEqual(updater.once()["status"], "updated")
            self.assertFalse(json.loads(updater.state_file.read_text())["bootstrapApproved"])

    def test_other_operator_maintenance_and_manual_recovery_block_automatic_install(self):
        with tempfile.TemporaryDirectory() as directory:
            root = instance(directory)
            updater = FakeUpdater(root)
            updater.maintenance.write_text("operator maintenance")
            self.assertEqual(updater.once()["status"], "maintenance_already_active")
            u.atomic_json(updater.state_file, {"manualRecoveryRequired": True, "failedCommit": COMMIT})
            self.assertEqual(updater.once()["status"], "operator_recovery_required")

    def test_failed_health_restores_static_and_config_without_database_restore(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, _ = fixture(directory)
            root = instance(directory)
            old = root / "source/deploy/hostinger/Caddyfile"
            old.parent.mkdir(parents=True)
            old.write_text("old configuration")
            updater = FakeUpdater(root)
            updater.fail_health_once = True
            with self.assertRaisesRegex(u.UpdateError, "health_failed"):
                updater.apply(archive, manifest)
            self.assertEqual(os.readlink(root / "www/current"), "releases/bootstrap")
            self.assertEqual(old.read_text(), "old configuration")
            state = json.loads(updater.state_file.read_text())
            self.assertEqual(state["failedCommit"], COMMIT)
            self.assertFalse(state["manualRecoveryRequired"])
            self.assertFalse((root / "www/maintenance.enabled").exists())
            self.assertFalse(any("pg_restore" in str(call) for call in updater.calls))

    def test_runtime_failure_retains_maintenance_for_manual_recovery(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, _ = fixture(directory)
            root = instance(directory)
            old = root / "source/deploy/hostinger/Caddyfile"
            old.parent.mkdir(parents=True)
            old.write_bytes(b"old recoverable configuration")
            updater = FakeUpdater(root)
            updater.image_change = True
            updater.fail_health_once = True
            with self.assertRaises(u.UpdateError):
                updater.apply(archive, manifest)
            self.assertTrue((root / "www/maintenance.enabled").exists())
            state = json.loads(updater.state_file.read_text())
            self.assertTrue(state["manualRecoveryRequired"])
            backup = Path(state["lastBackup"])
            self.assertEqual((backup / "runtime-before/deploy/hostinger/Caddyfile").read_bytes(), b"old recoverable configuration")
            recovery = json.loads((backup / "runtime-original-map.json").read_text())
            self.assertTrue(recovery["files"]["deploy/hostinger/Caddyfile"])
            self.assertFalse(recovery["files"]["deploy/hostinger/compose.yml"])
            self.assertEqual((backup / "runtime-original-map.json").stat().st_mode & 0o777, 0o600)
            self.assertEqual(list((updater.control / "staging").iterdir()), [])
            self.assertIn("collation-check", updater.calls)

    def test_partial_writer_stop_failure_restarts_existing_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, _ = fixture(directory)
            root = instance(directory)
            updater = FakeUpdater(root)
            updater.image_change = True
            compose = updater.compose
            def partial_stop(kind, arguments, *, tree=None):
                result = compose(kind, arguments, tree=tree)
                if arguments[0] == "stop":
                    raise u.UpdateError("partial_writer_stop_failed")
                return result
            updater.compose = partial_stop
            with self.assertRaisesRegex(u.UpdateError, "partial_writer_stop_failed"):
                updater.apply(archive, manifest)
            self.assertIn(("backend", ("up", "-d", "--wait", "--force-recreate", "--no-deps", *u.WRITERS)), updater.calls)
            self.assertNotIn("backup", updater.calls)
            self.assertFalse(updater.maintenance.exists())
            self.assertFalse(json.loads(updater.state_file.read_text())["manualRecoveryRequired"])

    def test_flock_and_apt_state_prevent_parallel_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = instance(directory)
            first, second = FakeUpdater(root), FakeUpdater(root)
            u.private_directory(first.control)
            descriptor = os.open(first.control / "updater.lock", os.O_WRONLY | os.O_CREAT, 0o600)
            try:
                u.fcntl.flock(descriptor, u.fcntl.LOCK_EX | u.fcntl.LOCK_NB)
                self.assertEqual(second.once()["status"], "another_update_running")
            finally:
                os.close(descriptor)
            second.busy = True
            self.assertEqual(second.once()["status"], "operating_system_security_update_running")
            for state in ("active", "activating", "reloading", "deactivating", "inactive"):
                updater = u.Updater(root)
                updater.command = lambda *args, value=state, **kwargs: value.encode()
                self.assertEqual(updater.os_updates_busy(), state != "inactive")

    def test_shared_asset_collision_and_active_release_cannot_be_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, _ = fixture(directory)
            root = instance(directory)
            stage = Path(directory) / "stage"
            u.unpack_verified(archive, manifest, stage)
            updater = u.Updater(root)
            shared = root / "www/assets/app-abc123.js"
            shared.parent.mkdir()
            shared.write_bytes(b"different old bytes")
            with self.assertRaisesRegex(u.UpdateError, "collision"):
                updater.prepare_site(stage, COMMIT)
            active = root / "www/releases" / COMMIT
            updater.promote("releases/" + COMMIT)
            with self.assertRaisesRegex(u.UpdateError, "active_release"):
                updater.prepare_site(stage, COMMIT)
            self.assertTrue(active.exists())

    def test_collation_mismatch_never_implicitly_reindexes(self):
        with tempfile.TemporaryDirectory() as directory:
            updater = u.Updater(instance(directory))
            commands = []
            def sql(command, **kwargs):
                commands.append(command)
                return json.dumps([{"name": "postgres", "allow": True, "template": False}])
            updater.sql = sql
            with self.assertRaisesRegex(u.UpdateError, "collation_rebuild_requires"):
                updater.collation_guard({"runtime": {"postgresMajor": 17, "reviewed": True}})
            self.assertEqual(len(commands), 1)


if __name__ == "__main__":
    unittest.main()
