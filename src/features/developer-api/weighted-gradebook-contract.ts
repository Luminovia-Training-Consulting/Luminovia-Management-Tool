/** Native contracts for reviewing, publishing and reading weighted course grades. */
import { z } from "zod";
import {
  weightedGradebookRequest,
  weightedGradebookResult,
  weightedGradeCommand,
} from "../learning/weighted-gradebook-schema.ts";
import { jsonContent, postgrestErrorResponse } from "./postgrest-content.ts";

/** Scope each operation to current course rights and the edition licence. */
export function weightedGradebookPaths(academy: boolean) {
  const common = {
    tags: ["Course gradebook"],
    security: [{ [academy ? "apiKey" : "publicApiKey"]: [], bearerAuth: [] }],
  };
  const errors = {
    "400": postgrestErrorResponse("Invalid course gradebook input."),
    "401": postgrestErrorResponse("Authentication required."),
    "403": postgrestErrorResponse(
      "Current course rights or licence unavailable.",
    ),
  };
  const read = {
    ...common,
    summary: "Read weighted course grades and release history",
    description:
      "Current course staff may select an enrolled learner for a grading preview. Learners receive only their own published revisions. Use p_before_revision to page through history.",
    ...(academy ? { "x-portal-licence": "active-or-grace" } : {}),
    responses: {
      "200": {
        description:
          "Course-scoped policy, calculated preview or published history.",
        content: jsonContent(weightedGradebookResult),
      },
      ...errors,
    },
  };
  return {
    "/rest/v1/rpc/course_weighted_gradebook": {
      get: {
        ...read,
        operationId: "getWeightedCourseGradebook",
        parameters: [
          {
            name: "p_run_id",
            in: "query",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "p_user_id",
            in: "query",
            required: false,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "p_before_revision",
            in: "query",
            required: false,
            schema: { type: "integer", minimum: 1 },
          },
        ],
      },
      post: {
        ...read,
        operationId: "readWeightedCourseGradebook",
        requestBody: {
          required: true,
          content: jsonContent(weightedGradebookRequest),
        },
      },
    },
    "/rest/v1/rpc/course_weighted_gradebook_command": {
      post: {
        ...common,
        operationId: "changeWeightedCourseGradebook",
        summary:
          "Save a weight policy, record exemptions, review or publish a course grade",
        description:
          "A policy can weight released quiz grades, uploaded exam results, the current published text exam and released individual or team assignments. Review pins the exact evidence and policy. Publication requires a still-current review, matching revision counters and a different staff actor if required by policy.",
        ...(academy ? { "x-portal-licence": "active" } : {}),
        requestBody: {
          required: true,
          content: jsonContent(weightedGradeCommand),
        },
        responses: {
          "200": {
            description: "New policy, exemption, review or release version.",
            content: jsonContent(
              z.strictObject({ version: z.number().int().positive() }),
            ),
          },
          ...errors,
          "409": postgrestErrorResponse(
            "The policy, evidence or release changed.",
          ),
        },
      },
    },
  };
}
