import { z } from "zod";

export const academyCourseCapacity = z.number().int().min(1).max(10000);
export const academyPublishedCourse = z.strictObject({
  published: z.literal(true),
  capacity: academyCourseCapacity,
});
export const academyCoursePublication = z
  .discriminatedUnion("published", [
    academyPublishedCourse,
    z.strictObject({ published: z.literal(false), capacity: z.null() }),
  ])
  .nullable();
