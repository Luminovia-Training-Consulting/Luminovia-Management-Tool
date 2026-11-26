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
          "Omit the course ID to access only your own entries; p_export includes all personal revisions. An assigned instructor may supply a course ID to page through immutable revisions explicitly shared with that instructor. Evidence metadata belongs to the exact snapshot. The file gateway rechecks access to each file. Management rights alone grant no access.",
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
          "Edit, attach evidence to, share, archive, restore or erase an owned portfolio entry",
        description:
          "Save, link, unlink and share compare the reviewed entry revision. Link an owned clean version returned by the file gateway in portfolio-evidence mode. Linking and unlinking create new revisions and preserve existing share snapshots. Sharing requires current course enrolment and a named current instructor. Archiving revokes active shares. Archive, restore and erase compare content and state revisions. Erasing also requires an archived entry and its exact title.",
        ...(academy ? { "x-portal-licence": "active" } : {}),
        requestBody: { required: true, content: jsonContent(portfolioCommand) },
        responses: {
          "200": {
            description:
              "Saved revision number, named share receipt or erasure confirmation.",
            content: jsonContent(
              z.union([
                z.strictObject({ revision: z.number().int().positive() }),
                z.strictObject({ share_id: z.uuid() }),
                z.strictObject({ deleted: z.literal(true) }),
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
