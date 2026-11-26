/** Reviewed native REST request shapes and scoped peer assessment results. */
import { z } from "zod";
import {
  peerFeedbackState,
  peerRoundNumber,
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
    command("open", z.strictObject({ ...round, body: body(1000) })),
    command("entry", z.strictObject({ ...round, body: body(2000), revision })),
    command("withdraw", z.strictObject({ ...round, revision })),
    command(
      "approve_entry",
      z.strictObject({ ...round, id, revision: revision.min(1) }),
    ),
    command("start", noInput),
    command("feedback", z.strictObject({ ...round, body: body(2000) })),
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
