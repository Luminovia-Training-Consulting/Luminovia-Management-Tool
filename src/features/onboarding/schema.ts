import { z } from "zod";

export const welcomeStepSchema = z.enum([
  "welcome",
  "profile",
  "jobs",
  "availability",
  "client",
  "calendar",
  "collaboration",
  "files",
  "contracts",
  "notifications",
  "administration",
  "finish",
]);
export const welcomeProgressSchema = z.object({
  step: welcomeStepSchema,
  status: z.enum(["active", "paused", "completed", "skipped"]),
  version: z.number().int().min(0),
});
export type WelcomeProgress = z.infer<typeof welcomeProgressSchema>;
export type WelcomeStep = z.infer<typeof welcomeStepSchema>;
