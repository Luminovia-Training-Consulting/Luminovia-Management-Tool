/** Draft receipt and snapshot contract for the course creator. */
import { z } from "zod";
import { validZone } from "../../lib/dates.ts";

const text = z.string();
export const courseCreatorSnapshotSchema = z.object({
  run: z.object({
    template_id: text,
    organisation_id: text,
    time_zone: text.refine(validZone),
    delivery_type: z.enum(["online", "onsite"]),
    venue: text,
    teaching_language: z.enum(["", "de", "en"]).optional(),
    archived: z.boolean(),
    sessions: z
      .array(
        z.object({
          starts_at: text,
          ends_at: text,
          source_session_id: text.optional(),
        }),
      )
      .min(1)
      .max(60),
  }),
  content: z.object({
    title: text,
    description: text,
    syllabus: text,
    prerequisites: text,
    topic_ids: z.array(text),
    archived: z.boolean(),
  }),
});
export type CourseCreatorSnapshot = z.infer<typeof courseCreatorSnapshotSchema>;

export const courseCreatorReceiptSchema = z.object({
  id: z.uuid(),
  title: text,
  revision: z.number().int().positive(),
  updated_at: z.iso.datetime({ offset: true }),
  state: z.enum(["editing", "created", "discarded"]),
  from_enquiry: z.boolean().optional(),
  course_run_id: z.uuid().nullable(),
  next_action: z.enum(["course", "offer"]).nullable(),
  payload: courseCreatorSnapshotSchema.nullable(),
});
export const courseCreatorIndexSchema = z.array(courseCreatorReceiptSchema);
export type CourseCreatorDraft = z.infer<typeof courseCreatorReceiptSchema>;
