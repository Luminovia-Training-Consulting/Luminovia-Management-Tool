import { z } from "zod";
import { validZone } from "../../lib/dates";

/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
export const runSchema = z.object({
  template_id: z.uuid(),
  organisation_id: z.string(),
  time_zone: z.string().refine(validZone),
  delivery_type: z.enum(["online", "onsite"]),
  venue: z.string().max(500),
  teaching_language: z.enum(["", "de", "en"]).optional(),
  archived: z.boolean(),
  sessions: z
    .array(
      z.object({
        starts_at: z.string().min(1),
        ends_at: z.string().min(1),
        // Form-local identity follows a retained row through remove/reorder.
        // It is never included in the normalized server session payload.
        source_session_id: z.string().optional(),
      }),
    )
    .min(1)
    .max(60),
});
