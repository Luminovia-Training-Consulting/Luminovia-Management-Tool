#!/usr/bin/env python3
"""Private, secret-free SMTP bridge and bounded SMTP/IMAP health-check worker."""

from __future__ import annotations

import argparse
import asyncio
import base64
import email.policy
import email.utils
import hmac
import http.server
import imaplib
import ipaddress
import json
import logging
import os
import re
import smtplib
import socket
import ssl
import threading
import urllib.error
import urllib.request
from contextlib import contextmanager
from dataclasses import dataclass
from email.message import EmailMessage
from email.parser import BytesParser
from typing import Any
from urllib.parse import urlparse

LOG = logging.getLogger("mail_relay")
MAX_MESSAGE_BYTES = 4 * 1024 * 1024
MAX_COMMAND_BYTES = 8192
MAILBOX_PATTERN = re.compile(r"^[^\s<>@]+@[^\s<>@]+$")
HOST_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$")
LEASE_HEADER = "X-Luminovia-Notification-Lease"
UUID_PATTERN = r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}"
SAFE_TEST_ERRORS = {
    "connect_failed",
    "tls_failed",
    "authentication_failed",
    "protocol_failed",
    "timeout",
    "configuration_changed",
    "configuration_unavailable",
}


class RelayFailure(Exception):
    """Represent only a bounded failure category; never retain provider text."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code if code in SAFE_TEST_ERRORS else "protocol_failed"


class DeliveryUncertain(Exception):
    """Mark the post-DATA network boundary where the provider may have accepted bytes."""


class AcademyScopeRejected(Exception):
    """A worker lease or its current recipient did not authorize delivery."""


@dataclass(frozen=True)
class RelayConfig:
    """Internal network and relay authentication values loaded only from protected container env."""

    api_url: str
    service_key: str
    username: str
    password: str
    control_token: str
    smtp_port: int = 2525
    host_smtp_port: int = 2526
    control_port: int = 8080
    connect_timeout: float = 8.0
    command_timeout: float = 90.0
    capture_auth_while_unconfigured: bool = False
    academy_notifications: bool = False

    @classmethod
    def from_environment(cls) -> "RelayConfig":
        """Validate the fixed service URL and secrets before opening any listener."""
        api_url = os.environ.get("PORTAL_MAIL_RELAY_API_URL", "").rstrip("/")
        parsed = urlparse(api_url)
        if parsed.scheme != "http" or parsed.hostname != "api-gw" or parsed.port != 8000:
            raise RuntimeError("Invalid internal mail API URL")
        values = {
            "service_key": os.environ.get("PORTAL_MAIL_RELAY_SERVICE_KEY", ""),
            "username": os.environ.get("PORTAL_MAIL_RELAY_USERNAME", ""),
            "password": os.environ.get("PORTAL_MAIL_RELAY_PASSWORD", ""),
            "control_token": os.environ.get("PORTAL_MAIL_RELAY_CONTROL_TOKEN", ""),
        }
        if any(not value or len(value) > 8192 for value in values.values()):
            raise RuntimeError("Incomplete mail relay configuration")
        if not MAILBOX_PATTERN.fullmatch(values["username"]):
            raise RuntimeError("Invalid internal SMTP username")
        return cls(api_url=api_url, **values,
                   capture_auth_while_unconfigured=os.environ.get("PORTAL_MAIL_RELAY_CAPTURE_PENDING") == "true",
                   academy_notifications=os.environ.get("PORTAL_MAIL_RELAY_ACADEMY_NOTIFICATIONS") == "true")


def valid_external_host(host: str) -> bool:
    """Reject IP literals, local names, invalid labels and hostnames with no public suffix."""
    if not isinstance(host, str) or len(host) > 253 or host != host.lower():
        return False
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    if not HOST_PATTERN.fullmatch(host) or host.endswith((".localhost", ".local", ".internal", ".test", ".invalid", ".onion")):
        return False
    return True


def valid_port(port: Any) -> bool:
    """Accept exactly one numeric TCP port; protocol and TLS are checked by callers."""
    return type(port) is int and 1 <= port <= 65535


def resolve_public_addresses(host: str, port: int) -> list[tuple[int, int, int, tuple[Any, ...]]]:
    """Resolve once and retain only globally routable addresses for pinned socket connects."""
    if not valid_external_host(host) or not valid_port(port):
        raise RelayFailure("configuration_unavailable")
    try:
        records = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM, proto=socket.IPPROTO_TCP)
    except (OSError, UnicodeError):
        raise RelayFailure("connect_failed") from None
    public: list[tuple[int, int, int, tuple[Any, ...]]] = []
    for record in records:
        family, socktype, protocol, _canonical, address = record
        try:
            ip = ipaddress.ip_address(address[0])
        except ValueError:
            continue
        if ip.is_global and not ip.is_multicast:
            public.append((family, socktype, protocol, address))
    if not public:
        raise RelayFailure("connect_failed")
    return public


def pinned_socket(host: str, port: int, timeout: float) -> socket.socket:
    """Connect directly to a previously validated public DNS answer, avoiding a second DNS lookup."""
    last_error: OSError | None = None
    for family, socktype, protocol, address in resolve_public_addresses(host, port):
        connection = socket.socket(family, socktype, protocol)
        connection.settimeout(timeout)
        try:
            connection.connect(address)
            return connection
        except OSError as error:
            last_error = error
            connection.close()
    if isinstance(last_error, (TimeoutError, socket.timeout)):
        raise RelayFailure("timeout") from None
    raise RelayFailure("connect_failed") from None


class PinnedSMTP(smtplib.SMTP):
    """Plain SMTP connector whose TCP target is pinned and separately TLS-upgraded for STARTTLS."""

    def _get_socket(self, host: str, port: int, timeout: float | object) -> socket.socket:
        return pinned_socket(host, port, self._timeout_value(timeout))

    @staticmethod
    def _timeout_value(value: float | object) -> float:
        return 8.0 if value is socket._GLOBAL_DEFAULT_TIMEOUT else float(value)


class PinnedSMTPSSL(smtplib.SMTP_SSL):
    """Implicit-TLS SMTP connector with pinned DNS and hostname-verified certificates."""

    def _get_socket(self, host: str, port: int, timeout: float | object) -> socket.socket:
        raw = pinned_socket(host, port, PinnedSMTP._timeout_value(timeout))
        return self.context.wrap_socket(raw, server_hostname=host)


class PinnedIMAP(imaplib.IMAP4):
    """Plain IMAP connector that pins DNS before STARTTLS or login."""

    def _create_socket(self, timeout: float | None) -> socket.socket:
        return pinned_socket(self.host, self.port, timeout or 8.0)


class PinnedIMAPSSL(imaplib.IMAP4_SSL):
    """Implicit-TLS IMAP connector with pinned DNS and hostname-verified certificates."""

    def _create_socket(self, timeout: float | None) -> socket.socket:
        raw = pinned_socket(self.host, self.port, timeout or 8.0)
        return self.ssl_context.wrap_socket(raw, server_hostname=self.host)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    """Prevent service-role authorization from being forwarded to an unexpected redirect target."""

    def redirect_request(self, request: Any, response: Any, code: int, message: str, headers: Any, new_url: str) -> None:
        return None


class MailRelay:
    """Fetch current credentials per operation and bridge Auth/worker SMTP to the validated provider."""

    def __init__(self, config: RelayConfig):
        self.config = config
        self.opener = urllib.request.build_opener(NoRedirect())

    def rpc(self, name: str, parameters: dict[str, Any]) -> Any:
        """Call a fixed PostgREST RPC using the service credential without logging request or response bodies."""
        if name not in {
            "get_mail_delivery_transport",
            "claim_mail_connection_test",
            "complete_mail_connection_test",
            "authorize_academy_notification_email",
            "record_auth_mail_activity",
        }:
            raise RelayFailure("configuration_unavailable")
        request = urllib.request.Request(
            f"{self.config.api_url}/rpc/{name}",
            data=json.dumps(parameters, separators=(",", ":")).encode(),
            headers={
                "apikey": self.config.service_key,
                "Authorization": f"Bearer {self.config.service_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with self.opener.open(request, timeout=10) as result:
                body = result.read(16385)
                if len(body) > 16384:
                    raise RelayFailure("protocol_failed")
                return json.loads(body)
        except RelayFailure:
            raise
        except (OSError, urllib.error.URLError, urllib.error.HTTPError, ValueError):
            raise RelayFailure("configuration_unavailable") from None

    @staticmethod
    def check_transport(data: Any, *, require_enabled: bool = True) -> dict[str, Any]:
        """Validate untrusted database JSON again before using host, port, TLS or credentials."""
        if not isinstance(data, dict) or (require_enabled and data.get("enabled") is not True):
            raise RelayFailure("configuration_unavailable")
        host = data.get("host")
        username = data.get("username")
        password = data.get("password")
        if (
                not valid_external_host(host)
                or not isinstance(username, str)
                or not username
                or len(username) > 254
                or any(ord(char) < 32 or ord(char) > 126 for char in username)
                or (data.get("protocol") == "imap" and not MAILBOX_PATTERN.fullmatch(username))
                or not isinstance(password, str)
                or not password
                or len(password) > 1024
                or any(ord(char) < 32 or ord(char) == 127 for char in password)
        ):
            raise RelayFailure("configuration_unavailable")
        return data

    def current_transport(self) -> dict[str, Any]:
        """Load the enabled sender credentials from Vault on demand; never cache secret material."""
        return self.check_transport(self.rpc("get_mail_delivery_transport", {}))

    def record_auth_mail_outcome(self, outcome: str) -> None:
        """Record the relay outcome without passing the envelope or message to the audit log."""
        try:
            self.rpc("record_auth_mail_activity", {"p_outcome": outcome})
        except RelayFailure:
            LOG.warning("Auth mail outcome could not be recorded")

    def test_connection(self, test_id: str, recipient: str | None = None) -> dict[str, Any]:
        """Claim a version-bound test and record the outcome of the handshake or self-test message."""
        claim = self.rpc("claim_mail_connection_test", {"p_test_id": test_id})
        if not isinstance(claim, dict) or claim.get("status") != "running":
            error_code = claim.get("error_code") if isinstance(claim, dict) else None
            return {
                "status": "failed",
                "error_code": error_code if error_code in SAFE_TEST_ERRORS else "configuration_unavailable",
            }
        error_code = None
        try:
            # The version-bound claim checks enablement before decrypting
            # credentials. Unlike the delivery response, it has no enabled field.
            self.check_transport(claim, require_enabled=False)
            if recipient is not None:
                if claim.get("protocol") != "smtp":
                    raise RelayFailure("protocol_failed")
                message = EmailMessage(policy=email.policy.SMTP)
                message["To"] = recipient
                message["Subject"] = "Portal SMTP-Test / SMTP test"
                message.set_content(
                    "Dein Portal hat diese Testnachricht über den gespeicherten SMTP-Transport gesendet.\n"
                    "Your portal sent this test message using the saved SMTP transport."
                )
                self.deliver(message.as_bytes(), recipient, settings={**claim, "sender_name": ""})
            elif claim.get("protocol") == "smtp":
                self.check_smtp(claim)
            elif claim.get("protocol") == "imap":
                self.check_imap(claim)
            else:
                raise RelayFailure("configuration_unavailable")
        except RelayFailure as error:
            error_code = error.code
        except (DeliveryUncertain, OSError, TimeoutError, socket.timeout):
            error_code = "timeout"
        try:
            persisted = self.rpc(
                "complete_mail_connection_test",
                {
                    "p_test_id": test_id,
                    "p_success": error_code is None,
                    "p_error_code": error_code,
                },
            )
        except RelayFailure:
            return {"status": "failed", "error_code": "configuration_unavailable"}
        if error_code is None and persisted is not True:
            error_code = (
                "configuration_changed" if persisted is False else "configuration_unavailable"
            )
        return {
            "status": "succeeded" if error_code is None else "failed",
            "error_code": error_code,
        }

    @contextmanager
    def smtp_session(self, settings: dict[str, Any], *, verify_implicit_greeting=False):
        """Own the pinned TLS connection and translate provider failures without exposing responses."""
        host, port, security = settings.get("host"), settings.get("port"), settings.get("security")
        if not valid_port(port) or security not in ("implicit_tls", "starttls"):
            raise RelayFailure("configuration_unavailable")
        connection: smtplib.SMTP | None = None
        context = ssl.create_default_context()
        try:
            if security == "implicit_tls":
                connection = PinnedSMTPSSL(
                    host,
                    port,
                    timeout=self.config.connect_timeout,
                    context=context,
                )
            else:
                connection = PinnedSMTP(host, port, timeout=self.config.connect_timeout)
                if connection.ehlo()[0] != 250 or not connection.has_extn("starttls"):
                    raise RelayFailure("protocol_failed")
                connection.starttls(context=context)
            if (security == "starttls" or verify_implicit_greeting) and connection.ehlo()[0] != 250:
                raise RelayFailure("protocol_failed")
            connection.login(settings["username"], settings["password"])
            yield connection
        except smtplib.SMTPAuthenticationError:
            raise RelayFailure("authentication_failed") from None
        except ssl.SSLError:
            raise RelayFailure("tls_failed") from None
        except (TimeoutError, socket.timeout):
            raise RelayFailure("timeout") from None
        except RelayFailure:
            raise
        except (smtplib.SMTPException, OSError):
            raise RelayFailure("connect_failed") from None
        finally:
            if connection is not None:
                connection.close()

    def check_smtp(self, settings: dict[str, Any]) -> None:
        """Verify TLS and credentials without issuing MAIL/RCPT/DATA."""
        with self.smtp_session(settings) as connection:
            code, _safe_response = connection.noop()
            if code != 250:
                raise RelayFailure("protocol_failed")

    def check_imap(self, settings: dict[str, Any]) -> None:
        """Verify IMAP TLS, login and NOOP only; no mailbox messages are fetched or changed."""
        host, port, security = settings.get("host"), settings.get("port"), settings.get("security")
        if port not in (143, 993) or security not in ("implicit_tls", "starttls"):
            raise RelayFailure("configuration_unavailable")
        connection: imaplib.IMAP4 | None = None
        context = ssl.create_default_context()
        try:
            if security == "implicit_tls":
                connection = PinnedIMAPSSL(
                    host,
                    port,
                    timeout=self.config.connect_timeout,
                    ssl_context=context,
                )
            else:
                connection = PinnedIMAP(host, port, timeout=self.config.connect_timeout)
                if connection.starttls(ssl_context=context)[0] != "OK":
                    raise RelayFailure("tls_failed")
            if connection.login(settings["username"], settings["password"])[0] != "OK":
                raise RelayFailure("authentication_failed")
            if connection.noop()[0] != "OK":
                raise RelayFailure("protocol_failed")
        except imaplib.IMAP4.error:
            raise RelayFailure("authentication_failed") from None
        except ssl.SSLError:
            raise RelayFailure("tls_failed") from None
        except (TimeoutError, socket.timeout):
            raise RelayFailure("timeout") from None
        except RelayFailure:
            raise
        except (OSError, imaplib.IMAP4.abort):
            raise RelayFailure("connect_failed") from None
        finally:
            if connection is not None:
                try:
                    connection.logout()
                except (OSError, imaplib.IMAP4.error):
                    pass

    def deliver_auth(self, raw_message: bytes, recipient: str) -> None:
        """Keep explicitly configured development Auth on private capture until its sender is enabled."""
        if not self.config.capture_auth_while_unconfigured:
            return self.deliver(raw_message, recipient)
        settings = self.rpc("get_mail_delivery_transport", {})
        if not isinstance(settings, dict) or settings.get("enabled") is not False:
            return self.deliver(raw_message, recipient, settings=self.check_transport(settings))
        if len(raw_message) > MAX_MESSAGE_BYTES or not MAILBOX_PATTERN.fullmatch(recipient):
            raise RelayFailure("protocol_failed")
        try:
            with smtplib.SMTP("mailpit", 1025, timeout=self.config.connect_timeout) as capture:
                capture.sendmail("no-reply@example.invalid", [recipient], raw_message)
        except (TimeoutError, smtplib.SMTPServerDisconnected):
            raise DeliveryUncertain() from None
        except (OSError, smtplib.SMTPException):
            raise RelayFailure("connect_failed") from None

    def deliver(self, raw_message: bytes, recipient: str, *, settings: dict | None = None,
                academy_notification: bool = False) -> None:
        """Replace the envelope/header sender and submit one recipient only to the current provider."""
        if len(raw_message) > MAX_MESSAGE_BYTES or not MAILBOX_PATTERN.fullmatch(recipient):
            raise RelayFailure("protocol_failed")
        settings = self.current_transport() if settings is None else settings
        sender = settings.get("sender_email")
        sender_name = settings.get("sender_name")
        host, port, security = settings.get("host"), settings.get("port"), settings.get("security")
        if (
                not isinstance(sender, str)
                or not MAILBOX_PATTERN.fullmatch(sender)
                or not isinstance(sender_name, str)
                or any(ord(char) < 32 or ord(char) == 127 for char in sender_name)
                or not valid_port(port)
                or security not in ("implicit_tls", "starttls")
        ):
            raise RelayFailure("configuration_unavailable")
        try:
            message = BytesParser(policy=email.policy.SMTP).parsebytes(raw_message)
            if message.defects:
                raise RelayFailure("protocol_failed")
            ticket = None
            if academy_notification:
                values = message.get_all(LEASE_HEADER, [])
                if len(values) != 1 or re.fullmatch(UUID_PATTERN + " " + UUID_PATTERN, str(values[0])) is None:
                    raise AcademyScopeRejected()
                ticket = str(values[0]).split(" ")
                del message[LEASE_HEADER]
            if "From" in message:
                del message["From"]
            message["From"] = email.utils.formataddr((sender_name, sender), charset="utf-8")
            outgoing = message.as_bytes(policy=email.policy.SMTP)
        except (ValueError, UnicodeError, TypeError):
            raise RelayFailure("protocol_failed") from None

        with self.smtp_session(settings, verify_implicit_greeting=True) as connection:
            if ticket and self.rpc("authorize_academy_notification_email", {
                "p_id": ticket[0], "p_lease_token": ticket[1], "p_recipient": recipient,
                "p_transport_version": settings.get("version"),
            }) is not True:
                raise AcademyScopeRejected()
            if connection.mail(sender)[0] not in (250, 251):
                raise RelayFailure("protocol_failed")
            if connection.rcpt(recipient)[0] not in (250, 251):
                raise RelayFailure("protocol_failed")
            try:
                code, _safe_response = connection.data(outgoing)
            except (smtplib.SMTPServerDisconnected, TimeoutError, socket.timeout):
                raise DeliveryUncertain() from None
            if code != 250:
                raise RelayFailure("protocol_failed")

    async def handle_smtp(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, *, auth_listener=False) -> None:
        """Run a small SMTP subset; never log commands, credentials, headers or message bodies."""
        greeted = False
        authenticated = False
        sender_accepted = False
        recipient: str | None = None

        async def report_auth_mail(outcome: str) -> None:
            if auth_listener:
                await asyncio.to_thread(self.record_auth_mail_outcome, outcome)

        async def reply(text: str) -> None:
            writer.write((text + "\r\n").encode("ascii"))
            await writer.drain()

        async def line() -> bytes:
            try:
                value = await asyncio.wait_for(
                    reader.readline(), timeout=self.config.command_timeout
                )
            except (asyncio.TimeoutError, asyncio.LimitOverrunError):
                raise RelayFailure("timeout") from None
            if len(value) > MAX_COMMAND_BYTES:
                raise RelayFailure("protocol_failed")
            return value

        async def decode_auth(value: str) -> list[bytes] | None:
            try:
                return base64.b64decode(value.encode("ascii"), validate=True).split(b"\0")
            except (ValueError, UnicodeError):
                return None

        async def authenticate_plain(value: str) -> bool:
            decoded = await decode_auth(value)
            if decoded is None or len(decoded) < 3:
                return False
            username, password = decoded[-2], decoded[-1]
            return hmac.compare_digest(username, self.config.username.encode()) and hmac.compare_digest(
                password, self.config.password.encode()
            )

        async def authenticate_login(initial: str | None) -> bool:
            if initial is None:
                await reply("334 VXNlcm5hbWU6")
                initial = (await line()).decode("ascii", "ignore").strip()
            username_parts = await decode_auth(initial)
            if username_parts is None or len(username_parts) != 1:
                return False
            if not hmac.compare_digest(username_parts[0], self.config.username.encode()):
                await reply("334 UGFzc3dvcmQ6")
                await line()
                return False
            await reply("334 UGFzc3dvcmQ6")
            password_value = (await line()).decode("ascii", "ignore").strip()
            password_parts = await decode_auth(password_value)
            return bool(
                password_parts
                and len(password_parts) == 1
                and hmac.compare_digest(password_parts[0], self.config.password.encode())
            )

        try:
            await reply("220 Luminovia private mail relay ready")
            while True:
                raw_line = await line()
                if not raw_line:
                    return
                if not raw_line.endswith((b"\n", b"\r")):
                    await reply("500 5.5.2 Invalid command")
                    return
                command_text = raw_line.decode("ascii", "ignore").strip()
                command, _, argument = command_text.partition(" ")
                command = command.upper()
                if command == "QUIT":
                    await reply("221 2.0.0 Closing connection")
                    return
                if command == "NOOP":
                    await reply("250 2.0.0 OK")
                    continue
                if command == "RSET":
                    sender_accepted = False
                    recipient = None
                    await reply("250 2.0.0 Reset")
                    continue
                if command in ("EHLO", "HELO"):
                    greeted = True
                    if command == "EHLO":
                        writer.write(
                            b"250-Luminovia private relay\r\n"
                            b"250-SIZE " + str(MAX_MESSAGE_BYTES).encode() + b"\r\n"
                                                                             b"250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n"
                        )
                        await writer.drain()
                    else:
                        await reply("250 Luminovia private relay")
                    continue
                if command == "AUTH":
                    if not greeted:
                        await reply("503 5.5.1 Send EHLO first")
                        continue
                    parts = argument.split()
                    mechanism = parts[0].upper() if parts else ""
                    initial = parts[1] if len(parts) > 1 else None
                    if mechanism == "PLAIN":
                        if initial is None:
                            await reply("334 ")
                            initial = (await line()).decode("ascii", "ignore").strip()
                            if initial == "*":
                                await reply("501 5.7.0 Authentication cancelled")
                                continue
                        authenticated = await authenticate_plain(initial)
                    elif mechanism == "LOGIN":
                        authenticated = await authenticate_login(initial)
                    else:
                        await reply("504 5.5.4 Authentication mechanism unavailable")
                        continue
                    await reply(
                        "235 2.7.0 Authentication successful"
                        if authenticated
                        else "535 5.7.8 Authentication credentials invalid"
                    )
                    continue
                if command == "MAIL":
                    if not authenticated:
                        await reply("530 5.7.0 Authentication required")
                        continue
                    if not greeted or not argument.upper().startswith("FROM:"):
                        await reply("501 5.5.2 Invalid MAIL command")
                        continue
                    sender_accepted = True
                    recipient = None
                    await reply("250 2.1.0 Sender accepted")
                    continue
                if command == "RCPT":
                    if not sender_accepted or recipient is not None or not argument.upper().startswith("TO:"):
                        await reply("503 5.5.1 Invalid recipient sequence")
                        continue
                    value = argument[3:].strip()
                    if value.startswith("<") and value.endswith(">"):
                        value = value[1:-1]
                    if not MAILBOX_PATTERN.fullmatch(value):
                        await reply("501 5.1.3 Invalid recipient")
                        continue
                    recipient = value
                    await reply("250 2.1.5 Recipient accepted")
                    continue
                if command == "DATA":
                    if recipient is None:
                        await reply("503 5.5.1 RCPT TO required")
                        continue
                    await reply("354 End data with <CR><LF>.<CR><LF>")
                    data = bytearray()
                    try:
                        while True:
                            content_line = await line()
                            if content_line in (b".\r\n", b".\n"):
                                break
                            if content_line.startswith(b".."):
                                content_line = content_line[1:]
                            data.extend(content_line)
                            if len(data) > MAX_MESSAGE_BYTES:
                                await reply("552 5.3.4 Message exceeds fixed maximum size")
                                return
                    except RelayFailure:
                        await reply("451 4.4.2 Message reception timed out")
                        return
                    try:
                        if auth_listener:
                            delivery = asyncio.to_thread(self.deliver_auth, bytes(data), recipient)
                        elif self.config.academy_notifications:
                            delivery = asyncio.to_thread(self.deliver, bytes(data), recipient, academy_notification=True)
                        else:
                            delivery = asyncio.to_thread(self.deliver, bytes(data), recipient)
                        await asyncio.wait_for(delivery, timeout=self.config.command_timeout)
                    except DeliveryUncertain:
                        writer.close()
                        await report_auth_mail("uncertain")
                        return
                    except AcademyScopeRejected:
                        await reply("550 5.7.1 Notification no longer authorized")
                        sender_accepted = False
                        recipient = None
                        continue
                    except RelayFailure as error:
                        LOG.warning("upstream mail delivery failed code=%s", error.code)
                        try:
                            await reply("451 4.3.0 Mail transport temporarily unavailable")
                        finally:
                            await report_auth_mail("failed")
                        sender_accepted = False
                        recipient = None
                        continue
                    except asyncio.TimeoutError:
                        # The upstream provider may have accepted DATA; closing avoids claiming safe retry.
                        writer.close()
                        await report_auth_mail("uncertain")
                        return
                    try:
                        await reply("250 2.0.0 Message accepted")
                    finally:
                        await report_auth_mail("accepted")
                    sender_accepted = False
                    recipient = None
                    continue
                await reply("502 5.5.1 Command not supported")
        except (ConnectionError, OSError, RelayFailure):
            return
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except (ConnectionError, OSError):
                pass

    def connection_test_http(self, test_id: str, recipient: str | None = None) -> dict[str, Any]:
        """Perform a SQL-queued check and return a bounded status with no provider text."""
        return self.test_connection(test_id, recipient)


class ControlHandler(http.server.BaseHTTPRequestHandler):
    """Internal-only control endpoint authenticated by a private token and fixed JSON schema."""

    relay: MailRelay
    control_token: str

    def log_message(self, _format: str, *_args: Any) -> None:
        return

    def send_json(self, status: int, value: dict[str, Any]) -> None:
        body = json.dumps(value, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(200, {"status": "ok"})
        else:
            self.send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        if self.path != "/connection-test":
            self.send_json(404, {"error": "not_found"})
            return
        expected = f"Bearer {self.control_token}".encode()
        supplied = self.headers.get("Authorization", "").encode()
        if not hmac.compare_digest(supplied, expected):
            self.send_json(401, {"error": "unauthorized"})
            return
        if self.headers.get_content_type() != "application/json":
            self.send_json(400, {"error": "invalid_request"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1024:
                raise ValueError
            body = json.loads(self.rfile.read(length))
            test_id = body.get("test_id") if isinstance(body, dict) else None
            recipient = body.get("recipient") if isinstance(body, dict) else None
            if (
                    not isinstance(body, dict)
                    or set(body) not in ({"test_id"}, {"test_id", "recipient"})
                    or ("recipient" in body and (
                        not isinstance(recipient, str) or len(recipient) > 254
                        or not MAILBOX_PATTERN.fullmatch(recipient)
                    ))
                    or not isinstance(test_id, str)
                    or not re.fullmatch(r"[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}", test_id, re.I)
            ):
                raise ValueError
        except (ValueError, TypeError, json.JSONDecodeError):
            self.send_json(400, {"error": "invalid_request"})
            return
        try:
            result = self.relay.connection_test_http(test_id, recipient)
            self.send_json(200, result)
        except RelayFailure:
            self.send_json(503, {"status": "failed", "error_code": "configuration_unavailable"})


class ThreadedControlServer(http.server.ThreadingHTTPServer):
    """Bound request concurrency and isolate each short internal test invocation."""

    daemon_threads = True
    request_queue_size = 8


async def serve(config: RelayConfig) -> None:
    """Start internal SMTP listeners and an unexposed relay-control listener."""
    relay = MailRelay(config)
    async def handle_auth(reader, writer):
        await relay.handle_smtp(reader, writer, auth_listener=True)

    smtp_internal = await asyncio.start_server(
        handle_auth,
        host="127.0.0.1",
        port=config.smtp_port,
        limit=MAX_COMMAND_BYTES + 2,
        backlog=16,
    )
    smtp_host = await asyncio.start_server(
        relay.handle_smtp,
        host="0.0.0.0",
        port=config.host_smtp_port,
        limit=MAX_COMMAND_BYTES + 2,
        backlog=8,
    )
    handler = type(
        "ConfiguredControlHandler",
        (ControlHandler,),
        {"relay": relay, "control_token": config.control_token},
    )
    control = ThreadedControlServer(("0.0.0.0", config.control_port), handler)
    control_thread = threading.Thread(target=control.serve_forever, daemon=True)
    control_thread.start()
    LOG.info("private mail relay listeners ready")
    async with smtp_internal, smtp_host:
        await asyncio.gather(smtp_internal.serve_forever(), smtp_host.serve_forever())


def main() -> None:
    """Load protected config and run the service; no command-line secrets are accepted."""
    parser = argparse.ArgumentParser(description="Private Luminovia SMTP relay")
    parser.add_argument("--serve", action="store_true", required=True)
    parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    try:
        asyncio.run(serve(RelayConfig.from_environment()))
    except (OSError, RuntimeError, ValueError):
        LOG.error("private mail relay failed to start")
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
