/** Document published package and lesson progress transport used by the course workspace. */
import { z } from "zod";
import {
  scormLessonSchema,
  scormPackageList,
} from "../learning/scorm-course-schema.ts";

const run = { p_run_id: z.uuid() };
const packageId = { ...run, p_version_id: z.uuid() };
const endpoint = <Action extends string>(action: Action, payload: z.ZodType) =>
  z.strictObject({
    ...packageId,
    p_action: z.literal(action),
    p_payload: payload,
  });
export const readScormPackages = z.toJSONSchema(scormPackageList);
export const scormCourseCommand = z.toJSONSchema(
  z.discriminatedUnion("p_action", [
    endpoint(
      "publish",
      z.strictObject({
        title: z.string().min(1).max(200),
        sha256: z.hash("sha256"),
        lessons: z.array(scormLessonSchema).min(1).max(100),
      }),
    ),
    endpoint("withdraw", z.strictObject({})),
    endpoint(
      "complete",
      z.strictObject({ item_id: z.string().min(1).max(160) }),
    ),
  ]),
);
