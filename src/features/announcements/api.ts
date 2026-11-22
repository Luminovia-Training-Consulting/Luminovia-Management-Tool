import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { resolveScheduleWindow } from "../../lib/dates";
import {
  adminAnnouncementPageSchema,
  adminAnnouncementSchema,
  announcementFormSchema,
  announcementInstant,
  announcementPageSchema,
  announcementSchema,
  type AnnouncementCursor,
  type AnnouncementForm,
  type Revision,
} from "./schema";

export {
  announcementFormSchema,
  announcementSchema,
  audienceRoles,
  type AdminAnnouncement,
  type Announcement,
  type AnnouncementCursor,
  type AnnouncementForm,
  type AnnouncementSummary,
  type Revision,
} from "./schema";

export function announcementPayload(
  values: AnnouncementForm,
  previous?: Revision,
) {
  const parsed = announcementFormSchema.parse(values);
  const window = resolveScheduleWindow(parsed, previous);
  if (!window) throw new Error("invalid-window");
  return { ...parsed, ...window };
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
      return announcementPageSchema.parse(data);
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
      return adminAnnouncementPageSchema.parse(data);
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
      return adminAnnouncementSchema.parse(data);
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
  return adminAnnouncementSchema.parse(data);
}

export async function acknowledgeAnnouncement(id: string) {
  requireOnline();
  const { data, error } = await db().rpc("acknowledge_announcement", {
    p_revision_id: id,
  });
  if (error) throw error;
  return announcementInstant.parse(data);
}
