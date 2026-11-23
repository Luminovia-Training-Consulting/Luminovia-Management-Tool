import { z } from "zod";
import {
  classFeedback,
  classRating,
  classScore,
} from "../operations/company-class-feedback-schema.ts";

const error = z.object({
  code: z.string(),
  message: z.string(),
  details: z.string().nullable(),
  hint: z.string().nullable(),
});

function response(description: string, schema: z.ZodType) {
  return {
    description,
    content: { "application/json": { schema: z.toJSONSchema(schema) } },
  };
}

function operation(
  operationId: string,
  summary: string,
  description: string,
  input: z.ZodType,
  result: z.ZodType,
  conflict: boolean = false,
) {
  return {
    post: {
      operationId,
      tags: ["Company classes"],
      summary,
      description,
      security: [{ publicApiKey: [], bearerAuth: [] }],
      requestBody: {
        required: true,
        content: { "application/json": { schema: z.toJSONSchema(input) } },
      },
      responses: {
        "200": response("Scoped class feedback or write receipt", result),
        "400": response("Invalid feedback, cursor, or class reference", error),
        "403": response(
          "Current company, staff, or assigned teaching scope required",
          error,
        ),
        ...(conflict
          ? {
              "409": response(
                "A newer rating or a different use of this request ID exists",
                error,
              ),
            }
          : {}),
      },
    },
  };
}

export const companyClassFeedbackPaths = {
  "/rest/v1/rpc/class_feedback": operation(
    "readCompanyClassFeedback",
    "Read a class rating summary and scoped comments",
    "Company members and authorised staff use the class ID. Lecturers must also send the ID of their confirmed assignment for that class. The response contains no author IDs or other class data. Follow the returned cursor for more comments.",
    z.object({
      p_class_id: z.uuid(),
      p_job_id: z.uuid().nullable().optional(),
      p_after: z.uuid().nullable().optional(),
    }),
    classFeedback,
  ),
  "/rest/v1/rpc/save_job_class_rating": operation(
    "saveJobClassRating",
    "Rate a class after a completed teaching assignment",
    "Requires a current confirmed claim and completed assignment sessions for the exact class. Submit zero for a new rating, or the current rating version when editing. The same rating and revision history are used if the class also appears in the course workspace.",
    z.object({
      p_job_id: z.uuid(),
      p_class_id: z.uuid(),
      p_score: classScore,
      p_expected_version: z.number().int().min(0).max(2147483646),
      p_comment: z.string().max(2000).optional(),
    }),
    classRating,
    true,
  ),
  "/rest/v1/rpc/add_company_class_note": operation(
    "addCompanyClassNote",
    "Add a comment to your company's class",
    "Requires current company or staff management authority. An exact retry with the same request ID returns the original receipt.",
    z.object({
      p_class_id: z.uuid(),
      p_comment: z.string().min(1).max(2000),
      p_request_id: z.uuid(),
    }),
    z.uuid(),
    true,
  ),
};
