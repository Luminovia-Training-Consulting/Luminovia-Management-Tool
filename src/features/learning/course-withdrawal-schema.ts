import { z } from "zod";

export const courseWithdrawalWindowSchema = z.strictObject({
  deadline_at: z.iso.datetime({ offset: true }).nullable(),
  can_withdraw: z.boolean(),
});
