import { z } from "zod";
import {
  enrolLearningProgramRequest,
  learningProgramId,
  learningProgramsResult,
  readLearningProgramsRequest,
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
    "/rest/v1/rpc/save_learning_program": write(
      "saveLearningProgramme",
      "Save a company learning programme",
      "Supply two to thirty distinct published course runs of the same organisation and the reviewed version. Use version zero and a client UUID to create. Existing enrolments lock programme content. Archiving retains enrolments and completion records and prevents new enrolments and unlocks.",
      saveLearningProgramRequest,
      false,
      learningProgramId,
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
      "Requires the current learner's programme enrolment. For ordered programmes, previous courses require unrevoked completion records. Existing active course access is retained; a removed enrolment is not restored.",
      startLearningProgramCourseRequest,
      true,
    ),
  };
}
