/** Owner transfer and voluntary departure for user-managed topic groups. */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Field, Notice } from "../../components/common";
import { chatKeys } from "./api";
import type { ChatMember, ChatRoom } from "./types";
import "./group-ownership-i18n";
export function GroupOwnership({
  actor,
  room,
  members,
  onLeft,
}: {
  actor: string;
  room: ChatRoom;
  members: ChatMember[];
  onLeft: () => void;
}) {
  const { t } = useTranslation("chatOwnership");
  const common = useTranslation().t;
  const online = useOnline();
  const client = useQueryClient();
  const [target, setTarget] = useState("");
  const [confirmation, setConfirmation] = useState<"transfer" | "leave" | null>(
    null,
  );
  const [transferred, setTransferred] = useState(false);
  const isOwner = room.owner_id === actor;
  const candidates = members.filter((member) => member.user_id !== actor);
  const action = useMutation({
    mutationFn: async (operation: "transfer" | "leave") => {
      requireOnline();
      const { error } =
        operation === "transfer"
          ? await db().rpc("transfer_topic_group_owner", {
              p_room_id: room.id,
              p_new_owner_id: target,
            })
          : await db().rpc("leave_topic_group", { p_room_id: room.id });
      if (error) throw error;
    },
    onSuccess: async (_result, operation) => {
      setConfirmation(null);
      if (operation === "leave") {
        client.removeQueries({ queryKey: chatKeys.messages(actor, room.id) });
        client.removeQueries({ queryKey: chatKeys.members(actor, room.id) });
        client.removeQueries({
          queryKey: ["chat-group-settings", actor, room.id],
        });
        onLeft();
      } else {
        setTransferred(true);
        setTarget("");
      }
      await client.invalidateQueries({ queryKey: chatKeys.rooms(actor) });
    },
  });
  return (
    <>
      {isOwner && (
        <>
          <Field id="chat-transfer-target" label={t("transferTo")}>
            <select
              id="chat-transfer-target"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              disabled={action.isPending}
            >
              <option value="">{t("select")}</option>
              {candidates.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Button
            type="button"
            variant="secondary"
            disabled={!target || !online || action.isPending}
            onClick={() => {
              action.reset();
              setConfirmation("transfer");
            }}
          >
            {t("transfer")}
          </Button>
          <p>{t("ownerHint")}</p>
        </>
      )}
      {!isOwner && (
        <Button
          type="button"
          variant="secondary"
          disabled={!online || action.isPending}
          onClick={() => {
            action.reset();
            setConfirmation("leave");
          }}
        >
          {t("leave")}
        </Button>
      )}
      {transferred && <Notice>{t("transferDone")}</Notice>}
      <Dialog
        open={confirmation !== null}
        onOpenChange={(next) => {
          if (!next && !action.isPending) setConfirmation(null);
        }}
        title={t(
          confirmation === "leave" ? "leaveQuestion" : "transferQuestion",
        )}
        description={t(confirmation === "leave" ? "leaveHint" : "transferHint")}
      >
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={action.isPending}
            onClick={() => setConfirmation(null)}
          >
            {common("cancel")}
          </Button>
          <Button
            type="button"
            variant={confirmation === "leave" ? "danger" : "default"}
            disabled={!online || action.isPending || confirmation === null}
            onClick={() => {
              if (confirmation) action.mutate(confirmation);
            }}
          >
            {t(confirmation === "leave" ? "leave" : "transfer")}
          </Button>
        </div>
        {action.isError && <Notice kind="error">{t("failed")}</Notice>}
      </Dialog>
    </>
  );
}
