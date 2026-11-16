/**
 * Actor-bezogene Query-Schlüssel und autorisierte Chatprojektionen. Die Nachrichtenhistorie verwendet Zeit/ID-Cursor; Realtime dient ergänzend zur Revalidierung und ersetzt keine RPC-Zugriffsprüfung.
 */
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import type {
  ChatContact,
  ChatMember,
  ChatMessage,
  ChatRoom,
  MessageCursor,
} from "./types";
/** Einheitliche Cachepräfixe für gezielte Revalidierung und sofortiges Entfernen eines widerrufenen Raums. */
export const chatKeys = {
  rooms: (actor: string) => ["chat-rooms", actor] as const,
  contacts: (actor: string) => ["chat-contacts", actor] as const,
  members: (actor: string, room: string) =>
    ["chat-members", actor, room] as const,
  messages: (actor: string, room: string) =>
    ["chat-messages", actor, room] as const,
};
/** Lädt die Serverprojektion über chat_rooms_list und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const chatRoomsQuery = (actor: string) =>
  queryOptions({
    queryKey: chatKeys.rooms(actor),
    queryFn: async () => {
      const { data, error } = await db().rpc("chat_rooms_list");
      if (error) throw error;
      return (data ?? []) as ChatRoom[];
    },
    refetchInterval: 3000,
    staleTime: 1000,
  });
/** Lädt die Serverprojektion über chat_contacts und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const chatContactsQuery = (actor: string) =>
  queryOptions({
    queryKey: chatKeys.contacts(actor),
    queryFn: async () => {
      const { data, error } = await db().rpc("chat_contacts");
      if (error) throw error;
      return (data ?? []) as ChatContact[];
    },
  });
/** Lädt die Serverprojektion über chat_room_members und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const chatMembersQuery = (actor: string, room: string) =>
  queryOptions({
    queryKey: chatKeys.members(actor, room),
    queryFn: async () => {
      const { data, error } = await db().rpc("chat_room_members", {
        p_room_id: room,
      });
      if (error) throw error;
      return (data ?? []) as ChatMember[];
    },
    refetchInterval: 5000,
  });
/** Lädt die Serverprojektion über chat_messages und propagiert deren Fehler an den Queryzustand. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
export const chatMessagesQuery = (
  actor: string,
  room: string,
  search: string,
) =>
  infiniteQueryOptions({
    queryKey: [...chatKeys.messages(actor, room), search],
    initialPageParam: null as MessageCursor | null,
    queryFn: async ({ pageParam }) => {
      const { data, error } = await db().rpc("chat_messages", {
        p_room_id: room,
        p_before_at: pageParam?.at ?? null,
        p_before_id: pageParam?.id ?? null,
        p_search: search,
        p_limit: 40,
      });
      if (error) throw error;
      return (data ?? []) as ChatMessage[];
    },
    getNextPageParam: (page): MessageCursor | undefined => {
      const last = page[page.length - 1];
      return page.length === 40 && last
        ? { at: last.created_at, id: last.id }
        : undefined;
    },
    staleTime: 1000,
    refetchInterval: 10000,
  });
/** Erkennt den PostgreSQL-Rechtefehler, damit die Oberfläche behaltene Raumdaten verbergen kann. */
export function chatAccessDenied(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "42501",
  );
}
/** Entfernt Cursorüberschneidungen zugunsten der zuerst geladenen neueren Seite und sortiert stabil nach Zeit/ID. */
export function orderedMessages(pages: ChatMessage[][] | undefined) {
  const unique = new Map<string, ChatMessage>();
  // Newer pages win if a concurrent update makes cursor pages overlap.
  for (const message of (pages ?? []).flat())
    if (!unique.has(message.id)) unique.set(message.id, message);
  return [...unique.values()].sort(
    (a, b) =>
      a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
  );
}
