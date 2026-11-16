/**
 * Lifetime-scoped subscription for one actor and room. Events batch authorized refetches;
 * observed membership revocation immediately discards room data and stops pending refreshes.
 */
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { chatKeys } from "./api";
/**
 * Treat Realtime payloads as refetch signals; authorized RPCs remain authoritative. Observe one room,
 * batch refreshes and dispose timers/subscription on actor or room changes.
 */
export function useChatRealtime(actor: string, room: string | undefined) {
  const client = useQueryClient();
  const [status, setStatus] = useState<"connecting" | "connected" | "retrying">(
    "connecting",
  );
  const statusRef = useRef(status);
  const [revoked, setRevoked] = useState(false);
  useEffect(() => {
    if (!room) return;
    let active = true;
    let accessRevoked = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let messagesPending = false;
    let roomsPending = false;
    const cancelRefresh = () => {
      if (refreshTimer !== undefined) clearTimeout(refreshTimer);
      refreshTimer = undefined;
      messagesPending = false;
      roomsPending = false;
    };
    // The first notification sets a short, fixed deadline. Later events share
    // that refresh, so a busy stream neither restarts every history-page request
    // nor postpones authorised revalidation indefinitely.
    const refresh = (messages: boolean, rooms: boolean) => {
      if (!active || accessRevoked) return;
      messagesPending ||= messages;
      roomsPending ||= rooms;
      if (refreshTimer !== undefined) return;
      refreshTimer = setTimeout(() => {
        const messageRefresh = messagesPending;
        const roomRefresh = roomsPending;
        cancelRefresh();
        if (!active || accessRevoked) return;
        if (messageRefresh)
          void client.invalidateQueries({
            queryKey: chatKeys.messages(actor, room),
          });
        if (roomRefresh)
          void client.invalidateQueries({ queryKey: chatKeys.rooms(actor) });
      }, 150);
    };
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
        () => refresh(true, true),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `room_id=eq.${room}`,
        },
        () => refresh(true, false),
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
          if (!active) return;
          // Only this actor's own membership row is visible. Drop removed-room data
          // before revalidating the room list; never place realtime bodies in cache.
          if (payload.new.room_id === room && payload.new.removed_at) {
            accessRevoked = true;
            cancelRefresh();
            setRevoked(true);
            client.removeQueries({ queryKey: chatKeys.messages(actor, room) });
            client.removeQueries({ queryKey: chatKeys.members(actor, room) });
            void client.invalidateQueries({ queryKey: chatKeys.rooms(actor) });
            return;
          }
          refresh(false, true);
        },
      )
      .subscribe((next) => {
        if (!active) return;
        const value = next === "SUBSCRIBED" ? "connected" : "retrying";
        if (value !== statusRef.current) {
          statusRef.current = value;
          setStatus(value);
        }
      });
    return () => {
      active = false;
      cancelRefresh();
      void db().removeChannel(channel);
    };
  }, [actor, room, client]);
  return { status, revoked };
}
