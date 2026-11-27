/** Reviewed OpenAPI contracts for course-scoped and company lecturer feedback. */
import { z } from "zod";
import {
  companyLecturerDirectory,
  companyLecturerProfile,
} from "../people/company-lecturer-feedback-schema.ts";
import {
  courseEvaluationComments,
  courseEvaluations,
  evaluationKind,
  evaluationRater,
  evaluationScore,
  ownEvaluation,
} from "../learning/course-evaluation-schema.ts";

const byRun = { p_run_id: z.uuid() };
const bySubject = {
  ...byRun,
  p_rater_role: evaluationRater,
  p_subject_kind: evaluationKind,
  p_subject_id: z.uuid(),
};
const json = (schema: z.ZodType) => ({
  "application/json": { schema: z.toJSONSchema(schema) },
});
const problem = json(
  z.strictObject({
    code: z.string(),
    message: z.string(),
    details: z.string().nullable(),
    hint: z.string().nullable(),
  }),
);
const invalid = {
  description: "The argument is outside the supported bounds.",
  content: problem,
};
const unauthenticated = {
  description: "A current human session is required.",
  content: problem,
};
const forbidden = {
  description:
    "The required edition, course, role or subject access is unavailable.",
  content: problem,
};

function operation({
  id,
  summary,
  description,
  request,
  result,
  write,
  academy,
}: {
  id: string;
  summary: string;
  description: string;
  request: z.ZodType;
  result: z.ZodType;
  write?: boolean;
  academy: boolean;
}) {
  return {
    post: {
      operationId: id,
      tags: ["Courses"],
      summary,
      description,
      security: [{ [academy ? "apiKey" : "publicApiKey"]: [], bearerAuth: [] }],
      ...(academy
        ? { "x-portal-licence": write ? "active" : "active-or-grace" }
        : {}),
      requestBody: { required: true, content: json(request) },
      responses: {
        "200": {
          description: "Authorized course evaluation result.",
          content: json(result),
        },
        "400": invalid,
        "401": unauthenticated,
        "403": forbidden,
        ...(write
          ? {
              "409": {
                description:
                  "The evaluation version changed. Reload its current revision.",
                content: problem,
              },
            }
          : {}),
      },
    },
  };
}

export function courseEvaluationPaths(academy: boolean) {
  return {
    "/rest/v1/rpc/course_evaluations": operation({
      id: "readCourseEvaluations",
      academy,
      summary: "Read scoped course evaluation targets and results",
      description:
        "The course's last session must have ended. Current enrolled learners may rate the assigned instructors and their course company. Current company contacts may rate assigned instructors. Assigned instructors may rate the course difficulty, company assigned school class and individual enrolled participants. Aggregates and own entries follow the caller's current course authority. Other evaluators' names and IDs are never returned.",
      request: z.strictObject(byRun),
      result: courseEvaluations,
    }),
    "/rest/v1/rpc/course_evaluation_comments": operation({
      id: "readCourseEvaluationComments",
      academy,
      summary: "Read a page of permitted individual evaluations",
      description:
        "Read up to 25 scores and optional comments for an exact completed course, author role and subject. A company contact can read reviews of its courses, lecturers, participants and organisation in that course. A participant can read feedback addressed to them. Instructors and management retain their scoped reads. Pass the previous next cursor to continue. The response has no author identities.",
      request: z.strictObject({
        ...bySubject,
        p_after: z.uuid().nullable().optional(),
      }),
      result: courseEvaluationComments,
    }),
    "/rest/v1/rpc/save_course_evaluation": operation({
      id: "saveCourseEvaluation",
      academy,
      write: true,
      summary: "Save one versioned course evaluation",
      description:
        "Only the issued role and subject combinations are writable after the last course session and while learning access is active. Score ranges from 1 to 5. Send version 0 to create the actor's own evaluation or its current version to edit it. If the response is lost, retry with the same revision, score and comment. The exact next revision is returned without an additional write while it is still current. Re-read after a version conflict. The optional comment is visible to authorized recipients.",
      request: z.strictObject({
        ...bySubject,
        p_score: evaluationScore,
        p_expected_version: z.int().min(0).max(2147483646),
        p_comment: z.string().max(2000).optional(),
      }),
      result: ownEvaluation,
    }),
  };
}

/** Company profile reads intentionally exclude course, reviewer and evidence identifiers. */
export const companyLecturerFeedbackPaths = {
  "/rest/v1/rpc/company_lecturer_feedback": operation({
    id: "readCompanyLecturerFeedback",
    academy: false,
    summary:
      "Browse lecturers and read company-visible individual reviews and qualifications",
    description:
      "An active signed-in company contact with a current organisation membership can browse lecturer names and open their current verified qualifications, confirmed teaching minutes and individual anonymized scores. No booking is required. Omit p_user_id to search names. Supply p_user_id for the lecturer's results and pass the corresponding next cursor to paginate. Source organisations, course identifiers, comments, reviewer identities and qualification files are omitted.",
    request: z.strictObject({
      p_user_id: z.uuid().nullable().optional(),
      p_search: z.string().max(100).optional(),
      p_after: z.uuid().nullable().optional(),
    }),
    result: z.union([companyLecturerDirectory, companyLecturerProfile]),
  }),
};
