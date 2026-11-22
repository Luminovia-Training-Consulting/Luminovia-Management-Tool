# Dedicated Academy data export

The installation operator can prepare a customer-owned handover archive during an approved maintenance window. The export uses the retained installation identity and verified release receipt. It also works during licence grace and after licence expiry. It reads the source and creates an encrypted archive. Apply retention or decommissioning decisions through the separate agreed offboarding procedure.

## Create the archive

Use the reviewed deployment repository and the exact installation UUID, runtime path and staged release commit. Run on the Linux Docker host as the installation operator. The host needs Python 3.12 or later and Age on its system path. Have the authorised recipient generate and keep an independent X25519 Age identity and provide its public recipient. Keep the private identity on the recipient's trusted system.

Close ingress and let in-flight work finish. Use the installation's existing Compose wrapper and profiles to stop all services, then run only its database and Storage. Keep the existing deployment directory and configuration.

```sh
academy_compose --profile ingress --profile mail-capture --profile notification-mail stop --timeout 90
academy_compose up -d --no-deps db storage
sudo python3 deploy/academy/offboard.py \
  "$runtime_root" "$installation_id" "$release_commit" --recipient "$customer_age_recipient"
```

Wait until PostgreSQL and Storage are healthy before exporting. The command verifies the private network and runtime mounts, the staged browser release and the database identity. It reads the records in a repeatable read-only database transaction and verifies each included file against its recorded content hash and byte length. It publishes a private `offboarding-*.zip.age` only after all reads and encryption succeed.

Record the receipt's installation UUID, release and SHA-256. Send the encrypted archive and the recorded hash to the authorised recipient through the agreed handover channels. Review the operator's maintenance plan before restarting ingress or other services.

## Verify and read a handover

The recipient validates the recorded ciphertext SHA-256, then decrypts onto private storage. The following example creates the ZIP with owner-only permissions. Use a fresh output directory to protect and distinguish stored exports.

```sh
sha256sum -- "$encrypted_export"
umask 077
age -d -i "$private_age_identity" "$encrypted_export" > academy-export.zip
unzip -t academy-export.zip
```

The archive uses `luminovia-academy-export/1`. `metadata.json` identifies the installation, edition, release and snapshot time. UTF-8 JSON Lines files contain organisations, course templates, runs, classes, class assignments, sessions, learner identities, memberships, enrolments, direct instructor assignments, attendance, attendance evidence and completion records. Bundled templates referenced by a course carry a title and identifier. Academy-authored templates carry their authored course description, syllabus and prerequisites.

`file_links.jsonl` relates materials and exams to courses. `attendance_evidence.jsonl` distinguishes attached course resources from direct scanned evidence and identifies its exact file version. `files.jsonl` pairs each included clean version with its original name, MIME type, byte length, SHA-256 and safe archive path. Historical attachment records may still refer to withdrawn or deleted files. Only entries listed in `files.jsonl` have bytes in the archive. Staff exam papers and attendance evidence require the recipient's protected storage and the original audience information.

The export excludes password hashes, tokens, runtime credentials, operational configuration, internal notes, stored meeting links, chats and private messages. Personal files without an approved course attachment and material held in quarantine are also excluded. Use the separate encrypted recovery archive for exact restoration of deployment data and secrets. The portable archive is a documented handover format for reading and independent processing. A destination system requires its own importer and access controls.
