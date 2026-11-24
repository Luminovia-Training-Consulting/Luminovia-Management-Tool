/** Closed mail transport contracts for both portal editions. */
import { z } from "zod";

const credentials = [{ apiKey: [], bearerAuth: [] }];
const internalSecurity = [{ publicApiKey: [], bearerAuth: [] }];
const tags = ["Local academy SMTP"];
const json = (schema: z.ZodType) => ({
  "application/json": { schema: z.toJSONSchema(schema) },
});
const restError = z.strictObject({
  code: z.string(),
  message: z.string(),
  details: z.string().nullable(),
  hint: z.string().nullable(),
});
const edgeError = z.strictObject({
  error: z.enum([
    "origin_not_allowed",
    "method_not_allowed",
    "authentication_required",
    "invalid_request",
    "permission_denied",
    "test_unavailable",
    "confirmed_email_required",
  ]),
});
const safeErrorCode = z.enum([
  "connect_failed",
  "tls_failed",
  "authentication_failed",
  "protocol_failed",
  "timeout",
  "configuration_changed",
  "configuration_unavailable",
]);
const transport = {
  enabled: z.boolean(),
  host: z.string().nullable(),
  security: z.enum(["implicit_tls", "starttls"]).nullable(),
  credentials_configured: z.boolean(),
  last_test: z
    .strictObject({
      status: z.enum(["pending", "running", "succeeded", "failed"]),
      error_code: safeErrorCode.nullable(),
      created_at: z.iso.datetime({ offset: true }),
      finished_at: z.iso.datetime({ offset: true }).nullable(),
    })
    .nullable(),
};
const configuration = z.strictObject({
  version: z.number().int().nonnegative(),
  smtp: z.strictObject({
    ...transport,
    port: z.union([z.literal(465), z.literal(587)]).nullable(),
    sender_email: z.string().nullable(),
    sender_name: z.string().nullable(),
  }),
  imap: z.strictObject({
    ...transport,
    port: z.union([z.literal(143), z.literal(993)]).nullable(),
  }),
});
const writeOnly = {
  username: z.string().max(254).meta({ writeOnly: true }).optional(),
  password: z.string().max(1024).meta({ writeOnly: true }).optional(),
};
const enabledFields = {
  enabled: z.literal(true),
  host: z.string().min(1).max(253),
  sender_email: z.email().max(254),
  sender_name: z.string().min(1).max(120),
  ...writeOnly,
};
const smtpDraft = z.union([
  z.strictObject({
    ...enabledFields,
    port: z.literal(465),
    security: z.literal("implicit_tls"),
  }),
  z.strictObject({
    ...enabledFields,
    port: z.literal(587),
    security: z.literal("starttls"),
  }),
  z.strictObject({
    enabled: z.literal(false),
    host: z.string().max(253).optional(),
    port: z
      .union([z.literal(465), z.literal(587)])
      .nullable()
      .optional(),
    security: z.enum(["implicit_tls", "starttls"]).optional(),
    sender_email: z.string().max(254).optional(),
    sender_name: z.string().max(120).optional(),
    ...writeOnly,
  }),
]);
export const mailRuntimeStatus = z.strictObject({
  relay_configured: z.boolean(),
  invitations_enabled: z.boolean(),
});
const result = z.strictObject({
  status: z.enum(["succeeded", "failed"]),
  error_code: safeErrorCode.nullable(),
});
const response = (description: string, schema = restError as z.ZodType) => ({
  description,
  content: json(schema),
});
const forbidden = response(
  "Current administrator and relevant licence required",
);

const runtimeStatusOperation = (
  operationId: string,
  operationTags: string[],
  security: Array<Record<string, never[]>>,
) => ({
  operationId,
  tags: operationTags,
  security,
  summary: "Read the configured mail relay and account invitation switches",
  description:
    "Requires current mail administration authority. Reports configured runtime switches without performing a handshake or attempting delivery.",
  responses: {
    "200": response("Runtime switches", mailRuntimeStatus),
    "401": response("Authentication required", edgeError),
    "403": response("Origin or current authority refused", edgeError),
    "503": response("Status unavailable", edgeError),
  },
});
export const mailDeliveryFailure = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["invitation", "course"]),
  status: z.enum(["failed", "uncertain"]),
  recipient: z.string().nullable(),
  failed_at: z.iso.datetime({ offset: true }),
  created_at: z.iso.datetime({ offset: true }),
  error_code: z.string().nullable(),
  retry_allowed: z.boolean(),
});

const recoveryId = z.strictObject({
  p_delivery_id: z.uuid(),
  p_failed_at: z.iso.datetime({ offset: true }),
  p_request_id: z.uuid(),
});

function mailRecoveryPaths(academy: boolean) {
  const prefix = academy ? "academy" : "internal";
  const operationTags = academy ? tags : ["Mail administration"];
  const security = academy ? credentials : internalSecurity;
  return {
    "/rest/v1/rpc/mail_delivery_failures": {
      get: {
        operationId: `${prefix}MailDeliveryFailures`,
        tags: operationTags,
        security,
        ...(academy && { "x-portal-licence": "active-or-grace" }),
        summary:
          "Read the latest failed invitation and course email deliveries",
        description:
          "Requires current mail administration authority. Returns at most 80 currently unresolved failures and uncertain outcomes, excluding credentials and raw provider responses.",
        responses: {
          "200": response(
            "Recent failed or uncertain deliveries",
            mailDeliveryFailure.array().max(80),
          ),
          "401": response("Authentication required"),
          "403": forbidden,
        },
      },
    },
    "/rest/v1/rpc/retry_course_mail_delivery": {
      post: {
        operationId: `${prefix}RetryCourseMailDelivery`,
        tags: operationTags,
        security,
        ...(academy && { "x-portal-licence": "active" }),
        summary: "Requeue one definitively failed course email",
        description:
          "Uses the original course event, its current verified account address, current course access and notification settings. Pass the retained failure timestamp and a stable request UUID. Ambiguous SMTP outcomes cannot be requeued.",
        requestBody: { required: true, content: json(recoveryId) },
        responses: {
          "200": response("Durably queued email UUID", z.uuid()),
          "400": response("Malformed delivery receipt or request identity"),
          "401": response("Authentication required"),
          "403": forbidden,
          "409": response(
            "Delivery state, access or recipient preferences changed",
          ),
        },
      },
    },
  };
}

export const internalMailRecoveryPaths = mailRecoveryPaths(false);

export const academyMailPaths = {
  ...mailRecoveryPaths(true),
  "/rest/v1/rpc/get_mail_configuration": {
    post: {
      operationId: "readAcademyMailConfiguration",
      tags,
      summary: "Read the local SMTP configuration status",
      description:
        "An active or grace-period installation permits this read to a current, confirmed local administrator. The response contains credential-presence flags and a sanitized test result.",
      security: credentials,
      "x-portal-licence": "active-or-grace",
      requestBody: { required: false, content: json(z.strictObject({})) },
      responses: {
        "200": response("Redacted configuration", configuration),
        "401": response("Authentication required"),
        "403": forbidden,
      },
    },
  },
  "/rest/v1/rpc/save_mail_configuration": {
    post: {
      operationId: "saveAcademyMailConfiguration",
      tags,
      summary: "Save the customer SMTP provider",
      description:
        "Current confirmed local administrators can submit the last configuration version with a public SMTP DNS name and its paired TLS mode. Supply both credential values to replace them. The relay stores both values in Vault. The IMAP settings argument is the disabled marker.",
      security: credentials,
      "x-portal-licence": "active",
      "x-portal-document-only": true,
      requestBody: {
        required: true,
        content: json(
          z.strictObject({
            p_expected_version: z.number().int().min(0).max(2147483647),
            p_smtp: smtpDraft,
            p_imap: z.strictObject({ enabled: z.literal(false) }),
          }),
        ),
      },
      responses: {
        "200": response("Redacted confirmed configuration", configuration),
        "400": response("Invalid SMTP transport settings"),
        "401": response("Authentication required"),
        "403": forbidden,
        "409": response("The configuration version changed"),
      },
    },
  },
  "/rest/v1/rpc/queue_mail_connection_test": {
    post: {
      operationId: "queueAcademyMailConnectionTest",
      tags,
      summary: "Reserve a single SMTP handshake request",
      description:
        "This is the caller-scoped database step used by mail-admin. Use the mail-admin operation to run the handshake and obtain a result.",
      security: credentials,
      "x-portal-licence": "active",
      "x-portal-document-only": true,
      requestBody: {
        required: true,
        content: json(z.strictObject({ p_protocol: z.literal("smtp") })),
      },
      responses: {
        "200": response("Single-use request identifier", z.uuid()),
        "400": response("SMTP settings or credentials are missing"),
        "401": response("Authentication required"),
        "403": forbidden,
      },
    },
  },
  "/functions/v1/mail-admin": {
    get: {
      ...runtimeStatusOperation(
        "readAcademyMailRuntimeStatus",
        tags,
        credentials,
      ),
      "x-portal-licence": "active-or-grace",
      "x-portal-document-only": true,
    },
    post: {
      operationId: "checkAcademyMailConnection",
      tags,
      summary: "Check SMTP or send a test email",
      description:
        "A current local administrator on an active installation can check the saved transport or use send_to_self to send a fixed test email to their confirmed account address. The result contains a fixed status and optional safe error code.",
      security: credentials,
      "x-portal-licence": "active",
      "x-portal-document-only": true,
      requestBody: {
        required: true,
        content: json(
          z.strictObject({
            protocol: z.literal("smtp"),
            send_to_self: z.literal(true).optional(),
          }),
        ),
      },
      responses: {
        "200": response("Sanitized mail test result", result),
        "400": response("Invalid request", edgeError),
        "401": response("Authentication required", edgeError),
        "403": response("Origin or current administrator refused", edgeError),
        "503": response("Test unavailable", edgeError),
      },
    },
  },
};

const internalTags = ["Mail transport"];
const internalForbidden = response(
  "Current mail administration authority required",
);
const mailProtocol = z.enum(["smtp", "imap"]);
const imapDraft = z.union([
  z.strictObject({
    enabled: z.literal(true),
    host: enabledFields.host,
    port: z.literal(993),
    security: z.literal("implicit_tls"),
    ...writeOnly,
  }),
  z.strictObject({
    enabled: z.literal(true),
    host: enabledFields.host,
    port: z.literal(143),
    security: z.literal("starttls"),
    ...writeOnly,
  }),
  z.strictObject({
    enabled: z.literal(false),
    host: z.string().max(253).optional(),
    port: z
      .union([z.literal(143), z.literal(993)])
      .nullable()
      .optional(),
    security: z.enum(["implicit_tls", "starttls"]).optional(),
    ...writeOnly,
  }),
]);

export const internalMailRead = {
  "/rest/v1/rpc/get_mail_configuration": {
    post: {
      operationId: "native_get_mail_configuration",
      tags: internalTags,
      summary: "Read the SMTP and IMAP configuration status",
      description:
        "Requires current mail administration authority. Includes configured SMTP and IMAP transports, credential-presence flags and sanitized test results.",
      security: internalSecurity,
      requestBody: { required: false, content: json(z.strictObject({})) },
      responses: {
        "200": response("Redacted configuration", configuration),
        "401": response("Authentication required"),
        "403": internalForbidden,
      },
    },
  },
};

export const internalMailDownload = {
  "/rest/v1/rpc/save_mail_configuration": {
    post: {
      operationId: "native_save_mail_configuration",
      tags: internalTags,
      summary: "Save the SMTP and IMAP providers",
      description:
        "Requires current mail administration authority. Pass the last-read configuration version. Enabled transports require paired port and TLS settings. Supply both credential values to replace a transport's credentials. Stored credentials remain in Vault.",
      security: internalSecurity,
      requestBody: {
        required: true,
        content: json(
          z.strictObject({
            p_expected_version: z.number().int().min(0).max(2147483647),
            p_smtp: smtpDraft,
            p_imap: imapDraft,
          }),
        ),
      },
      responses: {
        "200": response("Redacted confirmed configuration", configuration),
        "400": response("Invalid transport settings or credential pair"),
        "401": response("Authentication required"),
        "403": internalForbidden,
        "409": response("The configuration version changed"),
      },
    },
  },
  "/rest/v1/rpc/queue_mail_connection_test": {
    post: {
      operationId: "queueMailConnectionTest",
      tags: internalTags,
      summary: "Reserve a single SMTP or IMAP handshake",
      description:
        "Requires current mail administration authority. Use mail-admin to both queue and run the connection test.",
      security: internalSecurity,
      requestBody: {
        required: true,
        content: json(z.strictObject({ p_protocol: mailProtocol })),
      },
      responses: {
        "200": response("Single-use request identifier", z.uuid()),
        "400": response("Transport settings or credentials are missing"),
        "401": response("Authentication required"),
        "403": internalForbidden,
      },
    },
  },
  "/functions/v1/mail-admin": {
    get: runtimeStatusOperation(
      "readMailRuntimeStatus",
      internalTags,
      internalSecurity,
    ),
    post: {
      operationId: "checkMailConnection",
      tags: internalTags,
      summary: "Check a saved mail transport or send a test email",
      description:
        "Requires current mail administration authority. Checks TLS and authentication. For SMTP, send_to_self sends a fixed test email to the caller’s confirmed account address.",
      security: internalSecurity,
      requestBody: {
        required: true,
        content: json(
          z.union([
            z.strictObject({ protocol: mailProtocol }),
            z.strictObject({
              protocol: z.literal("smtp"),
              send_to_self: z.literal(true),
            }),
          ]),
        ),
      },
      responses: {
        "200": response("Sanitized mail test result", result),
        "400": response("Invalid request", edgeError),
        "401": response("Authentication required", edgeError),
        "403": response("Origin or current authority refused", edgeError),
        "503": response("Test unavailable", edgeError),
      },
    },
  },
};
