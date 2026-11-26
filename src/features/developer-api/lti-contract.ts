/** Course registration management for manually provisioned LTI 1.3 placements. */
import { z } from "zod";
import { jsonContent, postgrestErrorResponse } from "./postgrest-content.ts";

const identifier = z.uuid();
const version = z.number().int().positive();
const inputVersion = z.number().int().nonnegative();
const url = z.url().max(1500);
const toolPublicKey = z.strictObject({
  kty: z.literal("RSA"),
  kid: z.string().regex(/^[A-Za-z0-9._-]{1,80}$/),
  n: z.string().regex(/^[A-Za-z0-9_-]{342,683}$/),
  e: z.string().regex(/^[A-Za-z0-9_-]{2,8}$/),
  alg: z.literal("RS256").optional(),
  use: z.literal("sig").optional(),
});
const configuration = {
  client_id: z.string().min(1).max(255),
  login_uri: url,
  redirect_uri: url,
  target_uri: url,
};

export function ltiCoursePaths(academy: boolean) {
  const errors = {
    "400": postgrestErrorResponse("Invalid LTI registration."),
    "401": postgrestErrorResponse("Authentication required."),
    "403": postgrestErrorResponse(
      "Current course authority or licence is unavailable.",
    ),
    "409": postgrestErrorResponse("The reviewed registration version changed."),
  };
  const security = [
    { [academy ? "apiKey" : "publicApiKey"]: [], bearerAuth: [] },
  ];
  return {
    "/rest/v1/rpc/course_lti_tools": {
      post: {
        operationId: "readCourseLtiTools",
        summary: "Read the authorised course's LTI placements",
        description:
          "Current course actors receive active placements, while course managers can also inspect manual registration details. Only a current learner or instructor may launch.",
        tags: ["LTI 1.3"],
        security,
        ...(academy ? { "x-portal-licence": "active-or-grace" } : {}),
        requestBody: {
          required: true,
          content: jsonContent(z.strictObject({ p_run_id: identifier })),
        },
        responses: {
          "200": {
            description: "Role-scoped LTI registration details.",
            content: jsonContent(
              z.strictObject({
                can_manage: z.boolean(),
                can_launch: z.boolean(),
                tools: z.array(
                  z.strictObject({
                    id: identifier,
                    title: z.string(),
                    active: z.boolean(),
                    version,
                    client_id: configuration.client_id.optional(),
                    login_uri: configuration.login_uri.optional(),
                    redirect_uri: configuration.redirect_uri.optional(),
                    target_uri: configuration.target_uri.optional(),
                    nrps_enabled: z.boolean().optional(),
                    ags_enabled: z.boolean().optional(),
                    view_grades: z.boolean().optional(),
                    tool_public_key: toolPublicKey.nullable().optional(),
                    deep_link_uri: url.nullable().optional(),
                    can_select: z.boolean(),
                    can_withdraw: z.boolean(),
                    links: z.array(
                      z.strictObject({ id: identifier, title: z.string() }),
                    ),
                  }),
                ),
              }),
            ),
          },
          ...errors,
        },
      },
    },
    "/rest/v1/rpc/configure_course_lti_deep_link": {
      post: {
        operationId: "configureCourseLtiDeepLink",
        summary: "Configure a course tool's Deep Linking picker",
        description:
          "The course manager sets a tool selection URL on a deployment with a pinned verification key. Null disables new selections. Previously published links retain their placement and course scope.",
        tags: ["LTI 1.3"],
        security,
        ...(academy ? { "x-portal-licence": "active" } : {}),
        requestBody: {
          required: true,
          content: jsonContent(
            z.strictObject({
              p_registration_id: identifier,
              p_expected_version: version,
              p_selector_uri: url.nullable(),
            }),
          ),
        },
        responses: {
          "200": {
            description: "New registration revision.",
            content: jsonContent(version),
          },
          ...errors,
        },
      },
    },
    "/rest/v1/rpc/lti_deep_link_review": {
      post: {
        operationId: "reviewCourseLtiDeepLink",
        summary: "Review, publish or withdraw an LTI course link",
        description:
          "The current course author reviews a signed selection bound to the original session, then publishes it as an individual link. Course staff can withdraw an existing link.",
        tags: ["LTI 1.3"],
        security,
        ...(academy ? { "x-portal-licence": "active" } : {}),
        requestBody: {
          required: true,
          content: jsonContent(
            z.strictObject({
              p_id: identifier,
              p_action: z.enum(["read", "publish", "withdraw"]),
            }),
          ),
        },
        responses: {
          "200": {
            description: "Selection preview or confirmation.",
            content: jsonContent(
              z.strictObject({
                run_id: identifier,
                title: z.string().nullable().optional(),
                target_uri: url.nullable().optional(),
                published: z.boolean().optional(),
                line_item: z
                  .strictObject({
                    label: z.string(),
                    maximum: z.number().positive(),
                  })
                  .optional(),
              }),
            ),
          },
          ...errors,
        },
      },
    },
    "/rest/v1/rpc/configure_course_lti_advantage": {
      post: {
        operationId: "configureCourseLtiAdvantage",
        summary: "Configure a course LTI tool's roster permission",
        description:
          "The course manager pins the public RS256 tool key and can enable NRPS for that one deployment. Changing the registration revision withdraws its existing service tokens. NRPS exposes opaque learner and instructor IDs with roles and no names or email addresses.",
        tags: ["LTI 1.3"],
        security,
        ...(academy ? { "x-portal-licence": "active" } : {}),
        requestBody: {
          required: true,
          content: jsonContent(
            z.strictObject({
              p_registration_id: identifier,
              p_expected_version: version,
              p_public_key: toolPublicKey.nullable(),
              p_nrps: z.boolean(),
            }),
          ),
        },
        responses: {
          "200": {
            description: "New registration revision.",
            content: jsonContent(version),
          },
          ...errors,
        },
      },
    },
    "/rest/v1/rpc/configure_course_lti_ags": {
      post: {
        operationId: "configureCourseLtiAgs",
        summary: "Enable or disable LTI grade services",
        description:
          "A current course manager can permit this deployment to manage external grade columns and scores after pinning its public signing key. The revision change withdraws existing service tokens.",
        tags: ["LTI 1.3"],
        security,
        ...(academy ? { "x-portal-licence": "active" } : {}),
        requestBody: {
          required: true,
          content: jsonContent(
            z.strictObject({
              p_registration_id: identifier,
              p_expected_version: version,
              p_ags: z.boolean(),
            }),
          ),
        },
        responses: {
          "200": {
            description: "New registration revision.",
            content: jsonContent(version),
          },
          ...errors,
        },
      },
    },
    "/rest/v1/rpc/course_lti_ags_grades": {
      post: {
        operationId: "readCourseLtiAgsGrades",
        summary: "Read the external grade ledger",
        description:
          "Current teaching staff read the external columns for a registered deployment, ordered by column ID. A page includes one extra row when more columns are available. Each column previews the first 100 current learner entries.",
        tags: ["LTI 1.3"],
        security,
        ...(academy ? { "x-portal-licence": "active-or-grace" } : {}),
        requestBody: {
          required: true,
          content: jsonContent(
            z.strictObject({
              p_registration_id: identifier,
              p_after: identifier.nullable(),
              p_limit: z.number().int().min(1).max(20),
            }),
          ),
        },
        responses: {
          "200": {
            description: "Paged external grade columns.",
            content: jsonContent(
              z
                .array(
                  z.strictObject({
                    id: identifier,
                    label: z.string(),
                    maximum: z.number().positive(),
                    graded: z.number().int().nonnegative(),
                    results: z
                      .array(
                        z.strictObject({
                          subject_id: identifier,
                          name: z.string(),
                          score: z.number().nonnegative().nullable(),
                          grading_progress: z.enum([
                            "FullyGraded",
                            "Pending",
                            "PendingManual",
                            "Failed",
                            "NotReady",
                          ]),
                          comment: z.string().nullable(),
                        }),
                      )
                      .max(100),
                  }),
                )
                .max(21),
            ),
          },
          ...errors,
        },
      },
    },
    "/rest/v1/rpc/save_course_lti_tool": {
      post: {
        operationId: "saveCourseLtiTool",
        summary: "Register or revise one course LTI deployment",
        description:
          "A current course manager saves a versioned placement from out-of-band registration details. The deployment is scoped to the course. Login, redirect and target must be HTTPS, and changing OAuth client ID requires a new deployment.",
        tags: ["LTI 1.3"],
        security,
        ...(academy ? { "x-portal-licence": "active" } : {}),
        requestBody: {
          required: true,
          content: jsonContent(
            z.strictObject({
              p_id: identifier,
              p_run_id: identifier,
              p_title: z.string().min(1).max(140),
              p_client_id: configuration.client_id,
              p_login_uri: url,
              p_redirect_uri: url,
              p_target_uri: url,
              p_active: z.boolean(),
              p_expected_version: inputVersion,
            }),
          ),
        },
        responses: {
          "200": {
            description: "New registration revision.",
            content: jsonContent(version),
          },
          ...errors,
        },
      },
    },
  };
}
