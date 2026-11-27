/** Shared H5P playback and exact scanned package projections. */
import { z } from "zod";

export const h5pProgress = z.strictObject({
  completed: z.boolean(),
  score: z.number().min(0).max(1).nullable(),
});

const h5pPackage = z.strictObject({
  id: z.uuid(),
  title: z.string().min(1).max(200),
  sha256: z.hash("sha256"),
  progress: h5pProgress.nullable(),
  practice: z.literal(true).optional(),
});
export const h5pCatalogue = z.strictObject({
  can_publish: z.boolean(),
  can_complete: z.boolean(),
  packages: z.array(h5pPackage),
});
export type CourseH5pPackage = z.infer<typeof h5pPackage>;
export type H5pProgress = z.infer<typeof h5pProgress>;
