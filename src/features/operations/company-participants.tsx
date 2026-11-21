/** Per-company participant invites, opaque User-ID link requests and membership removal. */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { accountRequest } from "../accounts/api";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { CompanyParticipantDetails } from "./company-participant-detail";
import { CompanyParticipantHistory } from "./company-participant-history";
import {
  type CompanyParticipant,
  companyParticipantsSchema,
} from "./company-participant-schema";
import "./i18n";

type ParticipantAccess = { organisation_id: string; premium_enabled: boolean };

/** Give the caller only the participant directory and invitation controls for one selected company. */
export function CompanyParticipantsPanel({
  actor,
  organisationId,
}: {
  actor: string;
  organisationId: string;
}) {
  const { t } = useTranslation("operations");
  const online = useOnline();
  const cache = useQueryClient();
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedParticipant, setSelectedParticipant] = useState<string | null>(
    null,
  );
  const [removeTarget, setRemoveTarget] = useState<CompanyParticipant | null>(
    null,
  );
  const [notice, setNotice] = useState<
    "requested" | "invited" | "removed" | "failed" | null
  >(null);
  const refreshHistory = () =>
    cache.invalidateQueries({
      queryKey: ["company-participant-history", actor, organisationId],
    });
  const access = useQuery({
    queryKey: ["company-participant-access", actor, organisationId],
    queryFn: async () => {
      const { data, error } = await db().rpc("company_participant_access", {
        p_organisation_id: organisationId,
      });
      if (error) throw error;
      return data as ParticipantAccess;
    },
    enabled: online && Boolean(organisationId),
    refetchInterval: 15_000,
  });
  const participants = useQuery({
    queryKey: ["company-participants", actor, organisationId],
    queryFn: async () => {
      const { data, error } = await db().rpc("company_participants", {
        p_organisation_id: organisationId,
      });
      if (error) throw error;
      return companyParticipantsSchema.parse(data ?? []);
    },
    enabled: online && access.data?.premium_enabled === true,
  });
  const requestLink = useMutation({
    mutationFn: async (value: string) => {
      if (!online) throw new Error("offline");
      const { error } = await db().rpc("request_company_participant_link", {
        p_organisation_id: organisationId,
        p_luminovia_user_id: value.trim(),
        p_request_id: crypto.randomUUID(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setUserId("");
      setNotice("requested");
      void refreshHistory();
    },
    onError: () => setNotice("failed"),
  });
  const invite = useMutation({
    mutationFn: async () => {
      if (!online) throw new Error("offline");
      return await accountRequest<{ status: "requested" }>(
        "company-participant-invitations",
        "POST",
        {
          email: email.trim(),
          display_name: displayName.trim(),
          organisation_id: organisationId,
          idempotency_key: crypto.randomUUID(),
        },
      );
    },
    onSuccess: () => {
      setEmail("");
      setDisplayName("");
      setNotice("invited");
      void refreshHistory();
    },
    onError: () => setNotice("failed"),
  });
  const remove = useMutation({
    mutationFn: async (participant: CompanyParticipant) => {
      if (!online) throw new Error("offline");
      const { error } = await db().rpc("remove_company_participant", {
        p_organisation_id: organisationId,
        p_user_id: participant.user_id,
        p_expected_version: participant.version,
        p_request_id: crypto.randomUUID(),
      });
      if (error) throw error;
      return participant.user_id;
    },
    onSuccess: async () => {
      setRemoveTarget(null);
      setNotice("removed");
      await Promise.all([
        cache.invalidateQueries({
          queryKey: ["company-participants", actor, organisationId],
        }),
        refreshHistory(),
      ]);
    },
    onError: () => setNotice("failed"),
  });

  if (!online) return null;
  if (access.isPending) return <Loading />;
  if (access.isError) return <ErrorState retry={() => void access.refetch()} />;
  if (!access.data?.premium_enabled) return null;
  if (participants.isPending) return <Loading />;
  if (participants.isError)
    return <ErrorState retry={() => void participants.refetch()} />;
  const selected = participants.data.find(
    (row) => row.user_id === selectedParticipant,
  );

  return (
    <section
      className="panel company-participants"
      aria-labelledby={`participants-${organisationId}`}
    >
      <h2 id={`participants-${organisationId}`}>{t("participants")}</h2>
      <p className="muted">{t("participantsHelp")}</p>
      <Button
        type="button"
        variant="secondary"
        onClick={() => setHistoryOpen(true)}
      >
        {t("participantHistory")}
      </Button>
      {notice && (
        <Notice kind={notice === "failed" ? "error" : "success"}>
          {t(
            notice === "requested"
              ? "participantLinkRequested"
              : notice === "invited"
                ? "participantInviteRequested"
                : notice === "removed"
                  ? "participantRemoved"
                  : "participantOperationFailed",
          )}
        </Notice>
      )}
      <form
        className="participant-link-form"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice(null);
          requestLink.mutate(userId);
        }}
      >
        <Field
          id={`participant-user-id-${organisationId}`}
          label={t("participantUserId")}
        >
          <input
            id={`participant-user-id-${organisationId}`}
            value={userId}
            maxLength={32}
            autoComplete="off"
            onChange={(event) => setUserId(event.currentTarget.value)}
          />
        </Field>
        <Button
          type="submit"
          variant="secondary"
          disabled={
            !online || requestLink.isPending || userId.trim().length < 1
          }
        >
          {t("requestParticipantLink")}
        </Button>
      </form>
      <form
        className="participant-invite-form"
        onSubmit={(event) => {
          event.preventDefault();
          setNotice(null);
          invite.mutate();
        }}
      >
        <Field
          id={`participant-invite-name-${organisationId}`}
          label={t("participantInviteName")}
        >
          <input
            id={`participant-invite-name-${organisationId}`}
            value={displayName}
            maxLength={120}
            autoComplete="off"
            onChange={(event) => setDisplayName(event.currentTarget.value)}
            required
          />
        </Field>
        <Field
          id={`participant-invite-email-${organisationId}`}
          label={t("participantInviteEmail")}
        >
          <input
            id={`participant-invite-email-${organisationId}`}
            type="email"
            value={email}
            maxLength={254}
            autoComplete="off"
            onChange={(event) => setEmail(event.currentTarget.value)}
            required
          />
        </Field>
        <Button type="submit" disabled={!online || invite.isPending}>
          {t("inviteParticipant")}
        </Button>
      </form>
      <div className="company-participant-list">
        {participants.data.length ? (
          participants.data.map((participant) => (
            <article
              className="company-participant-row"
              key={participant.user_id}
            >
              <div>
                <strong>{participant.display_name}</strong>
                <small className="muted">{participant.luminovia_user_id}</small>
                {participant.company_reference && (
                  <p className="muted">
                    {t("participantCompanyReference")} ·{" "}
                    {participant.company_reference}
                  </p>
                )}
              </div>
              <div className="company-participant-row-actions">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setSelectedParticipant(participant.user_id)}
                >
                  {t("participantOpenDetails")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!online || remove.isPending}
                  onClick={() => setRemoveTarget(participant)}
                >
                  {t("removeParticipant")}
                </Button>
              </div>
            </article>
          ))
        ) : (
          <p className="muted">{t("participantListEmpty")}</p>
        )}
      </div>
      {selected && (
        <CompanyParticipantDetails
          key={`${actor}:${organisationId}:${selected.user_id}`}
          actor={actor}
          organisationId={organisationId}
          participant={selected}
          onClose={() => setSelectedParticipant(null)}
        />
      )}
      {historyOpen && (
        <CompanyParticipantHistory
          key={`${actor}:${organisationId}`}
          actor={actor}
          organisationId={organisationId}
          onClose={() => setHistoryOpen(false)}
        />
      )}
      <Dialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open && !remove.isPending) setRemoveTarget(null);
        }}
        title={t("removeParticipant")}
        description={t("removeParticipantConfirm")}
      >
        <div className="form-actions">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setRemoveTarget(null)}
          >
            {t("cancel")}
          </Button>
          <Button
            type="button"
            disabled={!online || remove.isPending || !removeTarget}
            onClick={() => removeTarget && remove.mutate(removeTarget)}
          >
            {remove.isPending ? t("saving") : t("removeParticipant")}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
