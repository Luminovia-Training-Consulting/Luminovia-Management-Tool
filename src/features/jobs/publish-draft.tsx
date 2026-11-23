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
  const { t } = useTranslation("jobLifecycle");
  const actor = useAuth().session!.user.id;
  const cache = useQueryClient();
  const online = useOnline();
  const request = useRequestKey();
  const publish = useMutation({
    mutationFn: async () => {
      const reviewed = await cache.fetchQuery(lifecycleQuery(actor, jobId));
      return manageOffer({
        job: jobId,
        action: "published",
        version: reviewed.version,
        request: request.forInput(`${jobId}:${reviewed.version}`),
      });
    },
    onSuccess: () => {
      onPublished?.();
      void refreshJobState(cache);
    },
  });
  return (
    <>
      <Button
        type="button"
        disabled={!online || publish.isPending || publish.isSuccess}
        onClick={() => publish.mutate()}
      >
        {t("publishMarketplace")}
      </Button>
      {publish.isError && <Notice kind="error">{t("failed")}</Notice>}
    </>
  );
}
