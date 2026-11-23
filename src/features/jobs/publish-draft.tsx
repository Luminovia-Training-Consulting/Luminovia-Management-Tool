import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Notice } from "../../components/common";
import { useOnline } from "../../lib/online";
import { useRequestKey } from "../../lib/request-key";
import { useAuth } from "../auth/auth-context";
import { lifecycleQuery, manageOffer, refreshJobState } from "./lifecycle-api";
import "./lifecycle-i18n";

export function PublishOfferDraft({
  jobId,
  onPublished,
}: {
  jobId: string;
  onPublished?: () => void;
}) {
  return (
    <OfferPublicationAction
      jobId={jobId}
      action="published"
      onChanged={onPublished}
    />
  );
}

export function OfferPublicationAction({
  jobId,
  action,
  onChanged,
  disabled = false,
}: {
  jobId: string;
  action: "published" | "draft";
  onChanged?: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("jobLifecycle");
  const actor = useAuth().session!.user.id;
  const cache = useQueryClient();
  const online = useOnline();
  const request = useRequestKey();
  const publish = useMutation({
    mutationFn: async () => {
      const reviewed = await cache.fetchQuery(lifecycleQuery(actor, jobId));
      if (
        action === "draft" &&
        (!reviewed.can_manage ||
          (reviewed.confirmed_count ?? 0) > 0 ||
          reviewed.claims.length > 0)
      )
        throw new Error("offer_publication_protected");
      return manageOffer({
        job: jobId,
        action,
        version: reviewed.version,
        request: request.forInput(`${action}:${jobId}:${reviewed.version}`),
      });
    },
    onSuccess: () => {
      onChanged?.();
      void refreshJobState(cache);
    },
  });
  return (
    <>
      <Button
        type="button"
        disabled={disabled || !online || publish.isPending || publish.isSuccess}
        onClick={() => publish.mutate()}
      >
        {t(action === "published" ? "publishMarketplace" : "draft")}
      </Button>
      {publish.isError && <Notice kind="error">{t("failed")}</Notice>}
    </>
  );
}
