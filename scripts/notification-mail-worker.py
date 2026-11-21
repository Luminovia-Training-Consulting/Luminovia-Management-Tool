#!/usr/bin/env python3
"""Finite, disabled-by-default SMTP outbox worker. Never run in a browser.

Only database-issued leases and the service-only prepare RPC can supply a
recipient. SMTP acceptance cannot be committed atomically with PostgreSQL:
ambiguous DATA/finish failures are fenced as uncertain, never blindly resent.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import re
import signal
import smtplib
import ssl
import sys
import time
from dataclasses import dataclass
from email.message import EmailMessage
from email.policy import SMTP
from email.utils import formatdate
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import UUID


class ConfigurationError(Exception):
    """Deliberately contains no configuration values or credentials."""


class RpcError(Exception):
    """Deliberately contains no server response, URL, or request headers."""


class WorkerDeadline(Exception):
    """Interrupt even a peer that keeps a per-socket timeout alive."""


def checked_url(value: str, *, allow_backend_path: bool = False) -> str:
    try:
        url = urlsplit(value)
        local = ipaddress.ip_address(url.hostname or "").is_loopback
    except ValueError:
        local = False
    try:
        port = url.port
        if (
                not url.hostname
                or url.username is not None
                or url.password is not None
                or url.query
                or url.fragment
                or any(ord(char) <= 32 or ord(char) == 127 for char in value)
                or "\\" in value
                or (url.scheme != "https" and not (url.scheme == "http" and local))
                or (url.path.rstrip("/") not in (["", "/backend"] if allow_backend_path else [""]))
                or (port is not None and not 1 <= port <= 65535)
        ):
            raise ConfigurationError("invalid_url")
    except (ValueError, UnboundLocalError):
        raise ConfigurationError("invalid_url") from None
    return value.rstrip("/")


def valid_email(value: Any) -> bool:
    return (
            isinstance(value, str)
            and len(value) <= 254
            and re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}", value) is not None
            and ".." not in value
    )


def integer(env: dict[str, str], key: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(env.get(key, str(default)))
    except ValueError:
        raise ConfigurationError("invalid_number") from None
    if not minimum <= value <= maximum:
        raise ConfigurationError("invalid_number")
    return value


@dataclass(frozen=True, repr=False)
class Config:
    api_url: str
    service_key: str
    portal_url: str
    smtp_username: str
    smtp_password: str
    smtp_host: str = "127.0.0.1"
    smtp_port: int = 2526
    batch: int = 10
    timeout: int = 15
    academy: bool = False

    @classmethod
    def from_env(cls, env: dict[str, str]) -> "Config":
        service_key = env.get("PORTAL_NOTIFICATION_SERVICE_KEY", "")
        username = env.get("PORTAL_NOTIFICATION_SMTP_USERNAME", "relay@example.invalid")
        password = env.get("PORTAL_NOTIFICATION_SMTP_PASSWORD", "")
        if (
                not service_key
                or len(service_key) > 8192
                or any(char.isspace() for char in service_key)
                or not valid_email(username)
                or not password
                or len(password) > 1024
                or "\x00" in password
        ):
            raise ConfigurationError("missing_or_invalid_credentials")
        port = integer(env, "PORTAL_NOTIFICATION_SMTP_PORT", 2526, 1, 65535)
        if port != 2526:
            raise ConfigurationError("smtp_relay_port_required")
        mode = env.get("PORTAL_NOTIFICATION_EDITION", "internal")
        api_url = env.get("PORTAL_NOTIFICATION_API_URL", "")
        if mode not in {"academy", "internal"} or (mode == "academy" and api_url != "http://api-gw:8000"):
            raise ConfigurationError("invalid_worker_route")
        return cls(
            api_url=api_url if mode == "academy" else checked_url(api_url, allow_backend_path=True),
            service_key=service_key,
            portal_url=checked_url(env.get("PORTAL_NOTIFICATION_APP_ORIGIN", "")),
            smtp_username=username,
            smtp_password=password,
            smtp_host="mail-relay" if mode == "academy" else "127.0.0.1",
            smtp_port=port,
            batch=integer(env, "PORTAL_NOTIFICATION_BATCH", 10, 1, 20),
            timeout=integer(env, "PORTAL_NOTIFICATION_TIMEOUT_SECONDS", 15, 1, 20),
            academy=mode == "academy",
        )


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Do not forward the service key to a redirected destination.
        return None


class RpcClient:
    def __init__(self, config: Config):
        self.config = config
        self.opener = build_opener(ProxyHandler({}), NoRedirect()) if config.academy else build_opener(NoRedirect())

    def call(self, name: str, payload: dict[str, Any]) -> Any:
        if name not in {
            "lease_notification_emails",
            "refresh_notification_reminders",
            "prepare_notification_email",
            "finish_notification_email",
        }:
            raise RpcError("rpc_not_allowed")
        request = Request(
            f"{self.config.api_url}/rest/v1/rpc/{name}",
            data=json.dumps(payload, separators=(",", ":")).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Accept": "application/json",
                "apikey": self.config.service_key,
                "Authorization": f"Bearer {self.config.service_key}",
            },
            method="POST",
        )
        try:
            with self.opener.open(request, timeout=self.config.timeout) as response:
                body = response.read(65537)
                if response.status != 200 or len(body) > 65536:
                    raise RpcError("rpc_response_invalid")
                return json.loads(body)
        except HTTPError as error:
            error.close()
            raise RpcError("rpc_unavailable") from None
        except (URLError, OSError, ValueError):
            raise RpcError("rpc_unavailable") from None


def canonical_uuid(value: Any) -> bool:
    try:
        return isinstance(value, str) and str(UUID(value)) == value
    except (ValueError, AttributeError):
        return False


def lease_valid(value: Any) -> bool:
    return (
            isinstance(value, dict)
            and canonical_uuid(value.get("id"))
            and canonical_uuid(value.get("lease_token"))
    )


def prepared_valid(value: Any, lease: dict[str, str]) -> bool:
    return (
            lease_valid(value)
            and value["id"] == lease["id"]
            and value["lease_token"] == lease["lease_token"]
            and valid_email(value.get("recipient"))
            and value.get("locale") in ("de", "en")
            and value.get("message_id") == f"<luminovia-notification.{lease['id']}@luminovia.org>"
    )


def make_message(config: Config, delivery: dict[str, Any]) -> EmailMessage:
    german = delivery["locale"] == "de"
    cancelled = delivery.get("kind") == "claim_cancelled"
    subject = (
        "Luminovia: Ein Auftrag wurde abgesagt" if cancelled else "Luminovia: Neue Benachrichtigung"
    ) if german else (
        "Luminovia: An assignment was cancelled" if cancelled else "Luminovia: New notification"
    )
    intro = "In deinem Luminovia-Portal gibt es eine neue Meldung." if german else "There is a new update in your Luminovia portal."
    closing = "Melde dich an, um die Meldung sicher zu öffnen. Deine E-Mail-Einstellungen kannst du im Portal ändern." if german else "Sign in to open the update securely. You can change your email preferences in the portal."
    message = EmailMessage(policy=SMTP)
    message["From"] = f"Luminovia <{config.smtp_username}>"
    message["To"] = delivery["recipient"]
    message["Subject"] = subject
    message["Date"] = formatdate(localtime=False, usegmt=True)
    message["Message-ID"] = delivery["message_id"]
    if config.academy:
        subject = "Neue Akademie-Benachrichtigung" if german else "New academy notification"
        intro = "In deiner Akademie gibt es eine neue Meldung." if german else "There is a new update in your academy."
        message.replace_header("Subject", subject)
        message.replace_header("Message-ID", f"<academy-notification.{delivery['id']}@{urlsplit(config.portal_url).hostname}>")
        message["X-Luminovia-Notification-Lease"] = f"{delivery['id']} {delivery['lease_token']}"
    message.set_content(f"{intro}\n\n{config.portal_url}/notifications\n\n{closing}\n", charset="utf-8")
    return message


def smtp_delivery(config: Config, delivery: dict[str, Any]) -> tuple[str, str | None]:
    """Submit to the loopback-only relay and preserve uncertainty after the DATA boundary."""
    if config.smtp_host != ("mail-relay" if config.academy else "127.0.0.1") or config.smtp_port != 2526:
        return "failed", "smtp_relay_config"
    connection = None
    data_started = False
    try:
        connection = smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=config.timeout)
        connection.ehlo()
        connection.login(config.smtp_username, config.smtp_password)
        code, _ = connection.mail(config.smtp_username)
        if code != 250:
            return ("retry" if 400 <= code < 500 else "failed", "smtp_sender_rejected")
        code, _ = connection.rcpt(delivery["recipient"])
        if code not in (250, 251):
            return ("retry" if 400 <= code < 500 else "failed", "smtp_recipient_rejected")
        message = make_message(config, delivery)
        data_started = True
        code, _ = connection.data(message.as_bytes())
        if code != 250:
            return ("retry" if 400 <= code < 500 else "failed", "smtp_data_rejected")
        return "accepted", None
    except smtplib.SMTPResponseException as error:
        # A negative SMTP response explicitly rejects this operation. Unlike a
        # lost final DATA reply, a documented 4xx rejection is safe to retry.
        return ("retry" if 400 <= error.smtp_code < 500 else "failed", "smtp_explicit_rejection")
    except ssl.SSLError:
        return ("uncertain", "smtp_ambiguous") if data_started else ("failed", "smtp_tls")
    except WorkerDeadline:
        return ("uncertain", "worker_deadline") if data_started else ("retry", "worker_deadline")
    except (OSError, smtplib.SMTPException):
        return ("uncertain", "smtp_ambiguous") if data_started else ("retry", "smtp_connection")
    finally:
        if connection is not None:
            # QUIT failure after DATA acceptance must not cause a resend.
            try:
                connection.close()
            except (OSError, smtplib.SMTPException):
                pass


def _run(config, rpc, sender, result, deadline):
    if not config.academy:
        refreshed = rpc.call("refresh_notification_reminders", {"p_limit": 100})
        if type(refreshed) is not int or not 0 <= refreshed <= 100000:
            raise RpcError("invalid_reminder_count")
    leases = rpc.call("lease_notification_emails", {"p_limit": config.batch})
    if not isinstance(leases, list) or len(leases) > config.batch or not all(map(lease_valid, leases)):
        raise RpcError("invalid_leases")
    for lease in leases:
        if time.monotonic() >= deadline:
            result["rpc_errors"] += 1
            break
        parameters = {"p_id": lease["id"], "p_lease_token": lease["lease_token"]}
        try:
            delivery = rpc.call("prepare_notification_email", parameters)
        except RpcError:
            result["rpc_errors"] += 1
            # Unknown whether prepare committed. Do not send or release the
            # lease: expired sending becomes uncertain; expired leased retries.
            continue
        if delivery is None:
            result["suppressed"] += 1
            continue
        if not prepared_valid(delivery, lease):
            outcome, error = "failed", "payload_invalid"
        else:
            outcome, error = sender(config, delivery)
        result[outcome] += 1
        if time.monotonic() >= deadline:
            # The batch alarm may have been handled inside SMTP so its exact
            # stage can be recorded. Permit one separately bounded completion
            # call, including a peer that continually drips response bytes.
            signal.setitimer(signal.ITIMER_REAL, config.timeout)
        try:
            finished = rpc.call("finish_notification_email", {
                **parameters,
                "p_outcome": outcome,
                "p_error_code": error,
            })
            if finished is not True:
                result["rpc_errors"] += 1
        except RpcError:
            result["rpc_errors"] += 1
            # In particular, never resend after SMTP accepted but finish failed.


def run(config: Config, rpc: RpcClient | Any = None, sender=None, *, budget_seconds=240) -> dict[str, int]:
    """Linux worker: 240s wall budget plus at most one 20s completion RPC.

    The alarm interrupts slow/dripping peers as well as ordinary socket waits.
    An interrupted SMTP DATA is uncertain. An API interruption leaves its
    server-side lease fenced, rather than falsely reporting success.
    """
    if not 0 < budget_seconds <= 240:
        raise ConfigurationError("invalid_worker_budget")
    result = {key: 0 for key in ("accepted", "retry", "failed", "uncertain", "suppressed", "rpc_errors")}
    previous_handler = signal.getsignal(signal.SIGALRM)
    previous_timer = signal.getitimer(signal.ITIMER_REAL)
    if previous_timer[0] > 0:
        raise ConfigurationError("worker_already_timed")

    def expire(_signal, _frame):
        raise WorkerDeadline()

    signal.signal(signal.SIGALRM, expire)
    signal.setitimer(signal.ITIMER_REAL, budget_seconds)
    try:
        _run(config, rpc or RpcClient(config), sender or smtp_delivery, result, time.monotonic() + budget_seconds)
    except WorkerDeadline:
        result["rpc_errors"] += 1
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
    return result


def main(argv=None, env=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run", action="store_true", help="Permit one finite delivery batch; also requires explicit environment opt-in")
    parser.add_argument("--check", action="store_true", help="Validate configuration without network calls or leases")
    parser.add_argument("--watch-academy", action="store_true", help="Wait between finite batches inside the private academy worker")
    args = parser.parse_args(argv)
    env = dict(os.environ) if env is None else env
    if not args.run and not args.check:
        print('{"status":"dry_run","network_calls":0}')
        return 0
    if env.get("PORTAL_NOTIFICATION_MAIL_ENABLED") != "true":
        print('{"status":"disabled","network_calls":0}')
        return 0
    try:
        config = Config.from_env(env)
        if args.watch_academy and (not args.run or not config.academy):
            raise ConfigurationError("watch_requires_private_academy_worker")
        if args.check:
            print('{"status":"configuration_valid","network_calls":0}')
            return 0
        while True:
            try:
                counts = run(config)
                print(json.dumps({"status": "batch_complete", **counts}, separators=(",", ":")), flush=True)
            except RpcError:
                if not args.watch_academy:
                    raise
                print('{"status":"rpc_unavailable"}', file=sys.stderr, flush=True)
            if not args.watch_academy:
                return int(any(counts[key] for key in ("retry", "failed", "uncertain", "rpc_errors")))
            time.sleep(60)
    except ConfigurationError:
        print('{"status":"configuration_invalid"}', file=sys.stderr)
        return 2
    except RpcError:
        print('{"status":"rpc_unavailable"}', file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
