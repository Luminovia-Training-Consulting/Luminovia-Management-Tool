/** Member-scoped group information and conflict-safe owner edits. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { chatKeys } from "./api";
import "./group-settings-i18n";

interface Settings {
  title: string;
  description: string;
  version: number;
}

export function GroupSettings({
  actor,
  room,
  canManage,
  open,
  onOpenChange,
}: {
  actor: string;
  room: string;
  canManage: boolean;
  open: boolean;
  onOpenChange: (value: boolean) => void;
}) {
  const { t } = useTranslation("chatGroupSettings");
  const online = useOnline();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["chat-group-settings", actor, room],
    enabled: open,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await db().rpc("chat_group_settings", {
        p_room_id: room,
      });
      if (error) throw error;
      return data as Settings;
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        if (!next && editing && !window.confirm(t("discard"))) return;
        if (!next) setEditing(false);
        onOpenChange(next);
      }}
      title={t("title")}
      description={t("hint")}
    >
      {settings.isPending ? (
        <Loading />
      ) : settings.isError ? (
        <ErrorState retry={() => void settings.refetch()} />
      ) : (
        <SettingsContent
          key={room}
          room={room}
          canManage={canManage}
          editing={editing}
          setEditing={setEditing}
          setPending={setPending}
          initial={settings.data}
          online={online}
          invalidate={async () => {
            await Promise.all([
              client.invalidateQueries({ queryKey: chatKeys.rooms(actor) }),
              client.invalidateQueries({
                queryKey: ["chat-group-settings", actor, room],
              }),
            ]);
          }}
        />
      )}
    </Dialog>
  );
}

function SettingsContent({
  room,
  canManage,
  editing,
  setEditing,
  setPending,
  initial,
  online,
  invalidate,
}: {
  room: string;
  canManage: boolean;
  editing: boolean;
  setEditing: (value: boolean) => void;
  setPending: (value: boolean) => void;
  initial: Settings;
  online: boolean;
  invalidate: () => Promise<void>;
}) {
  const { t } = useTranslation("chatGroupSettings");
  const common = useTranslation().t;
  const [version, setVersion] = useState(initial.version);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description);
  const mutation = useMutation({
    onMutate: () => setPending(true),
    onSettled: (_result, error) => {
      setPending(false);
      if (!error) setEditing(false);
    },
    mutationFn: async () => {
      requireOnline();
      const { error } = await db().rpc("update_chat_group_settings", {
        p_room_id: room,
        p_title: title,
        p_description: description,
        p_expected_version: version,
      });
      if (error) throw error;
    },
    onSuccess: invalidate,
  });
  if (!editing)
    return (
      <>
        <p>
          <strong>{initial.title}</strong>
        </p>
        <p style={{ whiteSpace: "pre-wrap" }}>
          {initial.description || t("empty")}
        </p>
        {canManage && (
          <Button
            type="button"
            onClick={() => {
              setTitle(initial.title);
              setDescription(initial.description);
              setVersion(initial.version);
              mutation.reset();
              setEditing(true);
            }}
            disabled={!online}
          >
            {t("edit")}
          </Button>
        )}
      </>
    );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (title.trim()) mutation.mutate();
      }}
    >
      <Field
        id="chat-group-settings-title"
        label={t("name")}
        error={!title.trim()}
      >
        <input
          id="chat-group-settings-title"
          value={title}
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
          disabled={mutation.isPending}
        />
      </Field>
      {!title.trim() && <Notice kind="error">{t("invalid")}</Notice>}
      <Field id="chat-group-settings-description" label={t("description")}>
        <textarea
          id="chat-group-settings-description"
          value={description}
          maxLength={2000}
          rows={5}
          onChange={(event) => setDescription(event.target.value)}
          disabled={mutation.isPending}
        />
      </Field>
      <div className="form-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={mutation.isPending}
          onClick={() => {
            setEditing(false);
            setTitle(initial.title);
            setDescription(initial.description);
            mutation.reset();
          }}
        >
          {common("cancel")}
        </Button>
        <Button disabled={!online || mutation.isPending || !title.trim()}>
          {common("save")}
        </Button>
      </div>
      {mutation.isError && (
        <Notice kind="error">
          {t(
            mutation.error &&
              typeof mutation.error === "object" &&
              "code" in mutation.error &&
              mutation.error.code === "40001"
              ? "conflict"
              : "failed",
          )}
        </Notice>
      )}
    </form>
  );
}
