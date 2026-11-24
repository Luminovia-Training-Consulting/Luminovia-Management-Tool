import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Loading, Notice } from "../../components/common";
import { useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { useRequestKey } from "../../lib/request-key";
import { useAuth } from "../auth/auth-context";
import { courseOfferPublicationPreviewSchema } from "../operations/course-building-block-schema";
import { lifecycleQuery, manageOffer, refreshJobState } from "./lifecycle-api";
import "../admin/course-i18n";
import "./lifecycle-i18n";

export function PublishOfferDraft({
  jobId,
  onPublished,
  disabled = false,
  reviewOnMount = false,
}: {
  jobId: string;
  reviewOnMount?: boolean;
  onPublished?: () => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation("courseOffer");
  const { t: common } = useTranslation();
  const actor = useAuth().session!.user.id;
  const cache = useQueryClient();
  const online = useOnline();
  const [open, setOpen] = useState(reviewOnMount);
  const [opener, setOpener] = useState<HTMLButtonElement | null>(null);
  const request = useRequestKey();
  const preview = useQuery({
    queryKey: ["course-offer-publication-preview", actor, jobId],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_offer_publication_preview", { p_job_id: jobId })
        .abortSignal(signal);
      if (error) throw error;
      return courseOfferPublicationPreviewSchema.parse(data);
    },
    enabled: open && online,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
  const publish = useMutation({
    mutationFn: (version: number) =>
      manageOffer({
        job: jobId,
        action: "published",
        version,
        request: request.forInput(`published:${jobId}:${version}`),
      }),
    onSuccess: () => {
      setOpen(false);
      onPublished?.();
      void refreshJobState(cache);
    },
  });
  const publication = preview.data;
  const internal = publication?.audience === "company";
  return (
    <>
      <Button
        type="button"
        ref={setOpener}
        disabled={disabled || !online || publish.isSuccess}
        onClick={() => setOpen(true)}
      >
        {t("reviewOffer")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !publish.isPending) setOpen(false);
        }}
        returnFocusTo={opener}
        closeDisabled={publish.isPending}
        title={t("reviewOffer")}
        description={t("reviewOfferHint")}
      >
        {preview.isError ? (
          <ErrorState retry={() => void preview.refetch()} />
        ) : preview.isPending ? (
          <Loading />
        ) : publication ? (
          <>
            <dl className="commercial-facts">
              <dt>{t("reviewAudience")}</dt>
              <dd>{t(internal ? "reviewCompany" : "reviewMarketplace")}</dd>
              <dt>{t("reviewBilling")}</dt>
              <dd>
                {t(publication.billable ? "reviewPaid" : "reviewNoBilling")}
              </dd>
            </dl>
            <Notice kind={publication.ready ? "success" : "error"}>
              {t(
                !publication.ready
                  ? "reviewBlocked"
                  : publication.eligible
                    ? "reviewEligible"
                    : "reviewNoEligible",
              )}
            </Notice>
            {publish.isError && (
              <Notice kind="error">{t("reviewRefreshRequired")}</Notice>
            )}
            <div className="form-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={!online || preview.isFetching || publish.isPending}
                onClick={async () => {
                  await preview.refetch();
                  publish.reset();
                }}
              >
                {common("retry")}
              </Button>
              <Button
                type="button"
                disabled={
                  disabled ||
                  !online ||
                  preview.isFetching ||
                  !publication.ready ||
                  publish.isPending
                }
                onClick={() => publish.mutate(publication.version)}
              >
                {internal ? t("publishCompanyOffer") : t("publishOffer")}
              </Button>
            </div>
          </>
        ) : null}
      </Dialog>
    </>
  );
}

function WithdrawOfferPublication({
  jobId,
  onChanged,
  disabled,
}: {
  jobId: string;
  onChanged?: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation("jobLifecycle");
  const actor = useAuth().session!.user.id;
  const cache = useQueryClient();
  const online = useOnline();
  const request = useRequestKey();
  const withdraw = useMutation({
    mutationFn: async () => {
      const reviewed = await cache.fetchQuery(lifecycleQuery(actor, jobId));
      if (
        !reviewed.can_manage ||
        (reviewed.confirmed_count ?? 0) > 0 ||
        reviewed.claims.length > 0
      )
        throw new Error("offer_publication_protected");
      return manageOffer({
        job: jobId,
        action: "draft",
        version: reviewed.version,
        request: request.forInput(`draft:${jobId}:${reviewed.version}`),
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
        disabled={
          disabled || !online || withdraw.isPending || withdraw.isSuccess
        }
        onClick={() => withdraw.mutate()}
      >
        {t("draft")}
      </Button>
      {withdraw.isError && <Notice kind="error">{t("failed")}</Notice>}
    </>
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
  return action === "published" ? (
    <PublishOfferDraft
      jobId={jobId}
      disabled={disabled}
      onPublished={onChanged}
    />
  ) : (
    <WithdrawOfferPublication
      jobId={jobId}
      disabled={disabled}
      onChanged={onChanged}
    />
  );
}
