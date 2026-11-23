#!/usr/bin/env python3
"""Import exact catalogue PDFs into private Storage on the Luminovia KVM."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import socket
import struct
import subprocess
from urllib.error import HTTPError
from urllib.request import Request, build_opener, ProxyHandler

NETWORK = "luminovia-portal-backend"
BUCKET = "portal-clean"
PREFIX = "course-sources/"
MAX_BYTES = 10 * 1024 * 1024


def docker(*args):
    return subprocess.check_output(["docker", *args], stderr=subprocess.DEVNULL)


def inspect(container):
    item, = json.loads(docker("inspect", container))
    if not item["State"]["Running"]:
        raise ValueError("required_container_stopped")
    return item


def ip_address(item):
    return item["NetworkSettings"]["Networks"][NETWORK]["IPAddress"]


def db_query(sql):
    return docker(
        "exec", "luminovia-supabase-db-1", "psql", "-XAt", "-v", "ON_ERROR_STOP=1",
        "-U", "supabase_admin", "-d", "postgres", "-c", sql,
    ).decode().splitlines()


def scan_pdf(scanner, data):
    with socket.create_connection((ip_address(scanner), 3310), timeout=15) as client:
        client.sendall(b"zINSTREAM\0")
        for offset in range(0, len(data), 65536):
            chunk = data[offset:offset + 65536]
            client.sendall(struct.pack("!I", len(chunk)) + chunk)
        client.sendall(b"\0\0\0\0")
        with client.makefile("rb") as response:
            verdict = bytearray()
            while len(verdict) < 1024:
                char = response.read(1)
                if char in (b"", b"\0"):
                    break
                verdict.extend(char)
        if verdict != b"stream: OK":
            raise ValueError("source_scan_not_clean")


def import_sources(directory):
    if db_query("select public from storage.buckets where id='portal-clean'") != ["f"]:
        raise ValueError("source_bucket_must_be_private")
    expected = set(db_query("select sha256 from public.building_block_sources"))
    existing = set(db_query("select name from storage.objects where bucket_id='portal-clean' and name like 'course-sources/%'"))
    gateway = inspect("luminovia-supabase-api-gw-1")
    functions = inspect("luminovia-supabase-functions-1")
    scanner = inspect("luminovia-portal-clamav-1")
    key = dict(entry.split("=", 1) for entry in functions["Config"]["Env"])["SUPABASE_SERVICE_ROLE_KEY"]
    base = f"http://{ip_address(gateway)}:8000/storage/v1/object/{BUCKET}/"
    opener = build_opener(ProxyHandler({}))
    headers = {"apikey": key, "Authorization": f"Bearer {key}"}
    sources = {}
    for path in sorted(directory.iterdir()):
        if path.is_symlink() or not path.is_file() or not re.fullmatch(r"[a-f0-9]{64}\.pdf", path.name):
            raise ValueError("unexpected_source_input")
        digest = path.stem
        if digest not in expected or not 0 < path.stat().st_size <= MAX_BYTES:
            raise ValueError("source_does_not_match_catalogue")
        data = path.read_bytes()
        if not data.startswith(b"%PDF-") or hashlib.sha256(data).hexdigest() != digest:
            raise ValueError("source_bytes_do_not_match_catalogue")
        sources[digest] = data
    if not sources:
        raise ValueError("no_sources_found")

    # Scan the whole batch before publishing any new object.
    for data in sources.values():
        scan_pdf(scanner, data)
    created = 0
    for digest, data in sources.items():
        path = f"{PREFIX}{digest}.pdf"
        if path not in existing:
            upload = Request(base + path, data=data, method="POST", headers={
                **headers, "Content-Type": "application/pdf",
                "Cache-Control": "no-store", "x-upsert": "false",
            })
            with opener.open(upload, timeout=20):
                created += 1
        request = Request(base + path, headers=headers)
        with opener.open(request, timeout=20) as stored:
            if hashlib.sha256(stored.read(MAX_BYTES + 1)).hexdigest() != digest:
                raise ValueError("stored_source_digest_mismatch")
    print(json.dumps({"verified": len(sources), "created": created, "catalogue_total": len(expected)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path, help="Private staging directory containing only SHA256.pdf files")
    options = parser.parse_args()
    try:
        import_sources(options.directory)
    except HTTPError as error:
        raise SystemExit(f"Private Storage request failed with HTTP {error.code}") from None
    except (KeyError, ValueError, OSError, subprocess.CalledProcessError) as error:
        code = str(error) if isinstance(error, ValueError) and re.fullmatch(r"[a-z_]+", str(error)) else type(error).__name__
        raise SystemExit(f"Catalogue import failed: {code}") from None
