/** The supported xAPI 1.0.3 statement profile contains only authoritative, pseudonymous LMS facts. */
import { z } from "zod";

const model = "https://luminovia.org/xapi/activities/course/";
const verbBase = "http://adlnet.gov/expapi/verbs/";
const identifier = z.uuid();
const activity = (pattern: RegExp) =>
  z.strictObject({
    objectType: z.literal("Activity"),
    id: z.string().startsWith(model).regex(pattern),
  });
const base = {
  id: identifier,
  timestamp: z.iso.datetime({ offset: true }),
  actor: z.strictObject({
    objectType: z.literal("Agent"),
    account: z.strictObject({
      homePage: z.literal("https://luminovia.org"),
      name: z.string().regex(/^[a-f0-9]{64}$/),
    }),
  }),
};
const percent = z.number().min(0).max(100);
const score = z.strictObject({
  scaled: z.number().min(0).max(1),
  raw: percent,
  min: z.literal(0),
  max: z.literal(100),
});
const scoredResult = z.strictObject({ score, success: z.boolean() });
const statement = z.union([
  z.strictObject({
    ...base,
    verb: z.strictObject({ id: z.literal(verbBase + "attempted") }),
    object: activity(/\/[a-f0-9]{64}\/quiz\/[1-9][0-9]*$/),
    result: scoredResult.extend({
      score: score.extend({ raw: percent.int() }),
    }),
  }),
  z.strictObject({
    ...base,
    verb: z.strictObject({ id: z.literal(verbBase + "completed") }),
    object: activity(/\/[a-f0-9]{64}$/),
    result: z.strictObject({ completion: z.literal(true) }),
  }),
  z.strictObject({
    ...base,
    verb: z.strictObject({ id: z.literal(verbBase + "scored") }),
    object: activity(
      /\/[a-f0-9]{64}\/(?:weighted-grade|text-exam\/[1-9][0-9]*)$/,
    ),
    result: scoredResult,
  }),
  z.strictObject({
    ...base,
    verb: z.strictObject({ id: z.literal(verbBase + "voided") }),
    object: z.strictObject({
      objectType: z.literal("StatementRef"),
      id: identifier,
    }),
  }),
]);

export const courseXapiArchiveSchema = z.strictObject({
  profile: z.literal("luminovia-lms-1"),
  xapi_version: z.literal("1.0.3"),
  statements: z
    .array(statement)
    .max(2000)
    .refine(
      (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
      "Statement IDs must be unique",
    ),
});
