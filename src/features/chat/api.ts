/**
 * Actor-scoped query keys and authorized chat projections. History uses timestamp/ID cursors;
 * Realtime supplements revalidation and never replaces RPC access checks.
 */
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { throwPagedReadError } from "../../lib/paged-read";
import { db } from "../../lib/supabase";
import type {
  ChatContact,
  ChatMember,
  ChatMessage,
  ChatRoom,
  MessageCursor,
} from "./types";

/** Shared cache prefixes for targeted revalidation and immediate removal of a revoked room. */
export const chatKeys = {
  rooms: (actor: string) => ["chat-rooms", actor] as const,
  draft: (actor: string, room: string) => ["chat-draft", actor, room] as const,
  contacts: (actor: string) => ["chat-contacts", actor] as const,
  members: (actor: string, room: string) =>
    ["chat-members", actor, room] as const,
  messages: (actor: string, room: string) =>
    ["chat-messages", actor, room] as const,
};
/** Read the chat_rooms_list server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const chatRoomsQuery = (actor: string) =>
  queryOptions({
    queryKey: chatKeys.rooms(actor),
    queryFn: async () => {
      const [rooms, pins, archives] = await Promise.all([
        db().rpc("chat_rooms_with_manual_unread"),
        db().rpc("chat_pinned_rooms"),
        db().rpc("chat_personal_archives"),
      ]);
      if (rooms.error) throw rooms.error;
      if (pins.error) throw pins.error;
      if (archives.error) throw archives.error;
      const pinOrder = new Map(
        ((pins.data ?? []) as string[]).map((id, order) => [id, order]),
      );
      const archived = new Set((archives.data ?? []) as string[]);
      return ((rooms.data ?? []) as ChatRoom[]).map((room) => ({
        ...room,
        personal_archived: archived.has(room.id),
        pinned: pinOrder.has(room.id),
        pinOrder: pinOrder.get(room.id) ?? -1,
      }));
    },
    refetchInterval: 3000,
    staleTime: 1000,
  });
const chatFacet = z.object({
  room_id: z.uuid(),
  category: z.enum(["company", "staff", "course", "lecturer"]),
  facet_key: z.string().min(1),
  label: z.string().min(1),
});
export type ChatDirectoryFacet = z.infer<typeof chatFacet>;

export const chatDirectoryFiltersQuery = (actor: string) =>
  queryOptions({
    queryKey: ["chat-directory-filters", actor],
    queryFn: async () => {
      const { data, error } = await db().rpc("chat_directory_filters");
      if (error) throw error;
      return z.array(chatFacet).parse(data);
    },
    staleTime: 3000,
    refetchInterval: 5000,
    retry: false,
  });

/** Read the chat_contacts server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const chatContactsQuery = (actor: string) =>
  queryOptions({
    queryKey: chatKeys.contacts(actor),
    queryFn: async () => {
      const { data, error } = await db().rpc("chat_contacts");
      if (error) throw error;
      return (data ?? []) as ChatContact[];
    },
  });
/** Read the chat_room_members server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
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
/** Read the chat_messages server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const chatMessagesQuery = (
  actor: string,
  room: string,
  search: string,
) =>
  infiniteQueryOptions({
    queryKey: [...chatKeys.messages(actor, room), search],
    initialPageParam: null as MessageCursor | null,
    queryFn: async ({ pageParam }) => {
      const { data, error, status } = await db().rpc(
        "chat_messages_with_mentions",
        {
          p_room_id: room,
          p_before_at: pageParam?.at ?? null,
          p_before_id: pageParam?.id ?? null,
          p_search: search,
          p_limit: 40,
        },
      );
      if (error) throwPagedReadError(error, status);
      const page = (data ?? []) as ChatMessage[];
      if (!page.length) return page;
      const previews = await db().rpc("chat_reply_previews", {
        p_room_id: room,
        p_message_ids: page.map((item) => item.id),
        p_versions: page.map((item) => item.content_version ?? 1),
      });
      if (previews.error) throwPagedReadError(previews.error, previews.status);
      const lookup = (previews.data ?? {}) as Record<
        string,
        ChatMessage["reply"]
      >;
      return page.map((item) =>
        Object.hasOwn(lookup, item.id)
          ? { ...item, reply: lookup[item.id] }
          : item,
      );
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
