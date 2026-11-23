# Accept a dedicated Academy on its intended customer target

Use this procedure for one authorised customer-operated or managed installation. Record the approved environment, the installation UUID, edition, current release commit, UTC time and operator against each check. Keep receipts with the private handover. Use fictional accounts and course data for delivery and recovery rehearsals. Keep credentials, message bodies, receipt tokens and customer records out of shared evidence.

Record each applicable check as **passed**, **failed** or **pending**. Optional delivery channels disabled by the agreed configuration can be marked **disabled by agreement** after their runtime settings are checked. For every pass, retain the evidence listed below. Open normal traffic and enable delivery only with the agreed release approval.

## Host preflight before activation

Run the [signed staging plan](README.md#prepare-the-runtime-and-signed-browser) with `--check-host` on the intended host. Save the non-secret report with the exact release. In an isolated rehearsal, verify that a blocked check exits with status 1 without publishing a browser package or starting services. Correct the blocker and repeat on the same runtime and release. Require a verified host report before proceeding.

## Public domain and exact release

After the approved DNS change and ingress activation, run this command from an independent machine with public Internet access and up-to-date trusted roots. Use absolute paths for the original [signed runtime handoff](RUNTIME-HANDOFF.md), target JSON and licensing inputs. Protect the handoff, target JSON and signed licence with mode `0600`. The public environment file contains only the two values intended for the browser. The trust keys come from the previously verified issuer and release signer.

```sh
node scripts/academy-check-public.mjs \
  "$private_handoff" "$trusted_vendor_public_key" "$target_json" \
  "$public_env" "$package_directory" "$release_signature" "$signed_licence" \
  "$licence_public_key" "$release_public_key"
```

The check verifies the signed target and the exact current signed archive locally before contacting its approved origin. It connects directly to every resolved public IPv4 and IPv6 address using the approved TLS name. The receipt binds the signed release and handoff fingerprints to matching public shell, callback and password route bytes, entry assets, PWA manifest, service worker and OpenAPI download. It also verifies the anonymous licensed installation identity, the cache controls on the shell files and capability response, and HTTP 404 on raw Storage and Auth administration routes. A certificate error, unexpected status, redirect, stale file or mismatched address fails the receipt.

For `acme`, the command requires the Caddy HTTP redirect to the same HTTPS origin and preserves the path and query. For `operator-terminated`, record the approved terminal proxy and independently confirm the agreed HTTP policy. The receipt reports that check as required. Verify DNS ownership, intended names and records in the operator's DNS console, including any CDN or regional records beyond what the test vantage point sees. Retain the public receipt, DNS record review reference and any terminal proxy evidence.

## Browser dependency handoff

For new browser packages, retain the signed archive entries `api/browser-sbom.cdx.json` and `api/dependency-licenses.txt`. The CycloneDX report binds the edition and built commit and identifies delivered files for each npm or Workbox dependency and the packaged Space Grotesk font. The licence index includes the publisher's notices, including the separately sourced upstream MIT notice for `react-remove-scroll-bar@2.3.8`. Both entries are covered by the package inventory and the release signature. Compare the verified archive with the public downloads on the target.

The browser report covers the static ZIP. Obtain component and licence evidence for the exact separately pinned runtime images and for any target-specific provider or proxy. Record those references alongside the browser handoff.

## Operational health and signed-in browser

On the installation host, use the private licence and the latest encrypted backup receipt. Store the result under permissions appropriate for the deployment operator.

```sh
sudo "$(command -v node)" scripts/academy-health.mjs \
  "$runtime_root" "$signed_licence" "$licence_public_key" \
  "$installation_id" "$edition" "$release_commit" \
  --backup-receipt "$backup_receipt" --max-backup-age-hours 24 \
  --verify-backup --expect-ingress
```

Use the agreed maximum backup age. Require exit 0, a matched staged licence, active licence and course access, recognised topology, fresh scanner signatures and a fresh backup with `digest_verified: true`. Confirm the exact applied migration prefix against the reviewed release before accepting changes. Check that both `web` and `api-ingress` are running. For provider delivery, confirm the capture override is absent and the Mailpit service is stopped. Verify any optional notification and webhook workers under their configured supervisor. Confirm that the agreed monitor observes the healthy target and that a controlled staging failure reaches the responsible operator. Retain the health receipt and the monitoring check reference.

Use the actual domain in an ordinary browser to sign in with the local administrator, teaching and learner test accounts, then publish a course, enrol, open the protected course material and record learner progress. Follow a real invitation or recovery link during the mail test. Confirm file-byte digests after download. Confirm a signed-out user and an account outside the course cannot open the same protected material. Retain the release, test roles, result references and the fictional file digests.

## Provider mail and signed webhook delivery

- **Auth mail.** Run the provider connection test in **Academy administration → Email transport**. With the agreed transport and test mailbox, use the invitation flow where enabled and the password recovery flow separately. Receive the messages in that mailbox. Confirm the sender and expected language, that the link points to this exact installation, and that completion updates the intended test account. Record the provider's acceptance reference, the independent mailbox receipt and the browser result. An isolated capture-mode run establishes capture-mode evidence.
- **Notification email.** Where enabled, follow the [notification worker procedure](README.md#optional-course-notification-email) with the same provider. Trigger a supported fictional course event for an opted-in test recipient and exercise the same event for a test recipient who has opted out. Confirm the generic message arrives once, its only action leads to the expected Academy inbox, and the recipient who opted out has no queued or delivered notice for the event. Review the delivery outcomes after the worker's next eligible cycle. Retain the two test outcomes and the independent mailbox reference.
- **Signed course webhook.** Run the [configured destination check](README.md#signed-course-webhooks) for the approved receiver. Publish a fictional course for that subscription and verify the received signature over the exact HTTP body with the configured signing key. Match the receiver's event receipt with the worker's delivery outcome. Exercise a retry on a staging receiver, keep one persisted result for the same event ID and confirm that a revoked subscription does not receive the next event. Retain the receiver and worker results without raw payloads or keys. Evaluate each configured customer destination separately.

## Encrypted recovery and retained-data upgrade

1. Before changing the release, use the [cold backup procedure](README.md#encrypted-recovery-for-a-dedicated-installation). Retain the trusted archive SHA-256, encrypted off-host copy, current release and exact PostgreSQL and Storage image references. Rehearse with the off-host copy on an independent machine with an empty Compose namespace and the same absolute runtime path. Keep ingress isolated and outbound delivery stopped. Retain both recovery receipts.
2. In the restored instance, verify the original signed release, licensed edition and migration ledger. Sign in with an existing rehearsal account, verify its membership and permission boundaries, and open retained courses, progress, documents and chat. Compare protected file bytes with the recorded SHA-256. Verify retained integration state where enabled, keeping external delivery disabled. Keep the protected baseline and references for the comparison.
3. On the same restored copy, exercise the [exact upgrade procedure](README.md#upgrade-an-existing-academy) with the newly signed browser and licence. Run the new release's migration command, apply the licence and verify active course access. Repeat the signed-in and prohibited-role cases against the new release and compare the retained data and file digests. Add a new course operation and verify it persists after restart. Keep the source and destination release receipts, migration results, retained-data results and latest backup evidence. Confirm the approved independent recovery remains available before applying the release to the customer installation.
4. Apply the same reviewed release to the authorised serving installation using its agreed maintenance window. Verify the private health and exact public release again. Confirm permitted signed-in access and the configured delivery channels on that target. Record the serving release and the completion of the maintenance window.

Track customer acceptance by the target's own receipts. A rehearsal receipt records the configuration, environment and release where that rehearsal ran.
