# Approved Academy runtime handoff

The private draft registry records the approved installation. The issuer can export an Ed25519-signed handoff once the draft is approved.

```sh
node scripts/academy-customer-draft.mjs export-runtime-handoff \
  "$private_registry" "$approved_request_id" "$private_signing_key"
```

Use the absolute path to the operator-owned signing key with mode `0600`. The command creates `runtime-handoff-<installation-uuid>.signed` in the private registry. An exact repeat returns the same file. Its signed payload contains the installation UUID, edition, HTTPS origin, runtime directory and approved source revision. Customer and administrator details, licence limits, support records and server credentials stay in their existing private workflows.

Deliver the handoff file privately. The receiving operator selects the trusted issuer public key independently of that file. Store the received file as an operator-owned regular file with mode `0600`.

## Initialize the local runtime

Confirm the agreed absolute runtime directory on the destination machine and choose its local IPv4 bind address. The operator must have permission to create the directory under the selected local parent. The command verifies the independent directory argument against the signed target before writing.

```sh
node scripts/academy-runtime-config.mjs from-handoff \
  "$confirmed_runtime_root" "$private_handoff" "$trusted_vendor_public_key" \
  "$local_ipv4"
```

On the first run, the existing generator creates a private directory with empty `data`, `browser` and `backups` subdirectories, and generates new credentials on that machine. It records the handoff and approved source revision in the private `runtime-handoff.json`. An exact repeat confirms that same runtime and preserves its files. If the path is already occupied by a different or incomplete runtime, the operator reviews it before retrying.

The signed revision identifies the approved application source for the later release and licence checks. The generator uses the current reviewed operator tooling and writes only local runtime configuration. Starting services, installing the exact browser and database release, applying the licence and enabling ingress are separate steps under the existing installation procedure. The existing manual runtime command also remains available.
