/** Show only the signed-in learner's current company invitations, and accept one explicitly. */
import { useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import "./i18n";

type Invitation = {
  organisation_id: string;
  organisation_name: string;
  version: number;
};

/** Acceptance changes only the named company membership; it does not enrol the learner. */
export function CompanyInvitations({ actor }: { actor: string }) {
  const { t } = useTranslation("learning");
  const online = useOnline();
  const cache = useQueryClient();
  const key = ["my-company-participant-invitations", actor] as const;
  const requestIds = useRef(new Map<string, string>());
  const invitations = useQuery({
    queryKey: key,
    enabled: online,
    refetchOnMount: "always",
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("my_company_participant_invitations")
        .abortSignal(signal);
      if (error) throw error;
      return data as Invitation[];
    },
  });
  const accept = useMutation({
    mutationFn: async (invitation: Invitation) => {
      requireOnline();
      const { organisation_id, version } = invitation;
      const signature = `${organisation_id}:${version}`;
      const requestId =
        requestIds.current.get(signature) ?? crypto.randomUUID();
      requestIds.current.set(signature, requestId);
      const { data, error } = await db().rpc(
        "accept_company_participant_invitation",
        {
          p_organisation_id: organisation_id,
          p_expected_version: version,
          p_request_id: requestId,
        },
      );
      if (error || data?.status !== "accepted")
        throw error ?? new Error("unconfirmed");
      requestIds.current.delete(signature);
    },
    onSuccess: async () => {
      await Promise.all([
        cache.invalidateQueries({ queryKey: key }),
        cache.invalidateQueries({ queryKey: ["course-workspaces", actor] }),
      ]);
    },
    onError: () => {
      void cache.invalidateQueries({ queryKey: key });
    },
  });
  if (!online) return null;
  if (invitations.isPending || !invitations.isFetchedAfterMount)
    return <Loading />;
  if (invitations.isError)
    return <ErrorState retry={() => void invitations.refetch()} />;
  if (!invitations.data.length && !accept.isSuccess && !accept.isError)
    return null;
  return (
    <section className="panel" aria-label={t("companyInvitations")}>
      <h2>{t("companyInvitations")}</h2>
      {accept.isSuccess && (
        <Notice kind="success">{t("companyInvitationAccepted")}</Notice>
      )}
      {accept.isError && <Notice kind="error">{t("saveError")}</Notice>}
      <ul>
        {invitations.data.map((invitation) => (
          <li key={invitation.organisation_id}>
            <Button
              type="button"
              disabled={accept.isPending || invitations.isFetching}
              onClick={() => accept.mutate(invitation)}
            >
              {t("acceptCompanyInvitation", {
                name: invitation.organisation_name,
              })}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
