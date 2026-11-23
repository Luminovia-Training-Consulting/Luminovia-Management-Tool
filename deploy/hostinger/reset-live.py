#!/usr/bin/env python3
"""Reset the single owned CMS instance after live administrator confirmation."""
import argparse
import base64
import getpass
from http.server import BaseHTTPRequestHandler
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import stat
import sys
import urllib.request
from uuid import UUID

sys.path.insert(0, str(Path(__file__).resolve().parent / "updates"))
from updater import SHA, UpdateError, Updater, atomic_json, migration_sql, now, read_environment

ROOT = Path("/opt/luminovia-portal")
ORIGIN = "https://cms.luminovia.org"
MOUNTS = {
    "postgres": ("db", "/var/lib/postgresql/data"),
    "storage": ("storage", "/var/lib/storage"),
    "mailpit": ("mailpit", "/data"),
}
NETWORK = "luminovia-portal-backend"
WEB_PATH = "/__portal/hosted-reset"
WEB_CONFIRMATION = "RESET CONFIRM"
MAX_REQUEST = 24 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise UpdateError("unexpected_auth_redirect")


def require(condition, reason):
    if not condition:
        raise UpdateError(reason)


def trusted_directory(path):
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o022,
            "unsafe_installation_directory")


def check_mounts(data, mountinfo):
    # Reject mounted descendants before renaming or recursively removing data.
    for line in mountinfo.splitlines():
        name = line.split()[4]
        name = re.sub(r"\\([0-7]{3})", lambda match: chr(int(match[1], 8)), name)
        mount = Path(name)
        require(mount != data and not mount.is_relative_to(data), "separate_data_mount")
    require({entry.name for entry in data.iterdir()} == set(MOUNTS), "unknown_data_entries")
    for name in MOUNTS:
        target = data / name
        require(stat.S_ISDIR(target.lstat().st_mode) and target.stat().st_dev == data.stat().st_dev,
                "unsafe_data_path")


def private_gateway(updater):
    networks = json.loads(updater.command(["docker", "inspect", "--format",
                                           "{{json .NetworkSettings.Networks}}",
                                           "luminovia-supabase-api-gw-1"]))
    address = ipaddress.ip_address(networks[NETWORK]["IPAddress"])
    require(address.version == 4 and address.is_private and not address.is_loopback,
            "unsafe_private_gateway_address")
    return f"http://{address}:8000/auth/v1"


def auth_request(gateway, key, route, body=None, token=None):
    request = urllib.request.Request(gateway + route,
        data=None if body is None else json.dumps(body).encode(),
        headers={"apikey": key, "Content-Type": "application/json",
                 **({"Authorization": "Bearer " + token} if token else {})})
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    try:
        with opener.open(request, timeout=15) as response:
            data = response.read(256 * 1024 + 1)
            require(len(data) <= 256 * 1024, "oversized_auth_response")
            return json.loads(data)
    except (OSError, ValueError) as error:
        raise UpdateError("auth_request_failed") from error


def assert_current_admin(updater, user, session, *, fresh=True):
    age_check = "and s.created_at > statement_timestamp() - interval '5 minutes'" if fresh else ""
    allowed = updater.sql(f"""
      select exists (
        select 1 from public.user_roles r
        join public.profiles p on p.id=r.user_id and p.active
        join auth.users u on u.id=r.user_id and u.email_confirmed_at is not null
        join auth.sessions s on s.user_id=u.id and s.id='{session}'::uuid
        where u.id='{user}'::uuid and r.role in ('admin','owner')
          {age_check}
          and (s.not_after is null or s.not_after > statement_timestamp())
      );""")
    require(allowed == "t", "current_administrator_required")


def verified_identity(gateway, key, token):
    # Trust the decoded session identifier only after native Auth has verified the JWT.
    identity = auth_request(gateway, key, "/user", token=token)
    segment = token.split(".")[1]
    claims = json.loads(base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4)))
    user = UUID(identity["id"])
    require(UUID(claims["sub"]) == user, "session_identity_mismatch")
    return user, UUID(claims["session_id"]), identity.get("email")


def authenticate(updater, env, email, password):
    gateway, key = private_gateway(updater), env["SUPABASE_PUBLISHABLE_KEY"]
    signed_in = auth_request(gateway, key, "/token?grant_type=password",
                             {"email": email, "password": password})
    user, session, _ = verified_identity(gateway, key, signed_in["access_token"])
    assert_current_admin(updater, user, session)
    return user, session


def installed_migrations(updater):
    history = updater.current_history()
    directory = updater.source / "supabase/migrations"
    trusted_directory(directory)
    found = {}
    for file in sorted(directory.glob("*.sql")):
        match = re.fullmatch(r"([0-9]{14})_([a-z0-9_]+)\.sql", file.name)
        require(match and not file.is_symlink() and file.is_file(), "invalid_migration_path")
        version, name = match.groups()
        require(version not in found, "duplicate_migration_version")
        source = file.read_bytes().decode("utf-8")
        require(history.get(version) == source, "installed_migration_source_mismatch")
        found[version] = migration_sql(source, version, name, operator_reviewed=True)
    require(found and found.keys() == history.keys(), "installed_migration_inventory_mismatch")
    return [found[version] for version in sorted(found)]


def instance_environment(updater):
    require(os.geteuid() == 0, "host_root_required")
    for path in (ROOT, ROOT / "source", ROOT / "private", ROOT / "data", ROOT / "www"):
        trusted_directory(path)
    require(not updater.maintenance.exists() and not updater.maintenance.is_symlink()
            and not updater.state.get("manualRecoveryRequired"), "existing_maintenance_or_recovery")
    env_path = updater.private / "selfhost.env"
    info = env_path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and info.st_nlink == 1
            and not info.st_mode & 0o077, "unsafe_private_environment")
    env = read_environment(env_path)
    data = ROOT / "data"
    require(env.get("PORTAL_APP_ORIGIN") == ORIGIN and env.get("SUPABASE_PUBLIC_URL") == ORIGIN + "/backend"
            and env.get("PORTAL_DATA_DIR") == str(data), "unexpected_portal_instance")
    return env


def preflight(updater):
    env = instance_environment(updater)
    data = ROOT / "data"
    active = updater.state.get("currentCommit", "")
    require(SHA.fullmatch(active) and (updater.www / "current").readlink() == Path("releases") / active,
            "active_release_mismatch")
    check_mounts(data, Path("/proc/self/mountinfo").read_text())
    for name, (service, destination) in MOUNTS.items():
        mounts = json.loads(updater.command(["docker", "inspect", "--format", "{{json .Mounts}}",
                                              f"luminovia-supabase-{service}-1"]))
        matches = [item for item in mounts if item["Destination"] == destination]
        require(len(matches) == 1 and matches[0]["Type"] == "bind"
                and matches[0]["Source"] == str(data / name), "docker_data_mount_mismatch")
    updater.require_fresh_complete_backup(updater.source)
    return env, data, active, installed_migrations(updater)


def start_backend(updater):
    updater.compose("backend", ["up", "-d", "--wait", "--force-recreate"])
    updater.sql("NOTIFY pgrst, 'reload schema';")


def recreate(updater, env, migrations, email, password):
    # Start the full backend so Auth, Storage and Realtime apply their own migrations.
    start_backend(updater)
    updater.sql("""CREATE SCHEMA IF NOT EXISTS supabase_migrations;
      CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations
      (version text PRIMARY KEY, statements text[], name text);""")
    for migration in migrations:
        updater.sql(migration)
    updater.sql("""UPDATE private.document_storage_limits SET
      total_quota_bytes=10737418240, owner_quota_bytes=1073741824 WHERE singleton;
      NOTIFY pgrst, 'reload schema';""")
    gateway = private_gateway(updater)
    key = env["SERVICE_ROLE_KEY"]
    owner = auth_request(gateway, key, "/admin/users", {
        "email": email, "password": password, "email_confirm": True,
        "user_metadata": {"display_name": "Portal Owner"},
    }, key)
    user = UUID(owner["id"])
    updater.sql(f"""INSERT INTO public.user_roles(user_id,role) VALUES ('{user}'::uuid,'owner')
      ON CONFLICT DO NOTHING;""")
    require(updater.sql("""SELECT (SELECT count(*) FROM auth.users)=1
      AND (SELECT count(*) FROM storage.objects)=0
      AND (SELECT count(*) FROM public.organisations)=0
      AND (SELECT count(*) FROM public.user_roles)=1;""") == "t", "reset_database_not_clean")
    login = auth_request(gateway, env["SUPABASE_PUBLISHABLE_KEY"], "/token?grant_type=password",
                         {"email": email, "password": password})
    require(UUID(login["user"]["id"]) == user, "new_owner_login_failed")


def reset(updater, env, data, migrations, actor, email, password):
    journal = updater.private / "reset-state.json"
    if journal.exists():
        require(json.loads(journal.read_text()).get("status") in {"complete", "rolled_back"},
                "unresolved_previous_reset")
    assert_current_admin(updater, *actor)
    quarantine = data.parent / (".reset-data-" + secrets.token_hex(12))
    quarantine.mkdir(mode=0o700)
    moved = []
    result = {"instance": ORIGIN, "release": updater.state["currentCommit"],
              "actor": str(actor[0]), "startedAt": now(), "quarantine": quarantine.name}
    atomic_json(journal, {**result, "status": "starting"})
    with updater.maintenance.open("x", encoding="ascii") as flag:
        flag.write("Portal data reset in progress.\n")
    try:
        updater.compose("backend", ["stop"])
        check_mounts(data, Path("/proc/self/mountinfo").read_text())
        for name in MOUNTS:
            (data / name).rename(quarantine / name)
            moved.append(name)
            (data / name).mkdir(mode=0o755)
        recreate(updater, env, migrations, email, password)
        updater.health(env, private_api=True)
    except Exception:
        try:
            updater.compose("backend", ["stop"])
            for name in reversed(moved):
                replacement = data / name
                if replacement.exists():
                    require(not replacement.is_symlink(), "unsafe_new_data_path")
                    shutil.rmtree(replacement)
                (quarantine / name).rename(replacement)
            quarantine.rmdir()
            start_backend(updater)
            updater.health(env, private_api=True)
            atomic_json(journal, {**result, "status": "rolled_back"})
            updater.maintenance.unlink()
        except Exception as error:
            atomic_json(journal, {**result, "status": "manual_recovery_required"})
            raise UpdateError("reset_rollback_requires_operator") from error
        raise
    # After successful private verification, never roll back partially erased data.
    atomic_json(journal, {**result, "status": "removing_previous_data"})
    shutil.rmtree(quarantine)
    updater.maintenance.unlink()
    try:
        updater.health(env)
    except Exception:
        with updater.maintenance.open("x", encoding="ascii") as flag:
            flag.write("Portal reset needs a health check.\n")
        atomic_json(journal, {**result, "status": "manual_recovery_required"})
        raise
    atomic_json(journal, {**result, "status": "complete", "finishedAt": now()})


def apply_web_reset(token, current_password, new_password):
    updater = Updater(ROOT)
    env = instance_environment(updater)
    try:
        gateway = private_gateway(updater)
        user, session, email = verified_identity(gateway, env["SUPABASE_PUBLISHABLE_KEY"], token)
        assert_current_admin(updater, user, session, fresh=False)
        require(isinstance(email, str) and email, "missing_administrator_email")
    except (UpdateError, KeyError, TypeError, ValueError) as error:
        raise PermissionError("reset_authorization_failed") from error
    with updater.reviewed_host_lock():
        env, data, _, migrations = preflight(updater)
        try:
            assert_current_admin(updater, user, session, fresh=False)
            actor = authenticate(updater, env, email, current_password)
            require(actor[0] == user, "password_session_identity_mismatch")
        except (UpdateError, KeyError, TypeError, ValueError) as error:
            raise PermissionError("reset_authorization_failed") from error
        reset(updater, env, data, migrations, actor, email, new_password)


class WebResetRequest(BaseHTTPRequestHandler):
    # The accepting socket is Unix-only and root-owned. Caddy is the sole HTTP ingress.
    def log_message(self, *args):
        pass  # Never log request headers, paths or credential-bearing bodies.

    def respond(self, status, result):
        body = json.dumps(result).encode("ascii")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)

    def expected_target(self):
        return self.path == WEB_PATH and self.headers.get_all("Host") == ["cms.luminovia.org"]

    def do_GET(self):
        if not self.expected_target():
            return self.respond(404, {"status": "unavailable"})
        return self.respond(200, {"instance": ORIGIN})

    def do_POST(self):
        if not self.expected_target() or self.headers.get_all("Origin") != [ORIGIN]:
            return self.respond(403, {"status": "denied"})
        authorization = self.headers.get_all("Authorization") or []
        match = re.fullmatch(r"Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)",
                             authorization[0]) if len(authorization) == 1 else None
        if not match or len(match[1]) > 8192:
            return self.respond(403, {"status": "denied"})
        lengths = self.headers.get_all("Content-Length") or []
        if (self.headers.get_all("Content-Type") != ["application/json"]
                or self.headers.get("Transfer-Encoding") is not None
                or len(lengths) != 1 or not re.fullmatch(r"[0-9]{1,5}", lengths[0])
                or not 0 < int(lengths[0]) <= MAX_REQUEST):
            return self.respond(400, {"status": "invalid"})
        try:
            length = int(lengths[0])
            raw = self.rfile.read(length)
            require(len(raw) == length, "incomplete_request")
            data = json.loads(raw.decode("utf-8"))
            require(isinstance(data, dict) and data.keys() == {"confirmation", "password", "newPassword"}
                    and data["confirmation"] == WEB_CONFIRMATION, "invalid_confirmation")
            password, new_password = data["password"], data["newPassword"]
            require(isinstance(password, str) and 0 < len(password) <= 1024
                    and isinstance(new_password, str) and 16 <= len(new_password) <= 1024
                    and new_password != password, "invalid_password")
        except (UpdateError, UnicodeError, ValueError):
            return self.respond(400, {"status": "invalid"})
        # A disconnect during the operation does not interrupt the locked reset or rollback.
        try:
            apply_web_reset(match[1], password, new_password)
        except PermissionError:
            return self.respond(403, {"status": "denied"})
        except (UpdateError, OSError, KeyError, TypeError, ValueError, RuntimeError) as error:
            if isinstance(error, UpdateError) and str(error) == "reviewed_migration_requires_fresh_complete_backup":
                return self.respond(412, {"status": "backup_required"})
            print("Hosted reset failed. Inspect the private reset state and backup status.", file=sys.stderr)
            return self.respond(503, {"status": "unconfirmed"})
        return self.respond(200, {"status": "complete"})


def serve_web_request():
    # systemd socket activation passes the accepted connection on standard input.
    require(os.geteuid() == 0, "host_root_required")
    with socket.socket(fileno=0) as connection:
        require(connection.family == socket.AF_UNIX, "private_reset_socket_required")
        connection.settimeout(10)
        try:
            WebResetRequest(connection, "", None)
        except (ConnectionError, TimeoutError):
            pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--plan", action="store_true", help="Inspect the verified live reset target.")
    modes.add_argument("--apply", action="store_true", help="Interactively reset the verified live target.")
    modes.add_argument("--serve-web-request", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    try:
        if args.serve_web_request:
            serve_web_request()
            return 0
        require(os.geteuid() == 0, "host_root_required")
        updater = Updater(ROOT)
        with updater.reviewed_host_lock():
            env, data, release, migrations = preflight(updater)
            print(f"Verified reset target: {ORIGIN}, release {release}.")
            print("Reset deletes database records, accounts, sessions, uploaded files and captured mail.")
            print("A fresh owner is created. Deployment settings and encrypted backups are retained.")
            if args.plan:
                return 0
            require(sys.stdin.isatty() and sys.stderr.isatty(), "interactive_tty_required")
            email = input("Current administrator email: ").strip()
            current_password = getpass.getpass("Current administrator password: ")
            password = getpass.getpass("New owner password: ")
            require(len(password) >= 16 and password != current_password
                    and password == getpass.getpass("Repeat new password: "), "new_password_confirmation_failed")
            signature = "RESET " + ORIGIN + " " + secrets.token_hex(4)
            require(input(f"Type {signature} to irreversibly replace all active data: ") == signature,
                    "reset_confirmation_failed")
            actor = authenticate(updater, env, email, current_password)
            reset(updater, env, data, migrations, actor, email, password)
            print("Verified fresh portal and new owner. Reset complete.")
            return 0
    except (UpdateError, OSError, ValueError, KeyError, RuntimeError) as error:
        message = str(error) if isinstance(error, UpdateError) else "reset_aborted_inspect_private_reset_state"
        print(message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
