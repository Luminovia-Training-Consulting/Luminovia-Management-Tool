"""Real loopback HTTP/SMTP and deterministic failure tests; no external mail."""

import asyncio
import base64
import contextlib
import importlib.util
import io
import json
import smtplib
import socketserver
import ssl
import sys
import threading
import time
import unittest
from dataclasses import replace
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location(
    "notification_mail_worker", Path(__file__).with_name("notification-mail-worker.py")
)
worker = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = worker
spec.loader.exec_module(worker)

relay_spec = importlib.util.spec_from_file_location(
    "mail_relay", Path(__file__).with_name("mail-relay.py")
)
relay_module = importlib.util.module_from_spec(relay_spec)
sys.modules[relay_spec.name] = relay_module
relay_spec.loader.exec_module(relay_module)

IDENTITY = "12345678-1234-4234-8234-123456789abc"
TOKEN = "87654321-4321-4321-8321-cba987654321"
LEASE = {"id": IDENTITY, "lease_token": TOKEN}
DELIVERY = {
    **LEASE,
    "recipient": "fictional.recipient@example.invalid",
    "locale": "de",
    "kind": "claim_cancelled",
    "message_id": f"<luminovia-notification.{IDENTITY}@luminovia.org>",
}
ENV = {
    "PORTAL_NOTIFICATION_MAIL_ENABLED": "true",
    "PORTAL_NOTIFICATION_API_URL": "https://backend.example.invalid",
    "PORTAL_NOTIFICATION_APP_ORIGIN": "https://portal.example.invalid",
    "PORTAL_NOTIFICATION_SERVICE_KEY": "fictional-test-service-key",
    "PORTAL_NOTIFICATION_SMTP_PASSWORD": "fictional-password",
}


@contextlib.contextmanager
def server_context(server):
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


class SmtpServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, mode="accepted"):
        self.mode = mode
        self.messages = []
        self.commands = []
        super().__init__(("127.0.0.1", 0), SmtpHandler)


class SmtpHandler(socketserver.StreamRequestHandler):
    def handle(self):
        self.connection.settimeout(2)
        self.wfile.write(b"220 capture.example.invalid SMTP\r\n")
        auth = False
        while raw := self.rfile.readline():
            line = raw.decode("ascii", errors="replace").rstrip("\r\n")
            command = line.split(" ", 1)[0].upper()
            self.server.commands.append(command)
            if command in ("EHLO", "HELO"):
                self.wfile.write(b"250-capture.example.invalid\r\n250 AUTH PLAIN\r\n")
            elif command == "AUTH":
                auth = True
                self.wfile.write(b"235 authenticated\r\n")
            elif command == "MAIL":
                self.wfile.write(b"250 sender OK\r\n" if auth else b"530 auth required\r\n")
            elif command == "RCPT":
                if self.server.mode == "temporary_recipient":
                    self.wfile.write(b"450 try later private-address-and-secret\r\n")
                elif self.server.mode == "permanent_recipient":
                    self.wfile.write(b"550 recipient unavailable private-address\r\n")
                else:
                    self.wfile.write(b"250 recipient OK\r\n")
            elif command == "DATA":
                self.wfile.write(b"354 send body\r\n")
                data = bytearray()
                while (body := self.rfile.readline()) not in (b".\r\n", b""):
                    data.extend(body)
                self.server.messages.append(bytes(data))
                if self.server.mode == "ambiguous_data":
                    return
                if self.server.mode == "temporary_data":
                    self.wfile.write(b"451 explicitly rejected private details\r\n")
                else:
                    self.wfile.write(b"250 queued\r\n")
            elif command == "QUIT":
                self.wfile.write(b"221 goodbye\r\n")
                return
            else:
                self.wfile.write(b"250 OK\r\n")


class ProviderSmtp:
    def __init__(self, mode):
        self.mode = mode
        self.submissions = []
        self.closed = False

    def ehlo(self):
        return 250, b"OK"

    def login(self, _username, _password):
        if self.mode == "login_4xx":
            raise smtplib.SMTPAuthenticationError(454, b"private authentication detail")
        if self.mode == "login_5xx":
            raise smtplib.SMTPAuthenticationError(535, b"private authentication detail")
        return 235, b"OK"

    def mail(self, _sender):
        if self.mode == "sender_4xx":
            return 450, b"private mailbox address and provider detail"
        if self.mode == "sender_5xx":
            return 550, b"private mailbox address and provider detail"
        return 250, b"OK"

    def rcpt(self, _recipient):
        if self.mode == "recipient_4xx":
            return 450, b"private recipient address and provider detail"
        if self.mode == "recipient_5xx":
            return 550, b"private recipient address and provider detail"
        return 250, b"OK"

    def data(self, message):
        self.submissions.append(message)
        if self.mode == "data_4xx":
            return 451, b"private data detail"
        if self.mode in ("data_5xx", "data_5xx_close_failure"):
            return 550, b"private data detail"
        if self.mode == "data_lost":
            raise smtplib.SMTPServerDisconnected("private provider disconnect")
        if self.mode == "data_io_error":
            raise OSError("private provider transport detail")
        if self.mode == "data_command_rejection":
            raise smtplib.SMTPDataError(554, b"private DATA command detail")
        if self.mode == "data_unexpected":
            return 354, b"unexpected continuation after DATA"
        return 250, b"OK"

    def close(self):
        self.closed = True
        if self.mode == "data_5xx_close_failure":
            raise OSError("private socket cleanup detail")


class CaptureRpcHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers["Content-Length"]))
        self.server.requests.append((self.path, json.loads(body), dict(self.headers)))
        name = self.path.rsplit("/", 1)[-1]
        if name == "refresh_notification_reminders":
            response = 1
        elif name == "lease_notification_emails":
            response = [LEASE]
        elif name == "prepare_notification_email":
            response = DELIVERY
        elif name == "finish_notification_email":
            response = True
        else:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(response).encode())

    def log_message(self, *args):
        pass


class ConfigurationTests(unittest.TestCase):
    def test_ownership_bound_academy_routes(self):
        env = {**ENV, "PORTAL_NOTIFICATION_EDITION": "academy",
               "PORTAL_NOTIFICATION_API_URL": "http://api-gw:8000"}
        config = worker.Config.from_env(env)
        self.assertTrue(config.academy)
        self.assertEqual(config.smtp_host, "mail-relay")
        with self.assertRaises(worker.ConfigurationError):
            worker.Config.from_env({**env, "PORTAL_NOTIFICATION_API_URL": "https://foreign.example.invalid"})
        message = worker.make_message(config, {**DELIVERY, "kind": "chat_message"})
        self.assertEqual(message["X-Luminovia-Notification-Lease"], f"{IDENTITY} {TOKEN}")
        self.assertEqual(message["Message-ID"], f"<academy-notification.{IDENTITY}@portal.example.invalid>")
        self.assertIn("https://portal.example.invalid/notifications", message.get_content())
        self.assertNotIn("Luminovia", message["Subject"])
        rpc = Mock()
        rpc.call.side_effect = [[LEASE], DELIVERY, True]
        self.assertEqual(worker.run(config, rpc, lambda *_: ("accepted", None))["accepted"], 1)
        self.assertEqual([called.args[0] for called in rpc.call.call_args_list], [
            "lease_notification_emails", "prepare_notification_email", "finish_notification_email",
        ])

    def test_default_dry_run_performs_no_configuration_or_network_work(self):
        with patch.object(worker.Config, "from_env") as config, patch.object(worker, "run") as run:
            with contextlib.redirect_stdout(io.StringIO()) as output:
                self.assertEqual(worker.main([], {}), 0)
            self.assertIn("dry_run", output.getvalue())
            config.assert_not_called()
            run.assert_not_called()

    def test_disabled_or_nonliteral_true_performs_no_network_work(self):
        for enabled in (None, "false", "1", "TRUE"):
            env = {} if enabled is None else {"PORTAL_NOTIFICATION_MAIL_ENABLED": enabled}
            with self.subTest(enabled=enabled), patch.object(worker, "run") as run:
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(worker.main(["--run"], env), 0)
                run.assert_not_called()

    def test_config_check_does_not_lease_or_send(self):
        with patch.object(worker, "run") as run, contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(worker.main(["--check"], ENV), 0)
        run.assert_not_called()

    def test_config_errors_do_not_echo_values(self):
        env = {**ENV, "PORTAL_NOTIFICATION_SMTP_PORT": "my-private-password"}
        with contextlib.redirect_stderr(io.StringIO()) as output:
            self.assertEqual(worker.main(["--run"], env), 2)
        self.assertEqual(output.getvalue(), '{"status":"configuration_invalid"}\n')

    def test_reject_missing_credentials_and_plain_smtp(self):
        for change in (
                {"PORTAL_NOTIFICATION_SERVICE_KEY": ""},
                {"PORTAL_NOTIFICATION_SERVICE_KEY": "key\nheader"},
                {"PORTAL_NOTIFICATION_SMTP_PASSWORD": ""},
                {"PORTAL_NOTIFICATION_SMTP_PORT": "25"},
                {"PORTAL_NOTIFICATION_SMTP_USERNAME": "Name <address@example.invalid>"},
                {"PORTAL_NOTIFICATION_BATCH": "21"},
                {"PORTAL_NOTIFICATION_TIMEOUT_SECONDS": "21"},
        ):
            with self.subTest(change=change), self.assertRaises(worker.ConfigurationError):
                worker.Config.from_env({**ENV, **change})

    def test_https_and_exact_loopback_are_allowed(self):
        for url in ("https://api.example.invalid", "http://127.0.0.1:54321", "http://[::1]:54321"):
            self.assertEqual(worker.checked_url(url), url)
        self.assertEqual(worker.checked_url("https://cms.example.invalid/backend", allow_backend_path=True), "https://cms.example.invalid/backend")

    def test_reject_untrusted_urls_and_credentials(self):
        for url in (
                "http://api.example.invalid", "http://127.0.0.1.evil.invalid",
                "https://key:secret@api.example.invalid", "https://api.example.invalid?secret=x",
                "https://api.example.invalid#secret", "https://api.example.invalid/other",
                "https://api.example.invalid/\\other", "https://api.example.invalid\nsecret",
                "https://[broken", "https://api.example.invalid:bad", "",
        ):
            with self.subTest(url=url), self.assertRaises(worker.ConfigurationError):
                worker.checked_url(url)


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.config = worker.Config.from_env(ENV)

    def test_customer_order_receipts_link_to_company_portal_in_both_languages(self):
        for kind, locale, subject, body_text in (
            ("customer_order_submitted", "de", "Kursauftrag ist eingegangen", "erhalten"),
            ("customer_order_submitted", "en", "received your course order", "submitted"),
            ("customer_order_lecturer_confirmed", "de", "Kursauftrag wurde übernommen", "bestätigen"),
            ("customer_order_lecturer_confirmed", "en", "lecturer accepted", "review and confirm"),
        ):
            with self.subTest(kind=kind, locale=locale):
                delivery = {**DELIVERY, "kind": kind, "locale": locale}
                self.assertTrue(worker.prepared_valid(delivery, LEASE))
                message = worker.make_message(self.config, delivery)
                self.assertEqual(message["To"], DELIVERY["recipient"])
                self.assertEqual(message["Message-ID"], DELIVERY["message_id"])
                self.assertIn(subject, message["Subject"])
                self.assertIn(body_text, message.get_content())
                self.assertIn("https://portal.example.invalid/client", message.get_content())

    def test_course_offer_message_is_localized_and_links_to_the_exact_assignment(self):
        delivery = {
            **DELIVERY,
            "kind": "course_offer_published",
            "offer": {
                "id": TOKEN,
                "title": "Linux für Einsteiger\r\nBcc: fictional@example.invalid",
                "description": "Übungen & Praxis\nWöchentlich, online.",
                "internal": False,
                "quote": {"total_amount": "1234.50", "currency": "AUD"},
            },
        }
        for locale, fee in (("de", "Dein Honorar für den gesamten Auftrag: 1.234,50 AUD"),
                            ("en", "Your fee for the entire assignment: 1,234.50 AUD")):
            with self.subTest(locale=locale):
                localized = {**delivery, "locale": locale}
                self.assertTrue(worker.prepared_valid(localized, LEASE))
                message = BytesParser(policy=policy.default).parsebytes(
                    worker.make_message(self.config, localized).as_bytes()
                )
                self.assertIn("Linux für Einsteiger", message["Subject"])
                self.assertIsNone(message["Bcc"])
                self.assertEqual(message.get_content_type(), "text/plain")
                body = message.get_content().replace("\r\n", "\n")
                self.assertIn(delivery["offer"]["description"], body)
                self.assertIn(fee, body)
                self.assertIn(f"https://portal.example.invalid/jobs/{TOKEN}", body)
                self.assertNotIn("/notifications", body)
        self.assertFalse(worker.prepared_valid(
            {**delivery, "offer": {**delivery["offer"], "id": "//foreign.example.invalid/"}}, LEASE
        ))
        self.assertFalse(worker.prepared_valid({**DELIVERY, "kind": "course_offer_published"}, LEASE))

    def captured_smtp(self, mode):
        server = SmtpServer(mode)
        original = smtplib.SMTP

        def connect(host, port, *, timeout):
            self.assertEqual((host, port), ("127.0.0.1", 2526))
            return original("127.0.0.1", server.server_address[1], timeout=timeout)

        return server, connect

    def test_actual_loopback_smtp_and_http_outbox_acceptance(self):
        server, connect = self.captured_smtp("accepted")
        http = ThreadingHTTPServer(("127.0.0.1", 0), CaptureRpcHandler)
        http.requests = []
        config = replace(self.config, api_url=f"http://127.0.0.1:{http.server_port}")
        with server_context(server), server_context(http), patch.object(smtplib, "SMTP", connect):
            result = worker.run(config)
        self.assertEqual(result["accepted"], 1)
        self.assertEqual(result["rpc_errors"], 0)
        self.assertEqual(len(server.messages), 1)
        content = server.messages[0].decode()
        self.assertIn(DELIVERY["message_id"], content)
        self.assertIn("https://portal.example.invalid/notifications", content)
        self.assertNotIn(ENV["PORTAL_NOTIFICATION_SMTP_PASSWORD"], content)
        self.assertEqual([r[0] for r in http.requests], [f"/rest/v1/rpc/{name}" for name in ("refresh_notification_reminders", "lease_notification_emails", "prepare_notification_email", "finish_notification_email")])
        self.assertEqual(http.requests[-1][1]["p_outcome"], "accepted")
        self.assertEqual(http.requests[0][2]["Authorization"], f"Bearer {self.config.service_key}")

    def test_actual_temporary_recipient_failure_is_safe_retry(self):
        server, connect = self.captured_smtp("temporary_recipient")
        with server_context(server), patch.object(smtplib, "SMTP", connect):
            outcome = worker.smtp_delivery(self.config, DELIVERY)
        self.assertEqual(outcome, ("retry", "smtp_recipient_rejected"))
        self.assertEqual(server.messages, [])

    def test_actual_permanent_recipient_failure_does_not_retry(self):
        server, connect = self.captured_smtp("permanent_recipient")
        with server_context(server), patch.object(smtplib, "SMTP", connect):
            outcome = worker.smtp_delivery(self.config, DELIVERY)
        self.assertEqual(outcome, ("failed", "smtp_recipient_rejected"))
        self.assertEqual(server.messages, [])

    def test_actual_explicit_data_rejection_is_safe_retry(self):
        server, connect = self.captured_smtp("temporary_data")
        with server_context(server), patch.object(smtplib, "SMTP", connect):
            outcome = worker.smtp_delivery(self.config, DELIVERY)
        self.assertEqual(outcome, ("retry", "smtp_data_rejected"))
        self.assertEqual(len(server.messages), 1)

    def test_actual_lost_final_data_response_becomes_uncertain(self):
        server, connect = self.captured_smtp("ambiguous_data")
        with server_context(server), patch.object(smtplib, "SMTP", connect):
            outcome = worker.smtp_delivery(self.config, DELIVERY)
        self.assertEqual(outcome, ("uncertain", "smtp_ambiguous"))
        self.assertEqual(len(server.messages), 1)

    def test_worker_and_private_relay_preserve_provider_outcome_class(self):
        settings = {
            "enabled": True,
            "host": "smtp.example.com",
            "port": 465,
            "security": "implicit_tls",
            "username": "provider@example.invalid",
            "password": "fictional-provider-password",
            "sender_email": "sender@example.invalid",
            "sender_name": "Fictional Sender",
        }
        expected = {
            "accepted": ("accepted", 1, 0),
            "login_4xx": ("retry", 0, 0),
            "login_5xx": ("failed", 0, 0),
            "sender_4xx": ("retry", 0, 0),
            "sender_5xx": ("failed", 0, 0),
            "recipient_4xx": ("retry", 0, 0),
            "recipient_5xx": ("failed", 0, 0),
            "data_4xx": ("retry", 1, 0),
            "data_5xx": ("failed", 1, 0),
            "data_5xx_close_failure": ("failed", 1, 0),
            "data_lost": ("uncertain", 1, 0),
            "data_io_error": ("uncertain", 1, 0),
            "data_command_rejection": ("failed", 1, 0),
            "data_unexpected": ("uncertain", 1, 0),
        }
        for mode, (outcome, submissions, rpc_errors) in expected.items():
            with self.subTest(provider_result=mode):
                provider = ProviderSmtp(mode)
                relay = relay_module.MailRelay(
                    relay_module.RelayConfig(
                        api_url="http://api-gw:8000/rest/v1",
                        service_key="fictional-relay-service-key",
                        username="relay@example.invalid",
                        password=ENV["PORTAL_NOTIFICATION_SMTP_PASSWORD"],
                        control_token="fictional-relay-control-token",
                    )
                )
                relay.current_transport = Mock(return_value=settings)
                rpc = Mock()
                rpc.call.side_effect = [0, [LEASE], DELIVERY, True]
                original_smtp = smtplib.SMTP
                data_responses = []

                async def run_delivery():
                    server = await asyncio.start_server(
                        lambda reader, writer: relay.handle_smtp(reader, writer),
                        host="127.0.0.1",
                        port=0,
                        limit=relay_module.MAX_COMMAND_BYTES + 2,
                    )
                    port = server.sockets[0].getsockname()[1]

                    def connect(host, requested_port, *, timeout):
                        self.assertEqual((host, requested_port), ("127.0.0.1", 2526))
                        connection = original_smtp("127.0.0.1", port, timeout=timeout)
                        original_data = connection.data

                        def capture_data(message):
                            response = original_data(message)
                            data_responses.append(response)
                            return response

                        connection.data = capture_data
                        return connection

                    try:
                        with (
                            patch.object(relay_module, "PinnedSMTPSSL", return_value=provider),
                            patch.object(smtplib, "SMTP", connect),
                        ):
                            # Use the real batch logic without installing a main-thread-only alarm.
                            result = {
                                key: 0
                                for key in (
                                    "accepted",
                                    "retry",
                                    "failed",
                                    "uncertain",
                                    "suppressed",
                                    "rpc_errors",
                                )
                            }
                            await asyncio.to_thread(
                                worker._run,
                                self.config,
                                rpc,
                                worker.smtp_delivery,
                                result,
                                time.monotonic() + 30,
                            )
                    finally:
                        server.close()
                        await server.wait_closed()
                    return result

                result = asyncio.run(run_delivery())
                self.assertEqual(
                    result[outcome],
                    1,
                    f"worker result={result!r}; RPC calls={rpc.call.call_args_list!r}",
                )
                self.assertEqual(result["rpc_errors"], rpc_errors)
                self.assertEqual(len(provider.submissions), submissions)
                if outcome == "uncertain":
                    self.assertEqual(data_responses, [])
                else:
                    self.assertEqual(len(data_responses), 1)
                    response_code, response_text = data_responses[0]
                    self.assertEqual(
                        response_code,
                        250 if outcome == "accepted" else 451 if outcome == "retry" else 550,
                    )
                    self.assertNotIn(b"private", response_text.lower())
                    self.assertNotIn(b"provider", response_text.lower())
                finish = rpc.call.call_args
                self.assertEqual(finish.args[0], "finish_notification_email")
                self.assertEqual(finish.args[1]["p_outcome"], outcome)
                self.assertNotIn("private", str(finish.args[1]).lower())
                self.assertTrue(provider.closed)

    def test_worker_and_private_relay_do_not_submit_incomplete_data_on_eof(self):
        relay = relay_module.MailRelay(
            relay_module.RelayConfig(
                api_url="http://api-gw:8000/rest/v1",
                service_key="fictional-relay-service-key",
                username="relay@example.invalid",
                password=ENV["PORTAL_NOTIFICATION_SMTP_PASSWORD"],
                control_token="fictional-relay-control-token",
            )
        )
        encoded_auth = base64.b64encode(
            b"\0" + relay.config.username.encode() + b"\0" + relay.config.password.encode()
        )

        class IncompleteReader:
            def __init__(self):
                self.lines = iter(
                    [
                        b"EHLO worker.example.invalid\r\n",
                        b"AUTH PLAIN " + encoded_auth + b"\r\n",
                        b"MAIL FROM:<worker@example.invalid>\r\n",
                        b"RCPT TO:<fictional.recipient@example.invalid>\r\n",
                        b"DATA\r\n",
                        b"Subject: incomplete\r\n",
                        b"\r\n",
                        b"partial body without terminator\r\n",
                        b"",
                    ]
                )
                self.eof_seen = False

            async def readline(self):
                try:
                    line = next(self.lines)
                except StopIteration:
                    raise AssertionError("SMTP handler continued reading after DATA EOF")
                if line == b"":
                    self.eof_seen = True
                return line

        class Writer:
            def __init__(self):
                self.closed = False

            def write(self, _value):
                pass

            async def drain(self):
                pass

            def close(self):
                self.closed = True

            async def wait_closed(self):
                pass

        reader, writer = IncompleteReader(), Writer()
        relay.deliver = Mock()

        async def run_incomplete_message():
            await relay.handle_smtp(reader, writer)

        asyncio.run(run_incomplete_message())
        self.assertTrue(reader.eof_seen)
        self.assertTrue(writer.closed)
        relay.deliver.assert_not_called()

    def test_worker_rejects_non_loopback_relays_before_network_access(self):
        with patch.object(smtplib, "SMTP") as connect:
            self.assertEqual(
                worker.smtp_delivery(
                    replace(self.config, smtp_host="smtp.hostinger.com"), DELIVERY
                ),
                ("failed", "smtp_relay_config"),
            )
            self.assertEqual(
                worker.smtp_delivery(replace(self.config, smtp_port=465), DELIVERY),
                ("failed", "smtp_relay_config"),
            )
        connect.assert_not_called()

    def test_connection_timeout_before_data_is_safe_retry(self):
        with patch.object(smtplib, "SMTP", side_effect=TimeoutError("secret")):
            self.assertEqual(worker.smtp_delivery(self.config, DELIVERY), ("retry", "smtp_connection"))

    def test_close_failure_after_acceptance_does_not_resend(self):
        connection = Mock()
        connection.mail.return_value = connection.rcpt.return_value = connection.data.return_value = (250, b"OK")
        connection.close.side_effect = OSError("secret")
        with patch.object(smtplib, "SMTP", return_value=connection):
            self.assertEqual(worker.smtp_delivery(self.config, DELIVERY), ("accepted", None))
        connection.data.assert_called_once()

    def test_generic_bilingual_message_does_not_include_resource_body(self):
        for locale in ("de", "en"):
            message = worker.make_message(self.config, {**DELIVERY, "locale": locale, "title": "PRIVATE CONTRACT", "body": "PRIVATE CHAT", "kind": "unknown-private-kind"})
            self.assertNotIn("PRIVATE", str(message))
            self.assertEqual(message["Message-ID"], DELIVERY["message_id"])
            self.assertIn("/notifications", message.get_content())
            self.assertIn("Luminovia:", message["Subject"])


class OutboxTests(unittest.TestCase):
    def setUp(self):
        self.config = worker.Config.from_env(ENV)

    def test_prepare_suppression_does_not_send_or_finish(self):
        rpc, sender = Mock(), Mock()
        rpc.call.side_effect = [0, [LEASE], None]
        result = worker.run(self.config, rpc, sender)
        self.assertEqual(result["suppressed"], 1)
        self.assertEqual(rpc.call.call_count, 3)
        sender.assert_not_called()

    def test_prepare_failure_does_not_send_or_falsely_release(self):
        rpc, sender = Mock(), Mock()
        rpc.call.side_effect = [0, [LEASE], worker.RpcError("unavailable")]
        self.assertEqual(worker.run(self.config, rpc, sender)["rpc_errors"], 1)
        self.assertEqual(rpc.call.call_count, 3)
        sender.assert_not_called()

    def test_finish_failure_after_acceptance_never_resends(self):
        rpc, sender = Mock(), Mock(return_value=("accepted", None))
        rpc.call.side_effect = [0, [LEASE], DELIVERY, worker.RpcError("unavailable")]
        result = worker.run(self.config, rpc, sender)
        self.assertEqual(result["accepted"], 1)
        self.assertEqual(result["rpc_errors"], 1)
        sender.assert_called_once()
        self.assertEqual(rpc.call.call_args.args[1]["p_outcome"], "accepted")

    def test_invalid_recipient_token_and_message_id_never_send(self):
        for change in (
                {"recipient": "victim@example.invalid\r\nBcc: other@example.invalid"},
                {"recipient": "One <one@example.invalid>"},
                {"lease_token": IDENTITY},
                {"message_id": "<spoof@example.invalid>"},
                {"locale": "other"},
        ):
            rpc, sender = Mock(), Mock()
            rpc.call.side_effect = [0, [LEASE], {**DELIVERY, **change}, True]
            with self.subTest(change=change):
                result = worker.run(self.config, rpc, sender)
                self.assertEqual(result["failed"], 1)
                sender.assert_not_called()
                self.assertEqual(rpc.call.call_args.args[1]["p_error_code"], "payload_invalid")

    def test_batch_bounds_and_invalid_ids_fail_closed(self):
        for leases in ({}, [{"id": "unsafe", "lease_token": TOKEN}], [LEASE] * 21):
            rpc, sender = Mock(), Mock()
            rpc.call.side_effect = [0, leases]
            with self.subTest(leases=leases), self.assertRaises(worker.RpcError):
                worker.run(self.config, rpc, sender)
            sender.assert_not_called()

    def test_uncertain_outcome_recorded_without_auto_resend(self):
        rpc, sender = Mock(), Mock(return_value=("uncertain", "smtp_ambiguous"))
        rpc.call.side_effect = [0, [LEASE], DELIVERY, True]
        result = worker.run(self.config, rpc, sender)
        self.assertEqual(result["uncertain"], 1)
        sender.assert_called_once()
        self.assertEqual(rpc.call.call_args.args[1]["p_outcome"], "uncertain")

    def test_reminder_generation_failure_stops_before_lease_or_send(self):
        rpc, sender = Mock(), Mock()
        rpc.call.side_effect = worker.RpcError("unavailable")
        with self.assertRaises(worker.RpcError):
            worker.run(self.config, rpc, sender)
        rpc.call.assert_called_once_with("refresh_notification_reminders", {"p_limit": 100})
        sender.assert_not_called()

    def test_invalid_reminder_count_stops_before_lease(self):
        for count in (None, True, -1, 100001):
            rpc, sender = Mock(), Mock()
            rpc.call.return_value = count
            with self.subTest(count=count), self.assertRaises(worker.RpcError):
                worker.run(self.config, rpc, sender)
            self.assertEqual(rpc.call.call_count, 1)
            sender.assert_not_called()

    def test_wall_deadline_interrupts_prepare_and_restores_alarm(self):
        rpc, sender = Mock(), Mock()

        def call(name, _payload):
            if name == "refresh_notification_reminders":
                return 0
            if name == "lease_notification_emails":
                return [LEASE]
            time.sleep(0.1)
            return DELIVERY

        rpc.call.side_effect = call
        started = time.monotonic()
        result = worker.run(self.config, rpc, sender, budget_seconds=0.02)
        self.assertLess(time.monotonic() - started, 1)
        self.assertEqual(result["rpc_errors"], 1)
        sender.assert_not_called()
        self.assertEqual(worker.signal.getitimer(worker.signal.ITIMER_REAL)[0], 0)

    def test_wall_deadline_before_data_finishes_known_safe_retry(self):
        rpc = Mock()
        rpc.call.side_effect = [0, [LEASE], DELIVERY, True]
        with patch.object(smtplib, "SMTP", side_effect=lambda *_args, **_kwargs: time.sleep(0.1)):
            result = worker.run(self.config, rpc, budget_seconds=0.02)
        self.assertEqual(result["retry"], 1)
        self.assertEqual(rpc.call.call_args.args[1]["p_outcome"], "retry")
        self.assertEqual(rpc.call.call_args.args[1]["p_error_code"], "worker_deadline")

    def test_wall_deadline_during_data_finishes_uncertain(self):
        rpc = Mock()
        rpc.call.side_effect = [0, [LEASE], DELIVERY, True]
        connection = Mock()
        connection.mail.return_value = connection.rcpt.return_value = (250, b"OK")
        connection.data.side_effect = lambda *_args: time.sleep(0.1)
        with patch.object(smtplib, "SMTP", return_value=connection):
            result = worker.run(self.config, rpc, budget_seconds=0.02)
        self.assertEqual(result["uncertain"], 1)
        self.assertEqual(rpc.call.call_args.args[1]["p_outcome"], "uncertain")
        connection.data.assert_called_once()

    def test_deadline_completion_rpc_is_also_wall_clock_bounded(self):
        rpc = Mock()

        def call(name, _payload):
            if name == "refresh_notification_reminders":
                return 0
            if name == "lease_notification_emails":
                return [LEASE]
            if name == "prepare_notification_email":
                return DELIVERY
            time.sleep(0.1)
            return True

        rpc.call.side_effect = call
        connection = Mock()
        connection.mail.return_value = connection.rcpt.return_value = (250, b"OK")
        connection.data.side_effect = lambda *_args: time.sleep(0.1)
        with patch.object(smtplib, "SMTP", return_value=connection):
            result = worker.run(replace(self.config, timeout=0.02), rpc, budget_seconds=0.02)
        self.assertEqual(result["uncertain"], 1)
        self.assertEqual(result["rpc_errors"], 1)
        self.assertEqual(rpc.call.call_count, 4)

    def test_overlong_or_existing_worker_deadline_fails_before_network(self):
        rpc = Mock()
        with self.assertRaises(worker.ConfigurationError):
            worker.run(self.config, rpc, budget_seconds=241)
        with patch.object(worker.signal, "getitimer", return_value=(5, 0)):
            with self.assertRaises(worker.ConfigurationError):
                worker.run(self.config, rpc)
        rpc.call.assert_not_called()

    def test_rpc_names_cannot_be_controlled_by_payload(self):
        rpc = worker.RpcClient(self.config)
        with self.assertRaises(worker.RpcError):
            rpc.call("../other", {})

    def test_rpc_redirect_does_not_leak_service_headers(self):
        class Redirect(BaseHTTPRequestHandler):
            def do_POST(self):
                self.send_response(307)
                self.send_header("Location", "http://127.0.0.1:1/stolen")
                self.end_headers()

            def log_message(self, *args):
                pass

        server = ThreadingHTTPServer(("127.0.0.1", 0), Redirect)
        config = replace(self.config, api_url=f"http://127.0.0.1:{server.server_port}")
        with server_context(server), self.assertRaises(worker.RpcError):
            worker.RpcClient(config).call("lease_notification_emails", {"p_limit": 1})


if __name__ == "__main__":
    unittest.main()
