/** Realtime carries an opaque course-room change signal. Authorized RPCs own all history. */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { db } from "../../lib/supabase";

/**
 * Mount only for an online, already authorised course room. An initial
 * subscription refresh closes the history-read/subscribe race. Polling in
 * CourseChat still revalidates access even when no signal can reach this actor.
 */
export function useCourseChatLive(actor: string, run: string, room: string) {
  const client = useQueryClient();
  useEffect(() => {
    const backend = db();
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function refresh() {
      if (!active || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (!active) return;
        void client.invalidateQueries({
          queryKey: ["course-chat-rooms", actor, run],
        });
        void client.invalidateQueries({
          queryKey: ["course-chat-messages", actor, run, room],
        });
      }, 150);
    }

    const filter = {
      schema: "public",
      table: "course_chat_activity",
      filter: `room_id=eq.${room}`,
    };
    const channel = backend
      .channel(`course-chat-activity-${crypto.randomUUID()}`, {
        config: { postgres_changes_options: { wait: true, timeout: 15000 } },
      })
      .on("postgres_changes", { ...filter, event: "INSERT" }, refresh)
      .on("postgres_changes", { ...filter, event: "UPDATE" }, refresh)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });

    return () => {
      active = false;
      clearTimeout(timer);
      void backend.removeChannel(channel);
    };
  }, [actor, run, room, client]);
}
