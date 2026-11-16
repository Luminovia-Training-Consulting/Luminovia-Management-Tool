import { Fragment, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Pencil, SmilePlus, Trash2 } from "lucide-react";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { chatKeys } from "./api";
import type { ChatMessage } from "./types";
import "./i18n";
import { TaskFromMessageAction } from "../workbench/message-action";
const editSchema = z.object({ body: z.string().max(8000) });
const quickReactions = ["👍", "❤️", "🎉", "💡", "👀", "✅"];
/** Text is never interpreted as HTML. Only explicit HTTP(S) links become anchors. */
export function MessageText({ body }: { body: string }) {
  return (
    <>
      {body.split(/(https?:\/\/[^\s<>]+)/g).map((part, index) => {
        if (!/^https?:\/\//.test(part))
          return <Fragment key={index}>{part}</Fragment>;
        try {
          const url = new URL(part);
          if (url.protocol === "http:" || url.protocol === "https:")
            return (
              <a
                key={index}
                href={url.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {part}
              </a>
            );
        } catch {
          /* Preserve malformed input as text. */
        }
        return <Fragment key={index}>{part}</Fragment>;
      })}
    </>
  );
}
export function MessageBubble({
  message,
  actor,
  zone,
  attachment,
  now,
}: {
  message: ChatMessage;
  actor: string;
  zone: string;
  attachment?: ReactNode;
  now: number;
}) {
  const { t, i18n } = useTranslation("chat");
  const common = useTranslation().t;
  const client = useQueryClient();
  const online = useOnline();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const own = message.sender_id === actor;
  const canEdit =
    own &&
    !message.deleted_at &&
    now - new Date(message.created_at).getTime() < 15 * 60_000;
  const form = useForm<z.infer<typeof editSchema>>({
    resolver: zodResolver(editSchema),
    defaultValues: { body: message.body },
  });
  const invalidate = () =>
    Promise.all([
      client.invalidateQueries({
        queryKey: chatKeys.messages(actor, message.room_id),
      }),
      client.invalidateQueries({ queryKey: chatKeys.rooms(actor) }),
    ]);
  const edit = useMutation({
    mutationFn: async (values: z.infer<typeof editSchema>) => {
      requireOnline();
      if (!values.body.trim() && !message.document_id)
        throw new Error("empty_message");
      const { error } = await db().rpc("edit_message", {
        p_message_id: message.id,
        p_body: values.body.trim(),
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await invalidate();
      setEditing(false);
    },
  });
  const remove = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { error } = await db().rpc("delete_message", {
        p_message_id: message.id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await invalidate();
      setDeleting(false);
    },
  });
  const react = useMutation({
    mutationFn: async ({
      emoji,
      remove,
    }: {
      emoji: string;
      remove: boolean;
    }) => {
      requireOnline();
      const { error } = await db().rpc("react_to_message", {
        p_message_id: message.id,
        p_emoji: emoji,
        p_remove: remove,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  const time = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: zone,
  }).format(new Date(message.created_at));
  return (
    <li
      className={`chat-message ${own ? "chat-message-own" : ""}`}
      data-message-id={message.id}
    >
      <div className="chat-message-avatar" aria-hidden="true">
        {(message.sender_name || "?").slice(0, 1).toUpperCase()}
      </div>
      <article
        className="chat-message-card"
        aria-label={`${message.sender_name || t("unnamed")} · ${time}`}
      >
        <header>
          <strong>
            {own ? t("yourMessage") : message.sender_name || t("unnamed")}
          </strong>
          <time dateTime={message.created_at}>{time}</time>
          {message.edited_at && !message.deleted_at && (
            <span>{t("edited")}</span>
          )}
        </header>
        {message.deleted_at ? (
          <p className="chat-tombstone">{t("deleted")}</p>
        ) : (
          <>
            <p className="chat-message-body">
              <MessageText body={message.body} />
            </p>
            {attachment}
            <div className="chat-message-footer">
              <div
                className="chat-reactions"
                role="group"
                aria-label={t("reactions")}
              >
                {(message.reactions ?? []).map((reaction) => (
                  <button
                    key={reaction.emoji}
                    type="button"
                    className={reaction.mine ? "is-mine" : ""}
                    aria-label={`${reaction.emoji} ${reaction.count} · ${t(reaction.mine ? "reactionRemove" : "reactionAdd", { emoji: reaction.emoji })}`}
                    aria-pressed={reaction.mine}
                    onClick={() =>
                      react.mutate({
                        emoji: reaction.emoji,
                        remove: reaction.mine,
                      })
                    }
                    disabled={!online || react.isPending}
                  >
                    <span>{reaction.emoji}</span> <span>{reaction.count}</span>
                  </button>
                ))}
              </div>
              <div
                className="chat-message-actions"
                role="group"
                aria-label={t("messageActions")}
              >
                <TaskFromMessageAction messageId={message.id} />
                <details className="chat-reaction-menu">
                  <summary aria-label={t("reactions")}>
                    <SmilePlus size={16} />
                  </summary>
                  <div>
                    {quickReactions.map((emoji) => {
                      const mine =
                        message.reactions?.some(
                          (reaction) =>
                            reaction.emoji === emoji && reaction.mine,
                        ) ?? false;
                      return (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => react.mutate({ emoji, remove: mine })}
                          disabled={!online || react.isPending}
                          aria-label={t(
                            mine ? "reactionRemove" : "reactionAdd",
                            { emoji },
                          )}
                        >
                          {emoji}
                        </button>
                      );
                    })}
                  </div>
                </details>
                {canEdit && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("edit")}
                    onClick={() => {
                      form.reset({ body: message.body });
                      edit.reset();
                      setEditing(true);
                    }}
                    disabled={!online}
                  >
                    <Pencil size={15} />
                  </Button>
                )}
                {own && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("delete")}
                    onClick={() => {
                      remove.reset();
                      setDeleting(true);
                    }}
                    disabled={!online}
                  >
                    <Trash2 size={15} />
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
        {react.isError && <Notice kind="error">{t("actionError")}</Notice>}
      </article>
      <Dialog
        open={editing}
        onOpenChange={setEditing}
        title={t("edit")}
        description={t("editHint")}
      >
        <form
          noValidate
          onSubmit={form.handleSubmit((values) => edit.mutate(values))}
        >
          <Field
            id={`edit-${message.id}`}
            label={t("message")}
            error={Boolean(form.formState.errors.body)}
          >
            <textarea
              id={`edit-${message.id}`}
              rows={5}
              maxLength={8000}
              {...form.register("body")}
              disabled={edit.isPending}
            />
          </Field>
          <Button disabled={!online || edit.isPending}>{common("save")}</Button>
          {edit.isError && <Notice kind="error">{t("actionError")}</Notice>}
        </form>
      </Dialog>
      <Dialog
        open={deleting}
        onOpenChange={setDeleting}
        title={t("deleteConfirm")}
        description={t("deleteHint")}
      >
        <p className="chat-delete-preview">{message.body}</p>
        <div className="form-actions">
          <Button
            variant="secondary"
            onClick={() => setDeleting(false)}
            disabled={remove.isPending}
          >
            {common("cancel")}
          </Button>
          <Button
            variant="danger"
            onClick={() => remove.mutate()}
            disabled={!online || remove.isPending}
          >
            {t("delete")}
          </Button>
        </div>
        {remove.isError && <Notice kind="error">{t("actionError")}</Notice>}
      </Dialog>
    </li>
  );
}
