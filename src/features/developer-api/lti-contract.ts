/** Course registration management for manually provisioned LTI 1.3 placements. */
import { z } from "zod";
import { jsonContent, postgrestErrorResponse } from "./postgrest-content.ts";

const identifier = z.uuid();
const version = z.number().int().positive();
const inputVersion = z.number().int().nonnegative();
const url = z.url().max(1500);
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
                  }),
                ),
              }),
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
