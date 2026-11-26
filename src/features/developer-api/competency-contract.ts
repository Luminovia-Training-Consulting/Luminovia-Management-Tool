/** Reviewed, role-scoped competency commands for both portal editions. */
import { z } from "zod";
import {
  competencyFrameworkDefinition,
  courseCompetenciesSchema,
} from "../learning/competency-schema.ts";

const id = z.uuid();
const revision = z.number().int().nonnegative();
const positiveRevision = revision.min(1);
const run = { p_run_id: id, p_expected_revision: revision };
const framework = z.strictObject({
  id,
  content: competencyFrameworkDefinition,
});
const mapping = z.strictObject({
  framework_id: id,
  framework_revision: positiveRevision,
});
const decision = z.strictObject({
  pin_revision: positiveRevision,
  user_id: id,
  competency_id: id,
  level_id: id,
  evidence_note: z.string().min(3).max(1500),
  include_quiz: z.boolean(),
});
export const competencyAction = z.toJSONSchema(
  z.discriminatedUnion("p_action", [
    z.strictObject({
      ...run,
      p_action: z.literal("save_framework"),
      p_payload: framework,
    }),
    z.strictObject({ ...run, p_action: z.literal("pin"), p_payload: mapping }),
    z.strictObject({
      ...run,
      p_action: z.literal("assess"),
      p_payload: decision,
    }),
  ]),
);
export const competencyActionResult = z.toJSONSchema(
  z.strictObject({ id: id.optional(), revision: positiveRevision }),
);
export const competencyRead = z.toJSONSchema(
  z.strictObject({
    p_run_id: id,
    p_user_id: id.nullable().optional(),
    p_offset: revision.optional(),
  }),
);
export const competencyReadResult = z.toJSONSchema(courseCompetenciesSchema);
