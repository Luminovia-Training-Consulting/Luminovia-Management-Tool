import { createHash } from "node:crypto";
import { z } from "zod";
import {
  licenceLimits,
  reference,
  releaseCommit,
} from "../src/features/branding/academy-licence-fields.ts";
import { validateAcademyLicenceTerms } from "./academy-licence.mjs";

export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);

const instant = z.iso.datetime({ precision: 3 });
const requestId = z.uuidv4().toLowerCase();
const initial = ["initial-trial", "initial-licensed"];
const adopt = ["adopt-trial", "adopt-licensed"];
const trialStart = ["initial-trial", "adopt-trial"];
const envelopeSchema = z
  .string()
  .max(16384)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/);
const licenceRequestSchema = z.strictObject({
  version: z.literal(1),
  action_id: requestId,
  draft_request_id: requestId,
  action: z.enum([...initial, ...adopt, "renew", "convert-trial"]),
  preceding_licence_sha256: digestSchema.nullable(),
  existing_licence_sha256: digestSchema.nullable().default(null),
  agreement_reference: reference,
  release_commit: releaseCommit,
  limits: licenceLimits,
  issued_at: instant,
  starts_at: instant,
  expires_at: instant,
  grace_until: instant,
});

export const licenceReceiptSchema = z.strictObject({
  request: licenceRequestSchema,
  installation_id: z.uuid(),
  tier: z.enum(["trial", "licensed"]),
  approval_sha256: digestSchema,
  recorded_at: instant,
  licence_sha256: digestSchema,
  envelope: envelopeSchema,
});

export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

export function parseLicenceRequest(input) {
  const parsed = licenceRequestSchema.safeParse(input);
  if (!parsed.success)
    throw new Error("Invalid private licence request fields or version.");
  return parsed.data;
}

// Calculate the exact transition that was reviewed and the unmodified v1 wire terms.
export function planLicenceAction(receipt, request, previous) {
  if (request.action_id === request.draft_request_id)
    throw new Error("Use a separate licence action ID.");
  if (previous) {
    if (
      request.preceding_licence_sha256 !== previous.licence_sha256 ||
      request.issued_at <= previous.request.issued_at ||
      request.expires_at <= previous.request.expires_at
    )
      throw new Error(
        "The licence must follow the current receipt and extend its validity.",
      );
    if (
      (request.action !== "renew" && request.action !== "convert-trial") ||
      (request.action === "convert-trial" && previous.tier !== "trial")
    )
      throw new Error(
        "The requested change is unavailable for the current licence tier.",
      );
  } else {
    if (
      request.preceding_licence_sha256 !== null ||
      (!initial.includes(request.action) && !adopt.includes(request.action))
    )
      throw new Error(
        "Start with an initial licence or register an existing signed licence.",
      );
    if (
      initial.includes(request.action) &&
      (request.release_commit !== receipt.draft.licence.release_commit ||
        JSON.stringify(request.limits) !==
          JSON.stringify(receipt.draft.licence.limits))
    )
      throw new Error(
        "The first licence must match the approved release and limits.",
      );
  }

  if (
    adopt.includes(request.action) !==
    (request.existing_licence_sha256 !== null)
  )
    throw new Error(
      "An existing envelope hash is required only when registering a licence.",
    );

  const { issued_at, starts_at, expires_at, grace_until } = request;
  const tier =
    request.action === "renew"
      ? previous.tier
      : trialStart.includes(request.action)
        ? "trial"
        : "licensed";
  const terms = {
    installation_id: receipt.installation_id,
    edition: receipt.draft.target.edition,
    release_commit: request.release_commit,
    issued_at,
    starts_at,
    expires_at,
    grace_until,
    modules: ["lms"],
    limits: request.limits,
  };
  validateAcademyLicenceTerms(terms);
  const approval_sha256 = sha256(
    "Luminovia Academy Licence Approval v1\n" +
      receipt.approval_sha256 +
      "\n" +
      JSON.stringify(request),
  );
  return { terms, tier, approval_sha256 };
}

export function indexLicenceActions(registry) {
  const drafts = new Map(
    registry.drafts.map((receipt) => [receipt.draft.request_id, receipt]),
  );
  const latest = new Map();
  const actions = new Map();
  const previousByAction = new Map();
  const termsByAction = new Map();
  for (const receipt of registry.licences ?? []) {
    const draft = drafts.get(receipt.request.draft_request_id);
    const previous = latest.get(receipt.request.draft_request_id);
    const plan = draft && planLicenceAction(draft, receipt.request, previous);
    if (
      !plan ||
      actions.has(receipt.request.action_id) ||
      receipt.installation_id !== plan.terms.installation_id ||
      receipt.approval_sha256 !== plan.approval_sha256 ||
      receipt.tier !== plan.tier ||
      receipt.licence_sha256 !== sha256(receipt.envelope) ||
      (receipt.request.existing_licence_sha256 !== null &&
        receipt.request.existing_licence_sha256 !== receipt.licence_sha256)
    )
      throw new Error(
        "The private registry has conflicting or modified licence receipts.",
      );
    actions.set(receipt.request.action_id, receipt);
    termsByAction.set(receipt.request.action_id, plan.terms);
    if (previous) previousByAction.set(receipt.request.action_id, previous);
    latest.set(receipt.request.draft_request_id, receipt);
  }
  return { drafts, latest, actions, previousByAction, termsByAction };
}
