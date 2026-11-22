/** Reviewed internal native contracts for institution enquiries and support. */
import { z } from "zod";
import {
  jsonContent as json,
  postgrestErrorResponse as error,
} from "./postgrest-content.ts";
import {
  enquiryContextSchema,
  enquiryDetailSchema,
  enquiryPageSchema,
  enquiryStatuses,
  type EnquiryAction,
} from "../enquiries/schema.ts";
import {
  newTicketSchema,
  supportContextSchema,
  supportPageSchema,
  supportStatuses,
  supportTicketDetailSchema,
  type SupportAction,
} from "../support/schema.ts";

const id = z.uuid();
const instant = z.iso.datetime({ offset: true });
const optionalId = z.union([id, z.literal(""), z.null()]).optional();
const version = z.number().int().min(1).max(2147483647);
const text = (max: number) => z.string().trim().min(1).max(max).regex(/[^ ]/);
const noBody = z.strictObject({});
const requestVersion = { p_expected_version: version, p_request_id: id };

function filters<T extends readonly [string, ...string[]]>(statuses: T) {
  const fields = {
    p_search: z.string().max(200).optional().meta({ default: "" }),
    p_status: z
      .enum(["", ...statuses])
      .optional()
      .meta({ default: "" }),
    p_limit: z.number().int().min(1).max(100).optional().meta({ default: 40 }),
  };
  return z.union([
    z.strictObject({
      ...fields,
      p_before_at: z.null().optional(),
      p_before_id: z.null().optional(),
    }),
    z.strictObject({ ...fields, p_before_at: instant, p_before_id: id }),
  ]);
}

const enquiryCommands = {
  status: z.strictObject({
    status: z.enum(["reviewing", "awaiting_customer", "closed"]),
    reason: text(4000),
  }),
  assign: z.strictObject({ user_id: optionalId }),
  link_customer: z.strictObject({ organisation_id: id }),
  create_customer: noBody,
  convert: z.strictObject({
    template_id: optionalId,
    time_zone: z.string().min(1),
    delivery_type: z.enum(["online", "onsite"]),
    venue: z.string().nullable().optional(),
    sessions: z
      .array(z.strictObject({ starts_at: instant, ends_at: instant }))
      .min(1)
      .max(60),
  }),
  note: z.strictObject({ note: text(4000) }),
} satisfies Record<EnquiryAction, z.ZodType>;

const supportLinks = {
  course_run_id: optionalId,
  claim_id: optionalId,
  organisation_id: optionalId,
};
const supportCommands = {
  reply: z.strictObject({ body: text(12000) }),
  internal_note: z.strictObject({ body: text(12000) }),
  status: z.strictObject({
    status: z.enum(["in_progress", "waiting_for_user", "resolved", "closed"]),
    reason: text(2000),
  }),
  assign: z.strictObject({ user_id: optionalId }),
  priority: z.strictObject({
    priority: supportTicketDetailSchema.shape.priority,
  }),
  reopen: z.strictObject({
    status: z
      .enum(["", ...supportStatuses])
      .optional()
      .describe(
        "Accepted from the portal form. Reopening always sets the ticket to open.",
      ),
    reason: text(2000),
  }),
  links: z.strictObject(supportLinks),
  attach: z.strictObject({ document_id: id, internal: z.boolean() }),
} satisfies Record<SupportAction, z.ZodType>;

function commands(resourceKey: string, payloads: Record<string, z.ZodType>) {
  const [first, ...rest] = Object.entries(payloads).map(
    ([p_action, p_payload]) =>
      z.strictObject({
        [resourceKey]: id,
        p_action: z.literal(p_action),
        p_payload,
        ...requestVersion,
      }),
  );
  return z.discriminatedUnion("p_action", [first, ...rest]);
}

const enquiryContextByRole = z.discriminatedUnion("can_convert", [
  enquiryContextSchema.extend({ can_convert: z.literal(true) }),
  enquiryContextSchema.extend({
    can_convert: z.literal(false),
    templates: enquiryContextSchema.shape.templates.max(0),
  }),
]);

const supportContextByRole = z.discriminatedUnion("can_manage", [
  supportContextSchema.extend({ can_manage: z.literal(true) }),
  supportContextSchema.extend({
    can_manage: z.literal(false),
    staff: supportContextSchema.shape.staff.max(0),
    report: supportContextSchema.shape.report.max(0),
  }),
]);

const supportDetailsByRole = z.discriminatedUnion("can_manage", [
  supportTicketDetailSchema.extend({ can_manage: z.literal(true) }),
  supportTicketDetailSchema.extend({
    can_manage: z.literal(false),
    mine: z.literal(true),
    messages: z.array(
      supportTicketDetailSchema.shape.messages.element.extend({
        internal: z.literal(false),
      }),
    ),
    attachments: z.array(
      supportTicketDetailSchema.shape.attachments.element.extend({
        internal: z.literal(false),
      }),
    ),
    events: z.array(
      supportTicketDetailSchema.shape.events.element.extend({
        action: z.enum([
          "created",
          "reply",
          "status",
          "assign",
          "priority",
          "reopen",
          "attach",
        ]),
      }),
    ),
  }),
]);

function operation(
  operationId: string,
  tag: "Institution enquiries" | "Support",
  summary: string,
  description: string,
  request: z.ZodType,
  response: z.ZodType,
  options: { optionalBody?: boolean; conflict?: boolean; budget?: string } = {},
) {
  return {
    post: {
      operationId,
      tags: [tag],
      summary,
      description,
      requestBody: { required: !options.optionalBody, content: json(request) },
      responses: {
        "200": {
          description: "The authorised projection or confirmed record ID.",
          content: json(response),
        },
        "400": error(
          "The request arguments, cursor, action or idempotency key are invalid.",
        ),
        "401": error("Authentication required."),
        "403": error("The current account does not have access."),
        "404": error("The supplied named arguments do not match this RPC."),
        ...(options.conflict
          ? {
              "409": error(
                "The expected version is stale. Reload before editing.",
                z.literal("PT409"),
              ),
            }
          : {}),
        ...(options.budget
          ? { "500": error(options.budget, z.literal("54000")) }
          : {}),
      },
    },
  };
}

export const enquiriesSupportPaths = {
  "/rest/v1/rpc/enquiry_context": operation(
    "readInstitutionEnquiryContext",
    "Institution enquiries",
    "Read authorised enquiry choices",
    "Requires current organisation management. Existing organisations and eligible staff are returned. Current course-management authority also permits conversion and template choices.",
    noBody,
    enquiryContextByRole,
    { optionalBody: true },
  ),
  "/rest/v1/rpc/enquiry_inbox": operation(
    "readInstitutionEnquiryInbox",
    "Institution enquiries",
    "Page through institution enquiry summaries",
    "Requires current organisation management. Search matches company name, topic and contact email. Summaries contain only the company, topic, status, version, timestamps and assignee name. Rows are newest first by update time and ID. Pass both cursor values from the previous page.",
    filters(enquiryStatuses),
    enquiryPageSchema,
    { optionalBody: true },
  ),
  "/rest/v1/rpc/enquiry_detail": operation(
    "readInstitutionEnquiry",
    "Institution enquiries",
    "Read an institution enquiry and its history",
    "Requires current organisation management to see original contact, consent and enquiry history. The linked course run ID is null for callers without current course-management authority.",
    z.strictObject({ p_enquiry_id: id }),
    enquiryDetailSchema,
  ),
  "/rest/v1/rpc/manage_enquiry": operation(
    "manageInstitutionEnquiry",
    "Institution enquiries",
    "Apply a reviewed enquiry action",
    "Requires current organisation management. Conversion additionally requires course management, an already linked customer and a valid non-overlapping schedule in an IANA time zone. Conversion creates an unpublished course. Every action returns the enquiry ID. Read the detail for the linked course ID. Reuse the request ID only for the identical action, payload and reviewed version.",
    commands("p_enquiry_id", enquiryCommands),
    id,
    { conflict: true, budget: "The enquiry version limit has been reached." },
  ),
  "/rest/v1/rpc/support_context": operation(
    "readSupportContext",
    "Support",
    "Read support choices in the current account scope",
    "Returns course, assignment and organisation choices independently scoped to the caller. Staff choices and aggregate reporting require current support-management authority.",
    noBody,
    supportContextByRole,
    { optionalBody: true },
  ),
  "/rest/v1/rpc/support_tickets": operation(
    "readSupportTicketPage",
    "Support",
    "Page through visible ticket summaries",
    "Requesters see their own tickets. Current support managers see the support queue. Search matches title and description, and summaries omit description, messages, events and attachment details. Results are newest first by update time and ID. Pass both cursor values from the previous page.",
    filters(supportStatuses),
    supportPageSchema,
    { optionalBody: true },
  ),
  "/rest/v1/rpc/support_ticket": operation(
    "readSupportTicket",
    "Support",
    "Read a visible ticket and conversation",
    "Requires current ticket ownership or support-management authority. Requesters receive public messages, events and exact attachment version references. Internal notes, events and attachments require support management. Linked course, assignment and organisation IDs require independent resource access.",
    z.strictObject({ p_ticket_id: id }),
    supportDetailsByRole,
  ),
  "/rest/v1/rpc/create_support_ticket": operation(
    "createSupportTicket",
    "Support",
    "Create a support ticket",
    "The current eligible account becomes the requester. Related resources require independent current access. At most ten new tickets can be created per requester in fifteen minutes. An identical request retry returns the same ticket ID.",
    z.strictObject({
      p_payload: z.strictObject({ ...newTicketSchema.shape, ...supportLinks }),
      p_request_id: id,
    }),
    id,
    { budget: "The requester reached the ticket creation rate limit." },
  ),
  "/rest/v1/rpc/update_support_ticket": operation(
    "updateSupportTicket",
    "Support",
    "Reply, attach evidence or change a ticket state",
    "Requires current ticket ownership or support-management authority. Assignment, priority, status transitions, related links and internal content require support management. Public replies and scanned evidence require an active ticket. Reopening a closed ticket is available to its requester for thirty days. Reuse the request ID only for the identical action, payload and reviewed version. The result is the ticket ID.",
    commands("p_ticket_id", supportCommands),
    id,
    {
      conflict: true,
      budget:
        "The acting account reached the support mutation rate limit or the ticket reached its version limit.",
    },
  ),
};

/** The Website backend uses a separate secret. Keep this path download-only. */
const websiteEnquiry = z.strictObject({
  submission_id: id,
  company_name: text(200),
  contact_name: text(120),
  email: z.string().trim().max(254).email(),
  phone: z
    .string()
    .max(60)
    // eslint-disable-next-line no-control-regex -- Match the intake handler's rejection of ASCII control characters.
    .regex(/^[^\u0000-\u001f\u007f]*$/),
  topic: text(200),
  message: text(12000),
  preferred_dates: z.string().max(1000),
  duration: z.string().max(200),
  delivery_type: z.enum(["online", "onsite", "flexible"]),
  time_zone: z.string().min(1).describe("Recognised IANA time zone"),
  locale: z.enum(["de", "en"]),
  privacy_notice_version: text(120).describe(
    "Current configured notice version",
  ),
  consent: z.literal(true),
  website: z.literal("").optional().describe("Honeypot"),
});

const websiteErrors = {
  "400": ["Invalid input, consent or notice version", "invalid_request"],
  "401": [
    "Invalid or missing server integration credential",
    "integration_authentication_required",
  ],
  "403": ["Origin does not match the configured Website", "origin_not_allowed"],
  "409": [
    "The receipt UUID was previously used with a different payload",
    "retry_conflict",
  ],
  "413": ["The streamed JSON exceeds 24,000 bytes", "invalid_request"],
  "415": ["Content-Type must be application/json", "json_required"],
  "429": ["The durable integration sender quota was reached", "rate_limited"],
  "503": [
    "The intake is unavailable or did not confirm delivery",
    "integration_unavailable",
    "delivery_unavailable",
  ],
} as const;

export const websiteEnquiryIntakePath = {
  post: {
    operationId: "receiveWebsiteEnquiry",
    tags: ["Website integration"],
    summary: "Submit a contact enquiry from the trusted Website service",
    description:
      "The public gateway key is required. Follow the target gateway configuration for a legacy anonymous JWT. Keep the additional Website integration token on the server. Repeat the exact UUID and payload after an uncertain response. A confirmed receipt contains the caller's submission ID.",
    security: [{ publicApiKey: [], websiteIntakeToken: [] }],
    parameters: [
      {
        name: "Origin",
        in: "header",
        required: false,
        description:
          "If supplied, must exactly match the configured Website origin.",
        schema: { type: "string" },
      },
    ],
    requestBody: {
      required: true,
      content: {
        "application/json": { schema: z.toJSONSchema(websiteEnquiry) },
      },
    },
    responses: {
      "202": {
        description: "Durable intake acknowledgement",
        content: {
          "application/json": {
            schema: z.toJSONSchema(
              z.strictObject({ received: z.literal(true), receipt: id }),
            ),
          },
        },
      },
      ...Object.fromEntries(
        Object.entries(websiteErrors).map(
          ([status, [description, ...errors]]) => [
            status,
            {
              description,
              content: {
                "application/json": {
                  schema: z.toJSONSchema(
                    z.strictObject({ error: z.enum(errors) }),
                  ),
                },
              },
            },
          ],
        ),
      ),
    },
  },
};
