/** Reviewed native REST request shapes and scoped peer assessment results. */
import { z } from "zod";
import {
  peerAttachment,
  peerFeedbackState,
  peerRoundNumber,
  peerScores,
} from "../learning/peer-feedback-schema.ts";

const run = { p_run_id: z.uuid() };
const revision = z.number().int().nonnegative();
const body = (max: number) => z.string().min(3).max(max);
const id = z.uuid();
const round = { round: peerRoundNumber.optional() };
const noInput = z.strictObject(round);
const command = <Action extends string>(action: Action, payload: z.ZodType) =>
  z.strictObject({ ...run, p_action: z.literal(action), p_payload: payload });

export const peerActionRequest = z.toJSONSchema(
  z.discriminatedUnion("p_action", [
    command(
      "open",
      z.union([
        z.strictObject({ ...round, body: body(1000) }),
        z.strictObject({
          ...round,
          body: body(1000),
          assignment_id: id,
          scored: z.boolean().optional(),
          assignment_version: z.number().int().min(1).max(999_999_999),
        }),
      ]),
    ),
    command(
      "entry",
      z.strictObject({
        ...round,
        body: body(2000),
        revision,
        attachment_version: id.nullable().optional(),
      }),
    ),
    command("withdraw", z.strictObject({ ...round, revision })),
    command(
      "approve_entry",
      z.strictObject({ ...round, id, revision: revision.min(1) }),
    ),
    command("start", noInput),
    command(
      "feedback",
      z.strictObject({
        ...round,
        body: body(2000),
        scores: peerScores.optional(),
      }),
    ),
    command("approve_feedback", z.strictObject({ ...round, id })),
    command("release", noInput),
    command("dispute", z.strictObject({ ...round, body: body(1000) })),
    command(
      "resolve",
      z.strictObject({ ...round, id, body: body(1000), keep: z.boolean() }),
    ),
  ]),
);
export const peerReadResult = z.toJSONSchema(peerFeedbackState);

export const peerReadRound = z.toJSONSchema(peerRoundNumber);

export const peerAttachmentResult = z.toJSONSchema(
  peerAttachment.extend({
    mime_type: z.enum(["application/pdf", "text/plain"]),
    size_bytes: z
      .number()
      .int()
      .positive()
      .max(10 * 1024 * 1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }),
);
