# Temporäre Installationen prüfen echte Kopien und Verzeichnistausch samt injizierten Prozessfehlern. Kritisch ist der Erhalt beider Datenstände, wenn Wiederherstellung oder erneute Healthprüfung scheitern.
"""Offline real-copy/rename recovery tests; no running Docker or VPS targeted."""

import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import atomic_recovery as recovery


# Eigener Dateisystembestand für Verzeichnistausch und Rückkehr; Prozessaufrufe werden gezielt protokolliert/injiziert.
class Installation:
    def __init__(self, directory):
        self.root = Path(directory) / "instance"
        self.root.mkdir(mode=0o700)
        (self.root / "www").mkdir()
        (self.root / "www/maintenance.enabled").write_text("closed for fictional test")
        backup = self.root / "private/update-backups/fictional"
        backup.mkdir(parents=True, mode=0o700)
        manifest = backup / "manifest.json"
        manifest.write_text(json.dumps({"status": "complete", "createdAt": dt.datetime.now(dt.timezone.utc).isoformat()}))
        manifest.chmod(0o600)
        self.state = {"lastBackup": str(backup)}
        self.docker = self.root / "docker"
        self.docker.mkdir()
        self.calls = []
        self.running = {recovery._container(recovery.BACKEND, name): False for name in recovery.WRITERS}
        self.paused = {}
        self.mounts = {}
        self.paths = {}
        self.volume_labels = {}
        self.wrong_owner = False
        self.fail_copy = False
        for identity, project, service, destination, kind, value in (*recovery.MOUNTS, recovery.CLAMAV):
            name = recovery._container(project, service)
            if name not in self.running:
                self.running[name] = True
            self.paused[name] = False
            source = self.root / value if kind == "bind" else self.docker / "volumes" / (project + "_" + value) / "_data"
            source.mkdir(parents=True)
            (source / "state.bin").write_bytes(("fictional preupdate " + identity).encode())
            entry = {"Destination": destination, "Source": str(source), "Type": kind}
            if kind == "volume":
                entry["Name"] = project + "_" + value
                self.volume_labels[entry["Name"]] = {"project": project, "volume": value}
            self.mounts.setdefault(name, []).append(entry)
            self.paths[identity] = source

    # Führt den übergebenen Prozess ohne Shell aus und übernimmt einen echten Fehlerstatus.
    def command(self, args, **kwargs):
        self.calls.append(tuple(args))
        if args[:2] == ["docker", "info"]:
            return str(self.docker).encode()
        if args[:2] == ["docker", "inspect"]:
            expression, name = args[-2:]
            if "com.docker.compose.project" in expression:
                return ("unexpected-project" if self.wrong_owner else recovery.BACKEND if name.startswith(recovery.BACKEND + "-") else recovery.WEB).encode()
            if expression == "{{json .Mounts}}":
                return json.dumps(self.mounts[name]).encode()
            if expression == "{{.State.Running}}":
                return str(self.running[name]).lower().encode()
            if expression == "{{.State.Paused}}":
                return str(self.paused[name]).lower().encode()
        if args[:3] == ["docker", "volume", "inspect"]:
            label = "project" if ".project" in args[-2] else "volume"
            return self.volume_labels[args[-1]][label].encode()
        if args[:2] == ["docker", "pause"]:
            self.paused[args[-1]] = True
            return b""
        if args[:2] == ["docker", "unpause"]:
            self.paused[args[-1]] = False
            return b""
        if args[0] == "cp":
            if self.fail_copy:
                raise RuntimeError("fictional copy failed")
            if Path(args[-2]).resolve() in self.paths.values():
                assert not self.running[recovery._container(recovery.BACKEND, "db")]
                assert not self.running[recovery._container(recovery.BACKEND, "mailpit")]
                assert self.paused[recovery._container(recovery.WEB, "web")]
            subprocess.run(args, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            return b""
        raise AssertionError("Unexpected fake command")

    def compose(self, kind, args):
        self.calls.append(("compose", kind, *args))
        project = recovery.BACKEND if kind == "backend" else recovery.WEB
        names = [name for name in args[1:] if not name.startswith("-")]
        for name in names:
            self.running[recovery._container(project, name)] = args[0] == "up"
        return b"{}"

    def restart_old(self, include_clamav=False):
        self.compose("backend", ["up", "-d", "--wait", "--force-recreate", "--no-deps", "db", "mailpit", *recovery.WRITERS])
        self.compose("web", ["up", "-d", "--wait", "--force-recreate", "--no-deps", "web", *(("clamav",) if include_clamav else ())])


# Prüft echten physischen Dateierhalt und die geschlossene API-Grenze bei jeder simulierten Wiederherstellungsstörung.
class AtomicRecoveryTests(unittest.TestCase):
    def test_real_copy_and_directory_swap_restore_pg_keys_storage_mailpit_and_preserve_failed_data(self):
        with tempfile.TemporaryDirectory() as directory:
            updater = Installation(directory)
            initial = {name: recovery.tree_fingerprint(path) for name, path in updater.paths.items()}
            checkpoint = recovery.create_checkpoint(updater)
            self.assertEqual(checkpoint, Path(updater.state["lastBackup"]) / "rollback-state")
            self.assertEqual((checkpoint / "manifest.json").stat().st_mode & 0o777, 0o600)
            self.assertEqual(checkpoint.stat().st_mode & 0o777, 0o700)
            self.assertTrue(updater.running[recovery._container(recovery.BACKEND, "db")])
            self.assertTrue(updater.running[recovery._container(recovery.BACKEND, "mailpit")])
            self.assertFalse(updater.paused[recovery._container(recovery.WEB, "web")])
            for name, path in updater.paths.items():
                if name == "clamav-signatures":
                    continue
                (path / "state.bin").write_bytes(b"failed candidate data")
                (path / "candidate-only.bin").write_bytes(b"preserve this private failure evidence")
            calls = []
            def restart():
                calls.append("restart")
                updater.restart_old()
            def healthy():
                self.assertEqual(calls, ["restart"])
                for name, path in updater.paths.items():
                    self.assertEqual(recovery.tree_fingerprint(path), initial[name])
                calls.append("health")
            result = recovery.restore_checkpoint(updater, checkpoint, public_unblocked=False, restart_old_runtime=restart, verify_health=healthy)
            self.assertEqual(result["status"], "restored")
            self.assertEqual(calls, ["restart", "health"])
            self.assertTrue((updater.root / "www/maintenance.enabled").exists())
            for name in initial:
                if name != "clamav-signatures":
                    self.assertEqual((checkpoint / "failed-state" / name / "state.bin").read_bytes(), b"failed candidate data")
                    self.assertTrue((checkpoint / "failed-state" / name / "candidate-only.bin").exists())
            self.assertFalse(any("clamav" in " ".join(call) for call in updater.calls))

    def test_changed_clamav_alone_is_paused_and_its_signatures_can_be_restored(self):
        with tempfile.TemporaryDirectory() as directory:
            updater = Installation(directory)
            old = (updater.paths["clamav-signatures"] / "state.bin").read_bytes()
            checkpoint = recovery.create_checkpoint(updater, include_clamav=True)
            self.assertIn(("docker", "pause", "luminovia-portal-clamav-1"), updater.calls)
            self.assertIn(("docker", "unpause", "luminovia-portal-clamav-1"), updater.calls)
            (updater.paths["clamav-signatures"] / "state.bin").write_bytes(b"candidate signatures")
            recovery.restore_checkpoint(updater, checkpoint, public_unblocked=False, restart_old_runtime=lambda: updater.restart_old(True), verify_health=lambda: None)
            self.assertEqual((updater.paths["clamav-signatures"] / "state.bin").read_bytes(), old)

    def test_public_unblock_corrupt_checkpoint_and_consumed_checkpoint_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            updater = Installation(directory)
            checkpoint = recovery.create_checkpoint(updater)
            updater.calls.clear()
            with self.assertRaisesRegex(recovery.RecoveryError, "forbidden_after_public"):
                recovery.restore_checkpoint(updater, checkpoint, public_unblocked=True, restart_old_runtime=lambda: None, verify_health=lambda: None)
            self.assertEqual(updater.calls, [])
            (checkpoint / "copies/storage/state.bin").write_bytes(b"corrupted snapshot")
            with self.assertRaisesRegex(recovery.RecoveryError, "checkpoint_corrupted"):
                recovery.restore_checkpoint(updater, checkpoint, public_unblocked=False, restart_old_runtime=lambda: None, verify_health=lambda: None)
            self.assertFalse(any(call[0] in {"cp", "compose"} for call in updater.calls))

    def test_snapshot_rejects_wrong_owner_running_writers_stale_backup_and_disk_pressure(self):
        for reason in ("owner", "writers", "backup", "disk"):
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as directory:
                updater = Installation(directory)
                if reason == "owner":
                    updater.wrong_owner = True
                elif reason == "writers":
                    updater.running["luminovia-supabase-auth-1"] = True
                elif reason == "backup":
                    manifest = Path(updater.state["lastBackup"]) / "manifest.json"
                    manifest.write_text(json.dumps({"status": "complete", "createdAt": "2000-01-01T00:00:00+00:00"}))
                context = patch.object(recovery.shutil, "disk_usage", return_value=shutil._ntuple_diskusage(1, 1, 0)) if reason == "disk" else patch.object(recovery, "MIN_FREE", recovery.MIN_FREE)
                with context, self.assertRaises(recovery.RecoveryError):
                    recovery.create_checkpoint(updater)
                self.assertFalse(any(call[0] in {"cp", "compose"} for call in updater.calls))

    def test_external_symlink_copy_failure_resume_old_services_without_modifying_live_data(self):
        for failure in ("symlink", "copy"):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory:
                updater = Installation(directory)
                if failure == "symlink":
                    (updater.paths["postgres"] / "external").symlink_to("../../outside")
                else:
                    updater.fail_copy = True
                original = (updater.paths["postgres"] / "state.bin").read_bytes()
                with self.assertRaises(Exception):
                    recovery.create_checkpoint(updater)
                self.assertEqual((updater.paths["postgres"] / "state.bin").read_bytes(), original)
                self.assertTrue(updater.running["luminovia-supabase-db-1"])
                self.assertTrue(updater.running["luminovia-supabase-mailpit-1"])
                self.assertFalse(updater.paused["luminovia-portal-web-1"])
                self.assertTrue((updater.root / "www/maintenance.enabled").exists())

    def test_private_health_failure_keeps_restored_data_and_failed_data_with_gate_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            updater = Installation(directory)
            checkpoint = recovery.create_checkpoint(updater)
            original = (updater.paths["postgres"] / "state.bin").read_bytes()
            (updater.paths["postgres"] / "state.bin").write_bytes(b"failed engine data")
            with self.assertRaisesRegex(recovery.RecoveryError, "private_health_failed"):
                recovery.restore_checkpoint(updater, checkpoint, public_unblocked=False, restart_old_runtime=updater.restart_old, verify_health=lambda: False)
            self.assertEqual((updater.paths["postgres"] / "state.bin").read_bytes(), original)
            self.assertEqual((checkpoint / "failed-state/postgres/state.bin").read_bytes(), b"failed engine data")
            self.assertTrue((updater.root / "www/maintenance.enabled").exists())
            with self.assertRaisesRegex(recovery.RecoveryError, "consumed_runtime_checkpoint"):
                recovery.restore_checkpoint(updater, checkpoint, public_unblocked=False, restart_old_runtime=updater.restart_old, verify_health=lambda: None)

    def test_failed_midway_directory_swap_undoes_moves_without_losing_either_data_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            updater = Installation(directory)
            checkpoint = recovery.create_checkpoint(updater)
            for name, path in updater.paths.items():
                if name != "clamav-signatures":
                    (path / "state.bin").write_bytes(b"preserve failed candidate")
            original_rename = os.rename
            failed_once = False
            def injected(source, destination):
                nonlocal failed_once
                if Path(source) == checkpoint / "restore-prepared/storage" and not failed_once:
                    failed_once = True
                    raise OSError("fictional swap failure")
                return original_rename(source, destination)
            with patch.object(recovery.os, "rename", side_effect=injected), self.assertRaisesRegex(recovery.RecoveryError, "restore_swap_failed"):
                recovery.restore_checkpoint(updater, checkpoint, public_unblocked=False, restart_old_runtime=lambda: self.fail("must not restart partial swap"), verify_health=lambda: self.fail("must not verify partial swap"))
            for name, path in updater.paths.items():
                if name != "clamav-signatures":
                    self.assertEqual((path / "state.bin").read_bytes(), b"preserve failed candidate")
                    self.assertTrue((checkpoint / "copies" / name / "state.bin").read_bytes().startswith(b"fictional preupdate"))
            self.assertEqual(json.loads((checkpoint / "manifest.json").read_text())["status"], "restore_swap_failed")
            self.assertTrue((updater.root / "www/maintenance.enabled").exists())


if __name__ == "__main__":
    unittest.main()
