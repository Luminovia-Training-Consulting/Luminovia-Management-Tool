# Dedicated Academy installation

This is the isolated setup for a customer-operated academy and for a dedicated managed academy. Use the exact reviewed source revision for the backend and browser. The private runtime and the public browser package have separate inputs. The provisioning machine needs Node from `.node-version`, repository dependencies, and Docker Compose with support for the merge `!reset` tag.

## Review a private customer academy draft

Use the [fictional draft form](customer-draft.example.json) as a template in a private local directory outside the repository and outside configured runtimes. Use Linux `flock` and a filesystem with exclusive locks and atomic rename. Create the registry directory with mode 0700 and store the edited input with mode 0600. Generate a fresh version-4 UUID for `request_id` on each onboarding request.

Use `purpose: customer` for an actual customer and `purpose: rehearsal` for fictional testing. Record the agreed academy brand and asset-review reference, initial administrator, domain status, edition, locale and time zone, SMTP mode, backup retention, data region, support agreement and licence selection. Use the same `host_reference` for every draft targeting the same host so an overlapping runtime path is caught. Domain verification is recorded from the operator's review.

```sh
node scripts/academy-customer-draft.mjs preview "$private_registry" "$private_draft"
node scripts/academy-customer-draft.mjs approve "$private_registry" "$private_draft" "$exact_approval"
```

Compare the preview and original private draft before setting `exact_approval` to the complete `APPROVE …` text returned by the preview. Any change to the approved details requires a fresh review. Keep `approved-drafts.json` private. It records names, contact addresses and approval times. An exact retry returns the original installation ID and receipt.

Use the [signed runtime handoff](RUNTIME-HANDOFF.md) to pass the approved installation and target to the customer operator. The operator confirms the local path and generates the private configuration on their own machine. Use the approved exact release, limits and customer agreement in the separate licence issuer and staging steps. Runtime creation, licence issuance and publication each require their own operator action.

## Issue, convert or renew a customer licence

Copy the [fictional licence request](customer-licence.example.json) to an operator-private file with mode 0600. Use the approved draft's `request_id` and generate a new version-4 `action_id`. Fill in the actual agreement reference, UTC dates, exact source revision and signed quotas. Review the original private file alongside the preview. The receipt binds the change to the already approved installation and edition.

```sh
node scripts/academy-customer-draft.mjs preview-licence "$private_registry" "$licence_request"
node scripts/academy-customer-draft.mjs issue-licence "$private_registry" \
  "$licence_request" "$exact_issuance_approval" "$private_issuer_key"
node scripts/academy-customer-draft.mjs licence-history "$private_registry" "$draft_request_id"
node scripts/academy-customer-draft.mjs export-licence "$private_registry" "$licence_action_id"
```

Use the full `ISSUE …` text from the preview and the trusted Ed25519 issuer key in a private file. The export writes `licence-<action_id>.signed` with mode 0600 in the registry directory. Share only this file, through the agreed fulfilment channel. Keep the registry and the signing key private. The registry records the reviewed terms, the exact signed envelope and the timestamp for every action. Retrying the same action returns its original receipt. Concurrent requests from the same previous licence can record only one successor.

- Use `initial-trial` or `initial-licensed` with `preceding_licence_sha256: null` and the release and limits from the approved draft.
- Use `renew` to extend the current tier or `convert-trial` to grant a licensed term from a trial. Set `preceding_licence_sha256` to the latest recorded envelope digest from `licence-history`. The successor must have a later issue timestamp and expiry. Enter any revised quotas in the new request and choose the release the operator will actually install. Apply the replacement once its validity starts.
- Use `adopt-trial` or `adopt-licensed` to record an already issued licence as the first ledger entry. Use the exact signed terms and set `existing_licence_sha256` to the SHA-256 of the envelope text without its final newline. Pass its private file path as the last argument to `issue-licence`. The command verifies the trusted signature and installation binding before recording the original envelope.

Commercial approval and payment take place in the agreed vendor workflow. Registration, trial conversion and renewal here record that approval and prepare a signed licence. The installation operator applies the licence separately. The runtime continues to use the same signed v1 module, validity and quota checks for both tiers.

## Prepare the runtime and signed browser

Choose an installation UUID, an edition, a customer-controlled HTTPS domain, a bind address and a new directory outside the checkout. Use `127.0.0.1` for local staging. The included public ingress uses Caddy ACME and ports 80 and 443 on an explicitly chosen host address. A separate reverse proxy may terminate TLS using its own reviewed configuration.

```sh
node scripts/academy-runtime-config.mjs "$runtime_root" "$installation_id" \
  customer-self-hosted "$portal_origin" "$bind_address"
```

The command creates a private directory with empty `data`, `backups` and `browser` paths, an `installation.json` containing the public installation identity, and three separate environment files. Only `runtime.env.public.env` goes to the browser build. Keep `runtime.env` and `runtime.env.notification.env` private. The API uses the same HTTPS host under `/backend`. Every instance receives independent credentials, Compose and storage namespaces.

Build and sign the matching brand and edition using the [browser package commands](../../DEVELOPMENT.md#white-label-browser-build). Obtain the signed licence, detached browser signature and two trusted public keys through the agreed delivery channels. Keep both signing keys with their respective issuers. Store the exact source commit in the independently reviewed target JSON.

To publish the fictional demo at the academy domain's `/demo`, set `"publicDemo": true` in the brand file before building and signing. The release manifest and staging receipt record the opt-in, and the package verifier checks the compiled demo files. A regular customer package leaves the public demo disabled by default. Apply changes to this option with the next signed source release on an existing installation.

After setup, a confirmed local administrator opens **Academy administration → Public links** to set the academy's support, privacy policy, legal notice and terms URLs. Use publicly intended HTTPS addresses. Blank fields hide the corresponding links. These settings appear before sign-in and in the academy footer. Editing requires an active licence.

In **Academy administration → Academy logo**, a confirmed administrator can preview and publish an RGB or RGBA PNG up to 512 pixels per edge and 256 KiB. The application displays it only after a clean scan. **Use package logo** restores the original logo after confirmation. The current image is included in the database backup. The signed application icons remain part of the browser package.

The target JSON copies `version`, `installation_id`, `edition`, `portal_origin`, `api_base_url`, `compose_project`, `backend_network`, `data_directory` and `backup_directory` from `installation.json`. Add the remaining site selections. The following example shows those additional fields for an isolated rehearsal.

```json
{
  "release_commit": "0123456789abcdef0123456789abcdef01234567",
  "backup_retention_days": 30,
  "data_region": "local",
  "time_zone": "Europe/Berlin",
  "tls": "acme",
  "smtp": {
    "mode": "capture",
    "sender_email": "training@academy.example.invalid",
    "sender_name": "Example Academy"
  }
}
```

Run the offline plan to review the approved target. The plan contains no credentials and does not write the deployment directories.

```sh
node scripts/academy-staging-plan.mjs "$target_json" \
  "$runtime_root/runtime.env.public.env" "$package_directory" "$release_signature" \
  "$signed_licence" "$licence_public_key" "$release_public_key"

node scripts/academy-install-browser.mjs "$runtime_root" "$target_json" \
  "$package_directory" "$release_signature" "$signed_licence" \
  "$licence_public_key" "$release_public_key"
```

The second command checks the active licence, the archive, both trust roots, the exact backend address and the gateway key. It publishes the verified files and the signed API allowance into the empty browser directory in one operation. It refuses a populated directory and leaves any prior installation in place. Run it before starting ingress, so the bind mount sees the published directory. The receipt's `customer_ready` remains false until the operational acceptance steps are complete.

## Prepare the private backend

Use the generated environment with the base self-hosted services and the dedicated override. Keep the project identity and reviewed environment fixed across upgrades. Compose gives exported shell variables precedence over `--env-file`. Run the installation commands from a clean shell without conflicting exported values or an inherited remote Docker target. Compose's quiet validation avoids printing resolved secrets.

```sh
academy_compose() {
  env -i PATH="$PATH" docker compose \
    --env-file "$runtime_root/runtime.env" \
    -f deploy/hostinger/selfhost/compose.yml \
    -f deploy/academy/compose.override.yml "$@"
}
academy_compose config --quiet
academy_compose up -d --wait
```

The default profile starts only the private backend with its own database, Auth, PostgREST, Realtime, Storage, Edge runtime, gateway, mail relay and ClamAV. The services expose no host ports. On an isolated test instance, add the capture override to route Auth invitation and recovery mail to the private Mailpit mailbox.

```sh
academy_compose -f deploy/academy/mail-capture.override.yml \
  --profile mail-capture up -d --wait
```

The mail relay, invitation routes and notification delivery each have separate activation controls. After the confirmed local administrator can sign in, open Administration → Email transport. Store the chosen provider and sender there and run a connection check. The check verifies TLS and credentials without sending a message. The relay uses the stored sender for both Auth invitation and recovery mail. Enable `PORTAL_INVITES_ENABLED=true` in the private runtime environment and recreate the `functions` service only when the operator has approved invitation delivery. Activating invitations and activating separate scheduled notifications are independent controls.

### Optional course notification email

The academy can email a generic alert for a new enrolment, course chat message, published material or the recipient's attendance update. The learner or staff member opts in under **My settings → Email notifications** and can set daily quiet hours. The notice links to the academy's own inbox. Course titles, messages, documents and attendance details remain in the academy.

After configuring the provider in **Academy administration → Email transport**, set `ACADEMY_NOTIFICATION_MAIL_ENABLED=true` in the private `runtime.env` and start the dedicated profile.

```sh
academy_compose --profile notification-mail up -d notification-mail
```

This worker uses only the local gateway and authenticated private SMTP relay. It claims finite batches, checks the current recipient and course before sending, and confirms each notification's one-time lease again before the upstream SMTP envelope. The queue binds each notice to the exact current signed release. Delivery pauses while the licensed course profile is unavailable. A replaced release's old entries cannot be sent. An uncertain provider acknowledgement is retained for inspection and does not trigger an automatic resend.

Set the option back to `false` and stop `notification-mail` to deactivate the worker. Include this profile when stopping the entire project for recovery.

Wait for the Auth user table, Storage bucket and object tables, and Realtime publication. Apply the migrations from the clean Git checkout matching the licence and staged browser receipt.

```sh
export PORTAL_ACADEMY_RUNTIME_ROOT="$runtime_root"
node scripts/academy-installation.mjs "$signed_licence" "$licence_public_key" \
  "$installation_id" "$edition" "$release_commit" --migrate
node scripts/academy-installation.mjs "$signed_licence" "$licence_public_key" \
  "$installation_id" "$edition" "$release_commit"
```

The migration command requires stopped ingress and the dedicated Compose target. It records each exact source with its transaction and verifies the entire applied prefix before running pending SQL. A retry skips the committed prefix. Prepare the empty academy before creating its first confirmed Auth identity. Then bind that identity with `--first-admin` and explicitly enable the verified course profile with `--course-access on`. Use the same UUID, edition, licence and source revision that were used to stage the browser.

## Verify before opening ingress

The two Compose profiles and the first-install command are covered by the dedicated tests.

```sh
node --test scripts/runtime-academy-{browser-package,licence,runtime-config}.test.mjs
node scripts/testing/academy-ingress-check.mjs "$caddy_binary" \
  "$runtime_root/browser" "$package_directory/manifest.json" "$portal_origin" 45682 "$envoy_binary"
```

Use the Caddy and Envoy binaries from the images pinned in `compose.override.yml`. The second command checks every signed browser file through a private local TLS certificate. It confirms deep links, PWA caching, the Realtime WebSocket handshake, the maintenance fence and the dedicated API surface. It also spends the entire test licence's API allowance and expects HTTP 429 with `Retry-After` on the next request. Use a staging licence with 31–1,000 requests per minute and reserve the chosen local port plus the port 10 higher. Repeat the browser and transport checks against the actual independently provisioned backend before public activation.

The dedicated public API has one shared allowance per Envoy instance. The signed amount is the burst size and the bucket refills each minute. Requests for static files and private service-to-service calls stay outside this allowance. Review occupancy, storage and mail limits alongside ingress when [renewing a licence](#apply-a-renewed-licence-on-the-same-release) or planning an upgrade.

The dedicated gateway forwards the course and local administration functions, approved Auth requests, database RPCs and the Realtime WebSocket. Server integrations can read the published course index with a scoped key. The database checks each RPC against the dedicated licence and the caller's current role. Legacy marketplace, public-website intake and external lecturer endpoints return HTTP 404. Course files and the academy logo use the existing scan gateway. Direct Storage and table routes stay private.

Verify the private first administrator, dedicated edition, licence limits, normal account sign-in, author/publish/enrol and learner journeys, protected objects, ClamAV, Realtime, current email routes and the encrypted backup/recovery target. When the customer's DNS and firewall are authorised and verified, the `ingress` profile starts Caddy on the generated address. Review certificate issuance and the browser edition, hostname and protected API against that particular environment. A fresh-install receipt is separate from approval of any data migration, upgrade, commercial handover or public deployment.

## Read the installed release and licence state

Use the signed licence and exact installed revision with the existing private operator connection.

```sh
node scripts/academy-installation.mjs "$signed_licence" "$licence_public_key" \
  "$installation_id" "$edition" "$release_commit" --status
```

The read-only receipt reports the exact licensed release, licence dates and current course access. It includes the applied migration count and last version when the operator ledger is present. A disabled course profile or an absent ledger is shown as a null value. The command requires the matching dedicated database and works with a licence in grace or after expiry. It does not print configuration, accounts or licence secrets.

## Apply a renewed licence on the same release

Keep the previous signed licence, target JSON and exact installed browser package. The issuer supplies a new currently active licence for the same installation, edition and source revision. Obtain a new detached signature for the exact existing package using the [release signing command](../../DEVELOPMENT.md#sign-and-verify-an-offline-browser-release). Verify the new licence and signature with the independently trusted keys and retain the previous receipt before maintenance. A release change uses the [separate upgrade steps](#upgrade-an-existing-academy).

Stop ingress using the installed release's Compose configuration. Keep the private database running. Execute the renewal with the current reviewed operator tooling and the existing runtime and target paths. The Linux host needs `flock` for the maintenance lock.

```sh
academy_compose --profile ingress stop web api-ingress
node scripts/academy-install-browser.mjs "$runtime_root" "$target_json" \
  "$package_directory" "$new_release_signature" "$new_licence" \
  "$licence_public_key" "$release_public_key" --renew-licence "$previous_licence"
academy_compose --profile ingress up -d --no-deps --force-recreate --wait api-ingress web
```

Wait for both ingress services to be ready and confirm the new licence receipt, current course access and API allowance. The command updates the recorded licence and changes only the two bucket values in the installed Envoy policy. It preserves existing route rules, maintenance marker, accounts and retained course data. If execution stops after updating the database, leave ingress stopped and repeat the same command with both signed licences. An expired replacement can finish the policy update only after PostgreSQL confirms that this exact signed licence already committed. Keep ingress stopped until an active renewal succeeds.

## Encrypted recovery for a dedicated installation

The operator command uses Linux, Python 3.12 or later, the local rootful Docker socket and the distribution's `age` package. Create the recovery identity on a separate trusted machine with `age-keygen`. Keep the private key there and provide only its X25519 public recipient to the academy. Keep a separate record of the expected installation UUID, runtime path, signed release, deployment source and the backup SHA-256.

Close ingress and allow in-flight requests to complete. Stop the entire dedicated Compose project and its separate webhook worker, if configured. Include the mail-capture profile and override if they were used. Keep the stopped containers for the command's ownership and mount checks.

```sh
academy_compose --profile ingress --profile mail-capture --profile notification-mail stop --timeout 90
sudo python3 deploy/academy/recovery.py backup \
  "$runtime_root" "$installation_id" "$release_commit" --recipient "$age_recipient"
```

The command verifies the dedicated mounts and cold database state before encrypting files directly to an archive in the private `backups` directory. The archive contains the physical PostgreSQL 17 cluster, including Auth, roles, databases and migration ledger, Storage objects, local mail capture if present, browser release, private runtime and configuration volumes. It also preserves the optional private `runtime.env.webhooks.env` receiver settings and the `runtime-handoff.json` operator receipt. Deno and scanner signature caches are rebuilt from the reviewed images. Copy the encrypted set off the deployment machine while preserving private permissions, confirm its SHA-256 using the recorded value, then resume the approved original services.

To rehearse or recover, use an independent host with an empty Compose namespace and the same absolute runtime path. Keep ingress closed. Use only an archive from the agreed recovery storage and make sure the original installation's Linux ownership is usable on the recovery machine.

```sh
sudo python3 deploy/academy/recovery.py restore \
  "$runtime_root" "$installation_id" "$release_commit" \
  --bundle "$encrypted_recovery_set" --identity "$private_age_key" \
  --sha256 "$trusted_backup_sha256"
```

Restoration verifies the archive against the independently recorded SHA-256 and authenticates its encrypted bytes before publishing the new runtime. It refuses existing runtimes, Compose services, networks and volumes. The receipt records the exact database and Storage image references. Start the restored backend using the original reviewed source and these exact images, first in isolation. Verify the migration ledger, an existing user's password, course permissions and a protected file's bytes. Verify scanner, SMTP, licences and ingress on the particular target before serving traffic. A change to PostgreSQL, the public domain or the database release uses a separate upgrade procedure after this exact recovery.

For a portable handover, the [Academy data export](OFFBOARDING.md) provides course records, participant data and the verified bytes of approved learning files in an independently encrypted format. It works during licence grace and after expiry. Use the recovery workflow above for restoring the exact application, configuration and Auth data on a separate host.

## Monitor a dedicated installation

Save the JSON output from the successful `recovery.py backup` command to a root-owned file with permissions `0600`. Run the monitor using the same expected installation and signed release as the deployment. The licence file and receipt must belong to the account running the monitor. A root operator can use a root-owned private copy of each. The key file contains the issuer's public verification key.

```sh
sudo "$(command -v node)" scripts/academy-health.mjs \
  "$runtime_root" "$licence_file" "$licence_public_key" \
  "$installation_id" "$edition" "$release_commit" \
  --backup-receipt "$backup_receipt" --max-backup-age-hours 24 --expect-ingress
```

Use the exit status in the installation's monitoring schedule. `0` reports healthy, `1` reports actionable degradation, and `2` reports unavailable or invalid operator input. The JSON includes the current licence, matching database release and migration ledger, service states, signature freshness and backup age. It omits configuration values, account and course data, Docker logs and file paths. `--expect-ingress` detects missing ingress on a serving installation. Omit it when rehearsing an intentionally private backend. Use `--verify-backup` for a periodic full SHA-256 read of the encrypted archive. The receipt's fingerprint should also be stored independently for incident recovery.

Treat a target mismatch as an installation incident. Confirm the expected release and runtime before restarting a service. For an expired licence, use the renewal workflow. For an old or invalid backup, take a new cold backup and rehearse restoration according to the recovery instructions. Verify external HTTPS, signing receiver deliveries and provider mail from their own authorised endpoints during acceptance. The local report records ingress processes and private service health.

## Upgrade an existing academy

Use a newer signed licence issued for the same installation and edition and the new source revision. Record the current receipt and actual backend image digests. Rehearse the recovery set and upgrade in an independently provisioned copy before maintaining an installation that holds customer records. Quiesce application writers before taking the recovery set. Include PostgreSQL databases and roles, the physical Storage mount, private runtime and signing/encryption configuration, and the persistent configuration volumes. Keep the encrypted recovery set and independent decryption key on different storage. Record the source revision and migration inventory with the set.

Stop the reviewed project's ingress services. Switch the course profile off with the old licence before staging the new package. Linux with Python 3 and a filesystem supporting atomic directory exchange is needed for the browser replacement.

```sh
academy_compose --profile ingress stop web api-ingress
node scripts/academy-installation.mjs "$old_licence" "$licence_public_key" \
  "$installation_id" "$edition" "$old_release_commit" --course-access off
node scripts/academy-install-browser.mjs "$runtime_root" "$new_target_json" \
  "$new_package_directory" "$new_release_signature" "$new_licence" \
  "$licence_public_key" "$release_public_key" --replace-revision "$old_release_commit"
```

The replacement compares the currently installed revision, verifies the signed candidate and exchanges the browser directories without modifying database or Storage data. The old signed browser stays in a private `.browser-previous-*` directory inside the same runtime. A Docker or filesystem error stops the upgrade. If the previous browser directory is ambiguous after interrupted maintenance, inspect each `release.json` before resuming.

From the new checkout, run `--migrate` and prepare the new licence using the same commands as above. Use the same existing database. Enable the new course profile, recreate the ingress containers to use the new private bind mounts, and verify the licensed rate limit, retained accounts and courses, real protected file bytes and the exact release before reopening customer traffic. After accepting new writes, recover forward or perform a separately authorised recovery. A previous browser copy alone cannot rewind the database or the verified licence.

## Signed course webhooks

Open **Academy administration → Signed course webhooks** as a local administrator and select the organisation. Register a receiver alias such as `course-sync`. Copy the one-time signing key to the receiver's secret store. Subscriptions expire after 180 days. To rotate the key, revoke the subscription, then register it again and update the receiver. The delivery list shows attempts and outcomes without printing secrets. The organisation always comes from the current course and subscription.

On the installation host, keep the [webhook worker environment](webhook-worker.env.example) in a root-owned file with mode 0600 outside the browser and source directories. Use the academy's own `api_base_url` and read the service-role key from its private runtime environment. Map only reviewed aliases for this installation to exact, public HTTPS receiver URLs with trusted certificates. A different company needs a different `<organisation-id>/<alias>` entry. Delivery is inactive until the operator starts the worker with a destination map.

```sh
node --env-file="$runtime_root/runtime.env.webhooks.env" scripts/company-course-webhook-worker.mjs \
  --check-destination '<organisation-id>/course-sync'
```

The receiver check verifies the configured hostname and certificate over a pinned public address. It opens only a TLS connection and consumes no delivery. After it returns `tls_verified`, verify a signed request from an approved staging academy with fictional records before enabling normal delivery.

```sh
node --env-file="$runtime_root/runtime.env.webhooks.env" scripts/company-course-webhook-worker.mjs --watch
```

Run the worker from the reviewed release checkout with its locked production dependencies under the installation supervisor. The same command without `--watch` processes one finite batch. The [receiver quickstart](../../scripts/examples/README.md#signed-course-webhook-receiver) shows how to validate signed requests, commit retry-safe receipts in a private SQLite inbox and expose the receiver through a customer-controlled HTTPS proxy. Delivery can arrive out of order. Queued events are bound to the exact active release. A disabled or expired licensed profile pauses delivery and invalidates the worker's ability to prepare an event.

## Connect a published course index

In Academy administration, select the organisation under Course integrations and issue a named, expiring key for the course index, enrolment of confirmed participants or aggregate participation reports. Store the one-time credential in the consuming service's secret store. The Academy OpenAPI download and [integration examples](../../scripts/examples/README.md) show the exact requests. Revocation is immediate and rotation preserves the original scope. Each request requires an active licence and a current authorised issuer.

## Academy issuer on generated course documents

The preparation command reads the name, short name and accent colour from the staged signed web manifest and pins them to the exact licensed release. Use `PORTAL_ACADEMY_STAGED_BROWSER_ROOT` with the equivalent private runtime root if the operator connects through private libpq. Administrators can override the presentation under **Academy administration → Academy branding**. A published PNG also supplies the browser tab icon. Resetting the logo restores the signed favicon. Installed app icons come from the signed browser package.

A new completion document records the issuer at issuance. Attendance PDFs use the current academy presentation. Retained completion records with no issuer snapshot keep their original facts and use the current academy brand when exported. File uploads are delivered as their exact approved bytes.
