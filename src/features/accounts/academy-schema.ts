import { z } from "zod";

export const academyOrganisation = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  time_zone: z.string(),
});
export const academyAdministration = z.strictObject({
  can_write: z.boolean(),
  organisations: z.array(academyOrganisation).max(200),
  accounts: z
    .array(
      z.strictObject({
        id: z.uuid(),
        display_name: z.string(),
        active: z.boolean(),
        role: z.enum(["lecturer", "participant"]),
        confirmed: z.boolean(),
      }),
    )
    .max(200),
});
export type AcademyAdministration = z.infer<typeof academyAdministration>;

export const academyAccountReceipt = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("created"), user_id: z.uuid() }),
  z.strictObject({ status: z.literal("in_progress") }),
]);
