import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import type { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import {
  calendarInvitationRoster,
  ownCalendarInvitations,
  type calendarInvitationCursor,
  type calendarResponse,
} from "./invitations-schema.ts";

export const invitationsKey = (actor: string) => [
  "calendar-invitations",
  actor,
];

export const ownInvitationsQuery = (actor: string) =>
  infiniteQueryOptions({
    queryKey: [...invitationsKey(actor), "own"],
    initialPageParam: null as z.infer<typeof calendarInvitationCursor> | null,
    queryFn: async ({ signal, pageParam }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc(
          "calendar_invitations",
          pageParam
            ? { p_after_at: pageParam.at, p_after_id: pageParam.id }
            : {},
        )
        .abortSignal(signal);
      if (error) throw error;
      return ownCalendarInvitations.parse(data);
    },
    getNextPageParam: (page) => page.next_cursor ?? undefined,
    retry: false,
  });

export const invitationRosterQuery = (
  actor: string,
  eventId: string,
  version: number,
) =>
  queryOptions({
    queryKey: [...invitationsKey(actor), eventId, version],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("calendar_invitations", {
          p_event_id: eventId,
          p_event_version: version,
        })
        .abortSignal(signal);
      if (error) throw error;
      return calendarInvitationRoster.parse(data);
    },
    retry: false,
  });

export async function setCalendarInvitation(
  eventId: string,
  version: number,
  userCode: string,
  revision: number,
  invited: boolean,
) {
  requireOnline();
  const { data, error } = await db().rpc("set_calendar_invitation", {
    p_event_id: eventId,
    p_event_version: version,
    p_user_code: userCode,
    p_expected_revision: revision,
    p_invited: invited,
  });
  if (error || data !== true) throw error ?? new Error("unconfirmed");
}

export async function replyCalendarInvitation(
  eventId: string,
  version: number,
  revision: number,
  response: z.infer<typeof calendarResponse>,
) {
  requireOnline();
  const { data, error } = await db().rpc("reply_calendar_invitation", {
    p_event_id: eventId,
    p_event_version: version,
    p_expected_revision: revision,
    p_response: response,
  });
  if (error || data !== true) throw error ?? new Error("unconfirmed");
}

export function invitationConflict(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "40001",
  );
}
