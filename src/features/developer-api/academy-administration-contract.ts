import { z } from "zod";
import {
  academyAccountReceipt,
  academyAdministration,
  academyInvitationReceipt,
  academyManagedAccount,
  academyMemberRoles,
  academyOrganisation,
} from "../accounts/academy-schema.ts";

const credentials = [{ apiKey: [], bearerAuth: [] }];
const json = (schema: z.ZodType) => ({
  "application/json": { schema: z.toJSONSchema(schema) },
});
const nativeError = z.strictObject({
  code: z.string(),
  message: z.string(),
  details: z.string().nullable(),
  hint: z.string().nullable(),
});
const error = (description: string, schema: z.ZodType = nativeError) => ({
  description,
  content: json(schema),
});
const noArguments = z.strictObject({});
const read =
  "Requires the operator-enabled course profile for the exact installed release and current local academy administration authority. An active or grace-period licence allows this read.";
const write =
  "Requires the operator-enabled course profile for the exact installed release, an active licence and current local academy administration authority.";

const account = {
  idempotency_key: z.uuid(),
  display_name: z.string().min(1).max(120),
  email: z
    .string()
    .max(254)
    .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/),
};
const instructor = { role: z.literal("lecturer"), organisation_id: z.null() };
const learner = { role: z.literal("participant"), organisation_id: z.uuid() };
const manager = { role: z.literal("management"), organisation_id: z.null() };
const companyContact = { role: z.literal("client"), organisation_id: z.uuid() };
const invite = { mode: z.literal("invite") };
const create = {
  mode: z.literal("password"),
  password: z
    .string()
    .min(8)
    .max(128)
    .regex(
      // eslint-disable-next-line no-control-regex -- The Auth facade rejects these exact ASCII controls.
      /^(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[!@#$%^&*()_+\-=[\]{}|;:,.<>?/])[^\x00-\x1f\x7f]+$/,
    )
    .meta({ writeOnly: true }),
};
const accountRequest = z.union([
  z.strictObject({ ...account, ...instructor, ...invite }),
  z.strictObject({ ...account, ...learner, ...invite }),
  z.strictObject({ ...account, ...manager, ...invite }),
  z.strictObject({ ...account, ...companyContact, ...invite }),
  z.strictObject({ ...account, ...instructor, ...create }),
  z.strictObject({ ...account, ...learner, ...create }),
  z.strictObject({ ...account, ...manager, ...create }),
  z.strictObject({ ...account, ...companyContact, ...create }),
]);
const isolatedReceipt = academyAccountReceipt.options[0];
const inProgress = academyAccountReceipt.options[1];

function memberWrite(
  operationId: string,
  summary: string,
  description: string,
  request: z.ZodType,
  conflict = "The expected state changed. Read the current directory.",
  response: z.ZodType = academyManagedAccount,
) {
  return {
    post: {
      operationId,
      tags: ["Local academy administration"],
      summary,
      description: `${write} ${description}`,
      security: credentials,
      "x-portal-licence": "active",
      requestBody: { required: true, content: json(request) },
      responses: {
        "200": {
          description: "The current local account state",
          content: json(response),
        },
        "400": error("Invalid account ID, state or version"),
        "401": error("Authentication required"),
        "403": error("Current authority over the target account required"),
        "409": error(conflict),
      },
    },
  };
}

const roleChange = {
  p_user_id: z.uuid(),
  p_expected_revision: academyMemberRoles.shape.revision,
};
const companyRole = z.enum(["client", "participant"]);

const academyAccountResponses = {
  "201": {
    description: "Confirmed native account creation",
    content: json(isolatedReceipt),
  },
  "200": {
    description: "Previously confirmed account creation",
    content: json(isolatedReceipt),
  },
  "202": {
    description: "The request is in progress",
    content: json(inProgress),
  },
  "400": error(
    "Invalid account request",
    z.strictObject({ error: z.literal("invalid_request") }),
  ),
  "401": error(
    "Authentication required",
    z.strictObject({ error: z.literal("authentication_required") }),
  ),
  "403": error(
    "Current local administration authority or an allowed origin is required",
    z.strictObject({
      error: z.enum(["permission_required", "origin_not_allowed"]),
    }),
  ),
  "409": error(
    "Existing account, changed or unavailable request, or all licensed account seats are in use",
    z.strictObject({
      error: z.enum(["creation_conflict", "academy_seat_limit"]),
    }),
  ),
  "413": error(
    "The request body exceeds the allowed size",
    z.strictObject({ error: z.literal("request_too_large") }),
  ),
  "415": error(
    "The request body must be JSON",
    z.strictObject({ error: z.literal("json_required") }),
  ),
  "429": error(
    "Account provisioning budget exhausted",
    z.strictObject({ error: z.literal("creation_rate_limited") }),
  ),
  "502": error(
    "Creation was not confirmed",
    z.strictObject({ error: z.literal("creation_failed") }),
  ),
  "503": error(
    "The provisioning or invitation service is unavailable",
    z.strictObject({
      error: z.enum([
        "creation_disabled",
        "creation_unavailable",
        "invitations_disabled",
        "service_unavailable",
      ]),
    }),
  ),
};

export const academyAdministrationPaths = {
  "/rest/v1/rpc/academy_member_roles": {
    post: {
      operationId: "readAcademyMemberRoles",
      tags: ["Local academy administration"],
      summary: "Read a local account's roles and company memberships",
      description: `${read} Requires a current local administrator. Returns role assignments with independent company scopes and the revision required for a change. Protected administrators and the current account cannot be edited here.`,
      security: credentials,
      "x-portal-licence": "active-or-grace",
      requestBody: {
        required: true,
        content: json(z.strictObject({ p_user_id: z.uuid() })),
      },
      responses: {
        "200": {
          description:
            "The current role assignments and available write actions",
          content: json(academyMemberRoles),
        },
        "401": error("Authentication required"),
        "403": error(
          "Current local administration authority over this account required",
        ),
      },
    },
  },
  "/rest/v1/rpc/academy_set_member_role": memberWrite(
    "changeAcademyMemberRole",
    "Grant or revoke one role for a local account",
    "Only a current local administrator can make the change. Provide the last-read role revision. A grant requires an active and confirmed account. The account must retain a role. A company contact or participant grant requires an active organisation and affects only that membership.",
    z.union([
      z.strictObject({
        ...roleChange,
        p_role: z.enum(["management", "lecturer"]),
        p_organisation_id: z.null(),
        p_enabled: z.boolean(),
      }),
      z.strictObject({
        ...roleChange,
        p_role: companyRole,
        p_organisation_id: z.uuid(),
        p_enabled: z.literal(true),
      }),
      z.strictObject({
        ...roleChange,
        p_role: companyRole,
        p_organisation_id: z.uuid().nullable(),
        p_enabled: z.literal(false),
      }),
    ]),
    "The expected revision changed or the account would lose its last role.",
    academyMemberRoles,
  ),
  "/rest/v1/rpc/academy_administration": {
    post: {
      operationId: "readAcademyAdministration",
      tags: ["Local academy administration"],
      summary: "Read the local organisation and course-member directory",
      description: `${read} Other eligible course actors receive null. The bounded read lists up to 200 active organisations and up to 200 manageable academy accounts. Administrators can also see local course managers. The account projection includes display name, current confirmation and activation state, and current lifecycle action flags.`,
      security: credentials,
      "x-portal-licence": "active-or-grace",
      requestBody: { required: false, content: json(noArguments) },
      responses: {
        "200": {
          description: "The local directory or null",
          content: json(academyAdministration.nullable()),
        },
        "401": error("Authentication required"),
        "403": error("The installation or current session is ineligible"),
      },
    },
  },
  "/rest/v1/rpc/academy_set_member_active": memberWrite(
    "changeAcademyMemberActivation",
    "Suspend or reactivate a local academy account",
    "Course managers can act on a standalone instructor or learner. An administrator can also act on a local course manager. Pass the last observed activation state. Existing Auth identity, enrolment and course evidence are preserved.",
    z.strictObject({
      p_user_id: z.uuid(),
      p_active: z.boolean(),
      p_expected_active: z.boolean(),
    }),
    "The expected state changed or all licensed account seats are in use. A seat-limit conflict has details academy_seat_limit.",
  ),
  "/rest/v1/rpc/academy_set_management": memberWrite(
    "changeAcademyManagementDelegation",
    "Grant or withdraw an existing instructor's management rights",
    "Only a current local administrator can make the change. A grant requires an active confirmed instructor. Pass the last observed delegation version, or zero for an instructor with no prior delegation. Withdrawing delegated rights preserves the instructor's Auth identity and teaching role.",
    z.strictObject({
      p_user_id: z.uuid(),
      p_enabled: z.boolean(),
      p_expected_version: z.number().int().min(0).max(2147483647),
    }),
  ),
  "/rest/v1/rpc/academy_create_organisation": {
    post: {
      operationId: "createAcademyOrganisation",
      tags: ["Local academy administration"],
      summary: "Create a local academy organisation",
      description: `${write} Provide an organisation name and the intended IANA time zone. A retry with the same request ID and values returns the original organisation.`,
      security: credentials,
      "x-portal-licence": "active",
      requestBody: {
        required: true,
        content: json(
          z.strictObject({
            p_request_id: z.uuid(),
            p_name: z.string().min(1).max(200),
            p_time_zone: z.string().min(1).max(80),
          }),
        ),
      },
      responses: {
        "200": {
          description: "The current organisation",
          content: json(academyOrganisation),
        },
        "400": error("Invalid name or time zone"),
        "401": error("Authentication required"),
        "403": error("Current local administration authority required"),
        "409": error(
          "Duplicate organisation, changed request or unavailable prior organisation",
        ),
      },
    },
  },
  "/functions/v1/accounts/v1/academy/users": {
    post: {
      operationId: "provisionAcademyCourseAccount",
      tags: ["Local academy administration"],
      summary: "Create or invite a local academy account",
      description: `${write} Choose password creation or a configured native Auth email invitation. A learner or company contact requires one active local organisation. Only a current local administrator can provision a company contact or course manager. A new request requires an available licensed account seat. Normal email confirmation applies to invited identities. Repeat a pending request with the same idempotency key and fields to check its status.`,
      security: credentials,
      "x-portal-licence": "active",
      requestBody: { required: true, content: json(accountRequest) },
      responses: academyAccountResponses,
    },
  },
  "/functions/v1/accounts/v1/academy/invitations/{id}/retry": {
    post: {
      operationId: "retryAcademyInvitationDelivery",
      tags: ["Local academy administration"],
      summary: "Send a replacement for a definitively rejected invitation",
      description:
        "Requires a current mail administrator and an active installation. The failed reservation supplies the name, role, organisation and original course when the invitation came from a company. Retry with a stable request key and the reviewed address. An uncertain result cannot start a second send.",
      security: credentials,
      "x-portal-licence": "active",
      parameters: [
        {
          in: "path",
          name: "id",
          required: true,
          schema: { type: "string", format: "uuid" },
        },
      ],
      requestBody: {
        required: true,
        content: json(
          z.strictObject({
            email: z.email().max(254),
            idempotency_key: z.uuid(),
          }),
        ),
      },
      responses: academyAccountResponses,
    },
  },

  "/functions/v1/accounts/v1/academy/company-invitations": {
    post: {
      operationId: "requestAcademyCompanyInvitation",
      tags: ["Local academy administration"],
      summary: "Request an email invitation from a company course workspace",
      description:
        "A current, confirmed company contact can request an invitation within their own company on an active academy licence. The server resolves the company from the course. The response acknowledges a request and has no account, enrolment or delivery details. Repeat an unchanged request with its original idempotency key.",
      security: credentials,
      "x-portal-licence": "active",
      requestBody: {
        required: true,
        content: json(z.strictObject({ ...account, course_id: z.uuid() })),
      },
      responses: {
        "202": {
          description: "Invitation requested",
          content: json(academyInvitationReceipt),
        },
        "400": error(
          "Invalid invitation request",
          z.strictObject({ error: z.literal("invalid_request") }),
        ),
        "401": error(
          "Authentication required",
          z.strictObject({ error: z.literal("authentication_required") }),
        ),
        "403": error(
          "Current company membership, an active licence and an allowed origin are required",
          z.strictObject({
            error: z.enum(["permission_required", "origin_not_allowed"]),
          }),
        ),
        "409": error(
          "The idempotency key was already used with different fields",
          z.strictObject({ error: z.literal("creation_conflict") }),
        ),
        "413": error(
          "Request body exceeds the allowed size",
          z.strictObject({ error: z.literal("request_too_large") }),
        ),
        "415": error(
          "The request body must be JSON",
          z.strictObject({ error: z.literal("json_required") }),
        ),
        "503": error(
          "Invitation service is disabled or unavailable",
          z.strictObject({
            error: z.enum([
              "invitations_disabled",
              "creation_unavailable",
              "service_unavailable",
            ]),
          }),
        ),
      },
    },
  },
};
