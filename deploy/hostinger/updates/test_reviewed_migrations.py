"""Exercise explicit, byte-bound migration approval without touching a real host.

Real archive/private-file/flock operations are retained. Only Docker, HTTPS and
physical recovery are replaced; a separate disposable PostgreSQL suite proves
that the reviewed SQL and its exact history commit or roll back together.
"""

import contextlib
import copy
import datetime as dt
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import updater as u
from test_updater import COMMIT, OLD, FakeUpdater, fixture, instance

OLD_VERSION = "20261115100000"
OLD_SOURCE = "BEGIN;\nCREATE TABLE public.example(id integer);\nCOMMIT;\n"
NEW_VERSION = "20261116120000"
NEW_PATH = "supabase/migrations/20261116120000_add_example.sql"
REVIEW_SOURCE = "BEGIN;\nUPDATE public.example SET id=id+1;\nCOMMIT;\n"


class ReviewedUpdater(FakeUpdater):
    """Keep real policy, binding, staging and rollback orchestration under test."""

    def __init__(self, root, manifest):
        super().__init__(root)
        self.history = {OLD_VERSION: OLD_SOURCE}
        self.state = {"currentCommit": OLD}
        u.atomic_json(self.state_file, self.state)
        self.published = copy.deepcopy(manifest)
        self.eligible = {"status": "candidate", "commit": COMMIT, "assets": {"cms-release.json": "fixture-manifest"}}
        self.backup_is_fresh = True
        self.after_checkpoint = None
        self.sql_sources = []

    def current_history(self):
        self.calls.append("live-history")
        return dict(self.history)

    def plan_migrations(self, tree, manifest):
        # Preserve the real unattended classifier, unlike generic runtime fakes.
        return u.Updater.plan_migrations(self, tree, manifest)

    def require_fresh_complete_backup(self, tree):
        self.calls.append("fresh-complete-backup")
        if not self.backup_is_fresh:
            raise u.UpdateError("reviewed_migration_requires_fresh_complete_backup")

    def candidate(self):
        self.calls.append("eligible-release")
        return self.eligible

    def download(self, url, destination, limit):
        self.assert_download = (url, limit)
        Path(destination).write_text(json.dumps(self.published), encoding="utf8")

    def sql(self, source, **kwargs):
        self.calls.append("sql")
        self.sql_sources.append(source)
        return ""

    def create_checkpoint(self, tree, *, include_clamav):
        checkpoint = super().create_checkpoint(tree, include_clamav=include_clamav)
        if self.after_checkpoint:
            self.after_checkpoint()
        return checkpoint

    def consume_reviewed_migration_plan(self, plan):
        self.calls.append("consume-plan")
        return super().consume_reviewed_migration_plan(plan)


@contextlib.contextmanager
def reviewed_fixture(extra=None):
    """Use owned temporary paths and emulate root ownership only inside tests."""
    with tempfile.TemporaryDirectory() as directory:
        files = {"supabase/migrations/" + OLD_VERSION + "_installed.sql": OLD_SOURCE.encode(), NEW_PATH: REVIEW_SOURCE.encode()}
        files.update(extra or {})
        archive, manifest, _ = fixture(directory, extra=files)
        updater = ReviewedUpdater(instance(directory), manifest)
        path = updater.control / "reviewed-migrations/approval.json"
        manifest_path = Path(directory) / "manifest.json"
        manifest_path.write_text(json.dumps(manifest), encoding="utf8")
        with patch.object(u, "REVIEWED_ROOT_UID", os.geteuid()), patch.object(u, "MAINTENANCE_LOCK", Path(directory) / "global.lock"), patch.object(u, "REBOOT_PENDING", Path(directory) / "no-reboot-marker"):
            plan = updater.make_reviewed_migration_plan(archive, manifest)
            updater.write_reviewed_migration_plan(path, plan)
            yield updater, archive, manifest, path, plan, manifest_path


class ReviewedPolicyTests(unittest.TestCase):
    def test_ordinary_classifier_stays_strict_while_explicit_sql_keeps_history(self):
        with self.assertRaisesRegex(u.UpdateError, "migration_requires_operator_review"):
            u.migration_sql(REVIEW_SOURCE, NEW_VERSION, "review")
        command = u.migration_sql(REVIEW_SOURCE, NEW_VERSION, "review", operator_reviewed=True)
        self.assertIn(REVIEW_SOURCE, command)
        self.assertIn("pg_advisory_xact_lock", command)
        self.assertTrue(command.endswith("COMMIT;\n"))

    def test_review_never_permits_transaction_escape_or_parser_setting_changes(self):
        commands = ["COMMIT; BEGIN", "END; BEGIN", "ROLLBACK", "ABORT", "SAVEPOINT boundary", "RELEASE boundary", "PREPARE TRANSACTION 'x'", "SET standard_conforming_strings=off", "ALTER SYSTEM SET work_mem='1MB'", "COPY public.example TO PROGRAM 'false'"]
        for command in commands:
            with self.subTest(command=command), self.assertRaises(u.UpdateError):
                u.reviewed_transaction("BEGIN;\n" + command + ";\nCOMMIT;\n")
        for source in ["UPDATE public.example SET id=1;", "BEGIN; UPDATE public.example SET id=1; COMMIT;", "BEGIN;\nCOMMIT;\nCOMMIT;\n"]:
            with self.subTest(source=source), self.assertRaises(u.UpdateError):
                u.reviewed_transaction(source)

    def test_builder_is_read_only_and_reports_exact_review_reasons(self):
        with reviewed_fixture() as (updater, archive, manifest, _path, plan, _manifest_path):
            self.assertEqual(updater.calls, ["live-history"])
            self.assertEqual(plan["applied"], [{"version": OLD_VERSION, "sha256": u.hashlib.sha256(OLD_SOURCE.encode()).hexdigest()}])
            self.assertEqual(plan["pending"], [{"version": NEW_VERSION, "path": NEW_PATH, "sha256": u.hashlib.sha256(REVIEW_SOURCE.encode()).hexdigest(), "reviewRequired": True, "reviewReason": "migration_requires_operator_review"}])
            self.assertEqual(plan["manifestSha256"], u.canonical_digest(manifest))
            self.assertEqual(plan["archiveSha256"], u.digest(archive))
            self.assertFalse(updater.maintenance.exists())
            self.assertEqual(os.readlink(updater.www / "current"), "releases/bootstrap")
            self.assertNotIn("source", json.dumps(plan))

    def test_builder_validates_archive_sources_history_order_and_ttl(self):
        with reviewed_fixture() as (updater, archive, manifest, _path, _plan, _manifest_path):
            cases = [(dict(updater.history, **{"20261117000000": OLD_SOURCE}), "remove_applied"), ({OLD_VERSION: OLD_SOURCE + "-- drift"}, "source_drift"), ({NEW_VERSION: REVIEW_SOURCE}, "out_of_order")]
            for history, error in cases:
                with self.subTest(history=history), self.assertRaisesRegex(u.UpdateError, error):
                    updater.make_reviewed_migration_plan(archive, manifest, history=history)
            for ttl in [0, 59, 7201, True, 1.5]:
                with self.subTest(ttl=ttl), self.assertRaisesRegex(u.UpdateError, "ttl"):
                    updater.make_reviewed_migration_plan(archive, manifest, ttl_seconds=ttl)
            for history in [{}, {OLD_VERSION: None}, {1: "x"}, {OLD_VERSION: "x", 1: "y"}]:
                with self.subTest(history=history), self.assertRaises(u.UpdateError):
                    u.history_inventory(history)
            bad = copy.deepcopy(manifest)
            bad["archiveSha256"] = "f" * 64
            with self.assertRaisesRegex(u.UpdateError, "archive_hash"):
                updater.make_reviewed_migration_plan(archive, bad)

    def test_crlf_source_bytes_are_never_normalised_in_approval_hash_or_history(self):
        source = REVIEW_SOURCE.replace("\n", "\r\n")
        with reviewed_fixture({NEW_PATH: source.encode()}) as (updater, _archive, manifest, _path, plan, _manifest_path):
            self.assertEqual(plan["pending"][0]["sha256"], u.hashlib.sha256(source.encode()).hexdigest())
            self.assertEqual(plan["pending"][0]["sha256"], next(row["sha256"] for row in manifest["migrations"] if row["version"] == NEW_VERSION))

    def test_unattended_path_never_discovers_or_uses_an_existing_approval(self):
        with reviewed_fixture() as (updater, archive, manifest, path, _plan, manifest_path):
            with self.assertRaisesRegex(u.UpdateError, "migration_requires_operator_review"):
                updater.once(package=archive, manifest_path=manifest_path)
            self.assertTrue(path.exists())
            self.assertNotIn("backup", updater.calls)
            self.assertNotIn("consume-plan", updater.calls)
            self.assertEqual(updater.sql_sources, [])


class ReviewedFileTests(unittest.TestCase):
    def test_created_plan_and_consumed_record_have_exact_mode_despite_restrictive_umask(self):
        with reviewed_fixture() as (updater, _archive, _manifest, path, plan, _manifest_path):
            fresh_path = path.with_name("restrictive-umask.json")
            previous = os.umask(0o777)
            try:
                updater.write_reviewed_migration_plan(fresh_path, plan)
                self.assertEqual(updater.read_reviewed_migration_plan(fresh_path), plan)
                updater.consume_reviewed_migration_plan(plan)
            finally:
                os.umask(previous)
            consumed = path.parent / "used" / (plan["id"] + ".json")
            self.assertEqual(fresh_path.stat().st_mode & 0o777, 0o600)
            self.assertEqual(consumed.stat().st_mode & 0o777, 0o600)

    def test_requires_root_owned_private_single_link_regular_file_and_safe_directories(self):
        with reviewed_fixture() as (updater, _archive, _manifest, path, _plan, _manifest_path):
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with patch.object(u, "REVIEWED_ROOT_UID", os.geteuid() + 1), self.assertRaisesRegex(u.UpdateError, "unsafe_reviewed_plan_directory"):
                updater.read_reviewed_migration_plan(path)
            path.chmod(0o640)
            with self.assertRaisesRegex(u.UpdateError, "unsafe_reviewed_plan_file"):
                updater.read_reviewed_migration_plan(path)
            path.chmod(0o600)
            link = path.with_name("hardlink.json")
            os.link(path, link)
            with self.assertRaisesRegex(u.UpdateError, "unsafe_reviewed_plan_file"):
                updater.read_reviewed_migration_plan(path)
            link.unlink()
            link.symlink_to(path)
            with self.assertRaisesRegex(u.UpdateError, "unsafe_or_invalid"):
                updater.read_reviewed_migration_plan(link)
            path.parent.chmod(0o770)
            with self.assertRaisesRegex(u.UpdateError, "unsafe_reviewed_plan_directory"):
                updater.read_reviewed_migration_plan(path)

    def test_refuses_outside_paths_overwrites_duplicate_keys_and_unknown_fields(self):
        with reviewed_fixture() as (updater, _archive, _manifest, path, plan, _manifest_path):
            with self.assertRaisesRegex(u.UpdateError, "output_already_exists"):
                updater.write_reviewed_migration_plan(path, plan)
            with self.assertRaisesRegex(u.UpdateError, "private_updates_directory"):
                updater.read_reviewed_migration_plan(updater.control / "elsewhere.json")
            for content in ['{"format":"a","format":"b"}', json.dumps(dict(plan, surprise=True)), json.dumps(dict(plan, id="../escape")), json.dumps(dict(plan, id=12)), json.dumps(plan).replace('"branch": "main"', '"branch": NaN')]:
                path.write_text(content, encoding="utf8")
                with self.subTest(content=content[:60]), self.assertRaises(u.UpdateError):
                    updater.read_reviewed_migration_plan(path)

    def test_rejects_expired_future_unzoned_and_excessively_long_lifetimes(self):
        with reviewed_fixture() as (updater, _archive, _manifest, path, plan, _manifest_path):
            stamp = dt.datetime.now(dt.timezone.utc)
            for issued, expiry in [(stamp - dt.timedelta(hours=2), stamp - dt.timedelta(hours=1)), (stamp + dt.timedelta(minutes=1), stamp + dt.timedelta(minutes=2)), (stamp - dt.timedelta(seconds=1), stamp + dt.timedelta(hours=3)), (stamp.replace(tzinfo=None), stamp + dt.timedelta(minutes=5)), ("bad", "bad")]:
                changed = dict(plan, createdAt=issued.isoformat() if hasattr(issued, "isoformat") else issued, expiresAt=expiry.isoformat() if hasattr(expiry, "isoformat") else expiry)
                path.write_text(json.dumps(changed), encoding="utf8")
                with self.subTest(issued=issued), self.assertRaisesRegex(u.UpdateError, "expired_or_invalid_time"):
                    updater.read_reviewed_migration_plan(path)

    def test_binds_whole_manifest_instance_history_pending_and_current_commit(self):
        with reviewed_fixture() as (updater, archive, manifest, path, plan, _manifest_path), tempfile.TemporaryDirectory() as stage:
            u.unpack_verified(archive, manifest, stage)
            changes = [({"root": "/different"}, "instance"), ({"repository": "elsewhere"}, "instance"), ({"branch": "other"}, "instance"), ({"fromCommit": COMMIT}, "commit"), ({"targetCommit": OLD}, "commit"), ({"manifestSha256": "e" * 64}, "manifest"), ({"archiveSha256": "e" * 64}, "manifest"), ({"historySha256": "e" * 64}, "history_drift"), ({"applied": []}, "history_drift"), ({"pending": []}, "pending_mismatch")]
            for values, reason in changes:
                path.write_text(json.dumps(dict(plan, **values)), encoding="utf8")
                with self.subTest(values=values), self.assertRaisesRegex(u.UpdateError, reason):
                    updater.validate_reviewed_migration_plan(path, stage, manifest)
            path.write_text(json.dumps(plan), encoding="utf8")
            changed = copy.deepcopy(manifest)
            changed["runtime"]["reviewed"] = False
            with self.assertRaisesRegex(u.UpdateError, "manifest_mismatch"):
                updater.validate_reviewed_migration_plan(path, stage, changed)
            updater.state["currentCommit"] = "e" * 40
            with self.assertRaisesRegex(u.UpdateError, "commit_mismatch"):
                updater.validate_reviewed_migration_plan(path, stage, manifest)

    def test_operator_snapshot_rejects_duplicate_versions_missing_sources_and_bad_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "history.json"
            for data in ["{}", "not-json", json.dumps([{"version": OLD_VERSION}]), json.dumps([{"version": OLD_VERSION, "source": OLD_SOURCE}] * 2), json.dumps([{"version": OLD_VERSION, "source": None}])]:
                path.write_text(data, encoding="utf8")
                with self.subTest(data=data[:50]), self.assertRaisesRegex(u.UpdateError, "history_input"):
                    u.imported_history(path)
            path.write_text(json.dumps([{"version": OLD_VERSION, "source": OLD_SOURCE}]), encoding="utf8")
            self.assertEqual(u.imported_history(path), {OLD_VERSION: OLD_SOURCE})


class ReviewedLifecycleTests(unittest.TestCase):
    def test_bound_plan_tampering_and_live_input_drift_fail_before_backup_or_sql(self):
        """Only an intact, fresh plan for live inputs may reach checkpoint or SQL."""
        plan_mutations = [
            ({"root": "/different-instance"}, "instance"),
            ({"repository": "different-repository"}, "instance"),
            ({"branch": "different-branch"}, "instance"),
            ({"fromCommit": COMMIT}, "commit"),
            ({"targetCommit": OLD}, "commit"),
            ({"manifestSha256": "e" * 64}, "manifest"),
            ({"archiveSha256": "e" * 64}, "manifest"),
            ({"historySha256": "e" * 64}, "history"),
            ({"applied": []}, "history"),
            ({"pending": []}, "pending"),
        ]
        for changed, expected in plan_mutations:
            with self.subTest(changed=changed), reviewed_fixture() as (
                updater,
                archive,
                _manifest,
                path,
                plan,
                manifest_path,
            ):
                path.write_text(json.dumps(dict(plan, **changed)), encoding="utf8")
                with self.assertRaisesRegex(u.UpdateError, expected):
                    updater.once(
                        package=archive,
                        manifest_path=manifest_path,
                        reviewed_migration_plan=path,
                    )
                self.assertNotIn("backup", updater.calls)
                self.assertNotIn("consume-plan", updater.calls)
                self.assertEqual(updater.sql_sources, [])
                self.assertFalse(updater.maintenance.exists())

        live_input_changes = ["expired", "archive-bytes", "installed-history"]
        for changed in live_input_changes:
            with self.subTest(changed=changed), reviewed_fixture() as (
                updater,
                archive,
                _manifest,
                path,
                plan,
                manifest_path,
            ):
                if changed == "expired":
                    issued = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=2)
                    expired = issued + dt.timedelta(minutes=5)
                    path.write_text(
                        json.dumps(
                            dict(
                                plan,
                                createdAt=issued.isoformat(),
                                expiresAt=expired.isoformat(),
                            )
                        ),
                        encoding="utf8",
                    )
                elif changed == "archive-bytes":
                    Path(archive).write_bytes(Path(archive).read_bytes() + b"tampered")
                else:
                    updater.history[OLD_VERSION] += "-- installed history drift\n"

                with self.assertRaises(u.UpdateError):
                    updater.once(
                        package=archive,
                        manifest_path=manifest_path,
                        reviewed_migration_plan=path,
                    )
                self.assertNotIn("backup", updater.calls)
                self.assertNotIn("consume-plan", updater.calls)
                self.assertEqual(updater.sql_sources, [])
                self.assertFalse(updater.maintenance.exists())

    def test_plan_expiring_during_final_network_check_cannot_be_consumed(self):
        with reviewed_fixture() as (updater, archive, _manifest, path, plan, manifest_path), contextlib.ExitStack() as cleanup:
            expired = dt.datetime.fromisoformat(plan["expiresAt"]) + dt.timedelta(seconds=1)

            class ExpiredClock(dt.datetime):
                @classmethod
                def now(cls, tz=None):
                    return expired if tz else expired.replace(tzinfo=None)

            original = updater.verify_reviewed_release_identity
            calls = 0

            def slow_network(manifest):
                nonlocal calls
                original(manifest)
                calls += 1
                if calls == 2:
                    cleanup.enter_context(patch.object(u.dt, "datetime", ExpiredClock))

            updater.verify_reviewed_release_identity = slow_network
            with self.assertRaisesRegex(u.UpdateError, "expired_or_invalid_time"):
                updater.once(package=archive, manifest_path=manifest_path, reviewed_migration_plan=path)
            self.assertIn("restore-checkpoint", updater.calls)
            self.assertEqual(updater.sql_sources, [])
            self.assertFalse((path.parent / "used" / (plan["id"] + ".json")).exists())
            self.assertFalse(updater.maintenance.exists())

    def test_success_uses_normal_checkpoint_health_and_single_use_fencing(self):
        with reviewed_fixture() as (updater, archive, manifest, path, plan, manifest_path):
            result = updater.once(package=archive, manifest_path=manifest_path, reviewed_migration_plan=path)
            self.assertEqual(result, {"status": "updated", "commit": COMMIT, "mode": "full"})
            self.assertEqual(updater.calls.count("eligible-release"), 2)
            for before, after in [("fresh-complete-backup", "backup"), ("backup", "checkpoint"), ("checkpoint", "consume-plan"), ("consume-plan", "sql"), ("private-health", "public-health")]:
                self.assertLess(updater.calls.index(before), updater.calls.index(after))
            self.assertIn(REVIEW_SOURCE, updater.sql_sources[0])
            self.assertFalse(updater.maintenance.exists())
            consumed = updater.control / "reviewed-migrations/used" / (plan["id"] + ".json")
            self.assertEqual(consumed.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(consumed.read_text())["planSha256"], u.canonical_digest(plan))
            with self.assertRaisesRegex(u.UpdateError, "already_consumed"):
                updater.read_reviewed_migration_plan(path)
            copied = path.with_name("copied.json")
            copied.write_bytes(path.read_bytes())
            copied.chmod(0o600)
            with self.assertRaisesRegex(u.UpdateError, "already_consumed"):
                updater.read_reviewed_migration_plan(copied)

    def test_requires_explicit_local_release_and_host_lock(self):
        with reviewed_fixture() as (updater, archive, manifest, path, _plan, _manifest_path):
            with self.assertRaisesRegex(u.UpdateError, "explicit_local_release"):
                updater.once(reviewed_migration_plan=path)
            with self.assertRaisesRegex(u.UpdateError, "host_maintenance_lock"):
                updater.apply(archive, manifest, reviewed_migration_plan=path)
            self.assertEqual(updater.sql_sources, [])

    def test_refuses_noneligible_or_locally_changed_release_before_downtime(self):
        for candidate in [{"status": "waiting_for_main_release", "commit": COMMIT}, {"status": "candidate", "commit": OLD}]:
            with self.subTest(candidate=candidate), reviewed_fixture() as (updater, archive, _manifest, path, _plan, manifest_path):
                updater.eligible = candidate
                with self.assertRaisesRegex(u.UpdateError, "eligible_current_main"):
                    updater.once(package=archive, manifest_path=manifest_path, reviewed_migration_plan=path)
                self.assertNotIn("backup", updater.calls)
        with reviewed_fixture() as (updater, archive, _manifest, path, _plan, manifest_path):
            updater.published["publicBuild"]["apiUrl"] += "/changed"
            with self.assertRaisesRegex(u.UpdateError, "differs_from_release"):
                updater.once(package=archive, manifest_path=manifest_path, reviewed_migration_plan=path)
            self.assertNotIn("backup", updater.calls)

    def test_missing_complete_backup_refuses_before_stopping_writers(self):
        with reviewed_fixture() as (updater, archive, _manifest, path, _plan, manifest_path):
            updater.backup_is_fresh = False
            with self.assertRaisesRegex(u.UpdateError, "fresh_complete_backup"):
                updater.once(package=archive, manifest_path=manifest_path, reviewed_migration_plan=path)
            self.assertNotIn("backup", updater.calls)
            self.assertFalse(updater.maintenance.exists())
            self.assertEqual(updater.sql_sources, [])

    def test_real_verified_backup_helper_is_required_and_checks_26_hour_freshness(self):
        helper = b"class CompleteBackup:\n def __init__(self,root): self.root=root\n def fresh(self,*,max_age_hours):\n  assert max_age_hours==26\n  return False\n"
        path = "deploy/hostinger/backups/complete_backup.py"
        with reviewed_fixture({path: helper}) as (updater, archive, manifest, _path, _plan, _manifest_path), tempfile.TemporaryDirectory() as stage:
            u.unpack_verified(archive, manifest, stage)
            with self.assertRaisesRegex(u.UpdateError, "fresh_complete_backup"):
                u.Updater.require_fresh_complete_backup(updater, stage)
            (Path(stage) / path).unlink()
            with self.assertRaisesRegex(u.UpdateError, "missing_verified_complete_backup_helper"):
                u.Updater.require_fresh_complete_backup(updater, stage)

    def test_consumption_persistence_failure_never_reaches_sql_and_cannot_replay(self):
        with reviewed_fixture() as (updater, archive, _manifest, path, _plan, manifest_path):
            persist = u.fsync_directory

            def interrupted(directory):
                if Path(directory).name == "used":
                    raise OSError("fictional fsync failure")
                persist(directory)

            with patch.object(u, "fsync_directory", side_effect=interrupted), self.assertRaisesRegex(u.UpdateError, "unexpected_update_failure"):
                updater.once(package=archive, manifest_path=manifest_path, reviewed_migration_plan=path)
            self.assertEqual(updater.sql_sources, [])
            self.assertIn("restore-checkpoint", updater.calls)
            with self.assertRaisesRegex(u.UpdateError, "already_consumed"):
                updater.read_reviewed_migration_plan(path)

    def test_history_or_main_drift_after_checkpoint_rolls_back_before_consumption(self):
        for kind in ["history", "main", "plan"]:
            with self.subTest(kind=kind), reviewed_fixture() as (updater, archive, _manifest, path, plan, manifest_path):
                def change():
                    if kind == "history":
                        updater.history[OLD_VERSION] += "-- changed while backing up"
                    elif kind == "main":
                        updater.eligible = {"status": "candidate", "commit": OLD}
                    else:
                        changed = dict(plan, id=str(u.uuid.uuid4()))
                        path.write_text(json.dumps(changed), encoding="utf8")

                updater.after_checkpoint = change
                with self.assertRaises(u.UpdateError):
                    updater.once(package=archive, manifest_path=manifest_path, reviewed_migration_plan=path)
                self.assertIn("restore-checkpoint", updater.calls)
                self.assertNotIn("consume-plan", updater.calls)
                self.assertEqual(updater.sql_sources, [])
                self.assertFalse(updater.maintenance.exists())

    def test_rollback_does_not_reactivate_consumed_plan_and_retry_needs_fresh_exact_sha(self):
        with reviewed_fixture() as (updater, archive, manifest, path, _plan, manifest_path):
            updater.fail_health_once = True
            with self.assertRaisesRegex(u.UpdateError, "static_release_health_failed"):
                updater.once(package=archive, manifest_path=manifest_path, reviewed_migration_plan=path)
            self.assertIn("restore-checkpoint", updater.calls)
            self.assertTrue(updater.state["automaticRollbackCompleted"])
            self.assertEqual(updater.state["currentCommit"], OLD)
            self.assertEqual(updater.state["failedCommit"], COMMIT)
            self.assertFalse(updater.maintenance.exists())
            with self.assertRaisesRegex(u.UpdateError, "already_consumed"):
                updater.once(package=archive, manifest_path=manifest_path, reviewed_migration_plan=path, retry_failed=True)
            fresh = updater.make_reviewed_migration_plan(archive, manifest)
            fresh_path = path.with_name("fresh-review.json")
            updater.write_reviewed_migration_plan(fresh_path, fresh)
            updater.state["failedCommit"] = OLD
            u.atomic_json(updater.state_file, updater.state)
            with self.assertRaisesRegex(u.UpdateError, "exact_failed_commit"):
                updater.once(package=archive, manifest_path=manifest_path, reviewed_migration_plan=fresh_path, retry_failed=True)
            updater.state["failedCommit"] = COMMIT
            u.atomic_json(updater.state_file, updater.state)
            self.assertEqual(updater.once(package=archive, manifest_path=manifest_path, reviewed_migration_plan=fresh_path, retry_failed=True)["status"], "updated")


class ReviewedLockAndCliTests(unittest.TestCase):
    def test_global_lock_rejects_another_process_and_retains_inherited_lock(self):
        with reviewed_fixture() as (updater, _archive, _manifest, _path, _plan, _manifest_path):
            u.MAINTENANCE_LOCK.touch(mode=0o600, exist_ok=False)
            child = subprocess.Popen([sys.executable, "-c", "import fcntl,sys; f=open(sys.argv[1],'w'); fcntl.flock(f,fcntl.LOCK_EX); print('held',flush=True); sys.stdin.read()", str(u.MAINTENANCE_LOCK)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
            try:
                self.assertEqual(child.stdout.readline().strip(), "held")
                with self.assertRaisesRegex(u.UpdateError, "another_host_maintenance_running"):
                    with updater.reviewed_host_lock():
                        self.fail("must not acquire busy host lock")
            finally:
                child.communicate("")
            descriptor = os.open(u.MAINTENANCE_LOCK, os.O_RDWR)
            try:
                u.fcntl.flock(descriptor, u.fcntl.LOCK_EX)
                with updater.reviewed_host_lock():
                    self.assertTrue(updater._reviewed_global_lock_held)
                # A separate open-file-description still cannot acquire the
                # caller's retained lock after the reviewed context closes.
                other = os.open(u.MAINTENANCE_LOCK, os.O_RDWR)
                try:
                    with self.assertRaises(BlockingIOError):
                        u.fcntl.flock(other, u.fcntl.LOCK_EX | u.fcntl.LOCK_NB)
                finally:
                    os.close(other)
            finally:
                os.close(descriptor)

    def test_unlocked_duplicate_fd_is_not_mistaken_for_an_inherited_lock(self):
        with reviewed_fixture() as (updater, _archive, _manifest, _path, _plan, _manifest_path):
            unrelated = os.open(u.MAINTENANCE_LOCK, os.O_RDWR | os.O_CREAT, 0o600)
            try:
                with updater.reviewed_host_lock():
                    with self.assertRaises(BlockingIOError):
                        u.fcntl.flock(unrelated, u.fcntl.LOCK_EX | u.fcntl.LOCK_NB)
                u.fcntl.flock(unrelated, u.fcntl.LOCK_EX | u.fcntl.LOCK_NB)
            finally:
                os.close(unrelated)

    def test_offline_cli_prints_reviewable_plan_without_any_instance_mutation(self):
        with reviewed_fixture() as (updater, archive, _manifest, _path, _plan, manifest_path):
            history = archive.parent / "history.json"
            history.write_text(json.dumps([{"version": OLD_VERSION, "source": OLD_SOURCE}]), encoding="utf8")
            empty_root = archive.parent / "not-created-instance"
            args = ["updater", "--plan-migrations", "--root", str(empty_root), "--package", str(archive), "--manifest", str(manifest_path), "--history-file", str(history), "--installed-commit", OLD]
            output = io.StringIO()
            with patch.object(sys, "argv", args), contextlib.redirect_stdout(output):
                self.assertEqual(u.main(), 0)
            result = json.loads(output.getvalue())
            self.assertEqual(result["status"], "migration_plan")
            self.assertEqual(result["plan"]["fromCommit"], OLD)
            self.assertFalse(empty_root.exists())
            self.assertNotIn("backup", updater.calls)

    def test_cli_rejects_ambiguous_plan_and_apply_option_combinations(self):
        cases = [["--once", "--reviewed-migration-plan", "x"], ["--check", "--plan-output", "x"], ["--once", "--history-file", "x"], ["--plan-migrations", "--package", "x", "--manifest", "y", "--history-file", "z"], ["--plan-migrations", "--package", "x", "--manifest", "y", "--retry-failed"], ["--once", "--plan-ttl-seconds", "60"]]
        for args in cases:
            with self.subTest(args=args), patch.object(sys, "argv", ["updater", *args]), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                u.main()
            self.assertEqual(error.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
