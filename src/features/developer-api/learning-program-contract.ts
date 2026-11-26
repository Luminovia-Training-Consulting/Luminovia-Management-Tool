import { z } from "zod";
import {
  enrolLearningProgramRequest,
  learningProgramId,
  learningProgramClassProgressResult,
  learningProgramGradeReport,
  learningProgramClassPlacementRequest,
  readLearningProgramClassProgressRequest,
  readLearningProgramGradeReportRequest,
  learningProgramsResult,
  readLearningProgramsRequest,
  programmePrerequisiteRequest,
  saveLearningProgramRequest,
  startLearningProgramCourseRequest,
} from "../learning/learning-program-schema.ts";
import { jsonContent, postgrestErrorResponse } from "./postgrest-content.ts";

export function learningProgramPaths(academy = false) {
  const access = (participant: boolean, write: boolean) => ({
    tags: ["Learning programmes"],
    security: [{ [academy ? "apiKey" : "publicApiKey"]: [], bearerAuth: [] }],
    "x-luminovia-rest-gate": {
      postgresRole: "authenticated",
      operationalSession: true,
      participantSession: participant,
      guestSession: false,
    },
    ...(academy
      ? { "x-portal-licence": write ? "active" : "active-or-grace" }
      : {}),
  });
  const failed = {
    "400": postgrestErrorResponse(
      "The supplied programme or query parameters are invalid.",
    ),
    "401": postgrestErrorResponse("Authentication required."),
    "403": postgrestErrorResponse(
      "The current actor, entitlement or resource scope does not allow the operation.",
    ),
    "409": postgrestErrorResponse(
      "The reviewed version changed or a programme, course or prerequisite is unavailable.",
    ),
  };
  const read = {
    ...access(true, false),
    summary: "List programmes and inspect scoped programme progress",
    description:
      "Learners see their own assigned programmes and trusted current completion receipts. Current company contacts and course managers can see the programme summary, enrolment candidates and the programme roster for that organisation. Optional search refines available courses, roster and candidate results.",
    responses: {
      "200": {
        description: "Role-scoped programme list and requested detail.",
        content: jsonContent(learningProgramsResult),
      },
      ...failed,
    },
  };
  const classProgress = {
    ...access(false, false),
    summary: "Read programme progress grouped by learner class",
    description:
      "For an authorised course manager or company contact only. Each row counts current active programme learners with an assigned class in the programme's company. Valid course completion receipts determine module and full-programme counts. The response contains class data and aggregate counts.",
    responses: {
      "200": {
        description:
          "Authorised aggregate class progress for the requested programme.",
        content: jsonContent(learningProgramClassProgressResult),
      },
      "400": failed["400"],
      "401": failed["401"],
      "403": failed["403"],
    },
  };
  const gradeReport = {
    ...access(true, false),
    summary: "Read released course grades for an enrolled programme learner",
    description:
      "Omit the learner ID to read your own grades. Only course management can select another current learner. Each row is the latest released weighted grade of a currently accessible enrolled course in the programme. A descriptive mean uses those released percentages. Course review evidence, private reasons and draft grades are excluded.",
    responses: {
      "200": {
        description:
          "Current released grades and descriptive programme summary.",
        content: jsonContent(learningProgramGradeReport),
      },
      "400": failed["400"],
      "401": failed["401"],
      "403": failed["403"],
    },
  };
  const query = [
    {
      in: "query",
      name: "p_program_id",
      schema: { type: "string", format: "uuid" },
    },
    {
      in: "query",
      name: "p_organisation_id",
      schema: { type: "string", format: "uuid" },
    },
    {
      in: "query",
      name: "p_search",
      schema: { type: "string", maxLength: 120 },
    },
  ];
  function write(
    operationId: string,
    summary: string,
    description: string,
    input: z.ZodType,
    participant = false,
    result?: z.ZodType,
  ) {
    return {
      post: {
        ...access(participant, true),
        operationId,
        summary,
        description,
        requestBody: { required: true, content: jsonContent(input) },
        responses: {
          ...(result
            ? {
                "200": {
                  description: "The saved programme ID.",
                  content: jsonContent(result),
                },
              }
            : { "204": { description: "The operation succeeded." } }),
          ...failed,
        },
      },
    };
  }
  return {
    "/rest/v1/rpc/learning_programs": {
      get: { ...read, operationId: "getLearningProgrammes", parameters: query },
      post: {
        ...read,
        operationId: "readLearningProgrammes",
        requestBody: {
          required: false,
          content: jsonContent(readLearningProgramsRequest),
        },
      },
    },
    "/rest/v1/rpc/learning_program_class_progress": {
      get: {
        ...classProgress,
        operationId: "getLearningProgrammeClassProgress",
        parameters: [
          {
            in: "query",
            name: "p_program_id",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
      },
      post: {
        ...classProgress,
        operationId: "readLearningProgrammeClassProgress",
        requestBody: {
          required: true,
          content: jsonContent(readLearningProgramClassProgressRequest),
        },
      },
    },
    "/rest/v1/rpc/learning_program_grade_report": {
      get: {
        ...gradeReport,
        operationId: "getLearningProgrammeGradeReport",
        parameters: [
          {
            in: "query",
            name: "p_program_id",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
          {
            in: "query",
            name: "p_user_id",
            schema: { type: "string", format: "uuid" },
          },
        ],
      },
      post: {
        ...gradeReport,
        operationId: "readLearningProgrammeGradeReport",
        requestBody: {
          required: true,
          content: jsonContent(readLearningProgramGradeReportRequest),
        },
      },
    },
    ...(academy
      ? {
          "/rest/v1/rpc/set_company_participant_class": write(
            "setAcademyCompanyParticipantClass",
            "Set or clear one company participant’s class",
            "Requires an active licence, current management or company contact authority, and the participant’s current company membership version. Use a class of that same company or null to clear the placement. Existing course and programme enrolments are unchanged.",
            learningProgramClassPlacementRequest,
          ),
        }
      : {}),
    "/rest/v1/rpc/save_learning_program": write(
      "saveLearningProgramme",
      "Save a company learning programme",
      "Supply two to thirty distinct published course runs of the same organisation and the reviewed version. Use version zero and a client UUID to create. Existing enrolments lock programme content. Archiving retains enrolments and completion records and prevents new enrolments and unlocks.",
      saveLearningProgramRequest,
      false,
      learningProgramId,
    ),
    "/rest/v1/rpc/set_learning_program_prerequisite": write(
      "setLearningProgrammePrerequisite",
      "Set explicit prerequisites for a programme step",
      "Managers can set an all or any completion rule targeting distinct earlier programme positions before any programme enrolment. Supply the reviewed version. An empty list restores the programme's existing sequential or unordered behaviour for that step.",
      programmePrerequisiteRequest,
    ),
    "/rest/v1/rpc/enrol_learning_program": write(
      "enrolLearningProgramme",
      "Assign a learning programme to a current learner",
      "Requires current course management or contact authority for the same organisation and an active linked participant. Assigns the entire programme and activates its first course atomically without changing independent eligible course enrolments.",
      enrolLearningProgramRequest,
    ),
    "/rest/v1/rpc/start_learning_program_course": write(
      "startLearningProgrammeCourse",
      "Activate an unlocked course for the current learner",
      "Requires the current learner's programme enrolment. Explicit all/any prerequisites are evaluated against unrevoked course completion receipts. Ordered steps without an explicit rule require receipts for all earlier courses. Existing active course access is retained; a removed enrolment is not restored.",
      startLearningProgramCourseRequest,
      true,
    ),
  };
}
