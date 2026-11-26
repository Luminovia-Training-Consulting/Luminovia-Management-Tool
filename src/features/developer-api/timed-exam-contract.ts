import { z } from "zod";
import {
  examExtraMinutes,
  examGradeImportCount,
  examGradeImportRequest,
  examInstant,
  examResultsSchema,
  examScore,
  timedExamSchema,
} from "../learning/timed-exam-schema.ts";

export function timedExamPaths(academy: boolean) {
  const run = { p_run_id: z.uuid() };
  function post(
    name: string,
    summary: string,
    description: string,
    payload: z.ZodType,
    result: z.ZodType,
    write = false,
  ) {
    return {
      post: {
        operationId: academy ? name : `native_${name}`,
        tags: ["Courses"],
        summary,
        description,
        security: [
          { [academy ? "apiKey" : "publicApiKey"]: [], bearerAuth: [] },
        ],
        ...(academy
          ? { "x-portal-licence": write ? "active" : "active-or-grace" }
          : {}),
        requestBody: {
          required: true,
          content: { "application/json": { schema: z.toJSONSchema(payload) } },
        },
        responses: {
          "200": {
            description: "Confirmed examination response",
            content: { "application/json": { schema: z.toJSONSchema(result) } },
          },
          "400": { description: "Invalid window, score or incomplete grades" },
          "403": {
            description: "Current course access, role or window required",
          },
          "409": {
            description:
              "The course exam changed or was already submitted or published",
          },
        },
      },
    };
  }
  return {
    "/rest/v1/rpc/course_exam_state": post(
      "course_exam_state",
      "Read the current examination state",
      "Shows timed exam metadata only within the caller’s scope. Draft grades and submission files appear only to authorised graders.",
      z.strictObject(run),
      timedExamSchema.nullable(),
    ),
    "/rest/v1/rpc/save_course_exam_schedule": post(
      "save_course_exam_schedule",
      "Schedule the course examination",
      "Set the announcement time, exclusive deadline, title and pass threshold. Start and end must fall within the course dates in its saved time zone. Use the currently reviewed version or zero to create.",
      z.strictObject({
        ...run,
        p_title: z.string().min(1).max(160),
        p_visible_from: examInstant,
        p_starts_at: examInstant,
        p_ends_at: examInstant,
        p_pass_percent: examScore,
        p_version: z.number().int().nonnegative(),
      }),
      z.literal(true),
      true,
    ),
    "/rest/v1/rpc/set_course_exam_extra_time": post(
      "set_course_exam_extra_time",
      "Assign extra time for one timed exam",
      "Before the exam starts, a current course manager may set 0–480 extra minutes for a current enrolment. Send its reviewed time-allowance revision (zero initially). The learner sees the effective deadline; release waits for the latest active deadline.",
      z.strictObject({
        ...run,
        p_participant_id: z.uuid(),
        p_extra_minutes: examExtraMinutes,
        p_expected_revision: z.number().int().nonnegative(),
      }),
      z.number().int().nonnegative(),
      true,
    ),
    "/rest/v1/rpc/submit_course_exam": post(
      "submit_course_exam",
      "Submit a checked exam file",
      "Requires the caller’s own scanned upload and an open exam. The first confirmed version is final. Repeating that version returns the original submission time.",
      z.strictObject({ ...run, p_version_id: z.uuid() }),
      examInstant,
      true,
    ),
    "/rest/v1/rpc/save_course_exam_grades": post(
      "save_course_exam_grades",
      "Save or publish examination grades",
      "Requires assigned teaching or course-management authority after the deadline. Scores map enrolled participant IDs to integer percentages. Publication is atomic and requires grades for all current submissions.",
      z.strictObject({
        ...run,
        p_scores: z.record(z.uuid(), examScore),
        p_version: z.number().int().positive(),
        p_publish: z.boolean(),
      }),
      z.literal(true),
      true,
    ),
    "/rest/v1/rpc/import_course_exam_grades": post(
      "import_course_exam_grades",
      "Save a reviewed spreadsheet of examination grade drafts",
      "An assigned teacher or course manager sends 1–200 distinct current participants, the observed score for each participant, their new integer scores and the reviewed examination version. The batch commits atomically as unpublished drafts. Use the separate grade publication operation after review.",
      examGradeImportRequest,
      examGradeImportCount,
      true,
    ),
    "/rest/v1/rpc/published_course_exam_results": post(
      "published_course_exam_results",
      "Read published examination results",
      "Use the current account or an explicitly scoped participant. The optional organisation limits the result set. Returns only currently authorised published percentages with their arithmetic mean.",
      z.strictObject({
        p_user_id: z.uuid().nullish(),
        p_organisation_id: z.uuid().nullish(),
      }),
      examResultsSchema,
    ),
  };
}
