"""Loopback-only tests for relay authentication, SMTP behavior, DNS safety and test status mapping."""

import asyncio
from dataclasses import replace
import http.client
import importlib.util
import json
import smtplib
import socket
import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, call, patch

spec = importlib.util.spec_from_file_location(
    "mail_relay", Path(__file__).with_name("mail-relay.py")
)
relay_module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = relay_module
spec.loader.exec_module(relay_module)

CONFIG = relay_module.RelayConfig(
    api_url="http://api-gw:8000/rest/v1",
    service_key="fictional-service-role-key",
    username="relay-abc123@internal.invalid",
    password="fictional-internal-relay-password",
    control_token="fictional-control-token-1234567890",
)
TEST_ID = "12345678-1234-4234-9234-123456789abc"


class RelayConfigTests(unittest.TestCase):
    """Validate generated service configuration and block local/private SMTP destinations."""

    def test_config_accepts_only_the_internal_api_gateway_and_required_secrets(self):
        env = {
            "PORTAL_MAIL_RELAY_API_URL": "http://api-gw:8000/rest/v1",
            "PORTAL_MAIL_RELAY_SERVICE_KEY": "fictional-service-key",
            "PORTAL_MAIL_RELAY_USERNAME": "relay-abc@internal.invalid",
            "PORTAL_MAIL_RELAY_PASSWORD": "fictional-password",
            "PORTAL_MAIL_RELAY_CONTROL_TOKEN": "fictional-control-token",
        }
        with patch.dict("os.environ", env, clear=True):
            self.assertEqual(
                relay_module.RelayConfig.from_environment().host_smtp_port,
                2526,
            )
        env["PORTAL_MAIL_RELAY_API_URL"] = "http://169.254.169.254:8000"
        with patch.dict("os.environ", env, clear=True):
            with self.assertRaises(RuntimeError):
                relay_module.RelayConfig.from_environment()

    def test_host_policy_rejects_local_names_ip_literals_and_reserved_suffixes(self):
        self.assertTrue(relay_module.valid_external_host("smtp.hostinger.com"))
        for host in (
                "127.0.0.1",
                "169.254.169.254",
                "localhost",
                "mail.local",
                "smtp.example.invalid",
                "mail.internal",
                "invalid..example.com",
        ):
            self.assertFalse(relay_module.valid_external_host(host), host)

    def test_dns_results_must_include_public_addresses(self):
        with patch.object(
                relay_module.socket,
                "getaddrinfo",
                return_value=[
                    (
                            socket.AF_INET,
                            socket.SOCK_STREAM,
                            socket.IPPROTO_TCP,
                            "",
                            ("127.0.0.1", 465),
                    )
                ],
        ):
            with self.assertRaises(relay_module.RelayFailure) as failure:
                relay_module.resolve_public_addresses("smtp.example.com", 465)
        self.assertEqual(failure.exception.code, "connect_failed")


class DevelopmentCaptureTests(unittest.TestCase):
    def test_only_explicit_auth_pending_route_uses_private_capture(self):
        relay = relay_module.MailRelay(replace(CONFIG, capture_auth_while_unconfigured=True))
        message = b"From: sender@example.invalid\r\n\r\nFictional test"
        with patch.object(relay, "rpc", return_value={"enabled": False}), \
             patch.object(relay_module.smtplib, "SMTP") as smtp:
            relay.deliver_auth(message, "recipient@example.invalid")
            smtp.assert_called_once_with("mailpit", 1025, timeout=CONFIG.connect_timeout)
            smtp.return_value.__enter__.return_value.sendmail.assert_called_once_with(
                "no-reply@example.invalid", ["recipient@example.invalid"], message)
            with self.assertRaises(relay_module.RelayFailure):
                relay.deliver(message, "recipient@example.invalid")

    def test_enabled_transport_is_selected_without_contacting_capture(self):
        relay = relay_module.MailRelay(replace(CONFIG, capture_auth_while_unconfigured=True))
        settings = {"enabled": True, "host": "smtp.hostinger.com", "username": "sender@example.com",
                    "password": "fictional-secret"}
        with patch.object(relay, "rpc", return_value=settings), \
             patch.object(relay, "deliver") as delivery:
            relay.deliver_auth(b"message", "recipient@example.invalid")
            delivery.assert_called_once_with(b"message", "recipient@example.invalid", settings=settings)


class RelaySmtpTests(unittest.TestCase):
    """Use a local async SMTP listener and mocked provider to avoid all external mail."""

    def setUp(self):
        self.relay = relay_module.MailRelay(CONFIG)

    def run_smtp_client(self, deliver, username=None, password=None, message=None):
        self.relay.deliver = deliver

        async def server_flow():
            server = await asyncio.start_server(
                self.relay.handle_smtp,
                host="127.0.0.1",
                port=0,
                limit=relay_module.MAX_COMMAND_BYTES + 2,
            )
            port = server.sockets[0].getsockname()[1]
            try:
                def send():
                    with smtplib.SMTP("127.0.0.1", port, timeout=3) as connection:
                        connection.login(
                            username or CONFIG.username,
                            password or CONFIG.password,
                        )
                        return connection.sendmail(
                            "untrusted-sender@example.invalid",
                            ["student@example.invalid"],
                            message or ("From: Wrong Sender <attacker@example.invalid>\r\n"
                            "To: Student <student@example.invalid>\r\n"
                            "Subject: Fictional relay test\r\n\r\nFictional message\r\n"),
                        )

                return await asyncio.to_thread(send)
            finally:
                server.close()
                await server.wait_closed()

        return asyncio.run(server_flow())

    def test_authenticated_smtp_forwards_one_recipient_to_the_private_transport(self):
        deliver = Mock()
        self.assertEqual(self.run_smtp_client(deliver), {})
        deliver.assert_called_once()
        message, recipient = deliver.call_args.args
        self.assertEqual(recipient, "student@example.invalid")
        self.assertIn(b"From: Wrong Sender", message)

    def test_invalid_credentials_cannot_reach_delivery(self):
        deliver = Mock()
        with self.assertRaises(smtplib.SMTPAuthenticationError):
            self.run_smtp_client(deliver, password="wrong-fictional-password")
        deliver.assert_not_called()

    def test_academy_listener_requires_current_single_use_ticket_before_provider_envelope(self):
        self.relay = relay_module.MailRelay(replace(CONFIG, academy_notifications=True))
        self.relay.current_transport = Mock(return_value={
            "enabled": True, "host": "smtp.example.com", "port": 465, "version": 2,
            "security": "implicit_tls", "username": "sender@example.com",
            "password": "fictional-upstream-password", "sender_email": "sender@example.com",
            "sender_name": "Fictional Academy",
        })
        ticket = "abcdef12-3456-7890-1234-567890abcdef"
        raw = ("From: Private worker <relay@example.invalid>\r\n"
               "To: student@example.invalid\r\n"
               "Subject: New course alert\r\n"
               f"X-Luminovia-Notification-Lease: {TEST_ID} {ticket}\r\n\r\n"
               "Open your fictional academy inbox.\r\n")
        self.relay.rpc = Mock(side_effect=[False, True])
        upstream = Mock()
        upstream.ehlo.return_value = (250, b"OK")
        upstream.mail.return_value = (250, b"OK")
        upstream.rcpt.return_value = (250, b"OK")
        upstream.data.return_value = (250, b"OK")
        with patch.object(relay_module, "PinnedSMTPSSL", return_value=upstream):
            with self.assertRaises(smtplib.SMTPDataError) as no_lease:
                self.run_smtp_client(self.relay.deliver)
            self.assertEqual(no_lease.exception.smtp_code, 550)
            with self.assertRaises(smtplib.SMTPDataError) as revoked:
                self.run_smtp_client(self.relay.deliver, message=raw)
            self.assertEqual(revoked.exception.smtp_code, 550)
            upstream.mail.assert_not_called()
            upstream.rcpt.assert_not_called()
            upstream.data.assert_not_called()
            self.assertEqual(self.run_smtp_client(self.relay.deliver, message=raw), {})
        self.relay.rpc.assert_called_with("authorize_academy_notification_email", {
            "p_id": TEST_ID, "p_lease_token": ticket, "p_recipient": "student@example.invalid",
            "p_transport_version": 2,
        })
        upstream.mail.assert_called_once_with("sender@example.com")
        self.assertNotIn(b"X-Luminovia-Notification-Lease", upstream.data.call_args.args[0])
        self.assertNotIn(ticket.encode(), upstream.data.call_args.args[0])

    def test_delivery_rewrites_sender_before_provider_submission(self):
        settings = {
            "enabled": True,
            "host": "smtp.example.com",
            "port": 465,
            "security": "implicit_tls",
            "username": "mailbox@example.com",
            "password": "fictional-upstream-secret",
            "sender_email": "mailbox@example.com",
            "sender_name": "Fictional Academy",
        }

        class FakeSMTP:
            instance = None

            def __init__(self, *_args, **_kwargs):
                self.__class__.instance = self

            def ehlo(self): return 250, b"OK"

            def login(self, _username, _password): return 235, b"OK"

            def mail(self, sender):
                self.sender = sender
                return 250, b"OK"

            def rcpt(self, _recipient): return 250, b"OK"

            def data(self, message):
                self.message = message
                return 250, b"OK"

            def close(self): pass

        self.relay.current_transport = Mock(return_value=settings)
        raw = (
            b"From: Attacker <attacker@example.invalid>\r\n"
            b"To: student@example.invalid\r\nSubject: Fictional\r\n\r\nBody\r\n"
        )
        with patch.object(relay_module, "PinnedSMTPSSL", FakeSMTP):
            self.relay.deliver(raw, "student@example.invalid")
        self.assertEqual(FakeSMTP.instance.sender, "mailbox@example.com")
        self.assertIn(b"From: Fictional Academy <mailbox@example.com>", FakeSMTP.instance.message)
        self.assertNotIn(b"attacker@example.invalid", FakeSMTP.instance.message)

    def test_version_bound_connection_check_records_only_allowlisted_status(self):
        self.relay.rpc = Mock(
            side_effect=[
                {
                    "status": "running",
                    "protocol": "smtp",
                    "host": "smtp.example.com",
                    "port": 465,
                    "security": "implicit_tls",
                    "username": "mailbox@example.com",
                    "password": "fictional-upstream-secret",
                },
                True,
            ]
        )
        self.relay.check_smtp = Mock()
        self.assertEqual(
            self.relay.test_connection(TEST_ID),
            {"status": "succeeded", "error_code": None},
        )
        self.relay.check_smtp.assert_called_once()
        self.assertEqual(
            self.relay.rpc.call_args_list[1].args,
            (
                "complete_mail_connection_test",
                {
                    "p_test_id": TEST_ID,
                    "p_success": True,
                    "p_error_code": None,
                },
            ),
        )

    def test_smtp_self_test_delivers_once_with_claimed_settings_and_fixed_content(self):
        claim = {
            "status": "running",
            "protocol": "smtp",
            "host": "smtp.example.com",
            "port": 465,
            "security": "implicit_tls",
            "username": "mailbox@example.com",
            "password": "fictional-upstream-secret",
            "sender_email": "mailbox@example.com",
        }
        self.relay.rpc = Mock(side_effect=[claim, True, {"status": "failed"}])
        self.relay.deliver = Mock()
        self.relay.check_smtp = Mock()
        recipient = "administrator@example.invalid"
        self.assertEqual(self.relay.test_connection(TEST_ID, recipient)["status"], "succeeded")
        self.assertEqual(self.relay.test_connection(TEST_ID, recipient)["status"], "failed")
        self.relay.deliver.assert_called_once()
        message, address = self.relay.deliver.call_args.args
        self.assertEqual(address, recipient)
        self.assertIn(b"Subject: Portal SMTP-Test / SMTP test", message)
        self.assertNotIn(claim["password"].encode(), message)
        self.assertEqual(self.relay.deliver.call_args.kwargs["settings"]["sender_email"], claim["sender_email"])
        self.relay.check_smtp.assert_not_called()

    def test_claimed_imap_probe_must_remain_current_through_completion(self):
        claim = {
            "status": "running",
            "protocol": "imap",
            "host": "imap.example.com",
            "port": 993,
            "security": "implicit_tls",
            "username": "mailbox@example.com",
            "password": "fictional-upstream-secret",
        }
        self.relay.check_imap = Mock()
        self.relay.rpc = Mock(side_effect=[claim, False])
        self.assertEqual(
            self.relay.test_connection(TEST_ID),
            {"status": "failed", "error_code": "configuration_changed"},
        )
        self.relay.check_imap.assert_called_once_with(claim)

    def test_smtp_connection_check_authenticates_without_mail_commands(self):
        connection = Mock()
        connection.noop.return_value = (250, b"provider response")
        settings = {
            "host": "smtp.example.com",
            "port": 465,
            "security": "implicit_tls",
            "username": "mailbox@example.com",
            "password": "fictional-upstream-secret",
        }
        with patch.object(relay_module, "PinnedSMTPSSL", return_value=connection):
            self.relay.check_smtp(settings)
        self.assertEqual(
            connection.mock_calls,
            [
                call.login(settings["username"], settings["password"]),
                call.noop(),
                call.close(),
            ],
        )

    def test_implicit_tls_wraps_the_pinned_socket_with_the_original_hostname(self):
        context = Mock()
        raw = Mock()
        connector = relay_module.PinnedSMTPSSL(timeout=3, context=context)
        with patch.object(relay_module, "pinned_socket", return_value=raw) as pinned:
            secured = connector._get_socket("smtp.example.com", 465, 3)
        pinned.assert_called_once_with("smtp.example.com", 465, 3)
        context.wrap_socket.assert_called_once_with(raw, server_hostname="smtp.example.com")
        self.assertIs(secured, context.wrap_socket.return_value)

    def test_smtp_probe_authenticates_only_after_starttls_and_fresh_greeting(self):
        settings = {
            "host": "smtp.example.com",
            "port": 2525,
            "security": "starttls",
            "username": "fictional-provider-login",
            "password": "fictional-upstream-secret",
        }
        for after_tls in (250, 421):
            with self.subTest(after_tls=after_tls):
                connection = Mock()
                connection.ehlo.side_effect = [(250, b""), (after_tls, b"")]
                connection.noop.return_value = (250, b"")
                with (
                    patch.object(relay_module, "PinnedSMTP", return_value=connection) as connector,
                    patch.object(relay_module.ssl, "create_default_context") as context,
                ):
                    calls = [call.ehlo(), call.has_extn("starttls"),
                             call.starttls(context=context.return_value), call.ehlo()]
                    if after_tls == 250:
                        self.relay.check_smtp(settings)
                        calls.extend([call.login(settings["username"], settings["password"]),
                                      call.noop()])
                    else:
                        with self.assertRaisesRegex(relay_module.RelayFailure, "protocol_failed"):
                            self.relay.check_smtp(settings)
                    connector.assert_called_once_with(
                        "smtp.example.com", 2525, timeout=self.relay.config.connect_timeout
                    )
                    self.assertEqual(connection.mock_calls, [*calls, call.close()])


class RelayControlTests(unittest.TestCase):
    """Exercise the internal test endpoint with local HTTP and no database or provider access."""

    def test_control_endpoint_requires_token_and_bounds_its_request(self):
        relay = Mock()
        relay.connection_test_http.return_value = {
            "status": "failed",
            "error_code": "authentication_failed",
        }
        handler = type(
            "TestControlHandler",
            (relay_module.ControlHandler,),
            {"relay": relay, "control_token": "fictional-control-token"},
        )
        server = relay_module.ThreadedControlServer(("127.0.0.1", 0), handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            port = server.server_address[1]
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
            connection.request(
                "POST",
                "/connection-test",
                body=json.dumps({"test_id": TEST_ID}),
                headers={"Content-Type": "application/json"},
            )
            self.assertEqual(connection.getresponse().status, 401)
            connection.close()

            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
            connection.request(
                "POST",
                "/connection-test",
                body=json.dumps({"test_id": TEST_ID}),
                headers={
                    "Authorization": "Bearer fictional-control-token",
                    "Content-Type": "application/json",
                },
            )
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertEqual(
                json.loads(response.read()),
                {"status": "failed", "error_code": "authentication_failed"},
            )
            connection.close()
            relay.connection_test_http.assert_called_once_with(TEST_ID, None)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()
