/** Actor- and room-scoped topic-pin RPCs; existing history prefix clears data on revocation. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { chatKeys } from "./api";

export interface TopicPinnedMessage {
  id: string;
  sender_name: string;
  body: string;
  created_at: string;
}

/** Sharing the room history prefix ensures Realtime revocation removes both caches. */
export function useTopicMessagePins(
  actor: string,
  room: string,
  enabled: boolean,
) {
  const client = useQueryClient();
  const key = [
    ...chatKeys.messages(actor, room),
    { kind: "topic-message-pins" },
  ] as const;
  const query = useQuery({
    queryKey: key,
    enabled,
    staleTime: 0,
    refetchInterval: 10000,
    queryFn: async () => {
      requireOnline();
      const { data, error } = await db().rpc("chat_topic_pinned_messages", {
        p_room_id: room,
      });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("invalid_pin_projection");
      return data as TopicPinnedMessage[];
    },
  });
  const toggle = useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => {
      requireOnline();
      const { error } = await db().rpc("set_chat_topic_message_pin", {
        p_message_id: id,
        p_pinned: pinned,
      });
      if (error) throw error;
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: chatKeys.messages(actor, room) }),
  });
  return { query, toggle };
}
