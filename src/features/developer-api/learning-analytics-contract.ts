import { z } from "zod";
import { analyticsScopes } from "../analytics/schema.ts";
import {
  learningAnalyticsAccessSchema,
  learningAnalyticsReportSchema,
  learningReportStatus,
} from "../analytics/learning-schema.ts";

export function learningAnalyticsPaths(academy: boolean) {
  function post(
    id: string,
    summary: string,
    description: string,
    result: z.ZodType,
    args?: z.ZodType,
  ) {
    const error = {
      content: {
        "application/json": {
          schema: z.toJSONSchema(
            z.object({
              code: z.string(),
              message: z.string(),
              details: z.string().nullable(),
              hint: z.string().nullable(),
            }),
          ),
        },
      },
    };
    return {
      post: {
        operationId: id,
        tags: ["Analytics"],
        summary,
        description,
        security: [
          { [academy ? "apiKey" : "publicApiKey"]: [], bearerAuth: [] },
        ],
        ...(academy ? { "x-portal-licence": "active-or-grace" } : {}),
        ...(args
          ? {
              requestBody: {
                required: true,
                content: {
                  "application/json": { schema: z.toJSONSchema(args) },
                },
              },
            }
          : {}),
        responses: {
          "200": {
            description: "Authorised course analytics",
            content: { "application/json": { schema: z.toJSONSchema(result) } },
          },
          "400": { description: "Invalid date range or filters", ...error },
          "401": { description: "Authentication required", ...error },
          "403": {
            description: "Current role or course scope required",
            ...error,
          },
          "429": { description: "Request allowance exceeded", ...error },
          "503": { description: "Service temporarily unavailable", ...error },
        },
      },
    };
  }
  return {
    "/rest/v1/rpc/learning_analytics_access": post(
      "readLearningAnalyticsAccess",
      "Read available LMS reporting scopes",
      "Lists reporting capabilities and authorised companies. Company options require current LMS access.",
      learningAnalyticsAccessSchema,
    ),
    "/rest/v1/rpc/learning_analytics_report": post(
      "readLearningAnalyticsReport",
      "Read aggregate course and learner statistics",
      "Uses an inclusive start date and an exclusive end date in the caller's reporting zone, up to 731 days. Cohorts use the first course session or the draft creation date. Personal scope uses current teaching assignments, company scope uses current membership, and staff scope requires course management. Returns totals, monthly cohorts and 25 course rows per page. Staff and current teachers receive assessment metric version 1 for the same course page. Per-measure cohorts below three contributing learners appear as null. Companies retain the coarse participation report. No learner identifiers, named grades, answers or comments are returned.",
      learningAnalyticsReportSchema,
      z.strictObject({
        p_scope: z.enum(analyticsScopes),
        p_from: z.iso.date(),
        p_until: z.iso.date(),
        p_organisation_id: z.uuid().nullish(),
        p_status: learningReportStatus.optional(),
        p_search: z.string().max(120).optional(),
        p_page: z.number().int().min(1).max(100000).optional(),
      }),
    ),
  };
}
