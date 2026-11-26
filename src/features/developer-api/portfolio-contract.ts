/** Native REST contracts for actor-owned portfolio records and named shares. */
import {
  portfolioCommand,
  portfolioOwner,
  portfolioReadRequest,
  portfolioTeacher,
} from "../learning/portfolio-schema.ts";
import { z } from "zod";
import { jsonContent, postgrestErrorResponse } from "./postgrest-content.ts";

/** Use the same reviewed operations in both editions, with edition-specific licence metadata. */
export function portfolioPaths(academy: boolean) {
  const common = {
    tags: ["Learning portfolio"],
    security: [{ [academy ? "apiKey" : "publicApiKey"]: [], bearerAuth: [] }],
  };
  const errors = {
    "400": postgrestErrorResponse(
      "Invalid portfolio input or record limit exceeded.",
    ),
    "401": postgrestErrorResponse("Authentication required."),
    "403": postgrestErrorResponse(
      "Current ownership, recipient scope or licence is unavailable.",
    ),
  };

  return {
    "/rest/v1/rpc/learning_portfolio": {
      post: {
        ...common,
        operationId: "readLearningPortfolio",
        summary:
          "Read or export your own portfolio, or see snapshots shared with you by current learners",
        description:
          "Omit the course ID to access only your own entries; p_export includes all personal revisions. An assigned instructor may supply a course ID to page through immutable revisions explicitly shared with that instructor. Management rights alone grant no access.",
        ...(academy ? { "x-portal-licence": "active-or-grace" } : {}),
        requestBody: {
          required: false,
          content: jsonContent(portfolioReadRequest),
        },
        responses: {
          "200": {
            description: "Caller-scoped portfolio or named course shares.",
            content: jsonContent(z.union([portfolioOwner, portfolioTeacher])),
          },
          ...errors,
        },
      },
    },
    "/rest/v1/rpc/learning_portfolio_command": {
      post: {
        ...common,
        operationId: "changeLearningPortfolio",
        summary:
          "Create a personal revision, share it with a named instructor, or revoke a share",
        description:
          "Save and share operations compare the reviewed entry revision. Sharing requires current course enrolment and a current named instructor. Revocation is available to the owner even after course access changes.",
        ...(academy ? { "x-portal-licence": "active" } : {}),
        requestBody: { required: true, content: jsonContent(portfolioCommand) },
        responses: {
          "200": {
            description: "Saved revision number or named share receipt.",
            content: jsonContent(
              z.union([
                z.strictObject({ revision: z.number().int().positive() }),
                z.strictObject({ share_id: z.uuid() }),
              ]),
            ),
          },
          ...errors,
          "409": postgrestErrorResponse("The portfolio revision changed."),
        },
      },
    },
  };
}
