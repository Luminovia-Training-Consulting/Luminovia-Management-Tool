# Dedicated Academy installation

This is the isolated setup for a customer-operated academy and for a dedicated managed academy. Use the exact reviewed source revision for the backend and browser. The private runtime and the public browser package have separate inputs. The provisioning machine needs Node from `.node-version`, repository dependencies, and Docker Compose with support for the merge `!reset` tag.

## Prepare the runtime and signed browser

Choose an installation UUID, an edition, a customer-controlled HTTPS domain, a bind address and a new directory outside the checkout. Use `127.0.0.1` for local staging. The included public ingress uses Caddy ACME and ports 80 and 443 on an explicitly chosen host address. A separate reverse proxy may terminate TLS using its own reviewed configuration.

```sh
node scripts/academy-runtime-config.mjs "$runtime_root" "$installation_id" \
  customer-self-hosted "$portal_origin" "$bind_address"
```

The command creates a private directory with empty `data`, `backups` and `browser` paths, an `installation.json` containing the public installation identity, and three separate environment files. Only `runtime.env.public.env` goes to the browser build. Keep `runtime.env` and `runtime.env.notification.env` private. The API uses the same HTTPS host under `/backend`. Every instance receives independent credentials, Compose and storage namespaces.

Build and sign the matching brand and edition using the [browser package commands](../../DEVELOPMENT.md#white-label-browser-build). Obtain the signed licence, detached browser signature and two trusted public keys through the agreed delivery channels. Keep both signing keys with their respective issuers. Store the exact source commit in the independently reviewed target JSON.

After setup, a confirmed local administrator opens **Academy administration → Public links** to set the academy's support, privacy policy, legal notice and terms URLs. Use publicly intended HTTPS addresses. Blank fields hide the corresponding links. These settings appear before sign-in and in the academy footer. Editing requires an active licence.

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

Use the Caddy and Envoy binaries from the images pinned in `compose.override.yml`. The second command checks every signed browser file through a private local TLS certificate. It confirms deep links, PWA caching, the Realtime WebSocket handshake, the maintenance fence and blocked administrative routes. It also spends the entire test licence's API allowance and expects HTTP 429 with `Retry-After` on the next request. Use a staging licence with 2–1,000 requests per minute and reserve the chosen local port plus the port 10 higher. Repeat the browser and transport checks against the actual independently provisioned backend before public activation.

The dedicated public API has one shared allowance per Envoy instance. The signed amount is the burst size and the bucket refills each minute. Requests for static files and private service-to-service calls stay outside this allowance. Review occupancy, storage and mail limits alongside ingress when renewing a licence or planning an upgrade.

Verify the private first administrator, dedicated edition, licence limits, normal account sign-in, author/publish/enrol and learner journeys, protected objects, ClamAV, Realtime, current email routes and the encrypted backup/recovery target. When the customer's DNS and firewall are authorised and verified, the `ingress` profile starts Caddy on the generated address. Review certificate issuance and the browser edition, hostname and protected API against that particular environment. A fresh-install receipt is separate from approval of any data migration, upgrade, commercial handover or public deployment.

## Encrypted recovery for a dedicated installation

The operator command uses Linux, Python 3.12 or later, the local rootful Docker socket and the distribution's `age` package. Create the recovery identity on a separate trusted machine with `age-keygen`. Keep the private key there and provide only its X25519 public recipient to the academy. Keep a separate record of the expected installation UUID, runtime path, signed release, deployment source and the backup SHA-256.

Close ingress and allow in-flight requests to complete. Stop the entire dedicated Compose project. Include the mail-capture profile and override if they were used. Keep the stopped containers for the command's ownership and mount checks.

```sh
academy_compose --profile ingress --profile mail-capture stop --timeout 90
sudo python3 deploy/academy/recovery.py backup \
  "$runtime_root" "$installation_id" "$release_commit" --recipient "$age_recipient"
```

The command verifies the dedicated mounts and cold database state before encrypting files directly to an archive in the private `backups` directory. The archive contains the physical PostgreSQL 17 cluster, including Auth, roles, databases and migration ledger, Storage objects, local mail capture if present, browser release, private runtime and configuration volumes. Deno and scanner signature caches are rebuilt from the reviewed images. Copy the encrypted set off the deployment machine while preserving private permissions, confirm its SHA-256 using the recorded value, then resume the approved original services.

To rehearse or recover, use an independent host with an empty Compose namespace and the same absolute runtime path. Keep ingress closed. Use only an archive from the agreed recovery storage and make sure the original installation's Linux ownership is usable on the recovery machine.

```sh
sudo python3 deploy/academy/recovery.py restore \
  "$runtime_root" "$installation_id" "$release_commit" \
  --bundle "$encrypted_recovery_set" --identity "$private_age_key" \
  --sha256 "$trusted_backup_sha256"
```

Restoration verifies the archive against the independently recorded SHA-256 and authenticates its encrypted bytes before publishing the new runtime. It refuses existing runtimes, Compose services, networks and volumes. The receipt records the exact database and Storage image references. Start the restored backend using the original reviewed source and these exact images, first in isolation. Verify the migration ledger, an existing user's password, course permissions and a protected file's bytes. Verify scanner, SMTP, licences and ingress on the particular target before serving traffic. A change to PostgreSQL, the public domain or the database release uses a separate upgrade procedure after this exact recovery.

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
node --env-file="$runtime_root/runtime.env.webhooks.env" scripts/company-course-webhook-worker.mjs --watch
```

Run the worker from the reviewed release checkout with its locked production dependencies under the installation supervisor. The same command without `--watch` processes one finite batch. The [receiver example](../../scripts/examples/verify-company-course-webhook.mjs) verifies the syntax, message timestamp, event ID and HMAC before interpreting the payload. Store each verified event ID atomically with its downstream change and acknowledge repeats. Delivery can arrive out of order. Queued events are bound to the exact active release and never transfer to a replacement release. A disabled or expired licensed profile pauses delivery and invalidates the worker's ability to prepare an event.
