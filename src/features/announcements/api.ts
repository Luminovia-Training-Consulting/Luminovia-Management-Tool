import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { DateTime } from "luxon";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { validZone, zonedInstant } from "../../lib/dates";

const instant = z.string().datetime({ offset: true });
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
  starts_at: instant,
  ends_at: instant,
  time_zone: z.string().refine(validZone),
};
const revisionSchema = z.object({
  ...content,
  audience_roles: z.array(z.enum(audienceRoles)),
  created_by: z.string().uuid(),
  created_at: instant,
});
export const announcementSchema = z.object({
  ...content,
  published_at: instant,
  acknowledged_at: instant.nullable(),
});
export type Announcement = z.infer<typeof announcementSchema>;
export type Revision = z.infer<typeof revisionSchema>;
const adminSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  archived_at: instant.nullable(),
  updated_at: instant,
  draft: revisionSchema,
  published: revisionSchema.extend({ published_at: instant }).nullable(),
});
export type AdminAnnouncement = z.infer<typeof adminSchema>;
const cursorSchema = z.object({ at: instant, id: z.string().uuid() });
export type AnnouncementCursor = z.infer<typeof cursorSchema>;
const pageSchema = z.object({
  items: z.array(announcementSchema).max(50),
  has_more: z.boolean(),
  next_cursor: cursorSchema.nullable(),
  as_of: instant,
});
const summarySchema = z.object({
  id: z.string().uuid(),
  version: z.number().int().positive(),
  title_de: z.string(),
  title_en: z.string(),
  has_draft: z.boolean(),
  state: z.enum(["draft", "published", "archived"]),
  archived_at: instant.nullable(),
  updated_at: instant,
  draft_revision_id: z.string().uuid(),
  published_revision_id: z.string().uuid().nullable(),
});
const adminPageSchema = z.object({
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

export function announcementPayload(
  values: AnnouncementForm,
  previous?: Revision,
) {
  const parsed = announcementFormSchema.parse(values);
  const exact = (field: "starts_at" | "ends_at") =>
    previous &&
    previous.time_zone === parsed.time_zone &&
    DateTime.fromISO(previous[field])
      .setZone(previous.time_zone)
      .toFormat("yyyy-MM-dd'T'HH:mm") === parsed[field]
      ? previous[field]
      : zonedInstant(parsed[field], parsed.time_zone);
  const starts = exact("starts_at"),
    ends = exact("ends_at");
  if (!starts || !ends || Date.parse(ends) <= Date.parse(starts))
    throw new Error("invalid-window");
  return { ...parsed, starts_at: starts, ends_at: ends };
}

export const announcementKeys = {
  all: (actor: string) => ["announcements", actor] as const,
};
export const announcementsQuery = (
  actor: string,
  search = "",
  cursor: AnnouncementCursor | null = null,
  unacknowledged = false,
  limit = 20,
) =>
  queryOptions({
    queryKey: [
      ...announcementKeys.all(actor),
      "list",
      search,
      cursor,
      unacknowledged,
      limit,
    ],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("announcements", {
          p_search: search,
          p_unacknowledged: unacknowledged,
          p_before_at: cursor?.at ?? null,
          p_before_id: cursor?.id ?? null,
          p_limit: limit,
        })
        .abortSignal(signal);
      if (error) throw error;
      return pageSchema.parse(data);
    },
    staleTime: 0,
    retry: false,
  });
export const announcementQuery = (actor: string, id: string) =>
  queryOptions({
    queryKey: [...announcementKeys.all(actor), "revision", id],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("announcement", { p_revision_id: id })
        .abortSignal(signal);
      if (error) throw error;
      return announcementSchema.parse(data);
    },
    staleTime: 0,
    retry: false,
  });
export const adminAnnouncementsQuery = (
  actor: string,
  search: string,
  state: string,
  cursor: AnnouncementCursor | null,
) =>
  queryOptions({
    queryKey: [...announcementKeys.all(actor), "admin", search, state, cursor],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("admin_announcements", {
          p_search: search,
          p_state: state,
          p_before_at: cursor?.at ?? null,
          p_before_id: cursor?.id ?? null,
          p_limit: 20,
        })
        .abortSignal(signal);
      if (error) throw error;
      return adminPageSchema.parse(data);
    },
    staleTime: 0,
    retry: false,
  });
export const adminAnnouncementQuery = (actor: string, id: string) =>
  queryOptions({
    queryKey: [...announcementKeys.all(actor), "admin-detail", id],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("admin_announcement", { p_id: id })
        .abortSignal(signal);
      if (error) throw error;
      return adminSchema.parse(data);
    },
    staleTime: 0,
    retry: false,
  });

export async function manageAnnouncement(args: {
  id: string | null;
  action: "save" | "publish" | "archive" | "recover";
  version: number;
  requestId: string;
  payload?: ReturnType<typeof announcementPayload>;
}) {
  requireOnline();
  const { data, error } = await db().rpc("manage_announcement", {
    p_id: args.id,
    p_action: args.action,
    p_expected_version: args.version,
    p_request_id: args.requestId,
    p_payload: args.payload ?? {},
  });
  if (error) throw error;
  return adminSchema.parse(data);
}

export async function acknowledgeAnnouncement(id: string) {
  requireOnline();
  const { data, error } = await db().rpc("acknowledge_announcement", {
    p_revision_id: id,
  });
  if (error) throw error;
  return instant.parse(data);
}
