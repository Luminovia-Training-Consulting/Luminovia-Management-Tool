/** Realtime carries an opaque course-room change signal. Authorized RPCs own all history. */
import { useEffect, useState } from "react";
import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { db } from "../../lib/supabase";

/**
 * Mount only for an online, already authorised course room. Refresh on attach
 * and reconnect to close the read/subscribe race. The room permission poll
 * remains independent from transport status and message history.
 */
export function useCourseChatLive(actor: string, run: string, room: string) {
  const client = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const backend = db();
    let active = true;
    let subscribed = false;

    function refreshQueue(queryKey: QueryKey) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let queued = false;
      let running = false;

      function schedule() {
        if (!active || !queued || running || timer !== undefined) return;
        timer = setTimeout(() => {
          timer = undefined;
          if (!active) return;
          running = true;
          queued = false;
          const wasFetching =
            client.isFetching({ queryKey, type: "active" }) > 0;
          // An existing read may have started before the signal. Let it finish
          // and then revalidate once more so it cannot swallow the change.
          void client
            .invalidateQueries({ queryKey }, { cancelRefetch: false })
            .then(() => {
              running = false;
              queued ||= wasFetching;
              schedule();
            });
        }, 150);
      }

      return {
        refresh() {
          queued = true;
          schedule();
        },
        cancel() {
          clearTimeout(timer);
        },
      };
    }

    const rooms = refreshQueue(["course-chat-rooms", actor, run]);
    const history = refreshQueue(["course-chat-messages", actor, run, room]);
    const refresh = () => {
      rooms.refresh();
      history.refresh();
    };
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
        if (!active) return;
        const next = status === "SUBSCRIBED";
        if (next !== subscribed) {
          subscribed = next;
          setConnected(next);
          refresh();
        }
      });

    return () => {
      active = false;
      rooms.cancel();
      history.cancel();
      void backend.removeChannel(channel);
    };
  }, [actor, run, room, client]);

  return connected;
}
