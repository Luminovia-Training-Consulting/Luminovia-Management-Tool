import { z } from "zod";
import {
  courseSeriesClasses,
  courseSeriesRequest,
  courseSeriesResult,
} from "../operations/course-series-schema.ts";
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
