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
  roomPreferences: (actor: string) => ["chat-room-preferences", actor] as const,
  draft: (actor: string, room: string) => ["chat-draft", actor, room] as const,
  contacts: (actor: string) => ["chat-contacts", actor] as const,
  members: (actor: string, room: string) =>
    ["chat-members", actor, room] as const,
  messages: (actor: string, room: string) =>
    ["chat-messages", actor, room] as const,
};
async function readChatRooms() {
  const { data, error } = await db().rpc("chat_rooms_with_manual_unread");
  if (error) throw error;
  return (data ?? []) as ChatRoom[];
}

/** Refresh personal preferences independently of room access checks and message traffic. */
export const chatRoomPreferencesQuery = (actor: string) =>
  queryOptions({
    queryKey: chatKeys.roomPreferences(actor),
    refetchInterval: 30000,
    staleTime: 30000,
    queryFn: async () => {
      const [pins, archives] = await Promise.all([
        db().rpc("chat_pinned_rooms"),
        db().rpc("chat_personal_archives"),
      ]);
      if (pins.error) throw pins.error;
      if (archives.error) throw archives.error;
      return {
        pinOrder: new Map(
          ((pins.data ?? []) as string[]).map((id, order) => [id, order]),
        ),
        archived: new Set((archives.data ?? []) as string[]),
      };
    },
  });

/** Poll the authoritative room list even when personal preferences are delayed or fail. */
export const chatRoomsQuery = (actor: string) =>
  queryOptions({
    queryKey: chatKeys.rooms(actor),
    queryFn: readChatRooms,
    refetchInterval: 3000,
    staleTime: 1000,
  });

/** Apply preferences only to rooms the current directory response still authorizes. */
export function decorateChatRooms(
  rooms: ChatRoom[],
  preferences:
    | { pinOrder: ReadonlyMap<string, number>; archived: ReadonlySet<string> }
    | undefined,
) {
  if (!preferences) return rooms;
  return rooms.map((room) => ({
    ...room,
    personal_archived: preferences.archived.has(room.id),
    pinned: preferences.pinOrder.has(room.id),
    pinOrder: preferences.pinOrder.get(room.id) ?? -1,
  }));
}

/** Observe the same invalidation prefix without fetching personal room metadata. */
export const chatUnreadCountQuery = (actor: string) =>
  queryOptions({
    queryKey: [...chatKeys.rooms(actor), "unread-count"],
    queryFn: async () =>
      (await readChatRooms()).reduce(
        (count, room) => count + Number(room.unread_count),
        0,
      ),
    staleTime: 15000,
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
    queryFn: async ({ pageParam, signal }) => {
      const { data, error, status } = await db()
        .rpc("chat_messages_with_mentions", {
          p_room_id: room,
          p_before_at: pageParam?.at ?? null,
          p_before_id: pageParam?.id ?? null,
          p_search: search,
          p_limit: 40,
        })
        .abortSignal(signal);
      // A room switch, discarded search or revocation can cancel this page between RPCs.
      signal.throwIfAborted();
      if (error) throwPagedReadError(error, status);
      const page = (data ?? []) as ChatMessage[];
      if (!page.length) return page;
      const previews = await db()
        .rpc("chat_reply_previews", {
          p_room_id: room,
          p_message_ids: page.map((item) => item.id),
          p_versions: page.map((item) => item.content_version ?? 1),
        })
        .abortSignal(signal);
      signal.throwIfAborted();
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
    // An infinite-query refresh fetches every loaded page, including reply
    // previews. Back off periodic requests after loading older history.
    refetchInterval: (query) =>
      Math.min(30_000, 10_000 * (query.state.data?.pages.length || 1)),
  });
