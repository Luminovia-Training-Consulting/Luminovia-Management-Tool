import { z } from "zod";

const instant = z.iso.datetime({ offset: true });
const auditPage = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: z.uuid(),
        actor_name: z.string(),
        action: z.string(),
        resource_id: z.uuid().nullable(),
        created_at: instant,
        resource_kind: z.string().optional(),
        changed_fields: z.array(z.string()).optional(),
        payment: z
          .strictObject({ amount: z.string(), currency: z.string().length(3) })
          .optional(),
      }),
    )
    .max(100),
  has_more: z.boolean(),
  next_cursor: z.strictObject({ at: instant, id: z.uuid() }).nullable(),
  from: instant,
  to: instant,
  actions: z.array(z.string()),
});

const query = z.strictObject({
  p_from: instant.nullable().optional(),
  p_to: instant.nullable().optional(),
  p_action: z.string().optional(),
  p_search: z.string().max(160).optional(),
  p_before_at: instant.nullable().optional(),
  p_before_id: z.uuid().nullable().optional(),
  p_limit: z.number().int().min(1).max(100).optional(),
});

export const administrationAuditPaths = {
  "/rest/v1/rpc/admin_audit_events": {
    post: {
      operationId: "native_admin_audit_events",
      tags: ["Administrative audit"],
      summary: "Read the 30-day administration audit trail",
      description:
        "Requires current audit.read authority. The requested half-open date range and cursor query only events retained within the last 30 days. Payments show amounts and currency only with the corresponding current finance authority. Use both fields of next_cursor.",
      requestBody: {
        required: false,
        content: { "application/json": { schema: z.toJSONSchema(query) } },
      },
      responses: {
        "200": {
          description: "Current audited activity",
          content: {
            "application/json": { schema: z.toJSONSchema(auditPage) },
          },
        },
        "400": { description: "Invalid date range, action, search or cursor" },
        "401": { description: "An authenticated session is required" },
        "403": {
          description: "The current account cannot read the audit trail",
        },
        "503": { description: "The audit trail is temporarily unavailable" },
      },
    },
  },
  "/rest/v1/rpc/clear_administration_activity": {
    post: {
      operationId: "native_clear_administration_activity",
      tags: ["Administrative audit"],
      summary: "Clear the administration activity trail",
      description:
        "Permanently clears the 30-day operational trail after explicit confirmation by an active internal administrator or owner. The call preserves underlying business receipts.",
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: z.toJSONSchema(
              z.strictObject({ p_confirm: z.literal(true) }),
            ),
          },
        },
      },
      responses: {
        "200": {
          description: "Number of deleted activity entries",
          content: {
            "application/json": {
              schema: z.toJSONSchema(
                z.strictObject({ removed: z.number().int().nonnegative() }),
              ),
            },
          },
        },
        "400": { description: "Explicit confirmation is required" },
        "401": { description: "An authenticated session is required" },
        "403": { description: "The current account cannot clear activity" },
      },
    },
  },
};
