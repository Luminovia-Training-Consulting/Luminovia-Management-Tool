/** API contract for the portal's versioned teaching evidence. */
import { z } from "zod";
import {
  deliveryDraftSchema,
  deliveryHistorySchema,
  deliveryPageSchema,
  deliveryReviewActions,
  deliveryScopes,
  deliverySessionSchema,
} from "../changes/delivery-schema.ts";
import { nativeExplorerPaths } from "./native-contract.ts";

const session = { p_session_id: z.uuid() };
const mutation = {
  ...session,
  p_expected_version: z.number().int().min(0).max(2147483647),
  p_request_id: z
    .uuid()
    .describe("Reuse only for a retry of the identical action."),
};
const listFilters = {
  p_scope: z.enum(deliveryScopes).optional().meta({ default: "own" }),
  p_limit: z.number().int().min(1).max(100).optional().meta({ default: 50 }),
};
const listInput = z.union([
  z.strictObject({
    ...listFilters,
    p_before_at: z.null().optional(),
    p_before_id: z.null().optional(),
  }),
  z.strictObject({
    ...listFilters,
    p_before_at: z.iso.datetime({ offset: true }),
    p_before_id: z.uuid(),
  }),
]);
const error = z.object({
  code: z.string(),
  message: z.string(),
  hint: z.string().nullable().optional(),
  details: z.string().nullable().optional(),
});

const json = (schema: z.ZodType, io: "input" | "output" = "output") => ({
  "application/json": { schema: z.toJSONSchema(schema, { io }) },
});

function operation(
  name: string,
  description: string,
  input: z.ZodType,
  output: z.ZodType,
) {
  const path = `/rest/v1/rpc/${name}` as const;
  const native = nativeExplorerPaths[path]?.post;
  const fault = (description: string) => ({
    description,
    content: json(error),
  });
  return [
    path,
    {
      post: {
        ...native,
        operationId: `native_${name}`,
        summary: name.replaceAll("_", " "),
        description,
        tags: ["Delivery evidence"],
        requestBody: {
          required: name !== "delivery_sessions",
          content: json(input, "input"),
        },
        responses: {
          ...native?.responses,
          "200": {
            description:
              "Authorised current evidence or an exact write receipt.",
            content: json(output),
          },
          "400": fault(
            "Invalid input, unavailable transition or changed replay payload.",
          ),
          "401": fault("Authentication required."),
          "403": fault(
            "Current scope, teaching ownership or independent review authority required.",
          ),
          "404": fault("Arguments do not identify the delivery RPC."),
          "409": fault("The reviewed version has changed."),
        },
      },
    },
  ] as const;
}

export const deliveryEvidencePaths = Object.fromEntries([
  operation(
    "delivery_sessions",
    "Find teaching evidence in the current own, management or customer scope. Send both cursor values to advance a page.",
    listInput,
    deliveryPageSchema,
  ),
  operation(
    "delivery_session",
    "Read the exact session and current evidence. Customer views contain only confirmed evidence with protected notes removed.",
    z.strictObject(session),
    deliverySessionSchema,
  ),
  operation(
    "delivery_history",
    "Read retained versions and matching decision events under the current evidence scope.",
    z.strictObject(session),
    deliveryHistorySchema,
  ),
  operation(
    "save_delivery_draft",
    "Record actual teaching or correct an independently reopened submission. Submitted revisions and agreed teaching times remain immutable.",
    z.strictObject({
      ...mutation,
      p_payload: deliveryDraftSchema,
    }),
    deliverySessionSchema,
  ),
  operation(
    "submit_delivery",
    "Submit the exact saved teaching evidence as a new retained revision.",
    z.strictObject(mutation),
    deliverySessionSchema,
  ),
  operation(
    "review_delivery",
    "An independent reviewer confirms or reopens the current evidence. A dispute or correction requires a reason of at least five characters.",
    z.discriminatedUnion("p_action", [
      z.strictObject({
        ...mutation,
        p_action: z.literal(deliveryReviewActions[0]),
        p_note: z.string().max(2000),
      }),
      z.strictObject({
        ...mutation,
        p_action: z.literal(deliveryReviewActions[1]),
        p_note: z.string().min(5).max(2000),
      }),
      z.strictObject({
        ...mutation,
        p_action: z.literal(deliveryReviewActions[2]),
        p_note: z.string().min(5).max(2000),
      }),
    ]),
    deliverySessionSchema,
  ),
  operation(
    "confirm_customer_delivery",
    "The assigned customer can acknowledge the current confirmed submission once.",
    z.strictObject(mutation),
    deliverySessionSchema,
  ),
]);
