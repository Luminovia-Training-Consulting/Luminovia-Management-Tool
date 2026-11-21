import { z } from "zod";

export const academyDraftOptions = z
  .object({
    organisations: z
      .array(z.object({ id: z.uuid(), name: z.string() }))
      .max(50),
    templates: z.array(z.object({ id: z.uuid(), title: z.string() })).max(50),
  })
  .nullable();

export const academyDraftReceipt = z.object({
  course_run_id: z.uuid(),
  template_id: z.uuid(),
});

const session = z.object({
  starts_at: z.iso.datetime({ offset: true }),
  ends_at: z.iso.datetime({ offset: true }),
});

export const academyDraftPayload = z.strictObject({
  time_zone: z.string().min(1),
  delivery_type: z.enum(["online", "onsite"]),
  venue: z.string().max(500),
  sessions: z.array(session).min(1).max(60),
});

export const academyDraftScheduleInput = academyDraftPayload.extend({
  sessions: z
    .array(session.extend({ id: z.uuid().nullable() }))
    .min(1)
    .max(60),
});
export const academyDraftScheduleReceipt = academyDraftPayload.extend({
  revision: z.number().int().min(1),
  sessions: z
    .array(session.extend({ id: z.uuid() }))
    .min(1)
    .max(60),
});
