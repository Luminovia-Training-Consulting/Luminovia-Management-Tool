/** Explicit own-room attention state; display only database-confirmed results. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { MailCheck, MailPlus } from "lucide-react";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/common";
import { chatKeys } from "./api";
import type { ChatRoom } from "./types";
import "./room-unread-i18n";
export function RoomUnread({
  actor,
  room,
  selected,
}: {
  actor: string;
  room: ChatRoom;
  selected: boolean;
}) {
  const { t } = useTranslation("chatRoomUnread");
  const online = useOnline();
  const client = useQueryClient();
  const marked = Boolean(room.manual_unread || room.unread_count > 0);
  const action = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { error } = marked
        ? await db().rpc("mark_chat_read", {
            p_room_id: room.id,
            p_message_id: null,
            p_muted: null,
          })
        : await db().rpc("mark_chat_unread", { p_room_id: room.id });
      if (error) throw error;
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: chatKeys.rooms(actor) }),
  });
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t(marked ? "clear" : "mark", { title: room.title })}
        title={
          selected && !marked
            ? t("closeFirst")
            : t(marked ? "clear" : "mark", { title: room.title })
        }
        disabled={!online || action.isPending || (selected && !marked)}
        onClick={() => action.mutate()}
      >
        {marked ? <MailCheck size={16} /> : <MailPlus size={16} />}
      </Button>
      {action.isError && <Notice kind="error">{t("failed")}</Notice>}
    </>
  );
}
