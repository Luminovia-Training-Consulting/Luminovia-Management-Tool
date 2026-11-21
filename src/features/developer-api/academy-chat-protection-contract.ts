import { z } from "zod";
import { courseChatProtectionSchema } from "../learning/course-chat-protection-schema.ts";

const json = (schema: z.ZodType) => ({
  "application/json": { schema: z.toJSONSchema(schema) },
});
const security = [{ apiKey: [], bearerAuth: [] }];
const failure = json(
  z.strictObject({
    code: z.string(),
    message: z.string(),
    details: z.string().nullable(),
    hint: z.string().nullable(),
  }),
);
const readResult = {
  description: "Current protection and version for each authorised scope.",
  content: json(courseChatProtectionSchema),
};
const rejected = {
  description: "Current course or administrator authority required.",
  content: failure,
};

export const academyChatProtectionPaths = {
  "/rest/v1/rpc/course_chat_protection": {
    post: {
      operationId: "readAcademyCourseChatProtection",
      tags: ["Local academy administration"],
      summary: "Read protection settings for course chat",
      description:
        "Reads the organisation settings for an exact course and the effective academy rule. Omit the course only for the local administrator's academy setting. Learners and unrelated contacts cannot read settings.",
      security,
      "x-portal-licence": "active-or-grace",
      requestBody: {
        required: false,
        content: json(
          z.strictObject({ p_run_id: z.uuid().nullable().optional() }),
        ),
      },
      responses: {
        "200": readResult,
        "401": { description: "Authentication required.", content: failure },
        "403": rejected,
      },
    },
  },
  "/rest/v1/rpc/set_course_chat_protection": {
    post: {
      operationId: "setAcademyCourseChatProtection",
      tags: ["Local academy administration"],
      summary: "Set the versioned course-chat spam protection",
      description:
        "Only a local administrator may set the academy-wide switch. Current authorised organisation contacts may set the company switch for their own course. An organisation switch cannot weaken the academy-wide limit.",
      security,
      "x-portal-licence": "active",
      requestBody: {
        required: true,
        content: json(
          z.strictObject({
            p_run_id: z.uuid().nullable(),
            p_global: z.boolean(),
            p_enabled: z.boolean(),
            p_expected_version: z.int().nonnegative(),
          }),
        ),
      },
      responses: {
        "200": readResult,
        "400": {
          description: "Invalid switch or version input.",
          content: failure,
        },
        "401": { description: "Authentication required.", content: failure },
        "403": rejected,
        "409": {
          description: "The setting changed. Reload its current version.",
          content: failure,
        },
      },
    },
  },
};
