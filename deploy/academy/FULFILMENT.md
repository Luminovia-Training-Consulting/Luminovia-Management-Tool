# Review and confirm a private Academy handover

Use the [approved Academy draft](README.md#review-a-private-customer-academy-draft), its [signed runtime handoff](RUNTIME-HANDOFF.md), and an issued licence for the same installation and source release. Enter the customer agreement reference in the licence request. Export both signed files into the private registry before delivering them through the agreed channel. Obtain the issuer public keys independently of the delivery artifacts.

```sh
node scripts/academy-customer-draft.mjs fulfilment-status \
  "$private_registry" "$draft_request_id" "$trusted_handoff_public_key" "$trusted_licence_public_key"
```

The status reports the approved draft, verified handoff export, current licence state and export, and any recorded confirmation. It shows `ready-for-handover` once both exports match an active licence for the approved release. A licence renewal appears as the current licence while the original handover receipt retains the exact identifiers and hashes that were delivered.

## Record the confirmed delivery

After the recipient acknowledges the exact delivery, store the reviewed references in an operator-private JSON file with mode `0600` outside the checkout. Use the request identifier from the approved draft and the action identifier from the current licence. The agreement reference must match the current licence request. Keep the receipt evidence in the agreed private record system and enter its reference here.

```json
{
  "version": 1,
  "draft_request_id": "07fff028-e932-4be6-80dd-bb4479e765fb",
  "licence_action_id": "8d23d1c1-4ba2-4fd7-aeb6-c43d7df21a79",
  "agreement_reference": "FICTIONAL-AGREEMENT-2026-01",
  "handover_reference": "FICTIONAL-RECIPIENT-RECEIPT-99"
}
```

```sh
node scripts/academy-customer-draft.mjs preview-fulfilment \
  "$private_registry" "$private_handover_request" "$trusted_handoff_public_key" "$trusted_licence_public_key"
node scripts/academy-customer-draft.mjs confirm-fulfilment \
  "$private_registry" "$private_handover_request" "$trusted_handoff_public_key" "$trusted_licence_public_key" "$exact_confirmation"
```

Compare the preview with the private request and the delivered files. Use the complete `CONFIRM …` value from that preview. The registry rechecks the active licence, both signatures, release and exact artifacts when saving the receipt. Repeating this exact action returns the original receipt. A competing confirmation for the same draft is refused. Review any later change through the agreed licence and installation processes.

The receipt records a reviewed acknowledgement of delivery. Start deployment, verify target readiness, and track commercial approvals or payments through their respective operating procedures.
