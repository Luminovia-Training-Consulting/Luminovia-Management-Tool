import { z } from "zod";

export const courseSubmissionPage = z.strictObject({
  enabled: z.boolean(),
  can_manage: z.boolean(),
  can_upload: z.boolean(),
  next: z.uuid().nullable(),
  entries: z
    .array(
      z.strictObject({
        version_id: z.uuid(),
        name: z.string(),
        size_bytes: z
          .number()
          .int()
          .positive()
          .max(10 * 1024 * 1024),
        submitted_at: z.iso.datetime({ offset: true }),
        participant: z.string().nullable(),
        can_withdraw: z.boolean(),
      }),
    )
    .max(50),
});

export type CourseSubmissionEntry = z.infer<
  typeof courseSubmissionPage
>["entries"][number];
