/** Readiness wire shapes shared by the browser and the internal OpenAPI contract. */
import { z } from "zod";

const instant = z.string().datetime({ offset: true });
export const readinessReceiptSchema = z.string().uuid();
const uuid = readinessReceiptSchema;
// Keep direct links local and reject backslashes, whitespace and control characters.
// eslint-disable-next-line no-control-regex
const localPath = z.string().regex(/^\/(?!\/)[^\\\s\x00-\x20\x7f]*$/);
const requirementFlags = {
  materials_required: z.boolean(),
  customer_required: z.boolean(),
  contact_required: z.boolean(),
  agreement_required: z.boolean(),
  instructions_required: z.boolean(),
};
const instructions = z.string().max(20000);
const readinessMeetingUrl = z
  .string()
  .trim()
  .max(2000)
  .regex(
    /^$|^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?::[0-9]{1,5})?(?:[/?#][^\s<>"\\]*)?$/,
  )
  .describe(
    "An HTTPS URL without credentials and with an optional port from 1 to 65535. An empty string clears the override.",
  );
const clearedInstant = z.union([instant, z.literal(""), z.null()]);

export const readinessSettingsInputSchema = z.strictObject({
  ...requirementFlags,
  instructions,
  meeting_url: readinessMeetingUrl,
  preparation_deadline: clearedInstant,
});
export const readinessTaskInputSchema = z.strictObject({
  title: z.string().trim().min(1).max(500),
  responsible_user_id: uuid,
  required: z.boolean(),
  due_at: clearedInstant,
  archived: z.boolean(),
});

const readinessSettingsSchema = z.object({
  version: z.number().int().nonnegative(),
  ...requirementFlags,
  instructions,
  instruction_version: z.number().int().positive(),
  meeting_url: z.string(),
  preparation_deadline: instant.nullable(),
  sessions_confirmed: z.boolean(),
});
const readinessTaskSchema = z.object({
  id: uuid,
  title: z.string(),
  required: z.boolean(),
  responsible_user_id: uuid,
  responsible_name: z.string(),
  due_at: instant.nullable(),
  completed_at: instant.nullable(),
  version: z.number().int().positive(),
  can_complete: z.boolean(),
});
const readinessSchema = z.object({
  id: uuid,
  title: z.string(),
  organisation_name: z.string().nullable(),
  time_zone: z.string(),
  delivery_type: z.enum(["online", "onsite"]),
  venue: z.string(),
  meeting_url: z.string(),
  starts_at: instant.nullable(),
  ends_at: instant.nullable(),
  status: z.enum(["ready", "attention_required", "blocked", "completed"]),
  percentage: z.number().min(0).max(100),
  applicable_count: z.number().int().positive(),
  completed_count: z.number().int().nonnegative(),
  can_manage: z.boolean(),
  can_acknowledge: z.boolean(),
  settings: readinessSettingsSchema,
  checks: z.array(
    z.object({
      code: z.enum([
        "lecturer",
        "agreement",
        "qualification",
        "materials",
        "delivery",
        "customer",
        "contact",
        "sessions",
        "instructions",
        "tasks",
      ]),
      applicable: z.boolean(),
      complete: z.boolean(),
      blocking: z.boolean(),
      responsible: z.enum(["management", "lecturer", "assignee"]),
      href: localPath.nullable(),
    }),
  ),
  tasks: z.array(readinessTaskSchema),
  lecturers: z.array(
    z.object({ id: uuid, display_name: z.string(), acknowledged: z.boolean() }),
  ),
  responsible_people: z.array(
    z.object({
      id: uuid,
      display_name: z.string(),
      acknowledged: z.boolean().optional(),
    }),
  ),
  documents: z.array(z.object({ id: uuid, name: z.string(), job_id: uuid })),
  jobs: z.array(z.object({ id: uuid, title: z.string() })),
  as_of: instant,
});
export type CourseReadiness = z.infer<typeof readinessSchema>;
export type ReadinessTask = z.infer<typeof readinessTaskSchema>;
export type ReadinessSettings = z.infer<typeof readinessSettingsSchema>;
export const readinessListSchema = z.array(readinessSchema).max(250);
export type SettingsInput = z.infer<typeof readinessSettingsInputSchema>;
export type TaskInput = z.infer<typeof readinessTaskInputSchema>;
