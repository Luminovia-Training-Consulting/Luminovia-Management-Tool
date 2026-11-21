import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Notice } from "../../components/common";

interface RejectedLecturer {
  claim_id: string;
  lecturer_name: string;
}

/** Explicitly allow a previously rejected lecturer to claim this offer again. */
export function CompanyRejectedLecturers({
  actor,
  job,
}: {
  actor: string;
  job: string;
}) {
  const { t } = useTranslation("platform");
  const common = useTranslation().t;
  const online = useOnline();
  const cache = useQueryClient();
  const [selected, setSelected] = useState<RejectedLecturer | null>(null);
  const key = ["company-rejected-lecturers", actor, job] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db().rpc("company_rejected_lecturers", {
        p_job: job,
      });
      if (error || !Array.isArray(data))
        throw error ?? new Error("invalid rejected lecturer list");
      return data as RejectedLecturer[];
    },
  });
  const release = useMutation({
    mutationFn: async (claim: string) => {
      requireOnline();
      const { error } = await db().rpc("release_company_rejection", {
        p_claim: claim,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: key });
      setSelected(null);
    },
  });
  if (query.isPending) return null;
  if (query.isError)
    return <Notice kind="error">{t("companyRejectionListError")}</Notice>;
  if (!query.data.length) return null;
  return (
    <div>
      <h3>{t("companyRejectedHeading")}</h3>
      <p>{t("companyRejectedHelp")}</p>
      {query.data.map((item) => (
        <div className="platform-teacher" key={item.claim_id}>
          <strong>{item.lecturer_name}</strong>{" "}
          <Button
            variant="secondary"
            disabled={!online || release.isPending}
            onClick={() => setSelected(item)}
          >
            {t("companyRejectionRelease")}
          </Button>
        </div>
      ))}
      {release.isError && (
        <Notice kind="error">{t("companyRejectionReleaseError")}</Notice>
      )}
      <Dialog
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={t("companyRejectionRelease")}
        description={t("companyRejectionReleaseHelp")}
      >
        <p>{selected?.lecturer_name}</p>
        <div className="form-actions">
          <Button
            variant="secondary"
            disabled={release.isPending}
            onClick={() => setSelected(null)}
          >
            {common("cancel")}
          </Button>
          <Button
            disabled={!online || release.isPending || !selected}
            onClick={() => {
              if (selected) release.mutate(selected.claim_id);
            }}
          >
            {t("companyRejectionReleaseConfirm")}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
