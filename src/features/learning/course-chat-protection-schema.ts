import { z } from "zod";

const switchState = z.strictObject({
  enabled: z.boolean(),
  version: z.int().nonnegative(),
});

export const courseChatProtectionSchema = z.strictObject({
  global: switchState.nullable(),
  company: switchState.nullable(),
  global_enforced: z.boolean(),
  can_write: z.boolean(),
});
