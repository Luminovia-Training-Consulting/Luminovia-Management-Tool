#!/usr/bin/env python3
# Authenticate and decrypt on the desktop into exclusive private destinations. Verify original privileged metadata and absolute links without applying them to the desktop.
"""Desktop-only authenticated decrypt and safe private recovery extraction."""
import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import sys
from pathlib import Path, PurePosixPath

from complete_backup import BackupError, FORMAT, digest, private_dir, private_file, verify_complete, write_json


# Accept only canonical relative archive paths without NUL or traversal.
def safe_name(name):
    path = PurePosixPath(name)
    if not name or path.is_absolute() or ".." in path.parts or path.as_posix() != name.rstrip("/") or "\x00" in name:
        raise BackupError("unsafe_recovery_member")
    return Path(*path.parts)


# Authenticate the catalog/parts and check inventory during exclusive private extraction; failure removes only the new owned destination.
def unpack(backup, identity, output, *, age="age"):
    import tarfile
    backup, identity, output = Path(backup).absolute(), Path(identity).absolute(), Path(output).absolute()
    private_file(identity)
    verify_complete(backup)
    if output.exists() or output.is_symlink():
        raise BackupError("recovery_output_must_be_new")
    if shutil.disk_usage(output.parent).free < 1024 ** 3:
        raise BackupError("insufficient_desktop_recovery_space")
    private_dir(output)
    try:
        result = subprocess.run([age, "--decrypt", "--identity", str(identity), str(backup / "catalog.json.age")], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
        if result.returncode or len(result.stdout) > 128 * 1024 ** 2:
            raise BackupError("catalog_authenticated_decryption_failed")
        catalog = json.loads(result.stdout)
        if catalog.get("format") != FORMAT:
            raise BackupError("unexpected_recovery_catalog")
        manifest = verify_complete(backup)
        if set(catalog["parts"]) != set(manifest["parts"]) - {"catalog.json.age"}:
            raise BackupError("encrypted_catalog_parts_differ")
        for name, metadata in catalog["parts"].items():
            if any(metadata[key] != manifest["parts"][name][key] for key in ["sha256", "bytes"]):
                raise BackupError("encrypted_catalog_checksum_differs")
        total_plain = sum(item["bytes"] for item in catalog["files"] if item["type"] == "file") + sum(d["plaintextBytes"] for name, d in catalog["parts"].items() if name != "files.tar.gz.age")
        if shutil.disk_usage(output).free < total_plain + 1024 ** 3:
            raise BackupError("insufficient_desktop_recovery_space")
        write_json(output / "catalog.json", catalog)
        for name, metadata in catalog["parts"].items():
            if name == "files.tar.gz.age":
                continue
            target = output / name.removesuffix(".age")
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "wb") as out:
                result = subprocess.run([age, "--decrypt", "--identity", str(identity), str(backup / name)], stdout=out, stderr=subprocess.PIPE, timeout=1800)
            if result.returncode or target.stat().st_size != metadata["plaintextBytes"] or digest(target) != metadata["plaintextSha256"]:
                raise BackupError("authenticated_part_recovery_failed")
        inventory = {}
        for item in catalog["files"]:
            safe_name(item["path"])
            if item["path"] in inventory:
                raise BackupError("duplicate_recovery_inventory_path")
            inventory[item["path"]] = item
        process = subprocess.Popen([age, "--decrypt", "--identity", str(identity), str(backup / "files.tar.gz.age")], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        content_hash = hashlib.sha256()
        plaintext_bytes = 0

        # Bind the decrypted archive stream to the expected plaintext digest.
        class Reader:
            # Update the hash/count for decrypted archive bytes actually consumed.
            def read(self, size=-1):
                nonlocal plaintext_bytes
                content = process.stdout.read(size)
                content_hash.update(content)
                plaintext_bytes += len(content)
                return content

        reader = Reader()
        seen = set()
        filesystem = output / "filesystem"
        private_dir(filesystem)
        restored_files = 0
        restored_bytes = 0
        links = []
        try:
            with tarfile.open(fileobj=reader, mode="r|gz") as tar:
                for member in tar:
                    name = member.name.rstrip("/")
                    relative = safe_name(name)
                    if name in seen or name not in inventory:
                        raise BackupError("unexpected_or_duplicate_recovery_member")
                    seen.add(name)
                    item = inventory[name]
                    member_type = "file" if member.isfile() else "directory" if member.isdir() else "hardlink" if member.islnk() else "symlink" if member.issym() else "unsupported"
                    if (member_type, member.mode, member.uid, member.gid, member.size, member.linkname) != (item["type"], item["mode"], item["uid"], item["gid"], item["bytes"], item["link"]):
                        raise BackupError("recovery_mode_ownership_or_link_metadata_differs")
                    if json.loads(member.pax_headers.get("LUMINOVIA.xattrs", "{}")) != item["xattrs"]:
                        raise BackupError("recovery_acl_or_xattr_metadata_differs")
                    destination = filesystem / relative
                    private_dir(destination.parent)
                    if member.isfile():
                        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                        h = hashlib.sha256()
                        count = 0
                        with os.fdopen(fd, "wb") as out, tar.extractfile(member) as data:
                            for chunk in iter(lambda: data.read(1024 * 1024), b""):
                                out.write(chunk);
                                h.update(chunk);
                                count += len(chunk)
                        if count != item["bytes"] or h.hexdigest() != item["sha256"]:
                            raise BackupError("restored_file_hash_differs")
                        restored_files += 1
                        restored_bytes += count
                    elif member.isdir():
                        private_dir(destination)
                    elif member.islnk():
                        target = filesystem / safe_name(member.linkname)
                        if not target.is_file() or target.is_symlink():
                            raise BackupError("unsafe_or_unresolved_hardlink")
                        shutil.copyfile(target, destination)
                        destination.chmod(0o600)
                        links.append(item)
                    elif member.issym():
                        # Record and verify every original link, but never materialize
                        # absolute host links while extracting on the desktop.
                        links.append(item)
                    else:
                        raise BackupError("unsupported_recovery_member_type")
            while reader.read(1024 * 1024):
                pass
            process.stdout.close()
            if process.wait(timeout=120):
                raise BackupError("file_archive_authenticated_decryption_failed")
        except Exception:
            process.kill();
            process.wait(timeout=10);
            process.stdout.close()
            raise
        expected = catalog["parts"]["files.tar.gz.age"]
        if seen != set(inventory) or plaintext_bytes != expected["plaintextBytes"] or content_hash.hexdigest() != expected["plaintextSha256"]:
            raise BackupError("recovered_archive_inventory_or_hash_differs")
        write_json(output / "filesystem-verification.json", {"status": "passed", "regularFiles": restored_files, "bytes": restored_bytes, "linksVerified": len(links), "archiveModesOwnersGroupsExact": True, "xattrsAndAclsCapturedInEncryptedCatalog": True, "desktopExtractionPermissions": "Private0700 directories/0600 regular files; original ownership/ACL/link metadata verified but privileged host permissions and absolute symlinks are not applied on this desktop."})
        return {"status": "decrypted_and_files_verified", "databases": len(catalog["databases"]), "regularFiles": restored_files, "restoredBytes": restored_bytes, "secretsPrinted": False}
    except Exception:
        shutil.rmtree(output)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--backup", type=Path, required=True)
    parser.add_argument("--identity", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--age", default="age")
    args = parser.parse_args()
    os.umask(0o077)
    try:
        print(json.dumps(unpack(args.backup, args.identity, args.output, age=args.age), sort_keys=True))
    except Exception as error:
        print(json.dumps({"status": "failed", "errorCode": str(error) if isinstance(error, BackupError) else "private_recovery_details_withheld"}), file=sys.stderr)
        sys.exit(1)