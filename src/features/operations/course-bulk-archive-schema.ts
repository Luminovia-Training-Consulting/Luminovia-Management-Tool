import { z } from "zod";

const courseArchiveState = z.strictObject({
  id: z.uuid(),
  published: z.boolean(),
  archived_at: z.iso.datetime({ offset: true }).nullable(),
  organisation_id: z.uuid().nullable(),
});

export const courseBulkArchiveRequest = z.strictObject({
  p_items: z.array(courseArchiveState).min(2).max(50),
  p_archive: z.boolean(),
});

export const courseBulkArchiveResult = z.int().min(2).max(50);

export const academyCourseArchiveRequest = z.strictObject({
  p_archived: z.boolean(),
  p_offset: z.int().nonnegative(),
});

const academyCourseArchiveItem = courseArchiveState.extend({
  title: z.string(),
  organisation_name: z.string(),
  time_zone: z.string(),
  starts_at: z.iso.datetime({ offset: true }).nullable(),
});

export const academyCourseArchivePage = z.strictObject({
  items: z.array(academyCourseArchiveItem).max(50),
  has_more: z.boolean(),
});

export type CourseBulkArchiveItem = z.infer<typeof academyCourseArchiveItem>;
