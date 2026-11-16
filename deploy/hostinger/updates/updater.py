#!/usr/bin/env python3
"""Pull verified public main releases; keep all credentials and data on this VM."""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import fcntl
import hashlib
import http.client
import importlib.util
import ipaddress
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import uuid

REPOSITORY = "Luminovia-Training-Consulting/Luminovia-Management-Tool"
BRANCH = "main"
API = "https://api.github.com/repos/" + REPOSITORY
DB = "luminovia-supabase-db-1"
SHA = re.compile(r"[a-f0-9]{40}\Z")
HASH = re.compile(r"[a-f0-9]{64}\Z")
IMAGE = re.compile(r"[A-Za-z0-9./_-]+(?::[A-Za-z0-9._-]+)?@sha256:[a-f0-9]{64}\Z")
WRITERS = ["auth", "rest", "realtime", "storage", "api-gw", "functions"]
MAX_ARCHIVE = 64 * 1024 * 1024
MAX_UNPACKED = 512 * 1024 * 1024
MAX_FILE = 64 * 1024 * 1024
MIN_FREE = 2 * 1024 * 1024 * 1024
CONTROLLER = "deploy/hostinger/updates/updater.py"
REBOOT_PENDING = Path("/run/luminovia-reboot-pending")
MAINTENANCE_LOCK = Path("/run/lock/luminovia-maintenance.lock")
REVIEWED_ROOT_UID = 0
REVIEWED_PLAN_FORMAT = "luminovia-reviewed-migration-plan-v1"
REVIEWED_PLAN_MAX_TTL = 7200


class UpdateError(Exception):
    """A stable, non-sensitive operator reason code."""


class RuntimeImagePullError(UpdateError):
    """A registry pull failed before application or persistent-data mutation."""


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def digest(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def private_directory(path):
    path = Path(path)
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink() or not path.is_dir():
        raise UpdateError("unsafe_private_directory")
    path.chmod(0o700)


def atomic_json(path, value):
    path = Path(path)
    private_directory(path.parent)
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
        json.dump(value, stream, sort_keys=True, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def read_environment(path):
    result = {}
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = re.fullmatch(r"([A-Z][A-Z0-9_]*)=(.*)", line)
        if not match:
            raise UpdateError("invalid_private_environment")
        key, value = match.groups()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if any(ord(character) < 32 for character in value):
            raise UpdateError("invalid_private_environment")
        result[key] = value
    return result


def allowed_path(name):
    if not isinstance(name, str) or not name or "\\" in name or "\x00" in name:
        return False
    path = PurePosixPath(name)
    if path.is_absolute() or any(part in ("", ".", "..") for part in name.split("/")):
        return False
    if name != path.as_posix() or any(part in ("private", ".local", ".git", "node_modules") for part in path.parts):
        return False
    if any(part.startswith(".env") and part != ".env.example" for part in path.parts):
        return False
    if name.startswith("site/"):
        return not any(part.startswith(".env") for part in path.parts)
    return name.startswith(("supabase/functions/", "supabase/migrations/", "deploy/hostinger/"))


def validate_manifest(value):
    if not isinstance(value, dict) or value.get("schemaVersion") != 1:
        raise UpdateError("invalid_release_manifest")
    if value.get("repository") != REPOSITORY or value.get("branch") != BRANCH:
        raise UpdateError("wrong_release_repository_or_branch")
    if not SHA.fullmatch(str(value.get("commit", ""))) or not HASH.fullmatch(str(value.get("archiveSha256", ""))):
        raise UpdateError("invalid_release_identity")
    files = value.get("files")
    if not isinstance(files, list) or not 1 <= len(files) <= 4096:
        raise UpdateError("invalid_release_file_list")
    by_path = {}
    total = 0
    for item in files:
        if not isinstance(item, dict) or not allowed_path(item.get("path")):
            raise UpdateError("unsafe_release_path")
        name, size = item["path"], item.get("size")
        if name in by_path or isinstance(size, bool) or not isinstance(size, int) or not 0 <= size <= MAX_FILE:
            raise UpdateError("invalid_release_file_size_or_duplicate")
        if not HASH.fullmatch(str(item.get("sha256", ""))):
            raise UpdateError("invalid_release_file_hash")
        total += size
        by_path[name] = item
    if total > MAX_UNPACKED or "site/index.html" not in by_path:
        raise UpdateError("invalid_release_total_size_or_entrypoint")
    for required in ("deploy/hostinger/compose.yml", "deploy/hostinger/selfhost/compose.yml", "deploy/hostinger/Caddyfile"):
        if required not in by_path:
            raise UpdateError("missing_runtime_configuration")
    runtime = value.get("runtime")
    if not isinstance(runtime, dict) or runtime.get("postgresMajor") != 17:
        raise UpdateError("postgres_major_requires_manual_migration")
    images = runtime.get("images")
    if not isinstance(images, list) or not images:
        raise UpdateError("missing_reviewed_image_inventory")
    seen = set()
    for item in images:
        if not isinstance(item, dict) or not re.fullmatch(r"[a-z][a-z0-9-]*", str(item.get("service", ""))):
            raise UpdateError("invalid_image_inventory")
        if item["service"] in seen or not IMAGE.fullmatch(str(item.get("image", ""))):
            raise UpdateError("unpinned_or_duplicate_runtime_image")
        seen.add(item["service"])
    build = value.get("publicBuild")
    if not isinstance(build, dict) or not HASH.fullmatch(str(build.get("publishableKeySha256", ""))):
        raise UpdateError("missing_public_build_identity")
    migrations = value.get("migrations")
    if not isinstance(migrations, list):
        raise UpdateError("missing_migration_inventory")
    versions = set()
    for migration in migrations:
        if not isinstance(migration, dict) or not re.fullmatch(r"[0-9]{14}", str(migration.get("version", ""))):
            raise UpdateError("invalid_migration_inventory")
        path = migration.get("path")
        if path not in by_path or not re.fullmatch(r"supabase/migrations/[0-9]{14}_[a-z0-9_]+\.sql", path):
            raise UpdateError("invalid_migration_inventory")
        if path.split("/")[-1][:14] != migration["version"] or migration["version"] in versions:
            raise UpdateError("duplicate_or_mismatched_migration")
        if migration.get("sha256") != by_path[path]["sha256"]:
            raise UpdateError("mismatched_migration_hash")
        versions.add(migration["version"])
    expected = {path for path in by_path if path.startswith("supabase/migrations/")}
    if expected != {item["path"] for item in migrations}:
        raise UpdateError("incomplete_migration_inventory")
    return by_path


def unpack_verified(archive, manifest, destination):
    files = validate_manifest(manifest)
    if Path(archive).stat().st_size > MAX_ARCHIVE or digest(archive) != manifest["archiveSha256"]:
        raise UpdateError("archive_hash_or_size_mismatch")
    private_directory(destination)
    seen = set()
    with tarfile.open(archive, "r:gz") as source:
        for member in source:
            name = member.name.rstrip("/") if member.isdir() else member.name
            if member.isdir():
                if not any(item.startswith(name + "/") for item in files):
                    raise UpdateError("unexpected_archive_directory")
                continue
            if not member.isfile() or not allowed_path(name) or name not in files or name in seen:
                raise UpdateError("unsafe_or_unlisted_archive_member")
            if member.size != files[name]["size"]:
                raise UpdateError("archive_member_size_mismatch")
            target = Path(destination) / name
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            stream = source.extractfile(member)
            if stream is None:
                raise UpdateError("unreadable_archive_member")
            value = hashlib.sha256()
            descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "wb") as output:
                remaining = member.size
                while remaining:
                    chunk = stream.read(min(1024 * 1024, remaining))
                    if not chunk:
                        raise UpdateError("truncated_archive_member")
                    output.write(chunk)
                    value.update(chunk)
                    remaining -= len(chunk)
            if value.hexdigest() != files[name]["sha256"]:
                raise UpdateError("archive_member_hash_mismatch")
            # Static files/configuration must be readable by their existing container UIDs.
            target.chmod(0o644)
            seen.add(name)
    if seen != set(files):
        raise UpdateError("missing_archive_member")


def visible_sql(source):
    """Remove SQL quoted values/comments while retaining executable statement tokens."""
    result = []
    index = 0
    while index < len(source):
        if source.startswith("--", index):
            end = source.find("\n", index + 2)
            index = len(source) if end == -1 else end
            result.append(" ")
        elif source.startswith("/*", index):
            depth = 1
            index += 2
            while index < len(source) and depth:
                if source.startswith("/*", index):
                    depth += 1
                    index += 2
                elif source.startswith("*/", index):
                    depth -= 1
                    index += 2
                else:
                    index += 1
            if depth:
                raise UpdateError("invalid_migration_sql")
            result.append(" ")
        elif source[index] in "\"'":
            quote = source[index]
            escaped = quote == "'" and index > 0 and source[index - 1] in "Ee" and (index < 2 or not (source[index - 2].isalnum() or source[index - 2] == "_"))
            index += 1
            while index < len(source):
                if source[index] == quote:
                    if index + 1 < len(source) and source[index + 1] == quote:
                        index += 2
                        continue
                    index += 1
                    break
                if source[index] == "\\" and escaped:
                    index += 2
                else:
                    index += 1
            else:
                raise UpdateError("invalid_migration_sql")
            result.append(" ")
        elif source[index] == "$" and (match := re.match(r"\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$", source[index:])):
            delimiter = match.group()
            end = source.find(delimiter, index + len(delimiter))
            if end < 0:
                raise UpdateError("invalid_migration_sql")
            index = end + len(delimiter)
            result.append(" ")
        else:
            result.append(source[index])
            index += 1
    return "".join(result)


def compatible_migration(source):
    visible = visible_sql(source)
    statements = [part.strip() for part in visible.split(";") if part.strip()]
    if len(statements) < 2 or statements[0].lower() not in ("begin", "begin transaction") or statements[-1].lower() != "commit":
        raise UpdateError("migration_requires_single_transaction")
    if not re.match(r"\s*(?:--[^\n]*\n\s*)*begin(?:\s+transaction)?\s*;", source, re.I) or not re.search(r"(?m)^\s*commit;\s*\Z", source, re.I):
        raise UpdateError("migration_transaction_delimiters_require_own_lines")
    for statement in statements[1:-1]:
        upper = statement.upper()
        first = upper.split()[0]
        if first in {"DROP", "TRUNCATE", "DELETE", "UPDATE", "MERGE", "EXECUTE", "DO", "CALL", "COPY", "ROLLBACK", "COMMIT", "BEGIN", "VACUUM", "REINDEX", "CLUSTER"}:
            raise UpdateError("migration_requires_operator_review")
        if first == "ALTER" and re.search(r"\b(DROP|RENAME|SYSTEM)\b|\bALTER\s+COLUMN\b", upper):
            raise UpdateError("migration_requires_operator_review")
        if first == "INSERT" and re.search(r"\bDO\s+UPDATE\b", upper):
            raise UpdateError("migration_requires_operator_review")
        if first == "WITH" and re.search(r"\b(DELETE|UPDATE|INSERT|MERGE|CALL)\b", upper):
            raise UpdateError("migration_requires_operator_review")
        if re.search(r"\bSTANDARD_CONFORMING_STRINGS\b", upper):
            raise UpdateError("migration_requires_operator_review")


def reviewed_transaction(source):
    """Only the exact reviewed SQL may cross the automatic policy boundary.

    Review is not permission to escape the one-transaction/history envelope or
    alter the parser's string semantics. The ordinary classifier stays intact.
    """
    visible = visible_sql(source)
    statements = [part.strip() for part in visible.split(";") if part.strip()]
    if len(statements) < 2 or statements[0].lower() not in ("begin", "begin transaction") or statements[-1].lower() != "commit":
        raise UpdateError("migration_requires_single_transaction")
    if not re.match(r"\s*(?:--[^\n]*\n\s*)*begin(?:\s+transaction)?\s*;", source, re.I) or not re.search(r"(?m)^\s*commit;\s*\Z", source, re.I):
        raise UpdateError("migration_transaction_delimiters_require_own_lines")
    for statement in statements[1:-1]:
        upper = statement.upper()
        if upper.split()[0] in {"BEGIN", "COMMIT", "ROLLBACK", "ABORT", "END", "SAVEPOINT", "RELEASE", "PREPARE"} or re.search(r"\bSTANDARD_CONFORMING_STRINGS\b|\bALTER\s+SYSTEM\b|\bCOPY\b.*\bPROGRAM\b", upper):
            raise UpdateError("reviewed_migration_transaction_escape")


def canonical_digest(value):
    """Bind all structured release fields without depending on JSON whitespace."""
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, allow_nan=False).encode()).hexdigest()


def fsync_directory(path):
    """Persist an exclusive plan/tombstone entry, including new subdirectories."""
    descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def validate_reviewed_plan_time(plan):
    """Check lifetime again at consumption after potentially slow network calls."""
    try:
        issued = dt.datetime.fromisoformat(plan["createdAt"])
        expires = dt.datetime.fromisoformat(plan["expiresAt"])
        current = dt.datetime.now(dt.timezone.utc)
        if issued.tzinfo is None or expires.tzinfo is None or not 0 < (expires - issued).total_seconds() <= REVIEWED_PLAN_MAX_TTL or issued > current or current >= expires:
            raise ValueError()
    except (KeyError, ValueError, TypeError) as error:
        raise UpdateError("reviewed_plan_expired_or_invalid_time") from error


def history_inventory(history):
    """Keep source fingerprints, never database credentials or application rows."""
    if not isinstance(history, dict) or not history or len(history) > 4096:
        raise UpdateError("reviewed_plan_requires_existing_source_history")
    if any(not isinstance(version, str) or not re.fullmatch(r"[0-9]{14}", version) or not isinstance(source, str) for version, source in history.items()):
        raise UpdateError("invalid_reviewed_plan_history")
    result = []
    for version in sorted(history):
        result.append({"version": version, "sha256": hashlib.sha256(history[version].encode()).hexdigest()})
    return result


def imported_history(path):
    """Accept an explicit offline operator snapshot; apply still rereads live SQL."""
    try:
        rows = json.loads(Path(path).read_text(encoding="utf8"))
        if not isinstance(rows, list):
            raise ValueError()
        result = {}
        for row in rows:
            if not isinstance(row, dict) or set(row) != {"version", "source"} or row["version"] in result:
                raise ValueError()
            result[row["version"]] = row["source"]
        history_inventory(result)
        return result
    except (OSError, ValueError, TypeError, KeyError, UpdateError) as error:
        raise UpdateError("invalid_reviewed_plan_history_input") from error


def migration_sql(source, version, name, *, operator_reviewed=False):
    if operator_reviewed:
        reviewed_transaction(source)
    else:
        compatible_migration(source)
    delimiter = "$cms_history_" + uuid.uuid4().hex + "$"
    if delimiter in source:
        raise UpdateError("invalid_migration_delimiter")
    record = "INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES ('" + version + "','" + name + "',ARRAY[" + delimiter + source + delimiter + "]);\n"
    ending = re.search(r"(?m)^\s*commit;\s*\Z", source, re.I)
    command = source[:ending.start()] + "\n" + record + "COMMIT;\n"
    opening = re.match(r"\s*(?:--[^\n]*\n\s*)*begin(?:\s+transaction)?\s*;", command, re.I)
    return command[:opening.end()] + "\nSELECT pg_advisory_xact_lock(hashtext('luminovia.schema_migrations'));\n" + command[opening.end():]


class SafeRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        parsed = urllib.parse.urlparse(new_url)
        if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port not in (None, 443) or parsed.hostname not in {"api.github.com", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"}:
            raise UpdateError("unsafe_release_redirect")
        return super().redirect_request(request, response, code, message, headers, new_url)


class Updater:
    def __init__(self, root=Path("/opt/luminovia-portal")):
        self.root = Path(root).absolute()
        self.private = self.root / "private"
        self.control = self.private / "updates"
        self.source = self.root / "source"
        self.www = self.root / "www"
        self.state_file = self.control / "state.json"
        self.state = json.loads(self.state_file.read_text()) if self.state_file.exists() else {}
        self.opener = urllib.request.build_opener(SafeRedirect())
        self.maintenance = self.www / "maintenance.enabled"

    def command(self, arguments, *, data=None, output=None, timeout=300):
        try:
            result = subprocess.run(arguments, input=data, stdout=output if output is not None else subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=timeout)
            return b"" if output is not None else result.stdout
        except (subprocess.SubprocessError, OSError) as error:
            raise UpdateError("subprocess_" + Path(arguments[0]).name + "_failed") from error

    def sql(self, source, *, database="postgres", user="postgres"):
        return self.command(["docker", "exec", "-i", DB, "psql", "-U", user, "-d", database, "-X", "-qAt", "-v", "ON_ERROR_STOP=1"], data=source.encode()).decode().strip()

    def compose(self, kind, arguments, *, tree=None):
        tree = Path(tree or self.source)
        directory = tree / "deploy/hostinger" / ("selfhost" if kind == "backend" else "")
        env = self.private / ("selfhost.env" if kind == "backend" else "web.env")
        return self.command(["docker", "compose", "--project-directory", str(directory), "--env-file", str(env), "-f", str(directory / "compose.yml"), *arguments], timeout=600)

    def pull_runtime_images(self, tree):
        # Configuration/manifest validation happens separately before this narrow
        # wrapper. No stop, backup, file promotion or data mutation belongs here.
        try:
            self.compose("backend", ["pull", "--quiet"], tree=tree)
            self.compose("web", ["pull", "--quiet"], tree=tree)
        except UpdateError as error:
            raise RuntimeImagePullError("runtime_image_pull_failed") from error

    def api(self, path, *, missing_ok=False):
        request = urllib.request.Request(API + path, headers={"Accept": "application/vnd.github+json", "User-Agent": "Luminovia-Development-Updater/1", "X-GitHub-Api-Version": "2026-03-10"})
        try:
            with self.opener.open(request, timeout=20) as response:
                data = response.read(2 * 1024 * 1024 + 1)
                if len(data) > 2 * 1024 * 1024:
                    raise UpdateError("github_response_too_large")
                return json.loads(data)
        except UpdateError:
            raise
        except urllib.error.HTTPError as error:
            if missing_ok and error.code == 404:
                return None
            raise UpdateError("github_request_failed") from error
        except (OSError, ValueError, urllib.error.URLError) as error:
            raise UpdateError("github_request_failed") from error

    def candidate(self):
        # GitHub's release list order is not a deployment ordering guarantee.
        # Read current main first, then resolve that commit's exact release tag.
        branch = self.api("/branches/main")
        commit = branch.get("commit", {}).get("sha") if isinstance(branch, dict) else None
        if not isinstance(commit, str) or not SHA.fullmatch(commit):
            raise UpdateError("invalid_github_main_response")
        if commit == self.state.get("currentCommit"):
            return {"status": "current", "commit": commit}
        if commit == self.state.get("failedCommit"):
            return {"status": "failed_release_suppressed", "commit": commit}
        # Four API calls only for a new release; normal polls use one.
        tag_name = "cms-dev-" + commit
        release = self.api("/releases/tags/" + tag_name, missing_ok=True)
        if release is None or isinstance(release, dict) and release.get("draft"):
            return {"status": "waiting_for_main_release", "commit": commit}
        if not isinstance(release, dict) or release.get("tag_name") != tag_name:
            raise UpdateError("release_tag_identity_mismatch")
        if release.get("immutable") is not True:
            raise UpdateError("automatic_release_must_be_immutable")
        tag = self.api("/git/ref/tags/" + release["tag_name"])
        if tag.get("object", {}).get("type") != "commit" or tag.get("object", {}).get("sha") != commit:
            raise UpdateError("release_tag_commit_mismatch")
        runs = self.api("/actions/workflows/ci.yml/runs?branch=main&status=success&head_sha=" + commit + "&per_page=10")
        if not any(run.get("head_sha") == commit and run.get("head_branch") == BRANCH and run.get("event") in {"push", "workflow_dispatch"} and run.get("status") == "completed" and run.get("conclusion") == "success" and run.get("path", "").split("@")[0] == ".github/workflows/ci.yml" for run in runs.get("workflow_runs", [])):
            return {"status": "waiting_for_successful_main_checks", "commit": commit}
        assets = {}
        prefix = "https://github.com/" + REPOSITORY + "/releases/download/" + release["tag_name"] + "/"
        for name in ("cms-release.tar.gz", "cms-release.json"):
            matches = [item for item in release.get("assets", []) if item.get("name") == name and item.get("state") == "uploaded"]
            if len(matches) != 1 or matches[0].get("browser_download_url") != prefix + name:
                raise UpdateError("missing_or_unsafe_release_asset")
            assets[name] = matches[0]["browser_download_url"]
        return {"status": "candidate", "commit": commit, "assets": assets}

    def download(self, url, path, limit):
        request = urllib.request.Request(url, headers={"User-Agent": "Luminovia-Development-Updater/1"})
        descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "wb") as output, self.opener.open(request, timeout=60) as response:
                count = 0
                for chunk in iter(lambda: response.read(1024 * 1024), b""):
                    count += len(chunk)
                    if count > limit:
                        raise UpdateError("release_download_too_large")
                    output.write(chunk)
        except UpdateError:
            raise
        except (OSError, urllib.error.URLError, http.client.HTTPException) as error:
            raise UpdateError("release_download_failed") from error

    def defer_network_retry(self, code, commit=None):
        attempts = min(int(self.state.get("networkRetryAttempts", 0)) + 1, 10)
        deadline = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=min(3600, 300 * 2 ** (attempts - 1)))
        if commit and self.state.get("failedCommit") == commit:
            self.state["failedCommit"] = None
        self.state.update({"status": "waiting_for_network_retry", "networkRetryAttempts": attempts, "nextNetworkRetryAt": deadline.isoformat(), "lastTransientFailureCode": code, "lastTransientFailureAt": now()})
        atomic_json(self.state_file, self.state)
        return {"status": "waiting_for_network_retry", "commit": commit, "retryAt": deadline.isoformat()}

    def verify_public_build(self, manifest):
        env = read_environment(self.private / "selfhost.env")
        expected = env.get("SUPABASE_PUBLISHABLE_KEY", "")
        url = env.get("SUPABASE_PUBLIC_URL", "")
        if not expected.startswith("sb_publishable_") or not url.startswith("https://"):
            raise UpdateError("invalid_instance_public_configuration")
        build = manifest["publicBuild"]
        if build.get("apiUrl") != url or build["publishableKeySha256"] != hashlib.sha256(expected.encode()).hexdigest():
            raise UpdateError("release_public_configuration_mismatch")
        return env

    def current_history(self):
        raw = self.sql("SELECT coalesce(json_agg(json_build_object('version',version,'source',statements[1])),'[]'::json)::text FROM supabase_migrations.schema_migrations;")
        return {row["version"]: row["source"] for row in json.loads(raw)}

    def migration_inventory(self, tree, manifest, applied, *, operator_reviewed=False):
        """Review can permit exact new SQL, never reorder or rewrite history."""
        candidates = {item["version"]: item for item in manifest["migrations"]}
        if set(applied) - set(candidates):
            raise UpdateError("release_would_remove_applied_migration")
        pending = []
        for version in sorted(candidates):
            item = candidates[version]
            # Do not translate CRLF: history and the approved digest bind bytes.
            source = (Path(tree) / item["path"]).read_bytes().decode("utf-8")
            if version in applied:
                if source != applied[version]:
                    raise UpdateError("applied_migration_source_drift")
            else:
                if applied and version <= max(applied):
                    raise UpdateError("out_of_order_migration")
                if operator_reviewed:
                    reviewed_transaction(source)
                else:
                    compatible_migration(source)
                pending.append((version, Path(item["path"]).name[15:-4], source))
        return pending

    def plan_migrations(self, tree, manifest):
        return self.migration_inventory(tree, manifest, self.current_history())

    def reviewed_pending_inventory(self, tree, manifest, history):
        """Report each pending source and why normal unattended policy rejects it."""
        pending = self.migration_inventory(tree, manifest, history, operator_reviewed=True)
        by_version = {item["version"]: item for item in manifest["migrations"]}
        result = []
        for version, _name, source in pending:
            reason = None
            try:
                compatible_migration(source)
            except UpdateError as error:
                if str(error) != "migration_requires_operator_review":
                    raise
                reason = str(error)
            result.append({"version": version, "path": by_version[version]["path"], "sha256": hashlib.sha256(source.encode()).hexdigest(), "reviewRequired": reason is not None, "reviewReason": reason})
        return pending, result

    def make_reviewed_migration_plan(self, archive, manifest, *, history=None, installed_commit=None, ttl_seconds=3600):
        """Read verified bytes/history; never alter running services or data."""
        validate_manifest(manifest)
        if isinstance(ttl_seconds, bool) or not isinstance(ttl_seconds, int) or not 60 <= ttl_seconds <= REVIEWED_PLAN_MAX_TTL:
            raise UpdateError("invalid_reviewed_plan_ttl")
        installed_commit = installed_commit if installed_commit is not None else self.state.get("currentCommit")
        if not SHA.fullmatch(str(installed_commit or "")) or installed_commit == manifest["commit"]:
            raise UpdateError("reviewed_plan_requires_distinct_installed_commit")
        history = self.current_history() if history is None else history
        applied = history_inventory(history)
        with tempfile.TemporaryDirectory(prefix="luminovia-reviewed-plan-") as directory:
            unpack_verified(archive, manifest, directory)
            _pending, inventory = self.reviewed_pending_inventory(directory, manifest, history)
        if not inventory:
            raise UpdateError("reviewed_plan_requires_pending_migrations")
        stamp = dt.datetime.now(dt.timezone.utc)
        return {"format": REVIEWED_PLAN_FORMAT, "id": str(uuid.uuid4()), "root": str(self.root), "repository": REPOSITORY, "branch": BRANCH,
                "fromCommit": installed_commit, "targetCommit": manifest["commit"], "manifestSha256": canonical_digest(manifest), "archiveSha256": manifest["archiveSha256"],
                "applied": applied, "historySha256": canonical_digest(applied), "pending": inventory,
                "createdAt": stamp.isoformat(), "expiresAt": (stamp + dt.timedelta(seconds=ttl_seconds)).isoformat()}

    def checked_reviewed_plan_path(self, path):
        """Require a direct private root-owned file, with no writable ancestors."""
        path = Path(path).absolute()
        directory = self.control / "reviewed-migrations"
        if path.parent != directory or not re.fullmatch(r"[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,150}\.json", path.name):
            raise UpdateError("reviewed_plan_requires_private_updates_directory")
        for parent in (directory, self.control, self.private, self.root):
            info = parent.lstat()
            if not stat.S_ISDIR(info.st_mode) or info.st_uid != REVIEWED_ROOT_UID or info.st_mode & 0o022:
                raise UpdateError("unsafe_reviewed_plan_directory")
        return path

    def write_reviewed_migration_plan(self, path, plan):
        """Create a reviewable file exclusively; never replace an existing grant."""
        private_directory(self.control / "reviewed-migrations")
        path = self.checked_reviewed_plan_path(path)
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        except OSError as error:
            raise UpdateError("reviewed_plan_output_already_exists_or_unsafe") from error
        with os.fdopen(descriptor, "w", encoding="utf8") as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(plan, stream, sort_keys=True, indent=2, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        fsync_directory(path.parent)
        fsync_directory(self.control)
        return canonical_digest(plan)

    def read_reviewed_migration_plan(self, path):
        """Reject links, permissive modes, duplicate fields, expired/replayed grants."""
        try:
            path = self.checked_reviewed_plan_path(path)
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(descriptor, "r", encoding="utf8") as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != REVIEWED_ROOT_UID or info.st_nlink != 1 or not 1 <= info.st_size <= 2 * 1024 * 1024:
                    raise UpdateError("unsafe_reviewed_plan_file")
                def unique_object(pairs):
                    result = {}
                    for key, value in pairs:
                        if key in result:
                            raise ValueError("duplicate key")
                        result[key] = value
                    return result
                def finite_constant(_value):
                    raise ValueError("nonfinite value")
                plan = json.loads(stream.read(2 * 1024 * 1024 + 1), object_pairs_hook=unique_object, parse_constant=finite_constant)
        except (OSError, ValueError, UnicodeError) as error:
            raise UpdateError("unsafe_or_invalid_reviewed_plan") from error
        fields = {"format", "id", "root", "repository", "branch", "fromCommit", "targetCommit", "manifestSha256", "archiveSha256", "applied", "historySha256", "pending", "createdAt", "expiresAt"}
        try:
            if not isinstance(plan, dict) or set(plan) != fields or plan["format"] != REVIEWED_PLAN_FORMAT or str(uuid.UUID(plan["id"])) != plan["id"]:
                raise ValueError()
        except (ValueError, TypeError, AttributeError) as error:
            raise UpdateError("invalid_reviewed_plan_format") from error
        validate_reviewed_plan_time(plan)
        consumed = self.control / "reviewed-migrations" / "used" / (plan["id"] + ".json")
        if consumed.exists() or consumed.is_symlink():
            raise UpdateError("reviewed_plan_already_consumed")
        return plan

    def validate_reviewed_migration_plan(self, path, tree, manifest):
        """Rebind the file to this live instance and the entire verified release."""
        plan = self.read_reviewed_migration_plan(path)
        if plan["root"] != str(self.root) or plan["repository"] != REPOSITORY or plan["branch"] != BRANCH:
            raise UpdateError("reviewed_plan_target_instance_mismatch")
        if plan["fromCommit"] != self.state.get("currentCommit") or not SHA.fullmatch(str(plan["fromCommit"])) or plan["targetCommit"] != manifest["commit"]:
            raise UpdateError("reviewed_plan_commit_mismatch")
        if plan["manifestSha256"] != canonical_digest(manifest) or plan["archiveSha256"] != manifest["archiveSha256"]:
            raise UpdateError("reviewed_plan_manifest_mismatch")
        history = self.current_history()
        applied = history_inventory(history)
        pending, inventory = self.reviewed_pending_inventory(tree, manifest, history)
        if plan["applied"] != applied or plan["historySha256"] != canonical_digest(applied):
            raise UpdateError("reviewed_plan_history_drift")
        if not inventory or plan["pending"] != inventory:
            raise UpdateError("reviewed_plan_pending_mismatch")
        return plan, pending

    def consume_reviewed_migration_plan(self, plan):
        """Durably reserve the UUID before mutation, even if physical rollback runs."""
        directory = self.control / "reviewed-migrations" / "used"
        private_directory(directory)
        path = directory / (plan["id"] + ".json")
        value = {"format": "luminovia-consumed-migration-plan-v1", "id": plan["id"], "planSha256": canonical_digest(plan), "fromCommit": plan["fromCommit"], "targetCommit": plan["targetCommit"], "manifestSha256": plan["manifestSha256"], "historySha256": plan["historySha256"], "consumedAt": now()}
        try:
            # A slow last release check must not extend approval lifetime. Only
            # the exclusive local reservation follows this check, no network.
            validate_reviewed_plan_time(plan)
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        except OSError as error:
            raise UpdateError("reviewed_plan_already_consumed_or_unsafe") from error
        with os.fdopen(descriptor, "w", encoding="utf8") as stream:
            os.fchmod(stream.fileno(), 0o600)
            json.dump(value, stream, sort_keys=True, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        # Persist both the record and the `used` directory's parent entry before
        # any SQL. Physical rollback only swaps data mounts, never these files.
        fsync_directory(directory)
        fsync_directory(directory.parent)
        fsync_directory(self.control)
        self.state["lastReviewedMigrationPlan"] = value
        atomic_json(self.state_file, self.state)

    def require_fresh_complete_backup(self, tree):
        """Require the separate encrypted recovery set before entering downtime."""
        path = Path(tree) / "deploy/hostinger/backups/complete_backup.py"
        if not path.is_file() or path.is_symlink():
            raise UpdateError("missing_verified_complete_backup_helper")
        spec = importlib.util.spec_from_file_location("luminovia_reviewed_backup_" + digest(path), path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        if not module.CompleteBackup(root=self.root).fresh(max_age_hours=26):
            raise UpdateError("reviewed_migration_requires_fresh_complete_backup")

    def verify_reviewed_release_identity(self, manifest):
        """Local bytes must equal the immutable, green, current-main release."""
        candidate = self.candidate()
        if candidate.get("status") != "candidate" or candidate.get("commit") != manifest["commit"]:
            raise UpdateError("reviewed_release_requires_eligible_current_main")
        private_directory(self.control / "downloads")
        with tempfile.TemporaryDirectory(prefix="reviewed-identity-", dir=self.control / "downloads") as directory:
            path = Path(directory) / "manifest.json"
            self.download(candidate["assets"]["cms-release.json"], path, 4 * 1024 * 1024)
            try:
                published = json.loads(path.read_text(encoding="utf8"))
                validate_manifest(published)
            except (ValueError, UnicodeError) as error:
                raise UpdateError("invalid_reviewed_published_manifest") from error
            if canonical_digest(published) != canonical_digest(manifest):
                raise UpdateError("reviewed_local_manifest_differs_from_release")

    @contextlib.contextmanager
    def reviewed_host_lock(self):
        """Use the same host lock as backup/OS/systemd, retaining inherited locks."""
        descriptor = None
        inherited = False
        try:
            if MAINTENANCE_LOCK.parent.is_symlink() or not MAINTENANCE_LOCK.parent.is_dir():
                raise UpdateError("unsafe_maintenance_lock_directory")
            descriptor = os.open(MAINTENANCE_LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_uid != REVIEWED_ROOT_UID or info.st_mode & 0o022 or info.st_nlink != 1:
                raise UpdateError("unsafe_maintenance_lock")
            for raw in os.listdir("/proc/self/fd"):
                try:
                    other = int(raw)
                    if other == descriptor:
                        continue
                    candidate = os.fstat(other)
                    if (candidate.st_dev, candidate.st_ino) == (info.st_dev, info.st_ino):
                        details = Path("/proc/self/fdinfo") / raw
                        held = details.read_text(encoding="ascii")
                        if not any(line.startswith("lock:") and "FLOCK" in line and "WRITE" in line for line in held.splitlines()):
                            continue
                        fcntl.flock(other, fcntl.LOCK_EX | fcntl.LOCK_NB)
                        inherited = True
                        break
                except (OSError, ValueError):
                    continue
            if not inherited:
                try:
                    fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError as error:
                    raise UpdateError("another_host_maintenance_running") from error
            self._reviewed_global_lock_held = True
            yield
        finally:
            self._reviewed_global_lock_held = False
            if descriptor is not None:
                os.close(descriptor)

    def rendered_images(self, tree):
        images = {}
        for kind in ("backend", "web"):
            configuration = json.loads(self.compose(kind, ["config", "--format", "json"], tree=tree))
            for service, settings in configuration.get("services", {}).items():
                image = settings.get("image", "")
                if not IMAGE.fullmatch(image) or service in images:
                    raise UpdateError("runtime_images_must_be_immutable")
                images[service] = image
        return images

    def verify_runtime(self, tree, manifest):
        images = self.rendered_images(tree)
        declared = {item["service"]: item["image"] for item in manifest["runtime"]["images"]}
        if images != declared:
            raise UpdateError("runtime_image_manifest_mismatch")
        if not re.fullmatch(r"supabase/postgres:17\.[^@]+@sha256:[a-f0-9]{64}", images.get("db", "")):
            raise UpdateError("postgres_major_requires_manual_migration")
        current = self.rendered_images(self.source)
        changed = images != current
        self.changed_image_services = {service for service in images if images[service] != current.get(service)}
        if changed and manifest["runtime"].get("reviewed") is not True:
            raise UpdateError("runtime_change_requires_reviewed_bundle")
        return changed, images.get("db") != current.get("db")

    def release_changes(self, manifest):
        changed = set()
        runtime_files = set()
        controller_changed = False
        for item in manifest["files"]:
            name = item["path"]
            if name.startswith("site/"):
                continue
            controller = name == CONTROLLER
            target = self.root / "control/updater.py" if controller else self.source / name
            if target.is_symlink() or any(parent.is_symlink() for parent in target.parents):
                raise UpdateError("unsafe_existing_source_path")
            matches = target.is_file() and target.stat().st_size == item["size"] and digest(target) == item["sha256"]
            if controller:
                controller_changed = not matches
            else:
                runtime_files.add(name)
                if not matches:
                    changed.add(name)
        previous_files = self.state.get("installedRuntimeFiles", [])
        if not isinstance(previous_files, list) or any(not isinstance(name, str) or not allowed_path(name) or name.startswith("site/") or name == CONTROLLER for name in previous_files):
            raise UpdateError("invalid_installed_runtime_inventory")
        # A known removal never qualifies for a site-only update. Runtime
        # deletion/reconciliation remains an operator-reviewed full deployment.
        changed.update(set(previous_files) - runtime_files)
        return changed, controller_changed, sorted(runtime_files)

    def activate_web(self, changed):
        forced = []
        if "deploy/hostinger/Caddyfile" in changed:
            forced.append("web")
        if "deploy/hostinger/clamd.conf" in changed:
            forced.append("clamav")
        normal = [service for service in ("web", "clamav") if service not in forced]
        if normal:
            self.compose("web", ["up", "-d", "--wait", *normal])
        if forced:
            # File bind mounts keep their old inode after atomic source copying.
            self.compose("web", ["up", "-d", "--wait", "--force-recreate", "--no-deps", *forced])

    def install_controller(self, tree):
        updater = Path(tree) / CONTROLLER
        if updater.exists():
            destination = self.root / "control/updater.py"
            if destination.is_symlink() or any(parent.is_symlink() for parent in destination.parents):
                raise UpdateError("unsafe_existing_controller_path")
            private_directory(destination.parent)
            temporary = destination.with_name(".updater-" + uuid.uuid4().hex + ".py")
            shutil.copy2(updater, temporary)
            temporary.chmod(0o700)
            os.replace(temporary, destination)

    def preflight_space(self, tree):
        data = self.root / "data/storage"
        object_bytes = 0
        for path in data.rglob("*"):
            if path.is_symlink():
                raise UpdateError("unsafe_storage_symlink")
            if path.is_file():
                object_bytes += path.stat().st_size
        db_bytes = int(self.sql("SELECT pg_database_size(current_database());"))
        stage_bytes = sum(path.stat().st_size for path in Path(tree).rglob("*") if path.is_file())
        required = object_bytes + 2 * db_bytes + 2 * stage_bytes + MIN_FREE
        if shutil.disk_usage(self.root).free < required:
            raise UpdateError("insufficient_free_disk_for_safe_update")

    def os_updates_busy(self):
        state = self.command(["systemctl", "show", "apt-daily-upgrade.service", "--property=ActiveState", "--value"], timeout=10).decode().strip()
        return state in {"activating", "active", "reloading", "deactivating"}

    def backup(self, commit):
        root = self.private / "update-backups"
        private_directory(root)
        complete = sorted((path for path in root.iterdir() if path.is_dir() and not path.is_symlink() and (path / "manifest.json").is_file()), key=lambda path: path.name)
        # Keep at most one older complete backup before creating the next (two total).
        for old in complete[:-1]:
            metadata = json.loads((old / "manifest.json").read_text())
            if metadata.get("format") == "luminovia-automatic-update-backup-v1" and metadata.get("status") == "complete":
                shutil.rmtree(old)
        path = root / (dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + commit[:12] + "-" + uuid.uuid4().hex[:8])
        private_directory(path)
        artifacts = {}
        try:
            commands = {
                "database.dump": ["docker", "exec", DB, "pg_dump", "-U", "postgres", "-d", "postgres", "--format=custom", "--no-password"],
                "roles.sql": ["docker", "exec", DB, "pg_dumpall", "-U", "postgres", "--roles-only", "--no-role-passwords"],
                "storage.tar": ["tar", "--create", "--file=-", "--directory=" + str(self.root / "data/storage"), "."],
            }
            for name, arguments in commands.items():
                descriptor = os.open(path / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(descriptor, "wb") as output:
                    self.command(arguments, output=output, timeout=1800)
                artifacts[name] = {"sha256": digest(path / name), "size": (path / name).stat().st_size}
            atomic_json(path / "manifest.json", {"format": "luminovia-automatic-update-backup-v1", "status": "complete", "commit": commit, "createdAt": now(), "quiescence": "backend writer services stopped", "offSite": False, "configurationSecretsIncluded": False, "artifacts": artifacts})
            return path
        except Exception:
            shutil.rmtree(path)
            raise

    def collation_guard(self, manifest):
        rows = json.loads(self.sql("SELECT coalesce(json_agg(json_build_object('name',datname,'allow',datallowconn,'template',datistemplate)),'[]'::json)::text FROM pg_database WHERE datcollversion IS NOT NULL AND datcollversion IS DISTINCT FROM pg_database_collation_actual_version(oid);", user="supabase_admin"))
        if not rows:
            return
        runtime = manifest["runtime"]
        approved = runtime.get("collationReindexApproved") is True
        permitted = runtime.get("collationDatabases", [])
        if not approved or any(not row["allow"] or row["name"] not in permitted for row in rows):
            raise UpdateError("collation_rebuild_requires_operator_review")
        for row in rows:
            identifier = '"' + row["name"].replace('"', '""') + '"'
            self.sql("REINDEX DATABASE " + identifier + ";", database=row["name"], user="supabase_admin")
            self.sql("ALTER DATABASE " + identifier + " REFRESH COLLATION VERSION;", user="supabase_admin")
        if self.sql("SELECT count(*) FROM pg_database WHERE datcollversion IS NOT NULL AND datcollversion IS DISTINCT FROM pg_database_collation_actual_version(oid);", user="supabase_admin") != "0":
            raise UpdateError("collation_rebuild_not_confirmed")

    def copy_runtime(self, tree, manifest, rollback, original):
        replacements = []
        for item in manifest["files"]:
            name = item["path"]
            if name.startswith("site/") or name == CONTROLLER:
                continue
            source, target = Path(tree) / name, self.source / name
            if target.is_symlink() or any(parent.is_symlink() for parent in target.parents if parent != self.source.parent):
                raise UpdateError("unsafe_existing_source_path")
            if target.exists():
                saved = rollback / name
                saved.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(target, saved)
            original[name] = target.exists()
            replacements.append((source, target))
        # Keep the entire recovery map and old files with the data backup, before
        # replacing any source. Staging is removed even after a failed update.
        atomic_json(rollback.parent / "runtime-original-map.json", {
            "format": "luminovia-runtime-recovery-v1",
            "capturedAt": now(),
            "sourceRoot": str(self.source),
            "files": original,
        })
        for source, target in replacements:
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_name(target.name + ".cms-update-" + uuid.uuid4().hex)
            shutil.copy2(source, temporary)
            os.replace(temporary, target)
        return original

    def rollback_runtime(self, original, rollback):
        for name, existed in original.items():
            target = self.source / name
            if existed:
                shutil.copy2(rollback / name, target)
            elif target.is_file() and not target.is_symlink():
                target.unlink()

    def prepare_site(self, tree, commit):
        release = self.www / "releases" / commit
        if release.exists():
            if (self.www / "current").is_symlink() and release.resolve() == (self.www / "current").resolve():
                raise UpdateError("refusing_to_overwrite_active_release")
            shutil.rmtree(release)
        release.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(Path(tree) / "site", release)
        for path in release.rglob("*"):
            path.chmod(0o755 if path.is_dir() else 0o644)
        release.chmod(0o755)
        assets = release / "assets"
        shared = [(source, self.www / "assets" / source.relative_to(assets)) for source in assets.rglob("*") if source.is_file()] if assets.exists() else []
        shared += [(source, self.www / source.name) for source in release.glob("workbox-*.js") if source.is_file() and re.fullmatch(r"workbox-[A-Za-z0-9_-]+\.js", source.name)]
        for source, target in shared:
            if not source.is_file():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                if digest(target) != digest(source):
                    raise UpdateError("immutable_asset_collision")
            else:
                shutil.copy2(source, target)
                target.chmod(0o644)
        return release

    def promote(self, target):
        if (self.www / "current").exists() and not (self.www / "current").is_symlink():
            raise UpdateError("static_current_must_be_release_symlink")
        temporary = self.www / (".current-" + uuid.uuid4().hex)
        os.symlink(target, temporary)
        os.replace(temporary, self.www / "current")

    def runtime_helper(self, tree, name):
        path = Path(tree) / "deploy/hostinger/maintenance" / (name + ".py")
        specification = importlib.util.spec_from_file_location("luminovia_" + name, path)
        if specification is None or specification.loader is None:
            raise UpdateError("missing_verified_runtime_helper")
        module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(module)
        return module

    def create_checkpoint(self, tree, *, include_clamav):
        return self.runtime_helper(tree, "atomic_recovery").create_checkpoint(self, include_clamav=include_clamav)

    def restore_checkpoint(self, tree, checkpoint, *, public_unblocked, restart_old_runtime, verify_health):
        return self.runtime_helper(tree, "atomic_recovery").restore_checkpoint(self, checkpoint, public_unblocked=public_unblocked, restart_old_runtime=restart_old_runtime, verify_health=verify_health)

    def postgres_preflight(self, tree, manifest):
        image = next(item["image"] for item in manifest["runtime"]["images"] if item["service"] == "db")
        return self.runtime_helper(tree, "pg_preflight").run_preflight(self, tree, image)

    def health(self, env, expected_index=None, *, private_api=False):
        for project, services in (("luminovia-supabase", (*WRITERS, "db", "mailpit")), ("luminovia-portal", ("web", "clamav"))):
            for service in services:
                state = json.loads(self.command(["docker", "inspect", "--format", "{{json .State}}", project + "-" + service + "-1"]))
                if state.get("Running") is not True or state.get("Paused") is True or state.get("OOMKilled") is True or (service != "web" and state.get("Health", {}).get("Status") != "healthy"):
                    raise UpdateError("runtime_container_health_failed")
        api_url = env["SUPABASE_PUBLIC_URL"]
        if private_api:
            network = json.loads(self.command(["docker", "inspect", "--format", "{{json .NetworkSettings.Networks}}", "luminovia-supabase-api-gw-1"]))
            address = network.get("luminovia-portal-backend", {}).get("IPAddress", "")
            try:
                parsed = ipaddress.ip_address(address)
                if parsed.version != 4 or not parsed.is_private:
                    raise ValueError()
            except ValueError as error:
                raise UpdateError("unsafe_private_gateway_address") from error
            api_url = "http://" + address + ":8000"
        for endpoint in ("/auth/v1/health", "/auth/v1/.well-known/jwks.json"):
            request = urllib.request.Request(api_url + endpoint, headers={"apikey": env["SUPABASE_PUBLISHABLE_KEY"], "Cache-Control": "no-cache"})
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    body = response.read(2 * 1024 * 1024)
                    if response.status != 200:
                        raise UpdateError("public_api_health_failed")
                    if endpoint.endswith("jwks.json"):
                        data = json.loads(body)
                        keys = data.get("keys") if isinstance(data, dict) else None
                        if not isinstance(keys, list) or not keys or any(not isinstance(key, dict) or key.get("kty") not in {"EC", "RSA", "OKP"} or any(part in key for part in ("d", "k", "p", "q", "dp", "dq", "qi", "oth")) for key in keys):
                            raise UpdateError("private_signing_material_in_public_jwks")
            except UpdateError:
                raise
            except Exception as error:
                raise UpdateError("public_api_health_failed") from error
        if expected_index is not None:
            request = urllib.request.Request(env["PORTAL_APP_ORIGIN"], headers={"Cache-Control": "no-cache"})
            try:
                with urllib.request.urlopen(request, timeout=20) as response:
                    if response.status != 200 or response.read(MAX_FILE + 1) != expected_index:
                        raise UpdateError("static_release_health_failed")
            except UpdateError:
                raise
            except Exception as error:
                raise UpdateError("static_release_health_failed") from error

    def apply(self, archive, manifest, *, reviewed_migration_plan=None):
        validate_manifest(manifest)
        if reviewed_migration_plan is not None and not getattr(self, "_reviewed_global_lock_held", False):
            raise UpdateError("reviewed_migration_requires_host_maintenance_lock")
        commit = manifest["commit"]
        env = self.verify_public_build(manifest)
        stage_reserve = 2 * sum(item["size"] for item in manifest["files"]) + MAX_ARCHIVE + MIN_FREE
        if shutil.disk_usage(self.root).free < stage_reserve:
            raise UpdateError("insufficient_free_disk_for_release_staging")
        private_directory(self.control / "staging")
        stage = Path(tempfile.mkdtemp(prefix=commit + "-", dir=self.control / "staging"))
        rollback = stage / ".rollback"
        original = {}
        runtime_changed = False
        runtime_mutated = False
        stopped = False
        promoted = False
        checkpoint = None
        public_unblocked = False
        mode = "validation"
        changed = set()
        reviewed = None
        old_target = os.readlink(self.www / "current") if (self.www / "current").is_symlink() else None
        if old_target and (PurePosixPath(old_target).is_absolute() or ".." in PurePosixPath(old_target).parts or not old_target.startswith("releases/")):
            raise UpdateError("unsafe_previous_release_target")
        try:
            unpack_verified(archive, manifest, stage)
            if reviewed_migration_plan is not None:
                reviewed, pending = self.validate_reviewed_migration_plan(reviewed_migration_plan, stage, manifest)
                self.require_fresh_complete_backup(stage)
            else:
                pending = self.plan_migrations(stage, manifest)
            changed, controller_changed, runtime_files = self.release_changes(manifest)
            runtime_changed, database_changed = self.verify_runtime(stage, manifest)
            if (self.www / "current").exists() and not (self.www / "current").is_symlink():
                raise UpdateError("static_current_must_be_release_symlink")
            mode = "full" if changed or pending or runtime_changed or not old_target else "site_controller"
            if mode == "full":
                self.preflight_space(stage)
                self.pull_runtime_images(stage)
                self.preflight_space(stage)
            self.prepare_site(stage, commit)
            if mode == "full":
                self.www.mkdir(parents=True, exist_ok=True, mode=0o755)
                self.maintenance.write_text("Development update in progress.\n", encoding="utf-8")
                self.maintenance.chmod(0o644)
                stopped = True
                self.compose("backend", ["stop", *WRITERS])
                backup = self.backup(commit)
                self.state["lastBackup"] = str(backup)
                atomic_json(self.state_file, self.state)
                rollback = backup / "runtime-before"
                private_directory(rollback)
                checkpoint = self.create_checkpoint(stage, include_clamav="deploy/hostinger/clamd.conf" in changed or "clamav" in getattr(self, "changed_image_services", set()))
                if database_changed:
                    self.state["lastPostgresPreflight"] = self.postgres_preflight(stage, manifest)
                    atomic_json(self.state_file, self.state)
                if reviewed is not None:
                    # Writers are stopped and the complete physical checkpoint
                    # has been validated. Recheck live source history immediately
                    # before consuming this exact, single-use authorisation.
                    current_plan, current_pending = self.validate_reviewed_migration_plan(reviewed_migration_plan, stage, manifest)
                    if canonical_digest(current_plan) != canonical_digest(reviewed) or current_pending != pending:
                        raise UpdateError("reviewed_plan_changed_during_preflight")
                    # Long backups may outlive a main promotion. Refuse a stale
                    # candidate before spending this one-shot authorisation.
                    self.verify_reviewed_release_identity(manifest)
                    self.consume_reviewed_migration_plan(reviewed)
                runtime_mutated = True
                self.copy_runtime(stage, manifest, rollback, original)
                # Reconcile both services that remained running while writers
                # stopped; normal up preserves unchanged containers.
                self.compose("backend", ["up", "-d", "--wait", "db", "mailpit"])
                # Inspect actual catalog versions, not filesystem ICU guesses or image tags.
                self.collation_guard(manifest)
                for version, name, source in pending:
                    self.sql(migration_sql(source, version, name, operator_reviewed=reviewed is not None))
                self.sql("NOTIFY pgrst, 'reload schema';")
                self.compose("backend", ["up", "-d", "--wait", "--force-recreate", "--no-deps", *WRITERS])
                self.activate_web(changed)
            self.promote("releases/" + commit)
            promoted = True
            if mode == "full":
                # Keep all external writers fenced until candidate checks pass.
                self.health(env, (stage / "site/index.html").read_bytes(), private_api=True)
                public_unblocked = True
                self.maintenance.unlink(missing_ok=True)
            self.health(env, (stage / "site/index.html").read_bytes())
            if controller_changed:
                self.install_controller(stage)
            self.state.update({"status": "updated", "currentCommit": commit, "previousCommit": self.state.get("currentCommit"), "lastSuccessAt": now(), "failedCommit": None, "failureCode": None, "manualRecoveryRequired": False, "bootstrapApproved": False, "appliedMigrationVersions": [item[0] for item in pending], "lastUpdateMode": mode, "lastAttemptMode": mode, "backupCreatedForCurrentUpdate": mode == "full", "installedRuntimeFiles": runtime_files, "networkRetryAttempts": 0, "nextNetworkRetryAt": None})
            atomic_json(self.state_file, self.state)
            return {"status": "updated", "commit": commit, "mode": mode}
        except Exception as error:
            code = str(error) if isinstance(error, UpdateError) else "unexpected_update_failure"
            if stopped and public_unblocked:
                # Fence new writes immediately. No physical data rollback is
                # allowed once the candidate has admitted external requests.
                self.maintenance.write_text("Operator recovery required.\n", encoding="utf-8")
                self.maintenance.chmod(0o644)
            recovered = not stopped
            if promoted and old_target:
                try:
                    self.promote(old_target)
                except Exception:
                    recovered = False
            if stopped and checkpoint is not None and not public_unblocked:
                try:
                    self.rollback_runtime(original, rollback)
                    def restart_old_runtime():
                        self.compose("backend", ["up", "-d", "--wait", "--force-recreate", "db", "mailpit"])
                        self.compose("backend", ["up", "-d", "--wait", "--force-recreate", "--no-deps", *WRITERS])
                        self.compose("web", ["up", "-d", "--wait", "--force-recreate", "--no-deps", "web", *(("clamav",) if "clamav" in getattr(self, "changed_image_services", set()) or "deploy/hostinger/clamd.conf" in changed else ())])
                    self.restore_checkpoint(stage, checkpoint, public_unblocked=False, restart_old_runtime=restart_old_runtime, verify_health=lambda: self.health(env, private_api=True))
                    self.maintenance.unlink(missing_ok=True)
                    self.health(env)
                    recovered = True
                except Exception:
                    recovered = False
            elif stopped and not runtime_mutated:
                try:
                    self.rollback_runtime(original, rollback)
                    # A checkpoint/preflight failure can leave db/mailpit
                    # stopped or the web/scanner paused, even before copying
                    # source. Reconcile these before restarting API writers.
                    self.compose("backend", ["up", "-d", "--wait", "db", "mailpit"])
                    self.compose("backend", ["up", "-d", "--wait", "--force-recreate", "--no-deps", *WRITERS])
                    self.compose("web", ["up", "-d", "--wait", "--force-recreate", "--no-deps", "web", *(("clamav",) if "clamav" in getattr(self, "changed_image_services", set()) or "deploy/hostinger/clamd.conf" in changed else ())])
                    self.health(env, private_api=True)
                    self.maintenance.unlink(missing_ok=True)
                    self.health(env)
                    recovered = True
                except Exception:
                    recovered = False
            if not recovered:
                self.maintenance.write_text("Operator recovery required.\n", encoding="utf-8")
                self.maintenance.chmod(0o644)
            self.state.update({"status": "failed", "failedCommit": commit, "failureCode": code, "lastFailureAt": now(), "manualRecoveryRequired": not recovered, "lastAttemptMode": mode})
            self.state["automaticRollbackCompleted"] = bool(recovered and checkpoint is not None and not public_unblocked)
            atomic_json(self.state_file, self.state)
            if isinstance(error, RuntimeImagePullError) and not stopped and not runtime_mutated and not promoted:
                raise RuntimeImagePullError(code) from error
            raise UpdateError(code) from error
        finally:
            # The staged directory is unique and owned; application data are elsewhere.
            shutil.rmtree(stage, ignore_errors=True)

    def once(self, *, package=None, manifest_path=None, retry_failed=False, reviewed_migration_plan=None):
        if reviewed_migration_plan is not None:
            if package is None or manifest_path is None:
                raise UpdateError("reviewed_migration_requires_explicit_local_release")
            if not getattr(self, "_reviewed_global_lock_held", False):
                with self.reviewed_host_lock():
                    return self.once(package=package, manifest_path=manifest_path, retry_failed=retry_failed, reviewed_migration_plan=reviewed_migration_plan)
        private_directory(self.control)
        lock = os.open(self.control / "updater.lock", os.O_WRONLY | os.O_CREAT, 0o600)
        try:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return {"status": "another_update_running"}
            self.state = json.loads(self.state_file.read_text()) if self.state_file.exists() else {}
            if REBOOT_PENDING.exists():
                return {"status": "operating_system_reboot_pending"}
            if self.state.get("manualRecoveryRequired") and not retry_failed:
                return {"status": "operator_recovery_required", "commit": self.state.get("failedCommit")}
            if self.os_updates_busy():
                return {"status": "operating_system_security_update_running"}
            if self.maintenance.exists() and not (retry_failed and self.state.get("manualRecoveryRequired")):
                return {"status": "maintenance_already_active"}
            if retry_failed:
                if reviewed_migration_plan is not None:
                    retry_manifest = json.loads(Path(manifest_path).read_text())
                    validate_manifest(retry_manifest)
                    if self.state.get("failedCommit") != retry_manifest["commit"]:
                        raise UpdateError("reviewed_retry_requires_exact_failed_commit")
                self.state["failedCommit"] = None
            elif self.state.get("nextNetworkRetryAt"):
                try:
                    if dt.datetime.fromisoformat(self.state["nextNetworkRetryAt"]) > dt.datetime.now(dt.timezone.utc):
                        return {"status": "waiting_for_network_retry", "retryAt": self.state["nextNetworkRetryAt"]}
                except (ValueError, TypeError):
                    raise UpdateError("invalid_network_retry_state")
            if package is not None:
                manifest = json.loads(Path(manifest_path).read_text())
                validate_manifest(manifest)
                if manifest["commit"] == self.state.get("currentCommit"):
                    return {"status": "current", "commit": manifest["commit"]}
                if manifest["commit"] == self.state.get("failedCommit"):
                    return {"status": "failed_release_suppressed", "commit": manifest["commit"]}
                if reviewed_migration_plan is not None:
                    self.verify_reviewed_release_identity(manifest)
                    return self.apply(Path(package), manifest, reviewed_migration_plan=reviewed_migration_plan)
                return self.apply(Path(package), manifest)
            if not self.state.get("currentCommit") and self.state.get("bootstrapApproved") is not True:
                return {"status": "not_initialized"}
            try:
                candidate = self.candidate()
            except UpdateError as error:
                if str(error) == "github_request_failed":
                    return self.defer_network_retry(str(error))
                raise
            if candidate["status"] != "candidate":
                return candidate
            downloads = self.control / "downloads"
            private_directory(downloads)
            try:
                if shutil.disk_usage(self.root).free < MAX_ARCHIVE + MIN_FREE:
                    raise UpdateError("insufficient_free_disk_for_release_download")
                with tempfile.TemporaryDirectory(prefix=candidate["commit"] + "-", dir=downloads) as directory:
                    manifest_file, archive = Path(directory) / "manifest.json", Path(directory) / "release.tar.gz"
                    self.download(candidate["assets"]["cms-release.json"], manifest_file, 4 * 1024 * 1024)
                    try:
                        manifest = json.loads(manifest_file.read_text())
                    except (ValueError, UnicodeError) as error:
                        raise UpdateError("incomplete_release_metadata_download") from error
                    validate_manifest(manifest)
                    if manifest["commit"] != candidate["commit"]:
                        raise UpdateError("release_manifest_commit_mismatch")
                    self.download(candidate["assets"]["cms-release.tar.gz"], archive, MAX_ARCHIVE)
                    return self.apply(archive, manifest)
            except Exception as error:
                code = str(error) if isinstance(error, UpdateError) else "invalid_release_download"
                if (code in {"release_download_failed", "incomplete_release_metadata_download", "archive_hash_or_size_mismatch"} or isinstance(error, RuntimeImagePullError)) and not self.state.get("manualRecoveryRequired"):
                    return self.defer_network_retry(code, candidate["commit"])
                if self.state.get("failedCommit") != candidate["commit"]:
                    self.state.update({"status": "failed", "failedCommit": candidate["commit"], "failureCode": code, "lastFailureAt": now()})
                    atomic_json(self.state_file, self.state)
                raise
        finally:
            os.close(lock)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="Read-only GitHub/current-release inspection")
    mode.add_argument("--once", action="store_true", help="Apply an eligible release once")
    mode.add_argument("--plan-migrations", action="store_true", help="Read-only exact migration plan; does not authorise or apply it")
    parser.add_argument("--root", type=Path, default=Path("/opt/luminovia-portal"))
    parser.add_argument("--package", type=Path, help="Operator-approved local bootstrap/test package")
    parser.add_argument("--manifest", type=Path, help="External manifest for the local package")
    parser.add_argument("--retry-failed", action="store_true", help="Explicit operator retry of the failed SHA")
    parser.add_argument("--reviewed-migration-plan", type=Path, help="Explicit operator-reviewed private one-shot plan; requires --once and local release")
    parser.add_argument("--plan-output", type=Path, help="Create a new private root-owned plan file instead of printing it")
    parser.add_argument("--history-file", type=Path, help="Read-only JSON version/source snapshot for offline plan construction")
    parser.add_argument("--installed-commit", help="Installed SHA matching --history-file; apply rechecks live state")
    parser.add_argument("--plan-ttl-seconds", type=int, help="Plan lifetime, 60–7200 seconds (default 3600)")
    arguments = parser.parse_args()
    if bool(arguments.package) != bool(arguments.manifest):
        parser.error("Local packages require --package and --manifest together")
    if arguments.check and (arguments.package or arguments.retry_failed or arguments.reviewed_migration_plan):
        parser.error("--check cannot apply a local release or reviewed plan")
    if arguments.plan_migrations:
        if not arguments.package or arguments.retry_failed or arguments.reviewed_migration_plan:
            parser.error("--plan-migrations requires a local release and cannot apply or retry")
        if bool(arguments.history_file) != bool(arguments.installed_commit):
            parser.error("Offline planning requires --history-file and --installed-commit together")
    elif arguments.plan_output or arguments.history_file or arguments.installed_commit or arguments.plan_ttl_seconds is not None:
        parser.error("Plan construction options require --plan-migrations")
    if arguments.reviewed_migration_plan and (not arguments.once or not arguments.package):
        parser.error("Reviewed application requires --once --package --manifest --reviewed-migration-plan")
    try:
        updater = Updater(arguments.root)
        if arguments.plan_migrations:
            manifest = json.loads(arguments.manifest.read_text(encoding="utf8"))
            history = imported_history(arguments.history_file) if arguments.history_file else None
            plan = updater.make_reviewed_migration_plan(arguments.package, manifest, history=history, installed_commit=arguments.installed_commit, ttl_seconds=arguments.plan_ttl_seconds if arguments.plan_ttl_seconds is not None else 3600)
            plan_hash = updater.write_reviewed_migration_plan(arguments.plan_output, plan) if arguments.plan_output else canonical_digest(plan)
            result = {"status": "migration_plan", "planSha256": plan_hash, "plan": plan}
        elif arguments.check:
            result = updater.candidate()
        else:
            result = updater.once(package=arguments.package, manifest_path=arguments.manifest, retry_failed=arguments.retry_failed, reviewed_migration_plan=arguments.reviewed_migration_plan)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        code = str(error) if isinstance(error, UpdateError) else "unexpected_update_failure"
        print(json.dumps({"status": "failed", "failureCode": code}, sort_keys=True))
        return 1


if __name__ == "__main__":
    sys.exit(main())
