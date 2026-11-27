/** Authorized room and installation retention settings with a revision check. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Timer } from "lucide-react";
import { z } from "zod";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import "./retention-i18n";

const duration = z.union([
  z.literal(0),
  z.literal(8),
  z.literal(168),
  z.literal(336),
]);
const policySchema = z.object({
  hours: duration.nullable(),
  default_hours: duration,
  version: z.number().int().nonnegative(),
  can_edit: z.boolean(),
});
type Policy = z.infer<typeof policySchema>;
const durationKeys = {
  0: "disabled",
  8: "hours8",
  168: "hours168",
  336: "hours336",
} as const;

export function ChatRetention({
  actor,
  roomId,
}: {
  actor: string;
  roomId?: string;
}) {
  const { t } = useTranslation("chatRetention");
  const [open, setOpen] = useState(false);
  const title = t(roomId ? "roomTitle" : "globalTitle");
  return (
    <>
      <Button
        type="button"
        variant={roomId ? "ghost" : "secondary"}
        size={roomId ? "icon" : "default"}
        aria-label={title}
        title={title}
        onClick={() => setOpen(true)}
      >
        <Timer size={18} aria-hidden="true" />
        {!roomId && title}
      </Button>
      {open && (
        <RetentionDialog
          actor={actor}
          roomId={roomId ?? null}
          title={title}
          close={() => setOpen(false)}
        />
      )}
    </>
  );
}

function RetentionDialog({
  actor,
  roomId,
  title,
  close,
}: {
  actor: string;
  roomId: string | null;
  title: string;
  close: () => void;
}) {
  const { t } = useTranslation("chatRetention");
  const online = useOnline();
  const client = useQueryClient();
  const [choice, setChoice] = useState<Policy["hours"]>();
  const [expectedVersion, setExpectedVersion] = useState<number>();
  const [confirmed, setConfirmed] = useState(false);
  const key = ["chat-retention", actor, roomId] as const;
  const setting = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db().rpc("chat_retention_policy", {
        p_room_id: roomId,
      });
      if (error) throw error;
      return policySchema.parse(data);
    },
  });
  const save = useMutation({
    mutationFn: async (input: { hours: Policy["hours"]; version: number }) => {
      requireOnline();
      const { data, error } = await db().rpc("set_chat_retention_policy", {
        p_room_id: roomId,
        p_hours: input.hours,
        p_expected_version: input.version,
      });
      if (error) throw error;
      return policySchema.parse(data);
    },
    onSuccess: async (result) => {
      client.setQueryData(key, result);
      await client.invalidateQueries({ queryKey: ["chat-retention", actor] });
      close();
    },
  });
  const conflict =
    save.error && "code" in save.error && save.error.code === "PT409";
  const initial = setting.data;
  const selected = choice === undefined ? initial?.hours : choice;
  return (
    <Dialog
      open
      title={title}
      description={t("description")}
      closeDisabled={save.isPending}
      onOpenChange={(next) => {
        if (!next && !save.isPending) close();
      }}
    >
      {setting.isPending ? (
        <Loading />
      ) : setting.isError ? (
        <ErrorState retry={() => void setting.refetch()} />
      ) : (
        initial && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (
                confirmed &&
                choice !== undefined &&
                expectedVersion !== undefined
              )
                save.mutate({ hours: choice, version: expectedVersion });
            }}
          >
            <p>
              {t("effective", {
                period: t(durationKeys[initial.hours ?? initial.default_hours]),
              })}
            </p>
            <p>{t("attachments")}</p>
            {initial.can_edit && (
              <>
                <Field id="chat-retention-duration" label={t("policy")}>
                  <select
                    id="chat-retention-duration"
                    value={selected ?? ""}
                    disabled={!online || save.isPending}
                    onChange={(event) => {
                      const value = event.target.value;
                      setChoice(
                        value === "" ? null : duration.parse(Number(value)),
                      );
                      setExpectedVersion(initial.version);
                      save.reset();
                      setConfirmed(false);
                    }}
                  >
                    {roomId && <option value="">{t("inherit")}</option>}
                    <option value="0">{t("disabled")}</option>
                    <option value="8">{t("hours8")}</option>
                    <option value="168">{t("hours168")}</option>
                    <option value="336">{t("hours336")}</option>
                  </select>
                </Field>
                {choice !== undefined && choice !== initial.hours && (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={save.isPending}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    {t("confirm")}
                  </label>
                )}
                {save.isError && (
                  <Notice kind="error">
                    {t(conflict ? "conflict" : "failed")}
                  </Notice>
                )}
                {conflict && (
                  <ErrorState
                    retry={() => {
                      setChoice(undefined);
                      setExpectedVersion(undefined);
                      setConfirmed(false);
                      save.reset();
                      void setting.refetch();
                    }}
                  />
                )}
                <Button
                  type="submit"
                  disabled={
                    !online ||
                    save.isPending ||
                    Boolean(conflict) ||
                    !confirmed ||
                    choice === initial.hours
                  }
                >
                  {t("save")}
                </Button>
              </>
            )}
          </form>
        )
      )}
    </Dialog>
  );
}
