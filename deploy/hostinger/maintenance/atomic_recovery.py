"""Private, quiescent physical rollback before a deployment opens the API.

This is deliberately limited to the known Compose installation and same-device
mount layout. The caller retains the maintenance lock and owns source rollback,
old-image activation, private health checks and the eventual public unblock.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import uuid


FORMAT = "luminovia-atomic-runtime-checkpoint-v1"
WRITERS = ("auth", "rest", "realtime", "storage", "api-gw", "functions")
MIN_FREE = 2 * 1024 ** 3
BACKEND = "luminovia-supabase"
WEB = "luminovia-portal"
MOUNTS = (
    ("postgres", BACKEND, "db", "/var/lib/postgresql/data", "bind", "data/postgres"),
    ("postgres-keys", BACKEND, "db", "/etc/postgresql-custom", "volume", "db-config"),
    ("storage", BACKEND, "storage", "/var/lib/storage", "bind", "data/storage"),
    ("mailpit", BACKEND, "mailpit", "/data", "bind", "data/mailpit"),
    ("deno-cache", BACKEND, "functions", "/root/.cache/deno", "volume", "deno-cache"),
    ("caddy-data", WEB, "web", "/data", "volume", "caddy_data"),
    ("caddy-config", WEB, "web", "/config", "volume", "caddy_config"),
)
CLAMAV = ("clamav-signatures", WEB, "clamav", "/var/lib/clamav", "volume", "clamav_signatures")


class RecoveryError(Exception):
    """Stable operator reason, without file contents or subprocess output."""


def _now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _plain_directory(path):
    path = Path(path)
    if path.is_symlink() or not path.is_dir() or any(parent.is_symlink() for parent in path.parents):
        raise RecoveryError("unsafe_recovery_directory")
    return path


def _private_directory(path):
    path = Path(path)
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    _plain_directory(path)
    path.chmod(0o700)


def _private_file(path):
    path = Path(path)
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.geteuid():
        raise RecoveryError("unsafe_private_recovery_metadata")
    return path


def _json(path, value):
    path = Path(path)
    temporary = path.with_name("." + path.name + "." + uuid.uuid4().hex)
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf8") as stream:
        json.dump(value, stream, sort_keys=True, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def _container(project, service):
    return project + "-" + service + "-1"


def _inspect(updater, project, service, expression):
    name = _container(project, service)
    owner = updater.command(["docker", "inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', name]).decode().strip()
    if owner != project:
        raise RecoveryError("recovery_container_ownership_mismatch")
    return updater.command(["docker", "inspect", "--format", expression, name]).decode().strip()


def _gate(updater):
    root = _plain_directory(Path(updater.root).absolute())
    maintenance = root / "www/maintenance.enabled"
    if maintenance.is_symlink() or not maintenance.is_file():
        raise RecoveryError("recovery_requires_closed_public_api")
    return root


def _stopped_writers(updater):
    for service in WRITERS:
        if _inspect(updater, BACKEND, service, "{{.State.Running}}") != "false":
            raise RecoveryError("recovery_requires_stopped_backend_writers")


def _backup(updater, root):
    raw = updater.state.get("lastBackup")
    if not isinstance(raw, str):
        raise RecoveryError("recovery_requires_fresh_complete_backup")
    backup = _plain_directory(Path(raw))
    if backup.parent != root / "private/update-backups":
        raise RecoveryError("unexpected_recovery_backup_path")
    if backup.stat().st_mode & 0o077 or backup.stat().st_uid != os.geteuid():
        raise RecoveryError("unsafe_private_recovery_backup")
    manifest = _private_file(backup / "manifest.json")
    metadata = json.loads(manifest.read_text())
    try:
        stamp = dt.datetime.fromisoformat(metadata["createdAt"])
        age = (dt.datetime.now(dt.timezone.utc) - stamp).total_seconds()
    except (KeyError, ValueError, TypeError):
        raise RecoveryError("recovery_requires_fresh_complete_backup") from None
    if metadata.get("status") != "complete" or not 0 <= age < 1200:
        raise RecoveryError("recovery_requires_fresh_complete_backup")
    return backup


def _mounts(updater, root, include_clamav):
    docker_root = _plain_directory(Path(updater.command(["docker", "info", "--format", "{{.DockerRootDir}}"]).decode().strip()))
    result = []
    for identity, project, service, destination, kind, value in (*MOUNTS, *((CLAMAV,) if include_clamav else ())):
        rows = json.loads(_inspect(updater, project, service, "{{json .Mounts}}"))
        matches = [row for row in rows if row.get("Destination") == destination]
        if len(matches) != 1 or matches[0].get("Type") != kind:
            raise RecoveryError("unexpected_recovery_service_mount")
        row = matches[0]
        source = _plain_directory(Path(row["Source"]))
        if kind == "bind":
            if source != root / value:
                raise RecoveryError("unexpected_recovery_bind_path")
        else:
            volume = project + "_" + value
            if row.get("Name") != volume or source != docker_root / "volumes" / volume / "_data":
                raise RecoveryError("unexpected_recovery_volume_path")
            for label, expected in (("project", project), ("volume", value)):
                actual = updater.command(["docker", "volume", "inspect", "--format", '{{index .Labels "com.docker.compose.' + label + '"}}', volume]).decode().strip()
                if actual != expected:
                    raise RecoveryError("recovery_volume_ownership_mismatch")
        result.append({"id": identity, "project": project, "service": service, "destination": destination, "kind": kind, "source": str(source)})
    if len({row["source"] for row in result}) != len(result):
        raise RecoveryError("overlapping_recovery_mounts")
    for left in result:
        for right in result:
            if left is not right and Path(left["source"]).is_relative_to(right["source"]):
                raise RecoveryError("overlapping_recovery_mounts")
    return result


def tree_fingerprint(root):
    """Hash bytes and file metadata without following any symbolic link."""
    root = _plain_directory(root)
    records = []
    byte_count = 0
    pending = [(root, ".")]
    while pending:
        path, name = pending.pop()
        info = path.lstat()
        fields = [name, stat.S_IMODE(info.st_mode), info.st_uid, info.st_gid]
        if stat.S_ISLNK(info.st_mode):
            target = os.readlink(path)
            if os.path.isabs(target):
                raise RecoveryError("recovery_absolute_symlink_requires_review")
            try:
                if not path.resolve().is_relative_to(root):
                    raise RecoveryError("recovery_external_symlink_requires_review")
            except RuntimeError:
                raise RecoveryError("recovery_symlink_cycle_requires_review") from None
            records.append([*fields, "link", target])
        elif stat.S_ISDIR(info.st_mode):
            records.append([*fields, "directory"])
            with os.scandir(path) as entries:
                for entry in entries:
                    child = Path(entry.path)
                    pending.append((child, str(child.relative_to(root))))
        elif stat.S_ISREG(info.st_mode):
            digest = hashlib.sha256()
            with path.open("rb") as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    digest.update(chunk)
            byte_count += info.st_size
            records.append([*fields, "file", info.st_size, digest.hexdigest()])
        else:
            raise RecoveryError("recovery_special_file_requires_review")
    encoded = json.dumps(sorted(records), separators=(",", ":")).encode()
    return {"sha256": hashlib.sha256(encoded).hexdigest(), "bytes": byte_count, "entries": len(records)}


def _live_size(root):
    # Do not hash a running PostgreSQL cluster for the free-space estimate.
    # Background checkpoint files can disappear; exact hashing happens stopped.
    total = 0
    for directory, _dirs, files in os.walk(root, followlinks=False):
        for name in files:
            path = Path(directory) / name
            try:
                info = path.lstat()
            except FileNotFoundError:
                continue
            if stat.S_ISREG(info.st_mode):
                total += info.st_size
    return total


def _copy(updater, source, target):
    target.mkdir(mode=0o700)
    updater.command(["cp", "-a", "--reflink=auto", str(source) + "/.", str(target)], timeout=1800)


def create_checkpoint(updater, *, include_clamav=False):
    root = _gate(updater)
    _stopped_writers(updater)
    backup = _backup(updater, root)
    mounts = _mounts(updater, root, include_clamav)
    checkpoint = backup / "rollback-state"
    if checkpoint.exists() or checkpoint.is_symlink():
        raise RecoveryError("recovery_checkpoint_already_exists")
    size = 0
    for item in mounts:
        source = Path(item["source"])
        if source.stat().st_dev != backup.stat().st_dev:
            raise RecoveryError("recovery_cross_filesystem_mount_requires_review")
        size += _live_size(source)
    if shutil.disk_usage(backup).free < 2 * size + MIN_FREE:
        raise RecoveryError("insufficient_space_for_atomic_runtime_recovery")
    _private_directory(checkpoint)
    _private_directory(checkpoint / "copies")
    identity = uuid.uuid4().hex
    descriptor = os.open(checkpoint / ".owner", os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(identity)
    metadata = {"format": FORMAT, "id": identity, "status": "incomplete", "root": str(root), "backup": str(backup), "createdAt": _now(), "includeClamav": bool(include_clamav), "mounts": mounts}
    _json(checkpoint / "manifest.json", metadata)
    paused = []
    stopped = False
    try:
        for service in ("web", *(("clamav",) if include_clamav else ())):
            if _inspect(updater, WEB, service, "{{.State.Running}}") != "true" or _inspect(updater, WEB, service, "{{.State.Paused}}") != "false":
                raise RecoveryError("recovery_requires_running_unpaused_web_services")
            name = _container(WEB, service)
            paused.append(name)
            updater.command(["docker", "pause", name])
        stopped = True
        updater.compose("backend", ["stop", "db", "mailpit"])
        fingerprints = {item["id"]: tree_fingerprint(item["source"]) for item in mounts}
        exact_size = sum(value["bytes"] for value in fingerprints.values())
        if shutil.disk_usage(backup).free < 2 * exact_size + MIN_FREE:
            raise RecoveryError("insufficient_space_for_atomic_runtime_recovery")
        for item in mounts:
            source = Path(item["source"])
            fingerprint = fingerprints[item["id"]]
            target = checkpoint / "copies" / item["id"]
            _copy(updater, source, target)
            if tree_fingerprint(target) != fingerprint:
                raise RecoveryError("recovery_checkpoint_copy_mismatch")
            item["fingerprint"] = fingerprint
        metadata["status"] = "complete"
        _json(checkpoint / "manifest.json", metadata)
        return checkpoint
    finally:
        failures = []
        if stopped:
            try:
                updater.compose("backend", ["up", "-d", "--wait", "db", "mailpit"])
            except Exception:
                failures.append("backend")
        for name in reversed(paused):
            try:
                updater.command(["docker", "unpause", name])
            except Exception:
                failures.append("web")
        if failures:
            raise RecoveryError("recovery_original_services_resume_failed")


def restore_checkpoint(updater, checkpoint, *, public_unblocked, restart_old_runtime, verify_health):
    if public_unblocked is not False:
        raise RecoveryError("automatic_data_restore_forbidden_after_public_unblock")
    root = _gate(updater)
    backup = _plain_directory(Path(updater.state.get("lastBackup", "")))
    checkpoint = _plain_directory(checkpoint)
    if checkpoint != backup / "rollback-state" or backup.parent != root / "private/update-backups":
        raise RecoveryError("unexpected_recovery_checkpoint_path")
    metadata = json.loads(_private_file(checkpoint / "manifest.json").read_text())
    if metadata.get("format") != FORMAT or metadata.get("status") != "complete" or metadata.get("root") != str(root) or metadata.get("backup") != str(backup) or _private_file(checkpoint / ".owner").read_text() != metadata.get("id"):
        raise RecoveryError("invalid_or_consumed_runtime_checkpoint")
    current = _mounts(updater, root, metadata.get("includeClamav") is True)
    expected = [{key: value for key, value in item.items() if key != "fingerprint"} for item in metadata["mounts"]]
    if current != expected:
        raise RecoveryError("runtime_recovery_mount_identity_changed")
    for item in metadata["mounts"]:
        if Path(item["source"]).stat().st_dev != checkpoint.stat().st_dev:
            raise RecoveryError("recovery_cross_filesystem_mount_requires_review")
        if tree_fingerprint(checkpoint / "copies" / item["id"]) != item["fingerprint"]:
            raise RecoveryError("runtime_recovery_checkpoint_corrupted")
    prepared = checkpoint / "restore-prepared"
    failed = checkpoint / "failed-state"
    if prepared.exists() or failed.exists():
        raise RecoveryError("runtime_recovery_previous_attempt_requires_review")
    required = sum(item["fingerprint"]["bytes"] for item in metadata["mounts"]) + MIN_FREE
    if shutil.disk_usage(backup).free < required:
        raise RecoveryError("insufficient_space_for_runtime_restore")
    _private_directory(prepared)
    _private_directory(failed)
    for item in metadata["mounts"]:
        target = prepared / item["id"]
        _copy(updater, checkpoint / "copies" / item["id"], target)
        if tree_fingerprint(target) != item["fingerprint"]:
            raise RecoveryError("prepared_runtime_restore_mismatch")
    updater.compose("backend", ["stop", *WRITERS, "db", "mailpit"])
    updater.compose("web", ["stop", "web", *(("clamav",) if metadata["includeClamav"] else ())])
    _stopped_writers(updater)
    metadata["status"] = "restoring"
    metadata["restoreStartedAt"] = _now()
    _json(checkpoint / "manifest.json", metadata)
    moved = []
    try:
        for item in metadata["mounts"]:
            source = Path(item["source"])
            _plain_directory(source)
            os.rename(source, failed / item["id"])
            moved.append(item)
            os.rename(prepared / item["id"], source)
    except Exception:
        # Every original failed tree is retained. Undo completed swaps without
        # deleting either side, then leave the API closed for operator recovery.
        for item in reversed(moved):
            source = Path(item["source"])
            if source.exists():
                os.rename(source, prepared / item["id"])
            os.rename(failed / item["id"], source)
        metadata["status"] = "restore_swap_failed"
        _json(checkpoint / "manifest.json", metadata)
        raise RecoveryError("runtime_restore_swap_failed") from None
    metadata["status"] = "data_restored_pending_health"
    metadata["failedDataPreserved"] = True
    _json(checkpoint / "manifest.json", metadata)
    if restart_old_runtime() is False:
        raise RecoveryError("old_runtime_restart_failed")
    if verify_health() is False:
        raise RecoveryError("old_runtime_private_health_failed")
    _gate(updater)
    metadata["status"] = "restored"
    metadata["restoredAt"] = _now()
    _json(checkpoint / "manifest.json", metadata)
    return {"status": "restored", "checkpoint": str(checkpoint), "failedDataPreserved": True, "publicApiStillClosed": True}
