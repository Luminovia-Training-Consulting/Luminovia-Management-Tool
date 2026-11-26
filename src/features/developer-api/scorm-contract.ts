/** Document published package and lesson progress transport used by the course workspace. */
import { z } from "zod";
import {
  scormLessonSchema,
  scormPackageList,
} from "../learning/scorm-course-schema.ts";

import {
  lessonRuntimeState,
  scormCommitPayload,
} from "../learning/scorm-runtime-schema.ts";

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
        playback: z.literal("runtime").optional(),
      }),
    ),
    endpoint("withdraw", z.strictObject({})),
    endpoint(
      "complete",
      z.strictObject({ item_id: z.string().min(1).max(160) }),
    ),
  ]),
);

const runtimeTarget = { ...packageId, p_item_id: z.string().min(1).max(160) };
export const scormRuntimeReadRequest = z.toJSONSchema(
  z.strictObject(runtimeTarget),
);
export const scormRuntimeReadResult = z.toJSONSchema(lessonRuntimeState);
export const scormRuntimeWriteRequest = z.toJSONSchema(
  z.strictObject({
    ...runtimeTarget,
    p_session_id: z.uuid(),
    p_expected_revision: z.number().int().nonnegative(),
    p_cmi: scormCommitPayload,
  }),
);
