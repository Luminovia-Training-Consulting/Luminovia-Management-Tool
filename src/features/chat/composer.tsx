/**
 * Nachrichtenentwurf mit validiertem Text, Anhängen und bestätigtem Versand. Anfragekennungen bleiben für Wiederholungen erhalten; hochgeladene Dokumente werden erst nach Scanfreigabe referenziert.
 */
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
import "./i18n";
/** Lokale Eingabegrenzen des Fachformulars; Rechte, Fremdschlüssel und verbindliche Zustandsregeln prüft der Server zusätzlich. */
const messageSchema = z.object({ body: z.string().max(8000) });
/** Dateiauswahlhilfe des Browsers; MIME, Magic Bytes, Größe und Scan werden unabhängig davon auf dem Server geprüft. */
const acceptedFiles = ".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx,.xlsx,.pptx";
/** Sendet Text und saubere Anhänge mit einer wiederholbaren Operation; lokale Eingaben bleiben bis zur Bestätigung erhalten. */
export function MessageComposer({
  actor,
  room,
}: {
  actor: string;
  room: string;
}) {
  const { t } = useTranslation("chat");
  const online = useOnline();
  const client = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  // Versand- und Uploadkennung gehören zu getrennten Operationen. Bei unklarem
  // Abschluss behält derselbe Inhalt seine Kennung; geänderte Eingaben beginnen neu.
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const uploadRetry = useRef<{ signature: string; key: string } | null>(null);
  const [attachment, setAttachment] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [progress, setProgress] = useState(0);
  const [empty, setEmpty] = useState(false);
  const form = useForm<z.infer<typeof messageSchema>>({
    resolver: zodResolver(messageSchema),
    defaultValues: { body: "" },
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
      if (!uploadRetry.current || uploadRetry.current.signature !== signature)
        uploadRetry.current = { signature, key: crypto.randomUUID() };
      return uploadDocument(
        file,
        { scope: "room", roomId: room, clientId: uploadRetry.current.key },
        setProgress,
      );
    },
    onSuccess: (document) => {
      uploadRetry.current = null;
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
      const signature = JSON.stringify([room, body, attachment?.id ?? null]);
      if (!retry.current || retry.current.signature !== signature)
        retry.current = { signature, key: crypto.randomUUID() };
      const { data, error } = await db().rpc("send_message", {
        p_room_id: room,
        p_body: body,
        p_client_id: retry.current.key,
        p_document_id: attachment?.id ?? null,
      });
      if (error || !data) throw error ?? new Error("unconfirmed");
      return data;
    },
    onSuccess: async () => {
      retry.current = null;
      form.reset();
      setAttachment(null);
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
      className="chat-composer"
      noValidate
      onSubmit={form.handleSubmit((values) => send.mutate(values))}
    >
      <Field
        id="chat-message-body"
        label={t("message")}
        error={Boolean(form.formState.errors.body) || empty}
        hint={t("messageHint")}
      >
        <textarea
          id="chat-message-body"
          rows={3}
          maxLength={8000}
          {...form.register("body")}
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
        <Button disabled={!online || busy}>
          <Send size={17} />
          {t(send.isPending ? "sending" : "send")}
        </Button>
      </div>
      {send.isSuccess && <Notice>{t("sent")}</Notice>}
      {send.isError && !empty && <Notice kind="error">{t("sendError")}</Notice>}
      {upload.isError && <Notice kind="error">{t("attachmentFailed")}</Notice>}
    </form>
  );
}
