"""Run the reset state machine against disposable directories only."""
import base64
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from uuid import uuid4

spec = importlib.util.spec_from_file_location("reset_live", Path(__file__).with_name("reset-live.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class RecordedUpdater:
    def __init__(self, root):
        self.private = root / "private"
        self.private.mkdir()
        self.maintenance = root / "maintenance.enabled"
        self.state = {"currentCommit": "1" * 40}
        self.commands = []
        self.authorized = True

    def sql(self, statement):
        self.commands.append("authorize" if "auth.sessions" in statement else "reload")
        return "t" if self.authorized else "f"

    def compose(self, kind, args):
        self.commands.append((kind, args[0]))

    def health(self, env, *, private_api=False):
        self.commands.append("private-health" if private_api else "public-health")


class ResetTest(unittest.TestCase):
    def setUp(self):
        workspace = tempfile.TemporaryDirectory()
        self.addCleanup(workspace.cleanup)
        self.root = Path(workspace.name)
        self.data = self.root / "data"
        self.data.mkdir()
        for name in module.MOUNTS:
            path = self.data / name
            path.mkdir()
            (path / "old").write_text(name)
        self.updater = RecordedUpdater(self.root)
        self.actor = (uuid4(), uuid4())
        self.fake_backup = self.root / "off-site-encrypted"
        self.fake_backup.write_text("fixture")

    def perform(self, recreate):
        with patch.object(module, "recreate", side_effect=recreate):
            module.reset(self.updater, {}, self.data, [], self.actor, "owner@example.invalid", "synthetic")

    def state(self):
        return json.loads((self.updater.private / "reset-state.json").read_text())["status"]

    def test_reset_verifies_fresh_state_then_removes_all_previous_data(self):
        def build(*args):
            for name in module.MOUNTS:
                self.assertEqual(list((self.data / name).iterdir()), [])
                (self.data / name / "fresh").write_text(name)
            self.assertTrue(self.updater.maintenance.exists())

        self.perform(build)
        self.assertEqual(self.state(), "complete")
        self.assertFalse(self.updater.maintenance.exists())
        self.assertFalse(list(self.root.glob(".reset-data-*")))
        self.assertTrue(self.fake_backup.exists())
        self.assertTrue(all((self.data / name / "fresh").is_file() for name in module.MOUNTS))
        self.assertEqual(self.updater.commands,
                         ["authorize", ("backend", "stop"), "private-health", "public-health"])

    def test_failed_boot_restores_all_original_paths(self):
        def fail(*args):
            (self.data / "storage" / "partial").touch()
            raise module.UpdateError("failed_boot")

        with self.assertRaisesRegex(module.UpdateError, "failed_boot"):
            self.perform(fail)
        self.assertEqual(self.state(), "rolled_back")
        self.assertFalse(self.updater.maintenance.exists())
        self.assertTrue(all((self.data / name / "old").is_file() for name in module.MOUNTS))
        self.assertFalse((self.data / "storage" / "partial").exists())

    def test_fresh_password_identity_is_checked_without_factor_requests(self):
        user, session = self.actor
        claims = base64.urlsafe_b64encode(json.dumps({
            "sub": str(user), "session_id": str(session), "aal": "aal1",
        }).encode()).decode().rstrip("=")
        token = f"header.{claims}.signature"
        with patch.object(module, "private_gateway", return_value="http://fictional"), \
                patch.object(module, "auth_request", side_effect=[
                    {"access_token": token}, {"id": str(user)},
                ]) as request:
            self.assertEqual(
                module.authenticate(self.updater, {"SUPABASE_PUBLISHABLE_KEY": "fictional"},
                                    "owner@example.invalid", "synthetic"),
                self.actor,
            )
        self.assertEqual([call.args[2] for call in request.call_args_list],
                         ["/token?grant_type=password", "/user"])
        self.assertEqual(self.updater.commands, ["authorize"])

    def test_rechecks_live_admin_before_removing_data(self):
        self.updater.authorized = False
        with self.assertRaisesRegex(module.UpdateError, "current_administrator_required"):
            self.perform(lambda *args: self.fail("revoked actor reached reset"))
        self.assertTrue(all((self.data / name / "old").is_file() for name in module.MOUNTS))

    def test_scope_refuses_nested_mount_extra_entry_and_symlink(self):
        mountinfo = f"1 2 3:4 / {self.data}/storage/nested rw - tmpfs tmpfs rw"
        with self.assertRaisesRegex(module.UpdateError, "separate_data_mount"):
            module.check_mounts(self.data, mountinfo)
        (self.data / "unexpected").mkdir()
        with self.assertRaisesRegex(module.UpdateError, "unknown_data_entries"):
            module.check_mounts(self.data, "")
        (self.data / "unexpected").rmdir()
        (self.data / "storage").rename(self.root / "unrelated")
        (self.data / "storage").symlink_to(self.root / "unrelated")
        with self.assertRaisesRegex(module.UpdateError, "unsafe_data_path"):
            module.check_mounts(self.data, "")
        self.assertTrue((self.root / "unrelated" / "old").is_file())


if __name__ == "__main__":
    unittest.main()
