#!/usr/bin/env python3
# Create the recovery identity once on the desktop; the VPS needs only its separate public recipient. Never print the key or write it into tracked source.
"""Create an off-VPS recovery identity once; print no key material."""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path

from complete_backup import BackupError, private_dir, private_file


# Create or verify only an ignored private desktop identity; an existing recipient must match that same identity.
def create(directory, *, keygen="age-keygen"):
    if os.geteuid() == 0:
        raise BackupError("generate_recovery_identity_only_as_desktop_user")
    directory = Path(directory).absolute()
    # A repository-ignored destination is mandatory. This command is intentionally
    # not an installer on the root-only VPS deployment snapshot.
    checked = subprocess.run(["git", "check-ignore", "--quiet", str(directory / "recovery.agekey")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if checked.returncode:
        raise BackupError("recovery_key_destination_must_be_git_ignored")
    private_dir(directory)
    identity = directory / "recovery.agekey"
    recipient_file = directory / "recipient.txt"
    if not identity.exists():
        result = subprocess.run([keygen, "--output", str(identity)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        if result.returncode:
            raise BackupError("recovery_identity_generation_failed")
        identity.chmod(0o600)
    private_file(identity)
    result = subprocess.run([keygen, "-y", str(identity)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise BackupError("recovery_recipient_derivation_failed")
    recipient = result.stdout.decode().strip()
    if not re.fullmatch(r"age1[0-9a-z]{58}", recipient):
        raise BackupError("unexpected_recovery_recipient")
    if recipient_file.exists():
        private_file(recipient_file)
        if recipient_file.read_text().strip() != recipient:
            raise BackupError("existing_recipient_mismatch")
    else:
        descriptor = os.open(recipient_file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as out:
            out.write(recipient + "\n")
    return {"status": "ready", "identitySavedOnlyOnDesktop": True, "recipientSavedSeparately": True, "keyMaterialPrinted": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--age-keygen", default="age-keygen")
    arguments = parser.parse_args()
    os.umask(0o077)
    try:
        print(json.dumps(create(arguments.directory, keygen=arguments.age_keygen), sort_keys=True))
    except Exception as error:
        print(json.dumps({"status": "failed", "errorCode": str(error) if isinstance(error, BackupError) else "key_setup_failed_private_details_withheld"}), file=sys.stderr)
        sys.exit(1)