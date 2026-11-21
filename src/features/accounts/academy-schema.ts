import { z } from "zod";

export const academyOrganisation = z.strictObject({
  id: z.uuid(),
  name: z.string(),
  time_zone: z.string(),
});
export const academyManagedAccount = z.strictObject({
  id: z.uuid(),
  display_name: z.string(),
  active: z.boolean(),
  role: z.enum(["lecturer", "participant", "management"]),
  confirmed: z.boolean(),
  management_delegated: z.boolean(),
  management_version: z.number().int().nonnegative(),
  can_set_active: z.boolean(),
  can_set_management: z.boolean(),
});
export const academyAdministration = z.strictObject({
  can_write: z.boolean(),
  can_create_management: z.boolean(),
  organisations: z.array(academyOrganisation).max(200),
  accounts: z.array(academyManagedAccount).max(200),
});
export type AcademyAdministration = z.infer<typeof academyAdministration>;
export type AcademyManagedAccount = z.infer<typeof academyManagedAccount>;

export const academyAccountReceipt = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("created"), user_id: z.uuid() }),
  z.strictObject({ status: z.literal("in_progress") }),
]);
