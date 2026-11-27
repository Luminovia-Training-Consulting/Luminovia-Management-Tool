/** Minimum public-within-company data contract shared by the UI and API explorer. */
import { z } from "zod";

const lecturer = z.object({ id: z.uuid(), display_name: z.string() });

export const companyLecturerDirectory = z.object({
  lecturers: z.array(lecturer).max(25),
  next: z.uuid().nullable(),
});

export const companyLecturerProfile = z.object({
  lecturer: lecturer.extend({
    teaching_minutes: z.number().int().nonnegative(),
  }),
  qualifications: z.array(
    z.object({ id: z.uuid(), label_de: z.string(), label_en: z.string() }),
  ),
  reviews: z
    .array(
      z.object({
        id: z.uuid(),
        rater_role: z.enum(["learner", "company"]),
        score: z.number().int().min(1).max(5),
      }),
    )
    .max(25),
  next: z.uuid().nullable(),
});
