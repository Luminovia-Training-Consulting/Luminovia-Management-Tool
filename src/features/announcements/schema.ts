import { z } from "zod";
import { validZone } from "../../lib/dates.ts";

export const announcementInstant = z.string().datetime({ offset: true });
export const audienceRoles = [
  "owner",
  "admin",
  "management",
  "senior_lecturer",
  "lecturer",
  "participant",
  "client",
] as const;
const content = {
  id: z.string().uuid(),
  announcement_id: z.string().uuid(),
  revision: z.number().int().positive(),
  title_de: z.string(),
  title_en: z.string(),
  body_de: z.string(),
  body_en: z.string(),
  important: z.boolean(),
  starts_at: announcementInstant,
  ends_at: announcementInstant,
  time_zone: z.string().refine(validZone),
};
const revisionSchema = z.object({
  ...content,
  audience_roles: z.array(z.enum(audienceRoles)),
  created_by: z.string().uuid(),
  created_at: announcementInstant,
});
export const announcementSchema = z.object({
  ...content,
  published_at: announcementInstant,
  acknowledged_at: announcementInstant.nullable(),
});
export type Announcement = z.infer<typeof announcementSchema>;
export type Revision = z.infer<typeof revisionSchema>;
export const adminAnnouncementSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  archived_at: announcementInstant.nullable(),
  updated_at: announcementInstant,
  draft: revisionSchema,
  published: revisionSchema
    .extend({ published_at: announcementInstant })
    .nullable(),
});
export type AdminAnnouncement = z.infer<typeof adminAnnouncementSchema>;
const cursorSchema = z.object({
  at: announcementInstant,
  id: z.string().uuid(),
});
export type AnnouncementCursor = z.infer<typeof cursorSchema>;
export const announcementPageSchema = z.object({
  items: z.array(announcementSchema).max(50),
  has_more: z.boolean(),
  next_cursor: cursorSchema.nullable(),
  as_of: announcementInstant,
});
const summarySchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  title_de: z.string(),
  title_en: z.string(),
  has_draft: z.boolean(),
  state: z.enum(["draft", "published", "archived"]),
  archived_at: announcementInstant.nullable(),
  updated_at: announcementInstant,
  draft_revision_id: z.string().uuid(),
  published_revision_id: z.string().uuid().nullable(),
});
export const adminAnnouncementPageSchema = z.object({
  items: z.array(summarySchema).max(50),
  has_more: z.boolean(),
  next_cursor: cursorSchema.nullable(),
});
export type AnnouncementSummary = z.infer<typeof summarySchema>;
export const announcementFormSchema = z.object({
  title_de: z.string().trim().min(1).max(200),
  title_en: z.string().trim().min(1).max(200),
  body_de: z.string().trim().min(1).max(8000),
  body_en: z.string().trim().min(1).max(8000),
  important: z.boolean(),
  audience_roles: z.array(z.enum(audienceRoles)).max(7),
  starts_at: z.string().min(1),
  ends_at: z.string().min(1),
  time_zone: z.string().refine(validZone),
});
export type AnnouncementForm = z.infer<typeof announcementFormSchema>;
