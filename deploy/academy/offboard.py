#!/usr/bin/env python3
"""Export a dedicated Academy's retained courses, learner records and files to an encrypted ZIP."""

import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
from uuid import UUID, uuid4
from zipfile import ZIP_DEFLATED, ZipFile

import recovery

FORMAT = "luminovia-academy-export/1"
SQL = Path(__file__).with_suffix(".sql")
BUFFER_SIZE = 64 * 1024
LINE_LIMIT = 16 * 1024 * 1024
MAX_FILE_SIZE = 104_857_600
CONTAINER_ID = re.compile(r"[0-9a-f]{64}")
SECTIONS = (
    "organisations", "templates", "courses", "classes", "class_assignments", "sessions", "participants",
    "participant_memberships", "enrolments", "instructor_assignments",
    "attendance", "completion", "attendance_evidence", "file_links", "course_submission_links",
)

# Use the supported authenticated object endpoint of the existing local
# Storage service. Its credential never leaves that container. Node's HTTP
# client streams response bytes without decoding Content-Encoding.
DOWNLOAD = """
const http = require('node:http');
const {pipeline} = require('node:stream/promises');
const key = process.env.SERVICE_KEY;
if (!key) process.exit(1);
const name = process.argv[1].split('/').map(encodeURIComponent).join('/');
const request = http.get({
  hostname: '127.0.0.1', port: 5000,
  path: '/object/authenticated/portal-clean/' + name,
  headers: {Authorization: 'Bearer ' + key},
  timeout: 15000,
}, (response) => {
  if (response.statusCode !== 200) {
    response.destroy();
    process.exitCode = 1;
    return;
  }
  pipeline(response, process.stdout).catch(() => { process.exitCode = 1; });
});
request.on('timeout', () => request.destroy());
request.on('error', () => { process.exitCode = 1; });
"""


class ExportDocker(recovery.Docker):
    def export_state(self, root):
        """Only the dedicated DB and Storage may be active on the backend."""
        services = {}
        for record in self.containers(project_only=False, include_stopped=False):
            labels = record["Config"]["Labels"] or {}
            service = labels.get("com.docker.compose.service")
            if labels.get("com.docker.compose.project") == self.project:
                if service not in {"db", "storage"} or service in services:
                    recovery.fail("stop all dedicated services except database and Storage")
                services[service] = record
                continue
            if self.project + "-backend" in record["NetworkSettings"]["Networks"]:
                recovery.fail("another container can access the dedicated export backend")
            for mount in record["Mounts"]:
                if mount.get("RW") and mount.get("Source"):
                    source = Path(mount["Source"]).resolve()
                    if source.is_relative_to(root) or root.is_relative_to(source):
                        recovery.fail("another container can write academy export inputs")

        containers = {}
        for name, destination, directory in (
            ("db", "/var/lib/postgresql/data", "postgres"),
            ("storage", "/var/lib/storage", "storage"),
        ):
            record = services.get(name)
            if (record is None or record["State"]["Status"] != "running"
                    or recovery.DIGEST.fullmatch(record["Config"]["Image"]) is None
                    or any((record["NetworkSettings"].get("Ports") or {}).values())
                    or set(record["NetworkSettings"]["Networks"]) != {self.project + "-backend"}
                    or CONTAINER_ID.fullmatch(record["Id"]) is None):
                recovery.fail("export requires private, digest-pinned dedicated database and Storage containers")
            self.require_mount(record, "bind", destination, root / "data" / directory)
            containers[name] = record["Id"]
        return containers

    @staticmethod
    @contextmanager
    def database(container):
        with SQL.open("rb") as script:
            with docker_stream([
                "exec", "-i", "--user", "postgres", container,
                "psql", "-wXqAt", "-U", "postgres", "-d", "postgres",
            ], stdin=script) as output:
                yield output

    @staticmethod
    def file(container, name):
        return docker_stream(["exec", container, "node", "-e", DOWNLOAD, name])


@contextmanager
def docker_stream(args, stdin=subprocess.DEVNULL):
    with subprocess.Popen(
        ["docker", "--host=unix:///var/run/docker.sock", *args],
        stdin=stdin, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env=recovery.COMMAND_ENV,
    ) as process:
        try:
            yield process.stdout
            if process.wait(timeout=30) != 0:
                recovery.fail("private export source did not complete")
        except BaseException:
            if process.poll() is None:
                process.kill()
            raise


def read_line(source):
    line = source.readline(LINE_LIMIT + 1)
    if not line.endswith(b"\n") or len(line) > LINE_LIMIT:
        recovery.fail("incomplete or oversized export record")
    return line


def write_snapshot(archive, source, expected, edition):
    if read_line(source) != b"@metadata\n":
        recovery.fail("missing database export identity")
    metadata = json.loads(read_line(source))
    if (metadata["installation_id"], metadata["edition"], metadata["release"]) != (
        expected["installation_id"], edition, expected["source_revision"],
    ):
        recovery.fail("database export belongs to another installation or release")
    archive.writestr("metadata.json", json.dumps({"format": FORMAT, **metadata}) + "\n")

    line = read_line(source)
    for section in (*SECTIONS, "files"):
        if line != f"@{section}\n".encode("ascii"):
            recovery.fail("database export omitted a required content section")
        with archive.open(section + ".jsonl", "w", force_zip64=True) as entry:
            while not (line := read_line(source)).startswith(b"@"):
                if section == "files":
                    file = json.loads(line)
                    name = file.pop("object_path")
                    validate_file(file, name)
                    file["archive_path"] = "files/" + file["id"]
                    entry.write(json.dumps(file, ensure_ascii=False).encode("utf-8") + b"\n")
                    yield file, name
                else:
                    entry.write(line)
    if line != b"@complete\n" or source.read(1):
        recovery.fail("database export transaction did not complete")


def validate_file(file, name):
    segments = name.split("/")
    try:
        matches_version = (
            len(segments) == 3
            and all(value == str(UUID(value)) for value in segments)
            and segments[1:] == [file["document_id"], file["id"]]
        )
    except ValueError:
        matches_version = False
    if (not matches_version or recovery.SHA256.fullmatch(file["sha256"]) is None
            or type(file["size_bytes"]) is not int
            or not 0 < file["size_bytes"] <= MAX_FILE_SIZE):
        recovery.fail("invalid retained file metadata")


def write_file(archive, source, file):
    checksum = hashlib.sha256()
    size = 0
    with archive.open(file["archive_path"], "w", force_zip64=True) as entry:
        while block := source.read(BUFFER_SIZE):
            size += len(block)
            if size > file["size_bytes"]:
                recovery.fail("retained file bytes differ from the approved version")
            checksum.update(block)
            entry.write(block)
    if size != file["size_bytes"] or checksum.hexdigest() != file["sha256"]:
        recovery.fail("retained file bytes differ from the approved version")


def pack(output, expected, edition, recipient, docker, containers):
    with recovery.encrypt_archive(output, recipient, "data export encryption failed") as encrypted:
        with ZipFile(encrypted, "w", compression=ZIP_DEFLATED) as archive:
            with docker.database(containers["db"]) as source:
                files = list(write_snapshot(archive, source, expected, edition))
            for file, name in files:
                with docker.file(containers["storage"], name) as stream:
                    write_file(archive, stream, file)


def export(root, expected, recipient, docker):
    if not re.fullmatch(r"age1[02-9ac-hj-np-z]{58}", recipient):
        recovery.fail("give the customer's X25519 age public recipient")
    backup_root = root / "backups"
    recovery.plain(backup_root, stat.S_ISDIR, private=True)
    with recovery.operator_lock(root, ".recovery.lock"):
        edition = recovery.runtime_configuration(root, expected, database_stopped=False)
        containers = docker.export_state(root)
        with tempfile.TemporaryDirectory(prefix=".partial-export-", dir=backup_root) as staging:
            output = Path(staging) / "export.zip.age"
            pack(output, expected, edition, recipient, docker, containers)
            if (recovery.runtime_configuration(root, expected, database_stopped=False) != edition
                    or docker.export_state(root) != containers):
                recovery.fail("export sources changed during encryption")
            with output.open("rb") as encrypted:
                checksum = hashlib.file_digest(encrypted, "sha256").hexdigest()
            final = backup_root / ("offboarding-" + uuid4().hex + ".zip.age")
            recovery.publish_encrypted_archive(output, final)
        return {
            "installation_id": expected["installation_id"], "release": expected["source_revision"],
            "format": FORMAT, "export": str(final), "sha256": checksum,
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runtime_root")
    parser.add_argument("installation_id")
    parser.add_argument("release")
    parser.add_argument("--recipient", required=True)
    args = parser.parse_args()
    try:
        if sys.platform != "linux" or os.geteuid() != 0:
            recovery.fail("run export as the Linux installation operator with sudo")
        root = recovery.root_directory(args.runtime_root, existing=True)
        expected = recovery.identity_for(root, args.installation_id, args.release)
        print(json.dumps(export(root, expected, args.recipient, ExportDocker(expected["compose_project"]))))
    except recovery.RecoveryError as error:
        print("Academy export rejected: " + str(error), file=sys.stderr)
        return 1
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError):
        print("Academy export rejected: the private runtime, records or encrypted output could not be verified.",
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
