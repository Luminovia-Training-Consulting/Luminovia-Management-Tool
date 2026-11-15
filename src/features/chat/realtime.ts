import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { chatKeys } from "./api";
/** Realtime payloads are notifications only. Authorised RPCs remain the source of truth. */
export function useChatRealtime(actor: string, room: string | undefined) {
  const client = useQueryClient();
  const [status, setStatus] = useState<"connecting" | "connected" | "retrying">(
    "connecting",
  );
  const statusRef = useRef(status);
  const [revoked, setRevoked] = useState(false);
  useEffect(() => {
    if (!room) return;
    const channel = db()
      .channel(`portal-room-${room}-${actor}`, {
        config: { postgres_changes_options: { wait: true, timeout: 15000 } },
      })
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${room}`,
        },
        () => {
          void client.invalidateQueries({
            queryKey: chatKeys.messages(actor, room),
          });
          void client.invalidateQueries({ queryKey: chatKeys.rooms(actor) });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${room}`,
        },
        () => {
          void client.invalidateQueries({
            queryKey: chatKeys.messages(actor, room),
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_members",
          filter: `user_id=eq.${actor}`,
        },
        (payload) => {
          // Only this actor's own membership row is visible. Drop removed-room data
          // before revalidating the room list; never place realtime bodies in cache.
          if (payload.new.room_id === room && payload.new.removed_at) {
            setRevoked(true);
            client.removeQueries({ queryKey: chatKeys.messages(actor, room) });
            client.removeQueries({ queryKey: chatKeys.members(actor, room) });
          }
          void client.invalidateQueries({ queryKey: chatKeys.rooms(actor) });
        },
      )
      .subscribe((next) => {
        const value = next === "SUBSCRIBED" ? "connected" : "retrying";
        if (value !== statusRef.current) {
          statusRef.current = value;
          setStatus(value);
        }
      });
    return () => {
      void db().removeChannel(channel);
    };
  }, [actor, room, client]);
  return { status, revoked };
}
