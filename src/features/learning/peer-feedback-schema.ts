/** Actor-scoped peer projections never include another learner's identity. */
import { z } from "zod";

const body = z.string();
const stage = z.enum(["collecting", "reviewing", "released"]);
export const peerRoundNumber = z.number().int().min(1).max(999_999_999);
const entry = z.strictObject({
  body,
  revision: z.number().int().positive(),
  approved: z.boolean(),
});
export const peerFeedbackState = z.strictObject({
  assignment_rubric: z
    .strictObject({
      title: body,
      version: z.number().int().positive(),
      criteria: z.array(body).min(1).max(20),
    })
    .nullable(),
  available_assignments: z.array(
    z.strictObject({
      id: z.uuid(),
      title: body,
      version: z.number().int().positive(),
    }),
  ),
  round_number: peerRoundNumber.nullable(),
  rounds: z.array(
    z.strictObject({ number: peerRoundNumber, prompt: body, stage }),
  ),
  prompt: body.nullable(),
  stage: stage.nullable(),
  can_write: z.boolean(),
  can_moderate: z.boolean(),
  own_entry: entry.nullable(),
  assignment: z.strictObject({ body, feedback: body.nullable() }).nullable(),
  received: z
    .strictObject({
      feedback: body.nullable(),
      dispute: body.nullable(),
      resolution: body.nullable(),
    })
    .nullable(),
  entries: z.array(entry.extend({ id: z.uuid() })).max(60),
  reviews: z
    .array(
      z.strictObject({
        id: z.uuid(),
        feedback: body,
        approved: z.boolean(),
        dispute: body.nullable(),
        resolution: body.nullable(),
      }),
    )
    .max(60),
});
export type PeerFeedbackState = z.infer<typeof peerFeedbackState>;
