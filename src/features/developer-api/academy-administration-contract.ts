import { z } from "zod";
import {
  academyAccountReceipt,
  academyAdministration,
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
  z.strictObject({ ...account, ...instructor, ...create }),
  z.strictObject({ ...account, ...learner, ...create }),
]);
const isolatedReceipt = academyAccountReceipt.options[0];
const inProgress = academyAccountReceipt.options[1];

export const academyAdministrationPaths = {
  "/rest/v1/rpc/academy_administration": {
    post: {
      operationId: "readAcademyAdministration",
      tags: ["Local academy administration"],
      summary: "Read the local organisation and course-member directory",
      description: `${read} Other eligible course actors receive null. The bounded read lists up to 200 active organisations and up to 200 local single-role lecturers and learners. The account projection includes display name and current account and confirmation state.`,
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
      summary: "Create or invite a local lecturer or learner",
      description: `${write} Choose password creation or a configured native Auth email invitation. A learner requires one active local organisation. The committed result binds that learner to its organisation. Normal email confirmation applies to invited identities. Repeat a pending request with the same idempotency key and fields to check its status.`,
      security: credentials,
      "x-portal-licence": "active",
      requestBody: { required: true, content: json(accountRequest) },
      responses: {
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
          "Existing account, changed request or unavailable prior request",
          z.strictObject({ error: z.literal("creation_conflict") }),
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
      },
    },
  },
};
