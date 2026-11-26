/** Course exam submission and grading operations, with role-specific output. */
import { z } from "zod";
import {
  textExamCommand,
  textExamExportRequest,
  textExamExportPage,
  textExamRead,
  textExamState,
} from "../learning/course-text-exam-schema.ts";
import { jsonContent, postgrestErrorResponse } from "./postgrest-content.ts";

export function manualTextExamPaths(academy: boolean) {
  const security = [
    { [academy ? "apiKey" : "publicApiKey"]: [], bearerAuth: [] },
  ];
  const errors = {
    "400": postgrestErrorResponse("Invalid exam command or parameters."),
    "401": postgrestErrorResponse("Authentication required."),
    "403": postgrestErrorResponse(
      "Current course authority or licence is unavailable.",
    ),
    "409": postgrestErrorResponse(
      "The exam, attempt or review changed or its window has closed.",
    ),
  };
  const read = {
    summary: "Read a course's native text exam",
    description:
      "Learners receive their own answers and latest released review. Questions are withheld until opening. Staff can browse submitted attempts by 25 per page, then select an exam revision and learner to review.",
    tags: ["Text exams"],
    security,
    ...(academy ? { "x-portal-licence": "active-or-grace" } : {}),
    responses: {
      "200": {
        description: "Current role-scoped exam and review.",
        content: jsonContent(textExamState),
      },
      ...errors,
    },
  };
  return {
    "/rest/v1/rpc/course_text_exam": {
      get: {
        ...read,
        operationId: "getCourseTextExam",
        parameters: [
          {
            name: "p_run_id",
            in: "query",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "p_revision",
            in: "query",
            schema: { type: "integer", minimum: 1 },
          },
          {
            name: "p_learner_id",
            in: "query",
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "p_offset",
            in: "query",
            schema: { type: "integer", minimum: 0, maximum: 1_000_000 },
          },
        ],
      },
      post: {
        ...read,
        operationId: "readCourseTextExam",
        requestBody: { required: true, content: jsonContent(textExamRead) },
      },
    },
    "/rest/v1/rpc/course_text_exam_grade_export": {
      post: {
        ...read,
        operationId: "readCourseTextExamGradeExport",
        summary: "Export released grades for one published examination",
        description:
          "Current course staff can page through released marks of currently eligible candidates. Pass the returned as_of and next values for the next page. Includes scores, outcome and release timestamps.",
        requestBody: {
          required: true,
          content: jsonContent(textExamExportRequest),
        },
        responses: {
          "200": {
            description: "Released exam grades",
            content: jsonContent(textExamExportPage),
          },
          ...errors,
        },
      },
    },
    "/rest/v1/rpc/course_text_exam_action": {
      post: {
        operationId: "updateCourseTextExam",
        summary: "Save, submit, publish or assess a text exam",
        description:
          "Managers save and publish versioned papers. Candidates save or submit their own answers during their effective window. Current staff draft or release a grade for submitted work after the assessment closes. The import_reviews command saves up to 25 submitted attempts as draft question marks in one batch, using each expected review revision. Supply the current paper, answer or review revision as applicable to each command.",
        tags: ["Text exams"],
        security,
        ...(academy ? { "x-portal-licence": "active" } : {}),
        requestBody: { required: true, content: jsonContent(textExamCommand) },
        responses: {
          "200": {
            description:
              "Accepted paper, answer or review revision, or the number of imported review drafts.",
            content: jsonContent(z.number().int().positive()),
          },
          ...errors,
        },
      },
    },
  };
}
