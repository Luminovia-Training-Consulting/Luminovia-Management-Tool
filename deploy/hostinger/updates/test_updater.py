# Isolated updater cases use fictional releases and temporary installations. FakeUpdater records external mutations while archive, filesystem, locking and state transitions remain real local operations.
"""Offline update-policy and real archive/filesystem/lock regression tests."""

import copy
import hashlib
import io
import json
import os
import shutil
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import updater as u

COMMIT = "a" * 40
OLD = "b" * 40
PIN = "example/service:1.2.3@sha256:" + "c" * 64
KEY = "sb_publishable_" + "d" * 32


def sha(data):
    return hashlib.sha256(data).hexdigest()


# Build a synthetic release/archive whose bytes and manifest can be varied deliberately.
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


# Create only this case's temporary installation tree.
def instance(directory):
    root = Path(directory) / "instance"
    root.mkdir(mode=0o700)
    (root / "private").mkdir(mode=0o700)
    (root / "private/selfhost.env").write_text("SUPABASE_PUBLIC_URL='https://cms.luminovia.org/backend'\nSUPABASE_PUBLISHABLE_KEY='" + KEY + "'\nPORTAL_APP_ORIGIN='https://cms.luminovia.org'\n")
    (root / "source").mkdir()
    (root / "www/releases/bootstrap/assets").mkdir(parents=True)
    (root / "www/releases/bootstrap/index.html").write_text("old release")
    os.symlink("releases/bootstrap", root / "www/current")
    return root


# Populate the known old runtime inventory so byte comparisons can distinguish update modes.
def installed_runtime(root, files):
    for name, contents in files.items():
        if name.startswith("site/"):
            continue
        destination = root / "control/updater.py" if name == u.CONTROLLER else root / "source" / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(contents)


# Inject download responses without mutating an actual release or server.
def network_candidate(updater, archive, manifest):
    u.atomic_json(updater.state_file, {"bootstrapApproved": True})
    updater.candidate = lambda: {"status": "candidate", "commit": COMMIT, "assets": {"cms-release.json": "manifest", "cms-release.tar.gz": "archive"}}

    def download(url, destination, limit):
        if url == "manifest":
            Path(destination).write_text(json.dumps(manifest))
        else:
            shutil.copy2(archive, destination)

    updater.download = download


# Record external system/Docker operations while keeping the real updater state machine active.
class FakeUpdater(u.Updater):
    def __init__(self, root):
        super().__init__(root)
        self.calls = []
        self.fail_health_once = False
        self.image_change = False
        self.busy = False
        self.collations = []
        self.pending = []
        self.fail_checkpoint_restore = False
        self.fail_public_health = False

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

    def create_checkpoint(self, tree, *, include_clamav):
        self.calls.append("checkpoint")
        self.assert_maintenance = self.maintenance.exists()
        return {"fixture": True}

    def restore_checkpoint(self, tree, checkpoint, *, public_unblocked, restart_old_runtime, verify_health):
        self.calls.append("restore-checkpoint")
        if public_unblocked or not self.maintenance.exists() or self.fail_checkpoint_restore:
            raise u.UpdateError("checkpoint_restore_failed")
        restart_old_runtime()
        verify_health()

    def postgres_preflight(self, tree, manifest):
        self.calls.append("postgres-preflight")
        return {"status": "passed"}

    def health(self, env, expected_index=None, *, private_api=False):
        self.calls.append("health")
        self.calls.append("private-health" if private_api else "public-health")
        if self.fail_public_health and not private_api:
            raise u.UpdateError("public_api_health_failed")
        if self.fail_health_once:
            self.fail_health_once = False
            raise u.UpdateError("static_release_health_failed")


# Archive cases exercise actual temporary bytes and dangerous entries before installation writes.
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

    def test_package_binds_only_the_known_external_relay_source(self):
        with tempfile.TemporaryDirectory() as directory:
            extra = {"scripts/mail-relay.py": b"print('fictional relay fixture')"}
            archive, manifest, _ = fixture(directory, extra=extra)
            output = Path(directory) / "verified"
            u.unpack_verified(archive, manifest, output)
            self.assertEqual((output / "scripts/mail-relay.py").read_bytes(), extra["scripts/mail-relay.py"])
            self.assertFalse(u.allowed_path("scripts/another-relay.py"))

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


# Check exact historical source, SQL quoting and conservative automatic migration limits.
class MigrationTests(unittest.TestCase):
    def test_released_job_material_migration_keeps_exact_history(self):
        path = Path(__file__).resolve().parents[3] / "supabase/migrations/20261123021230_job_material_archiving.sql"
        source = path.read_bytes().decode("utf-8")
        command = u.migration_sql(source, "20261123021230", "job_material_archiving")
        self.assertTrue(command.startswith("BEGIN;\nSELECT pg_advisory"))
        self.assertEqual(command.count(source), 2)
        self.assertTrue(command.endswith("COMMIT;\n"))
        with self.assertRaisesRegex(u.UpdateError, "migration_requires_single_transaction"):
            u.migration_sql(source + "\n-- altered", "20261123021230", "job_material_archiving")

    def test_sql_quoting_history_and_advisory_lock_preserve_exact_source(self):
        source = "-- begin; in a comment must not receive the lock\nBEGIN;\nCREATE FUNCTION public.example() RETURNS text LANGUAGE sql AS $$ SELECT 'regexp$' || 'delete from examples' $$;\nGRANT SELECT, UPDATE, DELETE ON public.example_table TO authenticated;\nCOMMIT;\n"
        command = u.migration_sql(source, "20261116120000", "example")
        self.assertTrue(command.startswith("-- begin; in a comment must not receive the lock\nBEGIN;\nSELECT pg_advisory"))
        self.assertIn(source, command)
        self.assertIn("regexp$'", command)
        self.assertTrue(command.endswith("COMMIT;\n"))

    def test_reviewed_and_automatic_paths_preserve_the_same_transaction_envelope(self):
        opening = "-- Fictional migration\nbegin transaction;"
        source = opening + "\nselect ';';\ncommit;\n"
        for operator_reviewed in (False, True):
            with self.subTest(operator_reviewed=operator_reviewed):
                command = u.migration_sql(source, "20261116120000", "example", operator_reviewed=operator_reviewed)
                self.assertTrue(command.startswith(opening + "\nSELECT pg_advisory_xact_lock"))
                self.assertIn(source, command)
                self.assertTrue(command.endswith("COMMIT;\n"))
                with self.assertRaisesRegex(u.UpdateError, "migration_transaction_delimiters_require_own_lines"):
                    u.migration_sql("BEGIN; SELECT 1; COMMIT;", "20261116120000", "example", operator_reviewed=operator_reviewed)

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


# GitHub fixtures prove exact current main and immutable release identity; CI status is deliberately not consulted.
class ReleaseTests(unittest.TestCase):
    def test_immutable_current_main_release_is_eligible_without_ci_results(self):
        with tempfile.TemporaryDirectory() as directory:
            updater = u.Updater(instance(directory))
            tag = "cms-dev-" + COMMIT
            release = {"tag_name": tag, "immutable": True, "assets": [{"name": name, "state": "uploaded", "browser_download_url": "https://github.com/" + u.REPOSITORY + "/releases/download/" + tag + "/" + name} for name in ("cms-release.tar.gz", "cms-release.json")]}
            run = {"head_sha": COMMIT, "head_branch": "main", "event": "push", "status": "completed", "conclusion": "success", "path": ".github/workflows/ci.yml"}
            calls = []

            def api(path, *, missing_ok=False):
                calls.append(path)
                if path.startswith("/releases/tags/"):
                    return release
                if path == "/branches/main":
                    return {"commit": {"sha": COMMIT}}
                if path.startswith("/git/ref"):
                    return {"object": {"type": "commit", "sha": COMMIT}}
                if path.startswith("/actions/"):
                    raise AssertionError("The automatic updater must ignore CI status.")
                raise AssertionError("Unexpected GitHub API path: " + path)

            updater.api = api
            self.assertEqual(updater.candidate()["status"], "candidate")
            self.assertEqual(calls, ["/branches/main", "/releases/tags/" + tag, "/git/ref/tags/" + tag])
            release["immutable"] = False
            with self.assertRaisesRegex(u.UpdateError, "immutable"):
                updater.candidate()

    def test_current_and_failed_sha_use_only_one_api_poll(self):
        with tempfile.TemporaryDirectory() as directory:
            updater = u.Updater(instance(directory))
            calls = []
            updater.api = lambda path: calls.append(path) or {"commit": {"sha": COMMIT}}
            updater.state = {"currentCommit": COMMIT}
            self.assertEqual(updater.candidate()["status"], "current")
            updater.state = {"failedCommit": COMMIT}
            self.assertEqual(updater.candidate()["status"], "failed_release_suppressed")
            self.assertEqual(len(calls), 2)
            self.assertEqual(calls, ["/branches/main", "/branches/main"])

    def test_reordered_release_list_cannot_hide_exact_current_main_release(self):
        with tempfile.TemporaryDirectory() as directory:
            updater = u.Updater(instance(directory))
            releases = [{"tag_name": "cms-dev-" + OLD, "immutable": True}, {"tag_name": "cms-dev-" + COMMIT, "immutable": True}]
            current = releases[1]
            current["assets"] = [{"name": name, "state": "uploaded", "browser_download_url": "https://github.com/" + u.REPOSITORY + "/releases/download/" + current["tag_name"] + "/" + name} for name in ("cms-release.tar.gz", "cms-release.json")]
            calls = []

            def api(path, *, missing_ok=False):
                calls.append(path)
                if path == "/branches/main":
                    return {"commit": {"sha": COMMIT}}
                if path == "/releases?per_page=5":
                    return releases  # The live failure's older-first ordering.
                if path.startswith("/releases/tags/"):
                    return next((item for item in releases if path.endswith(item["tag_name"])), None)
                if path.startswith("/git/ref"):
                    return {"object": {"type": "commit", "sha": COMMIT}}
                raise AssertionError("Unexpected GitHub API path: " + path)

            updater.api = api
            self.assertEqual(updater.candidate()["commit"], COMMIT)
            self.assertNotIn("/releases?per_page=5", calls)
            self.assertEqual(len(calls), 3)

    def test_missing_exact_release_404_is_normal_waiting_but_other_errors_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            updater = u.Updater(instance(directory))
            missing = u.urllib.error.HTTPError(u.API + "/releases/tags/cms-dev-" + COMMIT, 404, "Not Found", {}, None)
            main = io.BytesIO(json.dumps({"commit": {"sha": COMMIT}}).encode())
            with patch.object(updater.opener, "open", side_effect=[main, missing]):
                self.assertEqual(updater.candidate(), {"status": "waiting_for_main_release", "commit": COMMIT})
            forbidden = u.urllib.error.HTTPError(u.API + "/releases/tags/cms-dev-" + COMMIT, 403, "Forbidden", {}, None)
            with patch.object(updater.opener, "open", side_effect=forbidden):
                with self.assertRaisesRegex(u.UpdateError, "github_request_failed"):
                    updater.api("/releases/tags/cms-dev-" + COMMIT, missing_ok=True)
            with patch.object(updater.opener, "open", side_effect=missing):
                with self.assertRaisesRegex(u.UpdateError, "github_request_failed"):
                    updater.api("/branches/main")


# Exercise ordering, rollback and mutation fences of the real updater state machine in owned local file trees.
class InstallationTests(unittest.TestCase):
    def test_registry_pull_outage_backs_off_before_mutation_then_installs_after_deadline(self):
        for failed_kind in ("backend", "web"):
            with self.subTest(failed_kind=failed_kind), tempfile.TemporaryDirectory() as directory:
                archive, manifest, _ = fixture(directory)
                updater = FakeUpdater(instance(directory))
                network_candidate(updater, archive, manifest)
                original_compose = updater.compose
                unavailable = True

                def compose(kind, arguments, *, tree=None):
                    nonlocal unavailable
                    result = original_compose(kind, arguments, tree=tree)
                    if unavailable and kind == failed_kind and arguments[0] == "pull":
                        unavailable = False
                        raise u.UpdateError("subprocess_docker_failed")
                    return result

                updater.compose = compose
                with patch.object(updater, "prepare_site", wraps=updater.prepare_site) as prepare:
                    self.assertEqual(updater.once()["status"], "waiting_for_network_retry")
                    state = json.loads(updater.state_file.read_text())
                    self.assertIsNone(state.get("failedCommit"))
                    self.assertFalse(state["manualRecoveryRequired"])
                    self.assertEqual(state["lastTransientFailureCode"], "runtime_image_pull_failed")
                    self.assertEqual(state["networkRetryAttempts"], 1)
                    self.assertNotIn("backup", updater.calls)
                    self.assertNotIn("checkpoint", updater.calls)
                    self.assertFalse(any(isinstance(call, tuple) and call[1][0] != "pull" for call in updater.calls))
                    prepare.assert_not_called()
                    self.assertFalse(updater.maintenance.exists())
                    self.assertEqual(os.readlink(updater.www / "current"), "releases/bootstrap")
                    self.assertFalse((updater.www / "releases" / COMMIT).exists())
                    self.assertEqual(list((updater.control / "staging").iterdir()), [])
                    count = len(updater.calls)
                    self.assertEqual(updater.once()["status"], "waiting_for_network_retry")
                    self.assertEqual(len(updater.calls), count)
                    state["nextNetworkRetryAt"] = "2000-01-01T00:00:00+00:00"
                    u.atomic_json(updater.state_file, state)
                    self.assertEqual(updater.once()["status"], "updated")
                    prepare.assert_called_once()
                state = json.loads(updater.state_file.read_text())
                self.assertEqual(state["currentCommit"], COMMIT)
                self.assertEqual(state["networkRetryAttempts"], 0)
                self.assertIsNone(state["nextNetworkRetryAt"])

    def test_config_failure_and_post_mutation_pull_error_never_become_registry_retries(self):
        for failure in ("config", "after_mutation"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                archive, manifest, _ = fixture(directory)
                updater = FakeUpdater(instance(directory))
                network_candidate(updater, archive, manifest)
                if failure == "config":
                    def bad_config(tree, candidate):
                        raise u.UpdateError("subprocess_docker_failed")

                    updater.verify_runtime = bad_config
                else:
                    original_health = updater.health
                    unavailable = True

                    def late_failure(env, expected_index=None, *, private_api=False):
                        nonlocal unavailable
                        if unavailable:
                            unavailable = False
                            raise u.RuntimeImagePullError("runtime_image_pull_failed")
                        return original_health(env, expected_index, private_api=private_api)

                    updater.health = late_failure
                with self.assertRaises(u.UpdateError) as error:
                    updater.once()
                self.assertNotIsInstance(error.exception, u.RuntimeImagePullError)
                state = json.loads(updater.state_file.read_text())
                self.assertEqual(state["failedCommit"], COMMIT)
                self.assertFalse(state.get("nextNetworkRetryAt"))
                self.assertFalse(state.get("networkRetryAttempts"))
                if failure == "config":
                    self.assertNotIn("backup", updater.calls)
                    self.assertFalse(any(isinstance(call, tuple) for call in updater.calls))
                else:
                    self.assertIn("restore-checkpoint", updater.calls)
                    self.assertFalse(state["manualRecoveryRequired"])

    def test_transient_network_failure_backs_off_then_recovers_without_suppressing_commit(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, _ = fixture(directory)
            updater = FakeUpdater(instance(directory))
            u.atomic_json(updater.state_file, {"bootstrapApproved": True})
            updater.candidate = lambda: {"status": "candidate", "commit": COMMIT, "assets": {"cms-release.json": "manifest", "cms-release.tar.gz": "archive"}}
            downloads = []

            def unavailable(url, destination, limit):
                downloads.append(url)
                raise u.UpdateError("release_download_failed")

            updater.download = unavailable
            self.assertEqual(updater.once()["status"], "waiting_for_network_retry")
            self.assertIsNone(json.loads(updater.state_file.read_text()).get("failedCommit"))
            self.assertEqual(updater.once()["status"], "waiting_for_network_retry")
            self.assertEqual(len(downloads), 1)
            state = json.loads(updater.state_file.read_text())
            state["nextNetworkRetryAt"] = "2000-01-01T00:00:00+00:00"
            u.atomic_json(updater.state_file, state)

            def available(url, destination, limit):
                if url == "manifest":
                    Path(destination).write_text(json.dumps(manifest))
                else:
                    shutil.copy2(archive, destination)

            updater.download = available
            self.assertEqual(updater.once()["status"], "updated")
            state = json.loads(updater.state_file.read_text())
            self.assertEqual(state["currentCommit"], COMMIT)
            self.assertEqual(state["networkRetryAttempts"], 0)
            self.assertIsNone(state["nextNetworkRetryAt"])

    def test_github_outage_and_corrupt_archive_retry_before_any_backend_mutation(self):
        for failure in ("github", "corrupt_download"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                _, manifest, _ = fixture(directory)
                updater = FakeUpdater(instance(directory))
                u.atomic_json(updater.state_file, {"bootstrapApproved": True})
                if failure == "github":
                    def unavailable():
                        raise u.UpdateError("github_request_failed")

                    updater.candidate = unavailable
                else:
                    updater.candidate = lambda: {"status": "candidate", "commit": COMMIT, "assets": {"cms-release.json": "manifest", "cms-release.tar.gz": "archive"}}

                    def corrupted(url, destination, limit):
                        Path(destination).write_text(json.dumps(manifest) if url == "manifest" else "truncated archive")

                    updater.download = corrupted
                self.assertEqual(updater.once()["status"], "waiting_for_network_retry")
                state = json.loads(updater.state_file.read_text())
                self.assertIsNone(state.get("failedCommit"))
                self.assertNotIn("backup", updater.calls)
                self.assertFalse(any(isinstance(call, tuple) for call in updater.calls))
                self.assertEqual(os.readlink(updater.www / "current"), "releases/bootstrap")

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
            reconcile_mailpit = ("backend", ("up", "-d", "--wait", "db", "mailpit"))
            restart_writers = ("backend", ("up", "-d", "--wait", "--force-recreate", "--no-deps", *u.WRITERS))
            self.assertLess(updater.calls.index(reconcile_mailpit), updater.calls.index(restart_writers))

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

    def test_runtime_failure_restores_checkpoint_before_external_writes_resume(self):
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
            self.assertFalse((root / "www/maintenance.enabled").exists())
            state = json.loads(updater.state_file.read_text())
            self.assertFalse(state["manualRecoveryRequired"])
            self.assertTrue(state["automaticRollbackCompleted"])
            self.assertIn("restore-checkpoint", updater.calls)
            backup = Path(state["lastBackup"])
            self.assertEqual((backup / "runtime-before/deploy/hostinger/Caddyfile").read_bytes(), b"old recoverable configuration")
            recovery = json.loads((backup / "runtime-original-map.json").read_text())
            self.assertTrue(recovery["files"]["deploy/hostinger/Caddyfile"])
            self.assertFalse(recovery["files"]["deploy/hostinger/compose.yml"])
            self.assertEqual((backup / "runtime-original-map.json").stat().st_mode & 0o777, 0o600)
            self.assertEqual(list((updater.control / "staging").iterdir()), [])
            self.assertIn("collation-check", updater.calls)

    def test_no_database_rollback_after_external_writes_have_been_unblocked(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, _ = fixture(directory)
            updater = FakeUpdater(instance(directory))
            updater.image_change = True
            updater.fail_public_health = True
            gate_during_static_rollback = []
            promote = updater.promote

            def observed_promotion(target):
                if target == "releases/bootstrap":
                    gate_during_static_rollback.append(updater.maintenance.exists())
                promote(target)

            updater.promote = observed_promotion
            with self.assertRaisesRegex(u.UpdateError, "public_api_health_failed"):
                updater.apply(archive, manifest)
            self.assertNotIn("restore-checkpoint", updater.calls)
            self.assertTrue(updater.maintenance.exists())
            self.assertTrue(json.loads(updater.state_file.read_text())["manualRecoveryRequired"])
            self.assertTrue(json.loads(updater.state_file.read_text())["forwardRetryAvailable"])
            self.assertEqual(gate_during_static_rollback, [True])

    def test_forward_retry_rechecks_release_and_reopens_even_when_all_bytes_match(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, files = fixture(directory)
            updater = FakeUpdater(instance(directory))
            manifest_path = Path(directory) / "manifest.json"
            alternate = {**manifest, "commit": "c" * 40}
            manifest_path.write_text(json.dumps(alternate))
            installed_runtime(updater.root, files)
            updater.state = {"currentCommit": OLD, "failedCommit": COMMIT, "manualRecoveryRequired": True, "forwardRetryAvailable": True}
            u.atomic_json(updater.state_file, updater.state)
            updater.maintenance.write_text("Operator recovery required.\n")
            updater.candidate = lambda: {"status": "candidate", "commit": COMMIT, "assets": {"cms-release.json": "manifest"}}
            updater.download = lambda url, path, limit: path.write_text(json.dumps(manifest))
            lock = Path(directory) / "maintenance.lock"
            with patch.object(u, "REBOOT_PENDING", Path(directory) / "no-reboot"), patch.object(u, "REVIEWED_ROOT_UID", os.geteuid()), patch.object(u, "MAINTENANCE_LOCK", lock):
                self.assertEqual(updater.once(retry_failed=True)["status"], "operator_recovery_required")
                arguments = {"package": archive, "manifest_path": manifest_path, "retry_failed": True}
                with self.assertRaisesRegex(u.UpdateError, "exact_failed_commit"):
                    updater.once(**arguments)
                manifest_path.write_text(json.dumps({**manifest, "archiveSha256": "9" * 64}))
                with self.assertRaisesRegex(u.UpdateError, "local_manifest_differs"):
                    updater.once(**arguments)
                self.assertEqual(updater.calls, [])
                manifest_path.write_text(json.dumps(manifest))
                source = files[manifest["migrations"][0]["path"]].decode()
                updater.pending = [(manifest["migrations"][0]["version"], "add_example", source)]
                with self.assertRaisesRegex(u.UpdateError, "forward_recovery_requires_applied_migrations"):
                    updater.once(**arguments)
                updater.pending = []
                self.assertTrue(updater.maintenance.exists())
                self.assertNotIn("backup", updater.calls)
                self.assertEqual(updater.once(**arguments), {"status": "updated", "commit": COMMIT, "mode": "full"})
            self.assertIn("checkpoint", updater.calls)
            self.assertNotIn("restore-checkpoint", updater.calls)
            self.assertFalse(updater.maintenance.exists())
            self.assertFalse(updater.state["manualRecoveryRequired"])
            self.assertEqual(updater.state["appliedMigrationVersions"], [])

    def test_failed_forward_retry_keeps_maintenance_and_uses_only_fresh_checkpoint(self):
        for rollback_fails in (False, True):
            with self.subTest(rollback_fails=rollback_fails), tempfile.TemporaryDirectory() as directory:
                archive, manifest, _ = fixture(directory)
                updater = FakeUpdater(instance(directory))
                updater.maintenance.write_text("Operator recovery required.\n")
                updater.state = {"manualRecoveryRequired": True, "forwardRetryAvailable": True}
                updater.fail_health_once = True
                updater.fail_checkpoint_restore = rollback_fails
                with self.assertRaisesRegex(u.UpdateError, "static_release_health_failed"):
                    updater.apply(archive, manifest)
                self.assertLess(updater.calls.index("checkpoint"), updater.calls.index("restore-checkpoint"))
                self.assertTrue(updater.maintenance.exists())
                self.assertTrue(updater.state["manualRecoveryRequired"])
                self.assertEqual(updater.state["forwardRetryAvailable"], not rollback_fails)

    def test_checkpoint_resume_failure_reconciles_db_mailpit_and_paused_web_before_unblocking(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, files = fixture(directory)
            root = instance(directory)
            installed_runtime(root, files)
            (root / "source/deploy/hostinger/selfhost/compose.yml").write_bytes(b"older backend config")
            updater = FakeUpdater(root)

            def failed_checkpoint(tree, *, include_clamav):
                raise u.UpdateError("recovery_original_services_resume_failed")

            updater.create_checkpoint = failed_checkpoint
            with self.assertRaisesRegex(u.UpdateError, "original_services_resume_failed"):
                updater.apply(archive, manifest)
            database = ("backend", ("up", "-d", "--wait", "db", "mailpit"))
            writers = ("backend", ("up", "-d", "--wait", "--force-recreate", "--no-deps", *u.WRITERS))
            web = ("web", ("up", "-d", "--wait", "--force-recreate", "--no-deps", "web"))
            self.assertLess(updater.calls.index(database), updater.calls.index(writers))
            self.assertIn(web, updater.calls)
            self.assertIn("private-health", updater.calls)
            self.assertFalse(updater.maintenance.exists())
            self.assertFalse(json.loads(updater.state_file.read_text())["manualRecoveryRequired"])

    def test_pending_os_reboot_blocks_all_deployment_modes_before_network_or_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            updater = FakeUpdater(instance(directory))
            marker = Path(directory) / "reboot-pending"
            marker.touch()
            with patch.object(u, "REBOOT_PENDING", marker):
                self.assertEqual(updater.once()["status"], "operating_system_reboot_pending")
                self.assertEqual(updater.once(retry_failed=True)["status"], "operating_system_reboot_pending")
            self.assertEqual(updater.calls, [])

    def test_failed_checkpoint_restore_keeps_maintenance_and_recovery_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, _ = fixture(directory)
            updater = FakeUpdater(instance(directory))
            updater.image_change = True
            updater.fail_health_once = True
            updater.fail_checkpoint_restore = True
            with self.assertRaises(u.UpdateError):
                updater.apply(archive, manifest)
            self.assertTrue(updater.maintenance.exists())
            self.assertTrue(json.loads(updater.state_file.read_text())["manualRecoveryRequired"])

    def test_private_health_and_database_gate_precede_public_access(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, manifest, _ = fixture(directory)
            updater = FakeUpdater(instance(directory))
            updater.image_change = True
            updater.apply(archive, manifest)
            self.assertTrue(updater.assert_maintenance)
            self.assertLess(updater.calls.index("backup"), updater.calls.index("checkpoint"))
            self.assertLess(updater.calls.index("checkpoint"), updater.calls.index("postgres-preflight"))
            self.assertLess(updater.calls.index("postgres-preflight"), updater.calls.index("sql"))
            self.assertLess(updater.calls.index("private-health"), updater.calls.index("public-health"))

    def test_private_health_uses_only_owned_gateway_ip_for_api_and_checks_exact_public_index(self):
        with tempfile.TemporaryDirectory() as directory:
            updater = u.Updater(instance(directory))
            env = {"SUPABASE_PUBLIC_URL": "https://cms.luminovia.org/backend", "SUPABASE_PUBLISHABLE_KEY": KEY, "PORTAL_APP_ORIGIN": "https://cms.luminovia.org"}
            address = "172.19.0.5"

            # Run the supplied process without a shell and preserve a real failure status.
            def command(arguments):
                if arguments[-2] == "{{json .State}}":
                    return json.dumps({"Running": True, "Paused": False, "OOMKilled": False, "Health": {"Status": "healthy"}}).encode()
                self.assertEqual(arguments[-1], "luminovia-supabase-api-gw-1")
                return json.dumps({"luminovia-portal-backend": {"IPAddress": address}}).encode()

            updater.command = command
            urls = []

            def request(value, timeout):
                urls.append(value.full_url)
                if value.full_url.endswith("jwks.json"):
                    response = io.BytesIO(json.dumps({"keys": [{"kty": "EC", "x": "fictional-public-x", "y": "fictional-public-y"}]}).encode())
                elif value.full_url == env["PORTAL_APP_ORIGIN"]:
                    response = io.BytesIO(b"exact candidate index")
                else:
                    response = io.BytesIO(b"healthy")
                response.status = 200
                return response

            with patch.object(u.urllib.request, "urlopen", side_effect=request):
                updater.health(env, b"exact candidate index", private_api=True)
            self.assertEqual(urls, ["http://172.19.0.5:8000/auth/v1/health", "http://172.19.0.5:8000/auth/v1/.well-known/jwks.json", "https://cms.luminovia.org"])
            address = "8.8.8.8"
            with self.assertRaisesRegex(u.UpdateError, "unsafe_private_gateway_address"):
                updater.health(env, private_api=True)

    def test_each_required_health_facet_fails_closed_independently(self):
        # Keep each health boundary distinguishable so a partial runtime or failed probe cannot be hidden by a later success.
        cases = [
            ("container", "runtime_container_health_failed", False),
            ("private-address", "unsafe_private_gateway_address", True),
            ("private-api-timeout", "public_api_health_failed", True),
            ("private-jwks-key", "private_signing_material_in_public_jwks", True),
            ("release-index", "static_release_health_failed", False),
        ]
        for facet, expected, private_api in cases:
            with self.subTest(facet=facet), tempfile.TemporaryDirectory() as directory:
                updater = u.Updater(instance(directory))
                env = {
                    "SUPABASE_PUBLIC_URL": "https://cms.luminovia.org/backend",
                    "SUPABASE_PUBLISHABLE_KEY": KEY,
                    "PORTAL_APP_ORIGIN": "https://cms.luminovia.org",
                }
                address = "8.8.8.8" if facet == "private-address" else "172.19.0.5"

                # Emulate Docker's health inspection while leaving every unrelated service healthy.
                def command(arguments):
                    if arguments[-2] == "{{json .State}}":
                        service = arguments[-1]
                        running = not (facet == "container" and service == "luminovia-supabase-rest-1")
                        return json.dumps({"Running": running, "Paused": False, "OOMKilled": False, "Health": {"Status": "healthy"}}).encode()
                    return json.dumps({"luminovia-portal-backend": {"IPAddress": address}}).encode()

                updater.command = command

                # Return healthy endpoints except for the one selected failure boundary.
                def request(value, timeout):
                    if facet == "private-api-timeout" and value.full_url.endswith("/auth/v1/health"):
                        raise TimeoutError("fictional health probe timeout")
                    if value.full_url.endswith("jwks.json"):
                        keys = [{"kty": "RSA", "x": "fictional-public-x", "y": "fictional-public-y"}]
                        if facet == "private-jwks-key":
                            keys[0]["d"] = "fictional-private-key-material"
                        response = io.BytesIO(json.dumps({"keys": keys}).encode())
                    elif value.full_url == env["PORTAL_APP_ORIGIN"]:
                        response = io.BytesIO(b"different public index" if facet == "release-index" else b"exact candidate index")
                    else:
                        response = io.BytesIO(b"healthy")
                    response.status = 200
                    return response

                with patch.object(u.urllib.request, "urlopen", side_effect=request), self.assertRaisesRegex(u.UpdateError, expected):
                    updater.health(env, b"exact candidate index", private_api=private_api)

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
