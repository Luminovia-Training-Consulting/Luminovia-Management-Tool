/** Topic invitations are server-authorized consent records, separate from direct membership. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Notice } from "../../components/common";
import { chatKeys } from "./api";
import type { ChatContact } from "./types";
import "./topic-invitations-i18n";
type Incoming = {
  id: string;
  room_id: string;
  title: string;
  inviter_name: string;
};
type Outgoing = { id: string; invitee_name: string };
const inboxKey = (actor: string) => ["chat-topic-invitations", actor] as const;
const sentKey = (actor: string, room: string) =>
  ["chat-topic-invitations-sent", actor, room] as const;
export function TopicInvitationInbox({
  actor,
  onRoom,
}: {
  actor: string;
  onRoom: (id: string) => void;
}) {
  const { t } = useTranslation("topicInvitations");
  const client = useQueryClient();
  const online = useOnline();
  const inbox = useQuery({
    queryKey: inboxKey(actor),
    queryFn: async () => {
      const { data, error } = await db().rpc("topic_invitation_inbox");
      if (error) throw error;
      return (data ?? []) as Incoming[];
    },
    refetchInterval: 15000,
  });
  const response = useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) => {
      requireOnline();
      const { data, error } = await db().rpc("respond_topic_invitation", {
        p_id: id,
        p_accept: accept,
      });
      if (error || !data) throw error ?? new Error("unconfirmed");
      return { room: data as string, accept };
    },
    onSuccess: async ({ room, accept }) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: inboxKey(actor) }),
        client.invalidateQueries({ queryKey: chatKeys.rooms(actor) }),
      ]);
      if (accept) onRoom(room);
    },
    onError: () => void client.invalidateQueries({ queryKey: inboxKey(actor) }),
  });
  return (
    <section aria-label={t("inbox")} className="panel">
      <strong>{t("inbox")}</strong>
      {inbox.isError && <ErrorState retry={() => void inbox.refetch()} />}
      {inbox.isSuccess && inbox.data.length === 0 && <p>{t("empty")}</p>}
      {inbox.data?.map((item) => (
        <div key={item.id}>
          <strong>{item.title}</strong>
          <p>{t("from", { name: item.inviter_name })}</p>
          <Button
            type="button"
            size="sm"
            disabled={!online || response.isPending}
            onClick={() => response.mutate({ id: item.id, accept: true })}
          >
            {t("accept")}
          </Button>{" "}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={!online || response.isPending}
            onClick={() => response.mutate({ id: item.id, accept: false })}
          >
            {t("reject")}
          </Button>
        </div>
      ))}
      {response.isError && <Notice kind="error">{t("failed")}</Notice>}
    </section>
  );
}
export function TopicInvitationManager({
  actor,
  room,
  candidates,
}: {
  actor: string;
  room: string;
  candidates: ChatContact[];
}) {
  const { t } = useTranslation("topicInvitations");
  const client = useQueryClient();
  const online = useOnline();
  const [person, setPerson] = useState("");
  const sent = useQuery({
    queryKey: sentKey(actor, room),
    queryFn: async () => {
      const { data, error } = await db().rpc("topic_invitation_sent", {
        p_room_id: room,
      });
      if (error) throw error;
      return (data ?? []) as Outgoing[];
    },
  });
  const mutation = useMutation({
    mutationFn: async ({ id, revoke }: { id: string; revoke: boolean }) => {
      requireOnline();
      const { error } = revoke
        ? await db().rpc("revoke_topic_invitation", { p_id: id })
        : await db().rpc("invite_topic_member", {
            p_room_id: room,
            p_invitee_id: id,
          });
      if (error) throw error;
    },
    onSuccess: async () => {
      setPerson("");
      await client.invalidateQueries({ queryKey: sentKey(actor, room) });
    },
  });
  return (
    <section aria-label={t("manage")}>
      <h3>{t("manage")}</h3>
      <p>{t("hint")}</p>
      <Field id="topic-invite-person" label={t("select")}>
        <select
          id="topic-invite-person"
          value={person}
          onChange={(event) => setPerson(event.target.value)}
          disabled={mutation.isPending}
        >
          <option value="">{t("select")}</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.display_name}
            </option>
          ))}
        </select>
      </Field>
      <Button
        type="button"
        disabled={!person || !online || mutation.isPending}
        onClick={() => mutation.mutate({ id: person, revoke: false })}
      >
        {t("invite")}
      </Button>
      <h4>{t("pending")}</h4>
      {sent.data?.map((item) => (
        <div key={item.id}>
          {item.invitee_name}{" "}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!online || mutation.isPending}
            onClick={() => mutation.mutate({ id: item.id, revoke: true })}
          >
            {t("revoke", { name: item.invitee_name })}
          </Button>
        </div>
      ))}
      {sent.isError && <ErrorState retry={() => void sent.refetch()} />}
      {mutation.isError && <Notice kind="error">{t("failed")}</Notice>}
      {mutation.isSuccess && <Notice>{t("saved")}</Notice>}
    </section>
  );
}
