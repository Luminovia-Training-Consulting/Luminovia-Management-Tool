import { z } from "zod";
import {
  courseClassAssignment,
  courseClassOptions,
} from "../learning/course-classes-schema.ts";

const json = (schema: z.ZodType) => ({
  "application/json": { schema: z.toJSONSchema(schema) },
});
const error = json(
  z.strictObject({
    code: z.string(),
    message: z.string(),
    details: z.string().nullable(),
    hint: z.string().nullable(),
  }),
);
const forbiddenResponse = {
  description: "Current installation, course or actor scope is unavailable.",
  content: error,
};
const classResponse = {
  description:
    "Current class and the class options and grouped runs the caller may access.",
  content: json(courseClassOptions),
};

export const academyClassPaths = {
  "/rest/v1/rpc/course_class_options": {
    post: {
      operationId: "readAcademyCourseClass",
      tags: ["Courses"],
      summary: "Read the class of a course",
      description:
        "Course learners and instructors see their own course's class. Course managers and scoped company contacts can also see other courses in the same class. Reading is available during licence grace.",
      security: [{ apiKey: [], bearerAuth: [] }],
      "x-portal-licence": "active-or-grace",
      requestBody: {
        required: true,
        content: json(z.strictObject({ p_course_id: z.uuid() })),
      },
      responses: { "200": classResponse, "403": forbiddenResponse },
    },
  },
  "/rest/v1/rpc/set_course_class": {
    post: {
      operationId: "setAcademyCourseClass",
      tags: ["Courses"],
      summary: "Assign a course to a school class",
      description:
        "Requires an active licence and course management or a current membership for the owning company. Supply an existing class ID, a new class name, or neither to clear the grouping. Each change uses the version from the latest read. It does not change course enrolment, chat or document access.",
      security: [{ apiKey: [], bearerAuth: [] }],
      "x-portal-licence": "active",
      requestBody: { required: true, content: json(courseClassAssignment) },
      responses: {
        "200": classResponse,
        "400": { description: "Invalid assignment request.", content: error },
        "403": forbiddenResponse,
        "409": {
          description:
            "The assignment version changed or the class limit was reached.",
          content: error,
        },
      },
    },
  },
};
