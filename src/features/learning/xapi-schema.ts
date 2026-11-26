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
const quizActivity = activity(/\/[a-f0-9]{64}\/quiz\/[1-9][0-9]*$/);
const choice = z.string().regex(/^choice-[1-6]$/);
const statement = z.union([
  z.strictObject({
    ...base,
    verb: z.strictObject({ id: z.literal(verbBase + "attempted") }),
    object: quizActivity,
    result: scoredResult.extend({
      score: score.extend({ raw: percent.int() }),
    }),
  }),
  z.strictObject({
    ...base,
    verb: z.strictObject({ id: z.literal(verbBase + "answered") }),
    object: activity(
      /\/[a-f0-9]{64}\/quiz\/[1-9][0-9]*\/h5p\/(?:[1-9]|1[0-9]|20)$/,
    ).extend({
      definition: z.strictObject({
        type: z.literal("http://adlnet.gov/expapi/activities/cmi.interaction"),
        interactionType: z.literal("choice"),
        choices: z
          .array(z.strictObject({ id: choice }))
          .min(2)
          .max(6),
      }),
    }),
    result: z.strictObject({
      completion: z.literal(true),
      response: choice,
      success: z.boolean(),
    }),
    context: z.strictObject({
      contextActivities: z.strictObject({ parent: z.tuple([quizActivity]) }),
    }),
  }),
  z.strictObject({
    ...base,
    verb: z.strictObject({ id: z.literal(verbBase + "completed") }),
    object: activity(/\/[a-f0-9]{64}(?:\/(?:h5p|scorm)\/[a-f0-9]{64})?$/),
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

const deliveryTimestamp = z.iso.datetime({ offset: true });
const deliveryCount = z.number().int().min(0).max(2_147_483_647);
const deliveryFailure = z
  .enum([
    "delivery",
    "window_budget",
    "window_too_dense",
    "export_or_checkpoint",
  ])
  .nullable();
export const courseXapiDeliveryStatus = z
  .strictObject({
    through: deliveryTimestamp,
    reported_at: deliveryTimestamp,
    submitted: deliveryCount,
    retries: deliveryCount,
    failure: deliveryFailure,
  })
  .nullable();
export const courseXapiDeliveryReport = z.strictObject({
  p_run_id: z.uuid(),
  p_through: deliveryTimestamp,
  p_submitted: deliveryCount,
  p_retries: deliveryCount,
  p_failure: deliveryFailure,
});
