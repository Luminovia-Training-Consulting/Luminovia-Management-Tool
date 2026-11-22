/** Participant course rooms use scoped history, scan-gated uploads and confirmed posting. */
import { useRequestKey } from "../../lib/request-key";
import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { db } from "../../lib/supabase";
import { portalInternalEdition } from "../../lib/installation-brand";
import { requireOnline, useOnline } from "../../lib/online";
import {
  acceptedFiles,
  uploadAcademyCourseChatAttachment,
  uploadDocument,
} from "../files/api";
import {
  CourseChatAttachment,
  type CourseChatFile,
} from "./course-chat-attachment";
import { useCourseChatLive } from "./course-chat-live";
import { CourseChatProtection } from "./course-chat-protection";
import "./course-chat-i18n";

type Room = { id: string; title: string | null; can_post: boolean };
type Message = {
  id: string;
  sender_id: string;
  sender_name: string;
  body: string | null;
  created_at: string;
  deleted_at: string | null;
  attachment: CourseChatFile | null;
};
const messagesPerPage = 50;

/** Resolve room access independently from message history and drop the thread on denial. */
export function CourseChat({
  run,
  actor,
  canCreate = false,
  showProtection = false,
  readOnly = false,
}: {
  run: string;
  actor: string;
  canCreate?: boolean;
  showProtection?: boolean;
  readOnly?: boolean;
}) {
  const { t } = useTranslation("courseChat");
  const online = useOnline();
  const client = useQueryClient();
  const createRoom = useMutation({
    mutationFn: async ({ run }: { run: string; actor: string }) => {
      requireOnline();
      const { data, error } = await db().rpc("academy_ensure_course_chat", {
        p_run_id: run,
      });
      if (error || !data) throw error ?? new Error("unconfirmed");
    },
    onSuccess: (_, { run, actor }) =>
      client.invalidateQueries({ queryKey: ["course-chat-rooms", actor, run] }),
  });
  const roomField = useId();
  const [selected, setSelected] = useState<string | null>(null);
  const rooms = useQuery({
    queryKey: ["course-chat-rooms", actor, run],
    enabled: online,
    queryFn: async () => {
      const { data, error } = await db().rpc("course_chat_rooms", {
        p_run_id: run,
      });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("invalid_course_chat_rooms");
      return data as Room[];
    },
    staleTime: 0,
    // The open course is revalidated frequently. Discard its private cache on exit.
    gcTime: 0,
    retry: false,
    refetchInterval: 3000,
  });
  const room =
    rooms.data?.find((candidate) => candidate.id === selected) ??
    rooms.data?.[0];
  return (
    <section
      id="course-chat"
      className="panel learning-panel"
      aria-label={t("title")}
    >
      <h2>{t("title")}</h2>
      {showProtection && (
        <CourseChatProtection key={`${actor}:${run}`} actor={actor} run={run} />
      )}
      {!online || rooms.isError ? (
        <Notice kind="error">{t("unavailable")}</Notice>
      ) : rooms.isPending ? (
        <Loading />
      ) : !room ? (
        <>
          <p>{t("emptyRooms")}</p>
          {canCreate && !readOnly && (
            <Button
              type="button"
              disabled={createRoom.isPending}
              onClick={() => createRoom.mutate({ run, actor })}
            >
              {t("create")}
            </Button>
          )}
          {createRoom.isError && (
            <Notice kind="error">{t("createFailed")}</Notice>
          )}
        </>
      ) : (
        <>
          {rooms.data.length > 1 && (
            <Field id={roomField} label={t("title")}>
              <select
                id={roomField}
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
          <CourseChatThread
            key={room.id}
            room={room}
            actor={actor}
            run={run}
            readOnly={readOnly}
          />
        </>
      )}
    </section>
  );
}

/** The thread owns its draft, including upload/request IDs. Switching rooms
 * unmounts the previous draft, avoiding cross-room file and retry reuse. */
function CourseChatThread({
  room,
  run,
  actor,
  readOnly,
}: {
  room: Room;
  run: string;
  actor: string;
  readOnly: boolean;
}) {
  const { t, i18n } = useTranslation("courseChat");
  const client = useQueryClient();
  const heading = useRef<HTMLHeadingElement>(null);
  const messageField = useId();
  const attachmentField = useId();
  const [body, setBody] = useState("");
  const [before, setBefore] = useState<{ at: string; id: string } | null>(null);
  const [attachment, setAttachment] = useState<{
    id: string;
    version: string;
    name: string;
  } | null>(null);
  const [progress, setProgress] = useState(0);
  const [invalidDrop, setInvalidDrop] = useState(false);
  const uploadRetry = useRef<{ file: File; key: string } | null>(null);
  const retry = useRequestKey();
  const historyKey = ["course-chat-messages", actor, run, room.id];
  useCourseChatLive(actor, run, room.id);
  const messages = useQuery({
    queryKey: [...historyKey, before],
    queryFn: async () => {
      const { data, error } = await db().rpc("course_chat_messages", {
        p_room_id: room.id,
        p_before_at: before?.at ?? null,
        p_before_id: before?.id ?? null,
        p_limit: messagesPerPage + 1,
      });
      if (error) throw error;
      if (!Array.isArray(data)) throw new Error("invalid_course_chat_messages");
      // SQL returns the window oldest-first. One look-ahead row means an
      // older page exists, without loading unbounded history into the browser.
      return {
        items: data.slice(-messagesPerPage) as Message[],
        more: data.length > messagesPerPage,
      };
    },
    staleTime: 0,
    // The open course is revalidated frequently. Discard its private cache on exit.
    gcTime: 0,
    retry: false,
    refetchInterval: 3000,
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      requireOnline();
      if (!room.can_post) throw new Error("room_unavailable");
      setProgress(0);
      if (uploadRetry.current?.file !== file)
        uploadRetry.current = { file, key: crypto.randomUUID() };
      const document = portalInternalEdition
        ? await uploadDocument(
            file,
            {
              scope: "room",
              roomId: room.id,
              clientId: uploadRetry.current.key,
              messageOnly: true,
              courseChat: true,
            },
            setProgress,
          )
        : await uploadAcademyCourseChatAttachment(
            file,
            room.id,
            uploadRetry.current.key,
            setProgress,
          );
      if (!document.current_version_id) throw new Error("version_unavailable");
      return {
        id: document.id,
        version: document.current_version_id,
        name: document.original_name,
      };
    },
    onSuccess: (document) => {
      uploadRetry.current = null;
      setAttachment(document);
    },
  });
  const send = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (!room.can_post) throw new Error("room_unavailable");
      const text = body.trim();
      if ((!text && !attachment) || text.length > 8000)
        throw new Error("invalid_message");
      const signature = JSON.stringify([
        text,
        attachment?.id,
        attachment?.version,
      ]);
      const retryId = retry.forInput(signature);
      const args = {
        p_room_id: room.id,
        p_body: text,
        p_client_id: retryId,
      };
      const { data, error } = attachment
        ? await db().rpc("send_course_chat_attachment", {
            ...args,
            p_document_id: attachment.id,
            p_version_id: attachment.version,
          })
        : await db().rpc("send_course_chat_message", args);
      if (error || !data) throw error ?? new Error("unconfirmed");
    },
    onSuccess: async () => {
      retry.clear();
      setBefore(null);
      setBody("");
      setAttachment(null);
      setInvalidDrop(false);
      upload.reset();
      await client.invalidateQueries({ queryKey: historyKey });
    },
  });
  const busy = send.isPending || upload.isPending;

  /** Both the keyboard-accessible picker and drag/drop start the same upload. */
  function selectAttachment(files: FileList | null) {
    if (readOnly || !room.can_post || !files?.length || busy || attachment)
      return;
    setInvalidDrop(files.length !== 1);
    if (files.length === 1) upload.mutate(files[0]);
  }
  return (
    <>
      <h3 ref={heading} tabIndex={-1}>
        {room.title || t("title")}
      </h3>
      <p aria-live="polite" className="muted">
        {t(before ? "earlier" : "latest")}
      </p>
      {(messages.data?.more || before) && (
        <div className="form-actions">
          {messages.isSuccess && messages.data.more && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const oldest = messages.data.items[0];
                setBefore({ at: oldest.created_at, id: oldest.id });
                heading.current?.focus();
              }}
            >
              {t("olderMessages")}
            </Button>
          )}
          {before && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setBefore(null);
                heading.current?.focus();
              }}
            >
              {t("latestMessages")}
            </Button>
          )}
        </div>
      )}
      {messages.isPending ? (
        <Loading />
      ) : messages.isError ? (
        <ErrorState retry={() => void messages.refetch()} />
      ) : !messages.data.items.length ? (
        <p>{t("emptyMessages")}</p>
      ) : (
        <ol className="course-chat-messages">
          {messages.data.items.map((message) => (
            <li key={message.id}>
              <strong>{message.sender_name}</strong>
              <time dateTime={message.created_at}>
                {new Intl.DateTimeFormat(i18n.language, {
                  dateStyle: "short",
                  timeStyle: "short",
                }).format(new Date(message.created_at))}
              </time>
              {message.deleted_at ? (
                <p>{t("deleted")}</p>
              ) : (
                message.body && <p>{message.body}</p>
              )}
              {!message.deleted_at && message.attachment && (
                <CourseChatAttachment
                  key={message.attachment.version_id}
                  message={message.id}
                  attachment={message.attachment}
                />
              )}
            </li>
          ))}
        </ol>
      )}
      {readOnly || !room.can_post ? (
        <p className="muted">{t("readOnly")}</p>
      ) : (
        messages.isSuccess && (
          <form
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes("Files"))
                event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              selectAttachment(event.dataTransfer.files);
            }}
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && !upload.isError) send.mutate();
            }}
          >
            <Field id={messageField} label={t("message")}>
              <textarea
                id={messageField}
                value={body}
                maxLength={8000}
                onChange={(event) => setBody(event.target.value)}
                disabled={busy}
              />
            </Field>
            {attachment ? (
              <p>
                {attachment.name}{" "}
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setAttachment(null)}
                >
                  {t("removeAttachment")}
                </Button>
              </p>
            ) : (
              <Field id={attachmentField} label={t("attach")}>
                <input
                  id={attachmentField}
                  type="file"
                  accept={acceptedFiles}
                  disabled={busy}
                  onChange={(event) => {
                    selectAttachment(event.currentTarget.files);
                    event.currentTarget.value = "";
                  }}
                />
              </Field>
            )}
            {invalidDrop && (
              <Notice kind="error">{t("singleAttachment")}</Notice>
            )}
            {upload.isPending && (
              <p role="status">{t("scanProgress", { progress })}</p>
            )}
            {upload.isError && (
              <>
                <Notice kind="error">{t("uploadFailed")}</Notice>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    if (uploadRetry.current)
                      upload.mutate(uploadRetry.current.file);
                  }}
                >
                  {t("retryUpload")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    uploadRetry.current = null;
                    upload.reset();
                  }}
                >
                  {t("removeAttachment")}
                </Button>
              </>
            )}
            <Button
              disabled={busy || upload.isError || (!body.trim() && !attachment)}
            >
              {t("send")}
            </Button>
            {send.isError && (
              <Notice kind="error">
                {t(
                  send.error &&
                    typeof send.error === "object" &&
                    "code" in send.error &&
                    send.error.code === "PT429"
                    ? "protectionRateLimit"
                    : "failed",
                )}
              </Notice>
            )}
          </form>
        )
      )}
    </>
  );
}
