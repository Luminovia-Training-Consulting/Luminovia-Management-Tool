/** Versioned installation-wide assignment customer visibility API. */
import { z } from "zod";

export const assignmentCustomerMode = z.enum([
  "scheduled",
  "on_confirmation",
  "management_only",
]);

export const assignmentCustomerSettingsSchema = z.strictObject({
  mode: assignmentCustomerMode,
  lead_hours: z.int().min(0).max(8760),
  revision: z.int().nonnegative(),
});
