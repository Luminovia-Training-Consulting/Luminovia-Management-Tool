/** Published SCORM package versions and their caller-scoped progress. */
import { z } from "zod";

export const scormLessonSchema = z.strictObject({
  id: z.string().min(1).max(160),
  title: z.string().min(1).max(200),
});
const packageSchema = z.strictObject({
  id: z.uuid(),
  title: z.string().min(1).max(200),
  sha256: z.hash("sha256"),
  lessons: z.array(scormLessonSchema).min(1).max(100),
  completed: z.array(z.string()).max(100),
});
export const scormPackageList = z.strictObject({
  can_publish: z.boolean(),
  can_complete: z.boolean(),
  packages: z.array(packageSchema).max(20),
});
export type CourseScormPackage = z.infer<typeof packageSchema>;
