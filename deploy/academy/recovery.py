#!/usr/bin/env python3
"""Create and restore a cold, age-encrypted recovery set for one dedicated academy."""

import argparse
from contextlib import contextmanager, suppress
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import tarfile
import tempfile
from uuid import UUID, uuid4

FORMAT = "luminovia-academy-recovery-v1"
RUNTIME_FILES = ("installation.json", "runtime.env", "runtime.env.public.env",
                 "runtime.env.notification.env")
OPTIONAL_RUNTIME_FILES = ("runtime.env.webhooks.env", "runtime-handoff.json")
RUNTIME_DIRS = ("browser", "data")
VOLUMES = ("db-config", "caddy_data", "caddy_config")
CACHE_VOLUMES = ("deno-cache", "clamav_signatures")
EDITION = {"customer-managed", "customer-self-hosted"}
REVISION = re.compile(r"[0-9a-f]{40}")
SHA256 = re.compile(r"[0-9a-f]{64}")
DIGEST = re.compile(r"[\w./:-]+@sha256:[0-9a-f]{64}")
COMMAND_ENV = {"PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
               "LC_ALL": "C"}
METADATA_LIMIT = 64 * 1024


class RecoveryError(Exception):
    """A stable operator-facing failure that contains no credentials."""


def fail(reason):
    raise RecoveryError(reason)


def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True, env=COMMAND_ENV).stdout


def plain(path, kind, private=False):
    info = path.lstat()
    if not kind(info.st_mode) or path.resolve() != path:
        fail("unexpected file or symbolic link in approved recovery paths")
    if stat.S_ISREG(info.st_mode) and info.st_nlink != 1:
        fail("hard-linked recovery input")
    if private and info.st_mode & 0o077:
        fail("recovery input must be private")
    return info


def optional_exists(path):
    return os.path.lexists(path)


def optional_runtime_inputs(root):
    inputs = {}
    for name in OPTIONAL_RUNTIME_FILES:
        path = root / name
        if optional_exists(path):
            info = plain(path, stat.S_ISREG, private=True)
            inputs[name] = (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    return inputs


def publish_encrypted_archive(source, destination):
    """Publish private, synced bytes without replacing an existing receipt."""
    os.link(source, destination)
    source.unlink()
    for directory in (source.parent, destination.parent):
        handle = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
        try:
            os.fsync(handle)
        finally:
            os.close(handle)


def root_directory(value, existing):
    root = Path(value)
    if not re.fullmatch(r"/[A-Za-z0-9/_-]+", value) or root.as_posix() != value:
        fail("give the exact absolute academy runtime path")
    if existing:
        plain(root, stat.S_ISDIR, private=True)
    else:
        plain(root.parent, stat.S_ISDIR)
        if optional_exists(root):
            fail("restoration requires a new runtime directory")
    return root


def identity_for(root, identifier, revision):
    if str(UUID(identifier)) != identifier or REVISION.fullmatch(revision) is None:
        fail("invalid installation UUID or release revision")
    project = "academy-" + identifier.replace("-", "")
    return {
        "installation_id": identifier,
        "source_revision": revision,
        "runtime_directory": str(root),
        "compose_project": project,
    }


def runtime_configuration(directory, expected, *, database_stopped=True):
    for name in RUNTIME_FILES:
        plain(directory / name, stat.S_ISREG, private=True)
    for name in RUNTIME_DIRS:
        plain(directory / name, stat.S_ISDIR, private=True)
    root = Path(expected["runtime_directory"])
    identity = json.loads((directory / "installation.json").read_text(encoding="utf-8"))
    expected_fields = {
        "version": 1,
        "installation_id": expected["installation_id"],
        "compose_project": expected["compose_project"],
        "backend_network": expected["compose_project"] + "-backend",
        "data_directory": str(root / "data"),
        "backup_directory": str(root / "backups"),
        "browser_directory": str(root / "browser"),
    }
    if any(identity.get(key) != value for key, value in expected_fields.items()):
        fail("generated runtime identity does not match the requested installation")
    receipt_file = directory / "browser/release.json"
    plain(receipt_file, stat.S_ISREG, private=True)
    receipt = json.loads(receipt_file.read_text(encoding="utf-8"))
    release = receipt.get("release", {})
    edition = identity.get("edition")
    if (edition not in EDITION or receipt.get("version") != 1
            or receipt.get("state") != "browser-staged"
            or release.get("edition") != edition
            or release.get("source_revision") != expected["source_revision"]
            or release.get("installation_id") != expected["installation_id"]):
        fail("staged browser must match the requested installation and exact source revision")

    server_environment = {}
    for line in (directory / "runtime.env").read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        if sep and key in {"COMPOSE_PROJECT_NAME", "ACADEMY_INSTALLATION_ID", "ACADEMY_EDITION",
                           "PORTAL_DATA_DIR", "PORTAL_WWW_DIR", "PORTAL_BACKEND_NETWORK",
                           "POSTGRES_DB"}:
            if key in server_environment:
                fail("runtime environment contains duplicate target settings")
            server_environment[key] = value.removeprefix("'").removesuffix("'")
    if server_environment != {
        "COMPOSE_PROJECT_NAME": expected["compose_project"],
        "ACADEMY_INSTALLATION_ID": expected["installation_id"],
        "ACADEMY_EDITION": edition,
        "PORTAL_DATA_DIR": expected_fields["data_directory"],
        "PORTAL_WWW_DIR": expected_fields["browser_directory"],
        "PORTAL_BACKEND_NETWORK": expected_fields["backend_network"],
        "POSTGRES_DB": "postgres",
    }:
        fail("private environment does not match the dedicated runtime")

    postgres = directory / "data/postgres"
    plain(postgres, stat.S_ISDIR)
    plain(directory / "data/storage", stat.S_ISDIR)
    plain(postgres / "PG_VERSION", stat.S_ISREG)
    if (postgres / "PG_VERSION").read_text(encoding="ascii").strip() != "17":
        fail("unsupported PostgreSQL data format")
    if database_stopped and optional_exists(postgres / "postmaster.pid"):
        fail("PostgreSQL must be cleanly shut down")
    return edition


class Docker:
    def __init__(self, project):
        self.project = project
        self.recovery_id = uuid4().hex
        self.root = Path(json.loads(self.command("info", "--format", "{{json .DockerRootDir}}")))
        plain(self.root, stat.S_ISDIR)

    @staticmethod
    def command(*args):
        return run(["docker", "--host=unix:///var/run/docker.sock", *args])

    def containers(self, project_only, include_stopped):
        args = ["ps", "--quiet"]
        if include_stopped:
            args.append("--all")
        if project_only:
            args.extend(["--filter", "label=com.docker.compose.project=" + self.project])
        ids = self.command(*args).split()
        return json.loads(self.command("inspect", *ids)) if ids else []

    def volume(self, kind, created=False):
        name = self.project + "_" + kind
        records = json.loads(self.command("volume", "inspect", name))
        if len(records) != 1:
            fail("ambiguous dedicated volume")
        record = records[0]
        path = self.root / "volumes" / name / "_data"
        labels = record.get("Labels") or {}
        if (record["Name"] != name or record["Driver"] != "local"
                or record["Mountpoint"] != str(path) or record.get("Options")
                or labels.get("com.docker.compose.project") != self.project
                or labels.get("com.docker.compose.volume") != kind
                or (created and labels.get("com.luminovia.academy.recovery") != self.recovery_id)):
            fail("volume is outside the dedicated Compose ownership boundary")
        plain(path, stat.S_ISDIR)
        return path

    def volume_names(self):
        return set(self.command("volume", "ls", "--quiet").split())

    def no_writers(self, paths):
        for container in self.containers(project_only=False, include_stopped=False):
            for mount in container["Mounts"]:
                if not mount.get("RW") or not mount.get("Source"):
                    continue
                source = Path(mount["Source"]).resolve()
                if any(source.is_relative_to(path) or path.is_relative_to(source) for path in paths):
                    fail("another running container has writable access to academy recovery data")

    def backup_state(self, root):
        records = self.containers(project_only=True, include_stopped=True)
        services = {}
        for record in records:
            service = record["Config"]["Labels"].get("com.docker.compose.service")
            if record["State"]["Status"] not in {"exited", "created"}:
                fail("stop the entire dedicated Compose project before backup")
            if service in {"db", "storage", "web", "mailpit"}:
                if service in services:
                    fail("ambiguous service in dedicated Compose project")
                services[service] = record
        images = {}
        for name, destination in (("db", "/var/lib/postgresql/data"), ("storage", "/var/lib/storage")):
            service = services.get(name)
            exits = {0} if name == "db" else {0, 143}
            if (not service or service["State"]["Status"] != "exited"
                    or service["State"]["ExitCode"] not in exits):
                fail("required database and Storage containers must have stopped cleanly")
            source = root / "data" / ("postgres" if name == "db" else "storage")
            self.require_mount(service, "bind", destination, source)
            image = service["Config"]["Image"]
            if DIGEST.fullmatch(image) is None:
                fail("recovery requires digest-pinned database and Storage images")
            images[name] = image
        names = self.volume_names()
        known_names = {self.project + "_" + kind for kind in (*VOLUMES, *CACHE_VOLUMES)}
        if any(name.startswith(self.project + "_") and name not in known_names for name in names):
            fail("the installation has an unreviewed persistent volume")
        volumes = {kind: self.volume(kind) for kind in VOLUMES if self.project + "_" + kind in names}
        if "db-config" not in volumes:
            fail("the dedicated database configuration volume is absent")
        self.require_mount(services["db"], "volume", "/etc/postgresql-custom", volumes["db-config"])
        if "web" in services:
            self.require_mount(services["web"], "volume", "/data", volumes.get("caddy_data"))
            self.require_mount(services["web"], "volume", "/config", volumes.get("caddy_config"))
        if "mailpit" in services:
            self.require_mount(services["mailpit"], "bind", "/data", root / "data/mailpit")
        if ("caddy_data" in volumes) != ("caddy_config" in volumes):
            fail("the dedicated Caddy configuration volumes are incomplete")
        self.no_writers([root, *volumes.values()])
        return images, volumes

    @staticmethod
    def require_mount(service, kind, destination, source):
        mounts = [mt for mt in service["Mounts"] if mt["Destination"] == destination]
        if len(mounts) != 1 or mounts[0]["Type"] != kind or mounts[0]["Source"] != str(source):
            fail("service mount does not match the dedicated storage layout")

    def require_unused_namespace(self):
        names = self.volume_names()
        if (self.containers(project_only=True, include_stopped=True)
                or any(name.startswith(self.project + "_") for name in names)
                or self.command("volume", "ls", "--quiet", "--filter",
                                "label=com.docker.compose.project=" + self.project).strip()
                or self.command("network", "ls", "--quiet", "--filter",
                                "label=com.docker.compose.project=" + self.project).strip()
                or self.command("network", "ls", "--quiet", "--filter",
                                "name=^" + self.project + "-backend$").strip()):
            fail("dedicated Compose namespace is already in use")

    def create_empty_volume(self, kind):
        name = self.project + "_" + kind
        if name in self.volume_names():
            fail("restoration requires new volume identities")
        actual = self.command("volume", "create", "--driver", "local",
                              "--label", "com.docker.compose.project=" + self.project,
                              "--label", "com.docker.compose.volume=" + kind,
                              "--label", "com.luminovia.academy.recovery=" + self.recovery_id, name).strip()
        if actual != name:
            fail("unexpected dedicated volume identity")
        path = self.volume(kind, created=True)
        if list(path.iterdir()):
            fail("restoration requires empty volumes")
        return path

    def remove_volume(self, kind):
        self.volume(kind, created=True)
        self.command("volume", "rm", self.project + "_" + kind)


@contextmanager
def operator_lock(parent, name):
    path = parent / name
    handle = os.open(path, os.O_CREAT | os.O_NOFOLLOW | os.O_CLOEXEC | os.O_RDWR, 0o600)
    try:
        info = os.fstat(handle)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.geteuid():
            fail("invalid recovery operation lock")
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            fail("another recovery operation owns this installation")
        yield
    finally:
        os.close(handle)


def allowed_tar_type(member):
    # Caddy uses sticky directories in both persistent volumes. Preserve that
    # restriction while continuing to reject setuid/setgid and special files.
    caddy_directory = member.isdir() and member.name in (
        "volumes/caddy_data/caddy", "volumes/caddy_config/caddy",
    )
    forbidden_mode = 0o6000 if caddy_directory else 0o7000
    if not (member.isreg() or member.isdir()) or member.mode & forbidden_mode:
        fail("recovery set contains a special, linked or privileged file")
    return member


def bundle_metadata(expected, edition, images, volumes):
    return {"format": FORMAT, **expected, "edition": edition,
            "images": images, "volumes": list(volumes)}


@contextmanager
def encrypt_archive(output, recipient, encryption_error):
    """Finish and sync an encrypted stream without masking a rejected archive."""
    with output.open("xb") as destination:
        os.fchmod(destination.fileno(), 0o600)
        with subprocess.Popen(["age", "-r", recipient], env=COMMAND_ENV,
                              stdin=subprocess.PIPE, stdout=destination,
                              stderr=subprocess.DEVNULL) as age:
            try:
                yield age.stdin
                age.stdin.close()
            except BaseException:
                if age.poll() is None:
                    age.kill()
                # Closing the buffered pipe after stopping age can raise again.
                # Preserve the archive validation error that caused the abort.
                with suppress(BrokenPipeError):
                    age.stdin.close()
                raise
            if age.wait() != 0:
                fail(encryption_error)
        destination.flush()
        os.fsync(destination.fileno())


def pack(root, output, recipient, metadata, volumes, optional_inputs):
    with encrypt_archive(output, recipient, "recovery encryption failed") as encrypted:
        with tarfile.open(fileobj=encrypted, mode="w|gz", dereference=False) as archive:
            payload = json.dumps(metadata, sort_keys=True).encode("utf-8")
            member = tarfile.TarInfo("metadata.json")
            member.size, member.mode = len(payload), 0o600
            archive.addfile(member, io.BytesIO(payload))
            for name in (*RUNTIME_FILES, *optional_inputs, *RUNTIME_DIRS):
                archive.add(root / name, "runtime/" + name, filter=allowed_tar_type)
            for name, path in volumes.items():
                archive.add(path, "volumes/" + name, filter=allowed_tar_type)


def validate_metadata(metadata, expected):
    if (
        set(metadata) != {"format", *expected, "edition", "images", "volumes"}
        or metadata["format"] != FORMAT
        or any(metadata.get(key) != value for key, value in expected.items())
        or metadata.get("edition") not in EDITION
    ):
        fail("encrypted recovery belongs to a different target or release")
    images = metadata["images"]
    if set(images) != {"db", "storage"} or any(DIGEST.fullmatch(value) is None for value in images.values()):
        fail("encrypted recovery has no exact database and Storage image inventory")
    volumes = metadata["volumes"]
    if volumes not in [["db-config"], list(VOLUMES)]:
        fail("encrypted recovery has an invalid dedicated volume inventory")


def extract_member(archive, member, stage, volumes, seen):
    allowed_tar_type(member)
    name = member.name
    path = PurePosixPath(name)
    parts = path.parts
    if (path.is_absolute() or path.as_posix() != name or ".." in parts or len(parts) < 2
            or name in seen or not (
                parts[0] == "runtime" and (
                    parts[1] in RUNTIME_DIRS or (
                        parts[1] in (*RUNTIME_FILES, *OPTIONAL_RUNTIME_FILES) and len(parts) == 2
                    )
                ) or parts[0] == "volumes" and parts[1] in volumes
            )):
        fail("encrypted recovery contains an unexpected archive path")
    if len(parts) > 2 and str(path.parent) not in seen:
        fail("encrypted recovery omits a parent directory")
    seen.add(name)
    # Names, parent order, special files and links were checked above. Using
    # the fully trusted filter here preserves numeric PostgreSQL ownership.
    archive.extract(member, path=stage, set_attrs=not member.isdir(), numeric_owner=True,
                    filter="fully_trusted")


def unpack(bundle, key, stage, expected, checksum):
    with bundle.open("rb") as encrypted:
        original = os.fstat(encrypted.fileno())
        if hashlib.file_digest(encrypted, "sha256").hexdigest() != checksum:
            fail("recovery archive does not match its recorded SHA-256")
        encrypted.seek(0)
        with subprocess.Popen(["age", "-d", "-i", str(key)], env=COMMAND_ENV,
                              stdin=encrypted, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as age:
            try:
                with tarfile.open(fileobj=age.stdout, mode="r|gz") as archive:
                    first = archive.next()
                    if (first is None or first.name != "metadata.json" or not first.isreg()
                            or first.size < 1 or first.size > METADATA_LIMIT):
                        fail("encrypted recovery manifest is missing")
                    metadata = json.loads(archive.extractfile(first).read())
                    validate_metadata(metadata, expected)
                    seen = set()
                    directories = []
                    while (member := archive.next()) is not None:
                        extract_member(archive, member, stage, metadata["volumes"], seen)
                        if member.isdir():
                            directories.append(member)
                    for member in reversed(directories):
                        path = stage / member.name
                        archive.chown(member, str(path), numeric_owner=True)
                        archive.chmod(member, str(path))
                        archive.utime(member, str(path))
                # Read the remaining encrypted pipe until age authenticates
                # the final chunk, even when tar's end marker was buffered.
                while age.stdout.read(65536):
                    pass
            except BaseException:
                age.kill()
                raise
            if age.wait() != 0:
                fail("recovery authentication or decryption failed")
        current = os.fstat(encrypted.fileno())
        if (current.st_size, current.st_mtime_ns, current.st_ctime_ns) != (
            original.st_size, original.st_mtime_ns, original.st_ctime_ns
        ):
            fail("recovery archive changed during verification")
    for kind in metadata["volumes"]:
        plain(stage / "volumes" / kind, stat.S_ISDIR)
    optional_runtime_inputs(stage / "runtime")
    if runtime_configuration(stage / "runtime", expected) != metadata["edition"]:
        fail("restored runtime and encrypted manifest disagree")
    return metadata


def backup(root, expected, recipient, docker):
    if re.fullmatch(r"age1[023456789acdefghjklmnpqrstuvwxyz]{58}", recipient) is None:
        fail("provide an age X25519 public recipient")
    backup_root = root / "backups"
    plain(backup_root, stat.S_ISDIR, private=True)
    with operator_lock(root, ".recovery.lock"):
        edition = runtime_configuration(root, expected)
        optional_inputs = optional_runtime_inputs(root)
        images, volumes = docker.backup_state(root)
        metadata = bundle_metadata(expected, edition, images, volumes)
        with tempfile.TemporaryDirectory(prefix=".partial-recovery-", dir=backup_root) as staging:
            staging = Path(staging)
            output = staging / "bundle.tar.gz.age"
            pack(root, output, recipient, metadata, volumes, optional_inputs)
            if (runtime_configuration(root, expected) != edition
                    or optional_runtime_inputs(root) != optional_inputs
                    or docker.backup_state(root) != (images, volumes)):
                fail("recovery sources changed while the set was being encrypted")
            with output.open("rb") as encrypted:
                ciphertext_digest = hashlib.file_digest(encrypted, "sha256").hexdigest()
            final = backup_root / ("recovery-" + uuid4().hex + ".tar.gz.age")
            publish_encrypted_archive(output, final)
        return {"installation_id": expected["installation_id"], "release": expected["source_revision"],
                "bundle": str(final), "sha256": ciphertext_digest}


def restore(root, expected, bundle, key, checksum, docker):
    if SHA256.fullmatch(checksum) is None:
        fail("provide the recovery receipt's exact SHA-256")
    plain(bundle, stat.S_ISREG, private=True)
    plain(key, stat.S_ISREG, private=True)
    with operator_lock(root.parent, "." + expected["compose_project"] + "-recovery.lock"):
        if optional_exists(root):
            fail("restoration requires a new runtime directory")
        docker.require_unused_namespace()
        with tempfile.TemporaryDirectory(prefix=".academy-recovery-", dir=root.parent) as staging:
            staging = Path(staging)
            metadata = unpack(bundle, key, staging, expected, checksum)
            docker.require_unused_namespace()
            runtime = staging / "runtime"
            original_owner = (runtime / "installation.json").stat().st_uid
            original_group = (runtime / "installation.json").stat().st_gid
            (runtime / "backups").mkdir(mode=0o700)
            os.chown(runtime / "backups", original_owner, original_group)
            os.chown(runtime, original_owner, original_group)
            runtime.chmod(0o700)
            root.mkdir(mode=0o700)
            created = []
            try:
                for kind in metadata["volumes"]:
                    volume = docker.create_empty_volume(kind)
                    created.append(kind)
                    run(["cp", "-a", "--reflink=auto", "--",
                         str(staging / "volumes" / kind) + "/.", str(volume)])
                runtime.rename(root)
            except BaseException:
                for kind in reversed(created):
                    docker.remove_volume(kind)
                root.rmdir()
                raise
    return {"installation_id": expected["installation_id"], "release": expected["source_revision"],
            "runtime": str(root), "images": metadata["images"], "services_started": False}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["backup", "restore"])
    parser.add_argument("runtime_root")
    parser.add_argument("installation_id")
    parser.add_argument("release")
    parser.add_argument("--recipient")
    parser.add_argument("--bundle", type=Path)
    parser.add_argument("--identity", type=Path)
    parser.add_argument("--sha256")
    args = parser.parse_args()
    try:
        if sys.platform != "linux" or os.geteuid() != 0:
            fail("run recovery as the Linux installation administrator with sudo")
        saving = args.operation == "backup"
        if (saving and (not args.recipient or args.bundle or args.identity or args.sha256)) or (
            not saving and (args.recipient or not args.bundle or not args.identity or not args.sha256)
        ):
            fail("backup requires a public recipient; restore requires a private bundle, identity file and recorded SHA-256")
        root = root_directory(args.runtime_root, existing=saving)
        expected = identity_for(root, args.installation_id, args.release)
        docker = Docker(expected["compose_project"])
        result = (backup(root, expected, args.recipient, docker) if saving else
                  restore(root, expected, args.bundle.absolute(), args.identity.absolute(),
                          args.sha256, docker))
        print(json.dumps(result))
        return 0
    except RecoveryError as error:
        print("Academy recovery rejected: " + str(error), file=sys.stderr)
    except (OSError, subprocess.CalledProcessError, ValueError, KeyError, TypeError, tarfile.TarError):
        print("Academy recovery rejected: private archive, configuration or local Docker could not be verified.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
