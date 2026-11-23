"""Run the reset state machine against disposable directories only."""
import base64
from contextlib import nullcontext
import http.client
import importlib.util
import json
from pathlib import Path
import socket
import tempfile
import unittest
from threading import Thread
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


class WebResetTest(unittest.TestCase):
    token = "header.claims.signature"
    password = "fictional-current"
    replacement = "fictional-replacement"
    fields = {"confirmation": "RESET CONFIRM", "password": password, "newPassword": replacement}

    def request(self, *, method="POST", fields=None, headers=None):
        client, server = socket.socketpair()
        with client, server:
            client.settimeout(3)
            server.settimeout(3)
            handler = Thread(target=module.WebResetRequest, args=(server, "", None))
            handler.start()
            try:
                connection = http.client.HTTPConnection("cms.luminovia.org")
                connection.sock = client
                connection.request(method, module.WEB_PATH, json.dumps(self.fields if fields is None else fields), {
                    "Origin": module.ORIGIN, "Content-Type": "application/json",
                    "Authorization": "Bearer " + self.token, **(headers or {}),
                })
                response = connection.getresponse()
                self.assertEqual(response.getheader("Cache-Control"), "no-store")
                return response.status, json.loads(response.read())
            finally:
                handler.join(timeout=3)

    def test_discovery_and_success_use_the_private_socket(self):
        with patch.object(module, "apply_web_reset") as reset:
            self.assertEqual(self.request(method="GET"), (200, {"instance": module.ORIGIN}))
            reset.assert_not_called()
            self.assertEqual(self.request(), (200, {"status": "complete"}))
            reset.assert_called_once_with(self.token, self.password, self.replacement)

    def test_rejects_wrong_origin_host_confirmation_and_body_before_controller(self):
        with patch.object(module, "apply_web_reset") as reset:
            for headers in [
                {"Origin": "https://example.invalid"},
                {"Host": "example.invalid"},
                {"Authorization": "Bearer invalid"},
            ]:
                self.assertEqual(self.request(headers=headers)[0], 403)
            for fields in [
                {**self.fields, "confirmation": "DELETE"},
                {**self.fields, "newPassword": self.password},
                {**self.fields, "email": "different@example.invalid"},
                {**self.fields, "password": "x" * module.MAX_REQUEST},
            ]:
                self.assertEqual(self.request(fields=fields)[0], 400)
            reset.assert_not_called()

    def test_missing_backup_and_rejected_auth_are_never_reported_as_success(self):
        for failure, status, result in [
            (PermissionError(), 403, "denied"),
            (module.UpdateError("reviewed_migration_requires_fresh_complete_backup"), 412, "backup_required"),
            (module.UpdateError("reset_rollback_requires_operator"), 503, "unconfirmed"),
        ]:
            with patch.object(module, "apply_web_reset", side_effect=failure):
                self.assertEqual(self.request(), (status, {"status": result}))

    def test_different_password_identity_cannot_reset_the_browser_account(self):
        user, browser_session, password_session = uuid4(), uuid4(), uuid4()
        env = {"SUPABASE_PUBLISHABLE_KEY": "fictional"}
        email = "owner@example.invalid"
        with patch.object(module, "Updater") as updater, \
                patch.object(module, "instance_environment", return_value=env), \
                patch.object(module, "private_gateway", return_value="http://fictional"), \
                patch.object(module, "verified_identity", return_value=(user, browser_session, email)), \
                patch.object(module, "assert_current_admin") as authorized, \
                patch.object(module, "preflight", return_value=(env, "data", "release", [])), \
                patch.object(module, "authenticate", return_value=(uuid4(), password_session)) as authenticate, \
                patch.object(module, "reset") as reset:
            updater.return_value.reviewed_host_lock.return_value = nullcontext()
            with self.assertRaises(PermissionError):
                module.apply_web_reset(self.token, self.password, self.replacement)
            reset.assert_not_called()
            authenticate.assert_called_once_with(updater.return_value, env, email, self.password)
            self.assertEqual(authorized.call_count, 2)
            authorized.assert_called_with(updater.return_value, user, browser_session, fresh=False)
            authenticate.return_value = user, password_session
            module.apply_web_reset(self.token, self.password, self.replacement)
            reset.assert_called_once_with(updater.return_value, env, "data", [], (user, password_session),
                                          email, self.replacement)


if __name__ == "__main__":
    unittest.main()
