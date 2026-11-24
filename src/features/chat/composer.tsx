/**
 * Message drafts with validated text, attachments and confirmed sending. Retain request IDs for
 * retry and reference uploaded documents only after scan clearance.
 */
import { useRequestKey } from "../../lib/request-key";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { LoaderCircle, Paperclip, Send, X } from "lucide-react";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { uploadDocument } from "../files/api";
import { chatKeys } from "./api";
import { MentionPicker } from "./mentions";
import type { ChatMention } from "./types";
import "./i18n";

/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const messageSchema = z.object({ body: z.string().max(8000) });
/** Guide the browser file picker; the server independently checks MIME type, magic bytes, size and scanning. */
const acceptedFiles = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx,.xlsx,.pptx";

/** Send text and clean attachments as a retryable operation; retain local input until confirmation. */
export function MessageComposer({
  actor,
  room,
  replyId,
  draft = "",
  onDraftChange,
  replyTarget,
  onCancelReply,
}: {
  actor: string;
  room: string;
  replyId?: string | null;
  draft?: string;
  onDraftChange?: (text: string, sentText?: string) => void;
  replyTarget?: import("./types").ChatMessage;
  onCancelReply?: () => void;
}) {
  const { t } = useTranslation("chat");
  const online = useOnline();
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  // Sending and uploading are separate operations with separate retry identities.
  // An uncertain outcome keeps the same identity for unchanged content; changed input starts a new operation.
  const retry = useRequestKey();
  const uploadRetry = useRequestKey();
  const [attachment, setAttachment] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [progress, setProgress] = useState(0);
  const [mentions, setMentions] = useState<ChatMention[]>([]);
  const [dragging, setDragging] = useState(false);
  const [badDrop, setBadDrop] = useState(false);
  const [empty, setEmpty] = useState(false);
  const form = useForm<z.infer<typeof messageSchema>>({
    resolver: zodResolver(messageSchema),
    defaultValues: { body: draft },
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      requireOnline();
      setProgress(0);
      const signature = JSON.stringify([
        room,
        file.name,
        file.size,
        file.lastModified,
      ]);
      const uploadRetryId = uploadRetry.forInput(signature);
      return uploadDocument(
        file,
        {
          scope: "room",
          roomId: room,
          clientId: uploadRetryId,
          messageOnly: true,
        },
        setProgress,
      );
    },
    onSuccess: (document) => {
      uploadRetry.clear();
      setAttachment({ id: document.id, name: document.original_name });
    },
  });
  const send = useMutation({
    mutationFn: async (values: z.infer<typeof messageSchema>) => {
      requireOnline();
      setEmpty(false);
      const body = values.body.trim();
      if (!body && !attachment) {
        setEmpty(true);
        throw new Error("empty_message");
      }
      const ids = mentions.map((person) => person.user_id).sort();
      const signature = JSON.stringify([
        room,
        body,
        attachment?.id ?? null,
        ids,
        replyId ?? null,
      ]);
      const retryId = retry.forInput(signature);
      if (replyId && (!replyTarget || replyTarget.deleted_at))
        throw new Error("reply_unavailable");
      const args = {
        p_room_id: room,
        p_body: body,
        p_client_id: retryId,
        p_document_id: attachment?.id ?? null,
        p_mention_ids: ids,
      };
      const { data, error } = replyId
        ? await db().rpc("send_chat_reply", { ...args, p_reply_to_id: replyId })
        : await db().rpc("send_message_with_mentions", args);
      if (error || !data) throw error ?? new Error("unconfirmed");
      return data;
    },
    onSuccess: async (_, values) => {
      retry.clear();
      form.reset({ body: "" });
      onDraftChange?.("", values.body);
      setAttachment(null);
      setMentions([]);
      onCancelReply?.();
      upload.reset();
      await Promise.all([
        client.invalidateQueries({ queryKey: chatKeys.messages(actor, room) }),
        client.invalidateQueries({ queryKey: chatKeys.rooms(actor) }),
      ]);
    },
  });
  const busy = send.isPending || upload.isPending;
  return (
    <form
      className={`chat-composer ${dragging ? "is-dragging" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        if (online && !busy && !attachment) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        )
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!online || busy || attachment) return;
        const files = Array.from(event.dataTransfer.files);
        if (files.length !== 1) {
          setBadDrop(true);
          return;
        }
        setBadDrop(false);
        send.reset();
        upload.mutate(files[0]);
      }}
      noValidate
      onSubmit={form.handleSubmit((values) => send.mutate(values))}
    >
      {replyId && (
        <div className="chat-reply-draft">
          <span>
            {replyTarget && !replyTarget.deleted_at
              ? t("replyingTo", { name: replyTarget.sender_name })
              : t("replyUnavailable")}
          </span>
          {replyTarget && !replyTarget.deleted_at && (
            <p>{replyTarget.body.slice(0, 200)}</p>
          )}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("cancelReply")}
            disabled={busy}
            onClick={onCancelReply}
          >
            <X size={16} />
          </Button>
        </div>
      )}
      <Field
        id="chat-message-body"
        label={t("message")}
        error={Boolean(form.formState.errors.body) || empty}
      >
        <textarea
          id="chat-message-body"
          rows={2}
          maxLength={8000}
          {...form.register("body", {
            onChange: (event) => onDraftChange?.(event.target.value),
          })}
          disabled={busy}
          placeholder={t("message")}
        />
      </Field>

      {attachment && (
        <div className="chat-draft-attachment">
          <Paperclip size={16} />
          <span>{attachment.name}</span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t("removeAttachment")}
            onClick={() => {
              setAttachment(null);
              upload.reset();
            }}
            disabled={busy}
          >
            <X size={16} />
          </Button>
        </div>
      )}
      {upload.isPending && (
        <div className="chat-upload-state" role="status">
          <LoaderCircle className="spin" size={17} />
          {t("attachmentScanning", { progress: Math.round(progress) })}
        </div>
      )}
      <div className="chat-composer-actions">
        <MentionPicker
          actor={actor}
          room={room}
          value={mentions}
          onChange={setMentions}
          disabled={busy}
        />
        <input
          ref={input}
          hidden
          type="file"
          accept={acceptedFiles}
          aria-label={t("attachment")}
          disabled={!online || busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) {
              setBadDrop(false);
              send.reset();
              upload.mutate(file);
            }
          }}
        />
        <Button
          type="button"
          variant="secondary"
          onClick={() => input.current?.click()}
          disabled={!online || busy || Boolean(attachment)}
        >
          <Paperclip size={17} />
          {t("attachment")}
        </Button>
        <small>{online ? t("attachmentHint") : t("onlineOnly")}</small>
        <Button
          disabled={
            !online ||
            busy ||
            Boolean(replyId && (!replyTarget || replyTarget.deleted_at))
          }
        >
          <Send size={17} />
          {t(send.isPending ? "sending" : "send")}
        </Button>
      </div>
      {badDrop && <Notice kind="error">{t("oneFileDrop")}</Notice>}
      {send.isSuccess && <Notice>{t("sent")}</Notice>}
      {send.isError && !empty && <Notice kind="error">{t("sendError")}</Notice>}
      {upload.isError && <Notice kind="error">{t("attachmentFailed")}</Notice>}
    </form>
  );
}
