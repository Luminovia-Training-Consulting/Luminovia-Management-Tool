import { z } from "zod";

export const courseClassName = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((value) => !/\p{Cc}/u.test(value));

const courseClass = z.strictObject({
  id: z.uuid(),
  name: courseClassName,
});

export const courseClassOptions = z.strictObject({
  version: z.number().int().nonnegative(),
  current: courseClass.nullable(),
  can_edit: z.boolean(),
  classes: z.array(courseClass).max(100),
  courses: z
    .array(z.strictObject({ id: z.uuid(), title: z.string() }))
    .max(100),
});

export const courseClassAssignment = z
  .strictObject({
    p_course_id: z.uuid(),
    p_class_id: z.uuid().nullable(),
    p_new_name: courseClassName.nullable(),
    p_expected_version: z.number().int().nonnegative(),
  })
  .refine(({ p_class_id, p_new_name }) => !p_class_id || !p_new_name);
