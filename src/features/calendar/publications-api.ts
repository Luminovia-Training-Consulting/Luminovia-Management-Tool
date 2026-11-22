import { isDatabasePermissionDenied } from "../../lib/database-errors";
import { infiniteQueryOptions, type QueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { validZone, zonedInstant } from "../../lib/dates";
import {
  globalEventSchema,
  globalEventsPageSchema,
  validEventLink,
  type GlobalEvent,
} from "./publications-schema";
export type { GlobalEvent } from "./publications-schema";

export const globalEventFormSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(8000),
  link_url: z.string().trim().refine(validEventLink),
  starts_at: z.string().min(1),
  ends_at: z.string().min(1),
  time_zone: z.string().refine(validZone),
});
export type GlobalEventForm = z.infer<typeof globalEventFormSchema>;

export function globalEventPayload(
  values: GlobalEventForm,
  previous?: GlobalEvent,
) {
  const parsed = globalEventFormSchema.parse(values);
  const exact = (name: "starts_at" | "ends_at") =>
    previous &&
    previous.time_zone === parsed.time_zone &&
    DateTime.fromISO(previous[name])
      .setZone(previous.time_zone)
      .toFormat("yyyy-MM-dd'T'HH:mm") === parsed[name]
      ? previous[name]
      : zonedInstant(parsed[name], parsed.time_zone);
  const starts = exact("starts_at"),
    ends = exact("ends_at");
  if (
    !starts ||
    !ends ||
    !Number.isFinite(Date.parse(starts)) ||
    !Number.isFinite(Date.parse(ends)) ||
    Date.parse(ends) <= Date.parse(starts)
  )
    throw Error("invalid-time");
  return { ...parsed, starts_at: starts, ends_at: ends };
}

export const globalEventsQuery = (
  actor: string,
  from: string,
  to: string,
  manage = false,
  search = "",
) =>
  infiniteQueryOptions({
    queryKey: ["global-events", actor, from, to, manage, search],
    initialPageParam: null as { at: string; id: string } | null,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await db()
        .rpc("global_calendar_events", {
          p_from: from,
          p_to: to,
          p_manage: manage,
          p_search: search,
          p_before_at: pageParam?.at ?? null,
          p_before_id: pageParam?.id ?? null,
          p_limit: 50,
        })
        .abortSignal(signal);
      if (error) throw error;
      return globalEventsPageSchema.parse(data);
    },
    getNextPageParam: (p) =>
      p.has_more ? (p.next_cursor ?? undefined) : undefined,
    staleTime: 15000,
    retry: (attempt, error) =>
      !(error instanceof z.ZodError) &&
      !isDatabasePermissionDenied(error) &&
      attempt < 1,
  });

export async function manageGlobalEvent(
  id: string | null,
  action: "save" | "publish" | "unpublish" | "archive" | "recover",
  version: number,
  key: string,
  payload: Record<string, unknown> = {},
) {
  requireOnline();
  const { data, error } = await db().rpc("manage_global_event", {
    p_id: id,
    p_action: action,
    p_expected_version: version,
    p_request_id: key,
    p_payload: payload,
  });
  if (error) throw error;
  return globalEventSchema.parse(data);
}

export async function refreshGlobalEvents(client: QueryClient) {
  await client.invalidateQueries({ queryKey: ["global-events"] });
}
