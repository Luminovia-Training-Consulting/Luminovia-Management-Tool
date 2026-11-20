"""Loopback-only tests for relay authentication, SMTP behavior, DNS safety and test status mapping."""

import asyncio
import http.client
import importlib.util
import json
import smtplib
import socket
import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

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


class RelaySmtpTests(unittest.TestCase):
    """Use a local async SMTP listener and mocked provider to avoid all external mail."""

    def setUp(self):
        self.relay = relay_module.MailRelay(CONFIG)

    def run_smtp_client(self, deliver, username=None, password=None):
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
                            "From: Wrong Sender <attacker@example.invalid>\r\n"
                            "To: Student <student@example.invalid>\r\n"
                            "Subject: Fictional relay test\r\n\r\nFictional message\r\n",
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
                    "enabled": True,
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
            relay.connection_test_http.assert_called_once_with(TEST_ID)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == "__main__":
    unittest.main()