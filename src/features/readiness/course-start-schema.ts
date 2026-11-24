import { z } from "zod";

const uuid = z.uuid();
const instant = z.iso.datetime({ offset: true });

export const courseStartInput = z.strictObject({
  p_course_run_id: uuid,
  p_responsible: uuid,
  p_backup: uuid.nullable(),
  p_version: z.number().int().nonnegative(),
});

export const courseStartResponse = z.object({
  can_manage: z.boolean(),
  staff: z.array(z.object({ id: uuid, name: z.string() })),
  items: z
    .array(
      z.object({
        id: uuid,
        title: z.string(),
        starts_at: instant.nullable(),
        time_zone: z.string(),
        deadline: instant.nullable(),
        status: z.enum(["ready", "pending", "overdue", "unscheduled"]),
        missing: z.array(
          z.enum([
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
        ),
        responsible: z.string().nullable(),
        backup: z.string().nullable(),
        version: z.number().int().nonnegative(),
        responsible_id: uuid.nullable(),
        backup_id: uuid.nullable(),
      }),
    )
    .max(100),
});
