/** A text-only participant-course room; all reads and posts recheck live course entitlement. */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import "./course-chat-i18n";

type Room = { id: string; title: string | null };
type Message = {
  id: string;
  sender_id: string;
  sender_name: string;
  body: string | null;
  created_at: string;
  deleted_at: string | null;
};

export function CourseChat({ run, actor }: { run: string; actor: string }) {
  const { t, i18n } = useTranslation("courseChat");
  const online = useOnline();
  const client = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const rooms = useQuery({
    queryKey: ["course-chat-rooms", actor, run],
    queryFn: async () => {
      const { data, error } = await db().rpc("course_chat_rooms", {
        p_run_id: run,
      });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("invalid_course_chat_rooms");
      return data as Room[];
    },
    staleTime: 0,
    refetchInterval: 3000,
  });
  const room =
    rooms.data?.find((candidate) => candidate.id === selected) ??
    rooms.data?.[0];
  const messages = useQuery({
    queryKey: ["course-chat-messages", actor, run, room?.id],
    enabled: Boolean(room?.id && rooms.isSuccess),
    queryFn: async () => {
      const { data, error } = await db().rpc("course_chat_messages", {
        p_room_id: room!.id,
        p_before_at: null,
        p_before_id: null,
        p_limit: 50,
      });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("invalid_course_chat_messages");
      return data as Message[];
    },
    staleTime: 0,
    refetchInterval: 3000,
  });
  const send = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (!room) throw new Error("room_unavailable");
      const text = body.trim();
      if (!text || text.length > 8000) throw new Error("invalid_message");
      const signature = JSON.stringify([room.id, text]);
      if (!retry.current || retry.current.signature !== signature)
        retry.current = { signature, key: crypto.randomUUID() };
      const { data, error } = await db().rpc("send_course_chat_message", {
        p_room_id: room.id,
        p_body: text,
        p_client_id: retry.current.key,
      });
      if (error || !data) throw error ?? new Error("unconfirmed");
    },
    onSuccess: async () => {
      retry.current = null;
      setBody("");
      await client.invalidateQueries({
        queryKey: ["course-chat-messages", actor, run, room?.id],
      });
    },
  });
  return (
    <section
      id="course-chat"
      className="panel learning-panel"
      aria-label={t("title")}
    >
      <h2>{t("title")}</h2>
      {rooms.isPending ? (
        <Loading />
      ) : rooms.isError ? (
        <Notice kind="error">{t("unavailable")}</Notice>
      ) : !room ? (
        <p>{t("emptyRooms")}</p>
      ) : (
        <>
          {rooms.data.length > 1 && (
            <Field id="course-chat-room" label={t("title")}>
              <select
                id="course-chat-room"
                value={room.id}
                onChange={(event) => setSelected(event.target.value)}
              >
                {rooms.data.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.title}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <h3>{room.title || t("title")}</h3>
          <p className="muted">{t("latest")}</p>
          {messages.isPending ? (
            <Loading />
          ) : messages.isError ? (
            <ErrorState retry={() => void messages.refetch()} />
          ) : !messages.data.length ? (
            <p>{t("emptyMessages")}</p>
          ) : (
            <ol className="course-chat-messages">
              {messages.data.map((message) => (
                <li key={message.id}>
                  <strong>{message.sender_name}</strong>
                  <time dateTime={message.created_at}>
                    {new Intl.DateTimeFormat(i18n.language, {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(new Date(message.created_at))}
                  </time>
                  <p>{message.deleted_at ? t("deleted") : message.body}</p>
                </li>
              ))}
            </ol>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              send.mutate();
            }}
          >
            <Field id="course-chat-message" label={t("message")}>
              <textarea
                id="course-chat-message"
                value={body}
                maxLength={8000}
                onChange={(event) => setBody(event.target.value)}
                disabled={!online || send.isPending || messages.isError}
              />
            </Field>
            <Button
              disabled={
                !online || send.isPending || messages.isError || !body.trim()
              }
            >
              {t("send")}
            </Button>
          </form>
          {send.isError && <Notice kind="error">{t("failed")}</Notice>}
        </>
      )}
    </section>
  );
}
