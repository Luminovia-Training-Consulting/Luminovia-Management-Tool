#!/usr/bin/env python3
"""Pull verified public main releases; keep all credentials and data on this VM."""

from __future__ import annotations

import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
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


class UpdateError(Exception):
    """A stable, non-sensitive operator reason code."""


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


def migration_sql(source, version, name):
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

    def api(self, path):
        request = urllib.request.Request(API + path, headers={"Accept": "application/vnd.github+json", "User-Agent": "Luminovia-Development-Updater/1", "X-GitHub-Api-Version": "2026-03-10"})
        try:
            with self.opener.open(request, timeout=20) as response:
                data = response.read(2 * 1024 * 1024 + 1)
                if len(data) > 2 * 1024 * 1024:
                    raise UpdateError("github_response_too_large")
                return json.loads(data)
        except UpdateError:
            raise
        except (OSError, ValueError, urllib.error.URLError) as error:
            raise UpdateError("github_request_failed") from error

    def candidate(self):
        releases = self.api("/releases?per_page=5")
        if not isinstance(releases, list):
            raise UpdateError("invalid_github_release_response")
        release = next((item for item in releases if isinstance(item, dict) and not item.get("draft") and re.fullmatch(r"cms-dev-[a-f0-9]{40}", str(item.get("tag_name", "")))), None)
        if release is None:
            return {"status": "no_published_release"}
        commit = release["tag_name"][8:]
        if release.get("immutable") is not True:
            raise UpdateError("automatic_release_must_be_immutable")
        if commit == self.state.get("currentCommit"):
            return {"status": "current", "commit": commit}
        if commit == self.state.get("failedCommit"):
            return {"status": "failed_release_suppressed", "commit": commit}
        # Four API calls only for a new release; normal polls use one.
        branch = self.api("/branches/main")
        if branch.get("commit", {}).get("sha") != commit:
            return {"status": "release_not_current_main", "commit": commit}
        tag = self.api("/git/ref/tags/" + release["tag_name"])
        if tag.get("object", {}).get("type") != "commit" or tag.get("object", {}).get("sha") != commit:
            raise UpdateError("release_tag_commit_mismatch")
        runs = self.api("/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&head_sha=" + commit + "&per_page=5")
        if not any(run.get("head_sha") == commit and run.get("head_branch") == BRANCH and run.get("event") == "push" and run.get("status") == "completed" and run.get("conclusion") == "success" and run.get("path", "").split("@")[0] == ".github/workflows/ci.yml" for run in runs.get("workflow_runs", [])):
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
        except (OSError, urllib.error.URLError) as error:
            raise UpdateError("release_download_failed") from error

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

    def plan_migrations(self, tree, manifest):
        applied = self.current_history()
        candidates = {item["version"]: item for item in manifest["migrations"]}
        if set(applied) - set(candidates):
            raise UpdateError("release_would_remove_applied_migration")
        pending = []
        for version in sorted(candidates):
            item = candidates[version]
            source = (Path(tree) / item["path"]).read_text(encoding="utf-8")
            if version in applied:
                if source != applied[version]:
                    raise UpdateError("applied_migration_source_drift")
            else:
                if applied and version <= max(applied):
                    raise UpdateError("out_of_order_migration")
                compatible_migration(source)
                pending.append((version, Path(item["path"]).name[15:-4], source))
        return pending

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
        if changed and manifest["runtime"].get("reviewed") is not True:
            raise UpdateError("runtime_change_requires_reviewed_bundle")
        return changed, images.get("db") != current.get("db")

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
            if name.startswith("site/") or name == "deploy/hostinger/updates/updater.py":
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

    def health(self, env, expected_index=None):
        for endpoint in ("/auth/v1/health", "/auth/v1/.well-known/jwks.json"):
            request = urllib.request.Request(env["SUPABASE_PUBLIC_URL"] + endpoint, headers={"apikey": env["SUPABASE_PUBLISHABLE_KEY"], "Cache-Control": "no-cache"})
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

    def apply(self, archive, manifest):
        validate_manifest(manifest)
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
        old_target = os.readlink(self.www / "current") if (self.www / "current").is_symlink() else None
        if old_target and (PurePosixPath(old_target).is_absolute() or ".." in PurePosixPath(old_target).parts or not old_target.startswith("releases/")):
            raise UpdateError("unsafe_previous_release_target")
        try:
            unpack_verified(archive, manifest, stage)
            pending = self.plan_migrations(stage, manifest)
            runtime_changed, _database_changed = self.verify_runtime(stage, manifest)
            self.preflight_space(stage)
            if (self.www / "current").exists() and not (self.www / "current").is_symlink():
                raise UpdateError("static_current_must_be_release_symlink")
            self.compose("backend", ["pull", "--quiet"], tree=stage)
            self.compose("web", ["pull", "--quiet"], tree=stage)
            self.preflight_space(stage)
            self.prepare_site(stage, commit)
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
            runtime_mutated = True
            self.copy_runtime(stage, manifest, rollback, original)
            self.compose("backend", ["up", "-d", "--wait", "db"])
            # Inspect actual catalog versions, not filesystem ICU guesses or image tags.
            self.collation_guard(manifest)
            for version, name, source in pending:
                self.sql(migration_sql(source, version, name))
            self.sql("NOTIFY pgrst, 'reload schema';")
            self.compose("backend", ["up", "-d", "--wait", "--force-recreate", "--no-deps", *WRITERS])
            self.compose("web", ["up", "-d", "--wait", "--force-recreate"])
            self.promote("releases/" + commit)
            promoted = True
            self.maintenance.unlink(missing_ok=True)
            self.health(env, (stage / "site/index.html").read_bytes())
            updater = stage / "deploy/hostinger/updates/updater.py"
            if updater.exists():
                destination = self.root / "control/updater.py"
                destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                temporary = destination.with_suffix(".py.new")
                shutil.copy2(updater, temporary)
                temporary.chmod(0o700)
                os.replace(temporary, destination)
            self.state.update({"status": "updated", "currentCommit": commit, "previousCommit": self.state.get("currentCommit"), "lastSuccessAt": now(), "failedCommit": None, "failureCode": None, "manualRecoveryRequired": False, "bootstrapApproved": False, "appliedMigrationVersions": [item[0] for item in pending]})
            atomic_json(self.state_file, self.state)
            return {"status": "updated", "commit": commit}
        except Exception as error:
            code = str(error) if isinstance(error, UpdateError) else "unexpected_update_failure"
            recovered = not stopped
            if promoted and old_target:
                self.promote(old_target)
            if stopped and (not runtime_changed or not runtime_mutated):
                try:
                    self.rollback_runtime(original, rollback)
                    self.compose("backend", ["up", "-d", "--wait", "--force-recreate", "--no-deps", *WRITERS])
                    self.compose("web", ["up", "-d", "--wait", "--force-recreate"])
                    self.maintenance.unlink(missing_ok=True)
                    self.health(env)
                    recovered = True
                except Exception:
                    recovered = False
            if not recovered:
                self.maintenance.write_text("Operator recovery required.\n", encoding="utf-8")
                self.maintenance.chmod(0o644)
            self.state.update({"status": "failed", "failedCommit": commit, "failureCode": code, "lastFailureAt": now(), "manualRecoveryRequired": not recovered})
            atomic_json(self.state_file, self.state)
            raise UpdateError(code) from error
        finally:
            # The staged directory is unique and owned; application data are elsewhere.
            shutil.rmtree(stage, ignore_errors=True)

    def once(self, *, package=None, manifest_path=None, retry_failed=False):
        private_directory(self.control)
        lock = os.open(self.control / "updater.lock", os.O_WRONLY | os.O_CREAT, 0o600)
        try:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return {"status": "another_update_running"}
            self.state = json.loads(self.state_file.read_text()) if self.state_file.exists() else {}
            if self.state.get("manualRecoveryRequired") and not retry_failed:
                return {"status": "operator_recovery_required", "commit": self.state.get("failedCommit")}
            if self.os_updates_busy():
                return {"status": "operating_system_security_update_running"}
            if self.maintenance.exists() and not (retry_failed and self.state.get("manualRecoveryRequired")):
                return {"status": "maintenance_already_active"}
            if retry_failed:
                self.state["failedCommit"] = None
            if package is not None:
                manifest = json.loads(Path(manifest_path).read_text())
                validate_manifest(manifest)
                if manifest["commit"] == self.state.get("currentCommit"):
                    return {"status": "current", "commit": manifest["commit"]}
                if manifest["commit"] == self.state.get("failedCommit"):
                    return {"status": "failed_release_suppressed", "commit": manifest["commit"]}
                return self.apply(Path(package), manifest)
            if not self.state.get("currentCommit") and self.state.get("bootstrapApproved") is not True:
                return {"status": "not_initialized"}
            candidate = self.candidate()
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
                    manifest = json.loads(manifest_file.read_text())
                    validate_manifest(manifest)
                    if manifest["commit"] != candidate["commit"]:
                        raise UpdateError("release_manifest_commit_mismatch")
                    self.download(candidate["assets"]["cms-release.tar.gz"], archive, MAX_ARCHIVE)
                    return self.apply(archive, manifest)
            except Exception as error:
                if self.state.get("failedCommit") != candidate["commit"]:
                    code = str(error) if isinstance(error, UpdateError) else "invalid_release_download"
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
    parser.add_argument("--root", type=Path, default=Path("/opt/luminovia-portal"))
    parser.add_argument("--package", type=Path, help="Operator-approved local bootstrap/test package")
    parser.add_argument("--manifest", type=Path, help="External manifest for the local package")
    parser.add_argument("--retry-failed", action="store_true", help="Explicit operator retry of the failed SHA")
    arguments = parser.parse_args()
    if bool(arguments.package) != bool(arguments.manifest) or (arguments.check and (arguments.package or arguments.retry_failed)):
        parser.error("Local packages require --once --package and --manifest together")
    try:
        updater = Updater(arguments.root)
        result = updater.candidate() if arguments.check else updater.once(package=arguments.package, manifest_path=arguments.manifest, retry_failed=arguments.retry_failed)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as error:
        code = str(error) if isinstance(error, UpdateError) else "unexpected_update_failure"
        print(json.dumps({"status": "failed", "failureCode": code}, sort_keys=True))
        return 1


if __name__ == "__main__":
    sys.exit(main())
