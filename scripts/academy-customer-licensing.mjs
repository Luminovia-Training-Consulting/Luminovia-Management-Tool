/** Validate current licence requests and preserve the audit chain of recorded v1 receipts. */
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
const currentActions = z.enum(["initial-licensed", "adopt-licensed", "renew"]);
const recordedV1Actions = z.enum([
  ...currentActions.options,
  "initial-trial",
  "adopt-trial",
  "convert-trial",
]);
const envelopeSchema = z
  .string()
  .max(16384)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/);
const recordedV1Request = z.strictObject({
  version: z.literal(1),
  action_id: requestId,
  draft_request_id: requestId,
  action: recordedV1Actions,
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

// Keep the original field order for already approved v1 request digests.
const licenceRequestSchema = recordedV1Request
  .extend({
    version: z.union([z.literal(1), z.literal(2)]),
    action: currentActions,
    lms_package: z.enum(["standard", "premium"]).optional(),
  })
  .refine(
    (request) => request.version === 2 || request.lms_package === undefined,
  );

export const licenceReceiptSchema = z.strictObject({
  request: z.union([licenceRequestSchema, recordedV1Request]),
  installation_id: z.uuid(),
  tier: z.enum(["trial", "licensed"]),
  approval_sha256: digestSchema,
  recorded_at: instant,
  licence_sha256: digestSchema,
  envelope: envelopeSchema,
});

export const sha256 = (value) =>
  createHash("sha256").update(value).digest("hex");

/** Accept eligible new actions only, before any signing or registry write. */
export function parseLicenceRequest(input) {
  const parsed = licenceRequestSchema.safeParse(input);
  if (!parsed.success)
    throw new Error("Invalid private licence request fields or version.");
  return parsed.data;
}

/** Calculate the reviewed transition for the licensed terms issued by the CLI. */
export function planLicenceAction(receipt, input, previous) {
  const request = parseLicenceRequest(input);
  if (request.version === 1 && previous?.tier === "trial")
    throw new Error("Use a version 2 request to issue the next licensed term.");
  return planRecordedTransition(receipt, request, previous);
}

/** Recompute a receipt from its original format without changing signed wire terms. */
function planRecordedTransition(receipt, request, previous) {
  const adopting = ["adopt-licensed", "adopt-trial"].includes(request.action);
  const issuing = ["initial-licensed", "initial-trial"].includes(
    request.action,
  );
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
    if (request.preceding_licence_sha256 !== null || (!issuing && !adopting))
      throw new Error(
        "Start with an initial licence or register an existing signed licence.",
      );
    if (
      issuing &&
      (request.release_commit !== receipt.draft.licence.release_commit ||
        JSON.stringify(request.limits) !==
          JSON.stringify(receipt.draft.licence.limits))
    )
      throw new Error(
        "The first licence must match the approved release and limits.",
      );
  }

  const approvedPackage = receipt.draft.licence.lms_package;
  if (
    !previous &&
    approvedPackage &&
    (request.lms_package ?? "premium") !== approvedPackage
  ) {
    throw new Error(
      "The first licence must match the approved Academy LMS package.",
    );
  }

  if (adopting !== (request.existing_licence_sha256 !== null))
    throw new Error(
      "An existing envelope hash is required only when registering a licence.",
    );

  if (
    previous?.request.lms_package === "standard" &&
    request.lms_package === undefined
  )
    throw new Error("Confirm the Academy LMS package explicitly on renewal.");
  const { issued_at, starts_at, expires_at, grace_until } = request;
  // Only historical records use the old commercial tier metadata. It is
  // outside the signed entitlement terms, which keep their existing format.
  let tier = "licensed";
  if (request.version === 1) {
    if (request.action === "renew") tier = previous.tier;
    if (["initial-trial", "adopt-trial"].includes(request.action))
      tier = "trial";
  }
  const terms = {
    installation_id: receipt.installation_id,
    edition: receipt.draft.target.edition,
    release_commit: request.release_commit,
    issued_at,
    starts_at,
    expires_at,
    grace_until,
    modules: [request.lms_package === "standard" ? "lms-standard" : "lms"],
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

/** Verify append-only history, including receipts written by earlier operators. */
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
    const plan =
      draft && planRecordedTransition(draft, receipt.request, previous);
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
