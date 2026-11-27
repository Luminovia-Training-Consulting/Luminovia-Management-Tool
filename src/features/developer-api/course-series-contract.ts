import { z } from "zod";
import {
  courseSeriesClasses,
  courseSeriesRequest,
  courseSeriesResult,
} from "../operations/course-series-schema.ts";
import {
  courseSeriesRevisionRequest,
  courseSeriesSnapshot,
} from "../operations/course-series-revision-schema.ts";
import { jsonContent, postgrestErrorResponse } from "./postgrest-content.ts";

const path = "/rest/v1/rpc/";
const transport = {
  tags: ["Courses"],
  security: [{ publicApiKey: [], bearerAuth: [] }],
  "x-luminovia-rest-gate": {
    postgresRole: "authenticated",
    operationalSession: true,
    participantSession: false,
    guestSession: false,
  },
};

export function courseSeriesPaths(academy = false) {
  const audience = academy
    ? {
        ...transport,
        security: [{ apiKey: [], bearerAuth: [] }],
        "x-portal-licence": "active",
      }
    : transport;
  const denied = postgrestErrorResponse(
    "The course authority or organisation is unavailable.",
  );
  const classes = {
    ...audience,
    summary: "List the existing classes for course series planning",
    description:
      "Returns the ID and name of the selected organisation's classes to a current authorised planner.",
    responses: {
      "200": {
        description: "Classes from the selected organisation.",
        content: jsonContent(courseSeriesClasses),
      },
      "401": postgrestErrorResponse("Authentication required."),
      "403": denied,
    },
  };
  const savedSeries = {
    ...audience,
    ...(academy ? { "x-portal-licence": "active-or-grace" } : {}),
    summary: "Read the saved timetable and editable drafts for a series",
    description:
      "Returns the recorded timetable in the original time zone, the current revision and the explicit pattern of each run. Older series return a null pattern. During Academy grace, all runs are read-only.",
    responses: {
      "200": {
        description: "A scoped series, or null for a standalone course.",
        content: jsonContent(courseSeriesSnapshot),
      },
      "401": postgrestErrorResponse("Authentication required."),
      "403": denied,
    },
  };
  return {
    [`${path}course_series_classes`]: {
      get: {
        ...classes,
        operationId: "listCourseSeriesClasses",
        parameters: [
          {
            in: "query",
            name: "p_organisation_id",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
      },
      post: {
        ...classes,
        operationId: "readCourseSeriesClasses",
        requestBody: {
          required: true,
          content: jsonContent(z.strictObject({ p_organisation_id: z.uuid() })),
        },
      },
    },
    [`${path}course_series_for_run`]: {
      get: {
        ...savedSeries,
        operationId: "readSavedCourseSeries",
        parameters: [
          {
            in: "query",
            name: "p_course_id",
            required: true,
            schema: { type: "string", format: "uuid" },
          },
        ],
      },
      post: {
        ...savedSeries,
        operationId: "readSavedCourseSeriesById",
        requestBody: {
          required: true,
          content: jsonContent(z.strictObject({ p_course_id: z.uuid() })),
        },
      },
    },
    [`${path}revise_course_series`]: {
      post: {
        ...audience,
        operationId: "reviseSavedCourseSeries",
        summary:
          "Preview or confirm a pattern revision for selected course drafts",
        description:
          "Submit the original revision and selected drafts with explicit patterns and matching future sessions. Send p_confirm=false for a preview. Confirmation rechecks scope, draft status and conflicts atomically. Matching sessions retain their IDs and untouched courses retain their schedules.",
        requestBody: {
          required: true,
          content: jsonContent(courseSeriesRevisionRequest),
        },
        responses: {
          "200": {
            description:
              "Updated draft IDs or schedule conflicts in request order.",
            content: jsonContent(courseSeriesResult),
          },
          "400": postgrestErrorResponse(
            "The patterns or session inputs are invalid.",
          ),
          "401": postgrestErrorResponse("Authentication required."),
          "403": denied,
          "409": postgrestErrorResponse(
            "The review is stale or the selected course is locked.",
          ),
        },
      },
    },
    [`${path}plan_course_series`]: {
      post: {
        ...audience,
        operationId: "planCourseSeries",
        summary: "Review or create a series of independent course drafts",
        description:
          "Supply two to twelve runs from one template and organisation. Send the exact future session instants with offsets. Send a null request ID to detect overlapping sessions, class conflicts and on-site room conflicts without creating courses. A conflict receipt lists run and session positions only. To create the drafts, supply a unique request ID with the reviewed inputs. The server rechecks conflicts and atomically creates the complete series. Retrying unchanged input with the same ID returns its original draft IDs. A class association grants no enrolment or access.",
        requestBody: {
          required: true,
          content: jsonContent(courseSeriesRequest),
        },
        responses: {
          "200": {
            description:
              "Draft IDs or schedule conflicts in the reviewed series.",
            content: jsonContent(courseSeriesResult),
          },
          "400": postgrestErrorResponse("The schedule inputs are invalid."),
          "401": postgrestErrorResponse("Authentication required."),
          "403": denied,
          "409": postgrestErrorResponse(
            "The request ID has different inputs or its previous series is unavailable.",
          ),
        },
      },
    },
  };
}
