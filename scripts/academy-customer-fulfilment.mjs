import { z } from "zod";
import {
  digestSchema,
  reference,
  sha256,
} from "./academy-customer-licensing.mjs";

const requestSchema = z.strictObject({
  version: z.literal(1),
  draft_request_id: z.uuidv4().toLowerCase(),
  licence_action_id: z.uuidv4().toLowerCase(),
  agreement_reference: reference,
  handover_reference: reference,
});

export const fulfilmentReceiptSchema = z.strictObject({
  request: requestSchema,
  handoff_sha256: digestSchema,
  licence_sha256: digestSchema,
  approval_sha256: digestSchema,
  confirmed_at: z.iso.datetime({ precision: 3 }),
});

export function parseFulfilmentRequest(input) {
  const request = requestSchema.safeParse(input);
  if (!request.success) throw new Error("Invalid private handover request.");
  return request.data;
}

export function handoffTarget({ draft, installation_id }) {
  return {
    installation_id,
    edition: draft.target.edition,
    portal_origin: draft.target.portal_origin,
    runtime_directory: draft.target.runtime_directory,
    source_revision: draft.licence.release_commit,
  };
}

function matchesApproval(draft, licence, request) {
  return (
    licence?.request.draft_request_id === request.draft_request_id &&
    licence.installation_id === draft.installation_id &&
    licence.request.release_commit === draft.draft.licence.release_commit &&
    licence.request.agreement_reference === request.agreement_reference
  );
}

const approvalHash = (draft, { request, handoff_sha256, licence_sha256 }) =>
  sha256(
    "Luminovia Academy Fulfilment Approval v1\n" +
      draft.approval_sha256 +
      "\n" +
      JSON.stringify({ request, handoff_sha256, licence_sha256 }),
  );

export function indexFulfilments(registry, { drafts, actions }) {
  const confirmed = new Map();
  for (const receipt of registry.fulfilments ?? []) {
    const { request, confirmed_at } = receipt;
    const draft = drafts.get(request.draft_request_id);
    const licence = actions.get(request.licence_action_id);
    const confirmedAt = Date.parse(confirmed_at);
    if (
      !draft ||
      confirmed.has(request.draft_request_id) ||
      !matchesApproval(draft, licence, request) ||
      receipt.licence_sha256 !== licence.licence_sha256 ||
      receipt.approval_sha256 !== approvalHash(draft, receipt) ||
      !Number.isFinite(confirmedAt) ||
      confirmedAt < Date.parse(draft.approved_at) ||
      confirmedAt < Date.parse(licence.recorded_at) ||
      confirmedAt < Date.parse(licence.request.starts_at) ||
      confirmedAt >= Date.parse(licence.request.expires_at)
    )
      throw new Error(
        "The private registry has conflicting or modified handover receipts.",
      );
    confirmed.set(request.draft_request_id, receipt);
  }
  return confirmed;
}

export function planFulfilment(draft, request, licence, artifacts) {
  if (!matchesApproval(draft, licence, request))
    throw new Error(
      "The current licence must match the handoff release and reviewed agreement.",
    );
  if (
    !artifacts.handoff_sha256 ||
    !artifacts.licence_exported ||
    artifacts.licence_state !== "active"
  )
    throw new Error(
      "Export the verified runtime handoff and current active licence before confirming delivery.",
    );
  const plan = {
    request,
    handoff_sha256: artifacts.handoff_sha256,
    licence_sha256: licence.licence_sha256,
  };
  return { ...plan, approval_sha256: approvalHash(draft, plan) };
}
