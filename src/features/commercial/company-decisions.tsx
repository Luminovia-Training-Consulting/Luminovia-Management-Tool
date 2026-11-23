import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { dateTime } from "../../lib/dates";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { Notice } from "../../components/common";
import { commissionKeys } from "./commission-api";
import { CompanyRejectedLecturers } from "./company-rejected";

interface CompanyDecision {
  claim_id: string;
  lecturer_name: string;
  status: "pending" | "accepted" | "auto_accepted" | "review_required";
  deadline: string;
  can_reject: boolean;
}

/** Company decisions are separate from the lecturer's committed claim. */
export function CompanyDecisions({
  actor,
  job,
  zone,
}: {
  actor: string;
  job: string;
  zone: string;
}) {
  const { t, i18n } = useTranslation("platform");
  const common = useTranslation().t;
  const online = useOnline();
  const client = useQueryClient();
  const [rejected, setRejected] = useState<CompanyDecision | null>(null);
  const queryKey = ["company-decisions", actor, job] as const;
  const decisions = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await db().rpc("company_lecturer_decisions", {
        p_job_id: job,
      });
      if (error) throw error;
      return data as CompanyDecision[];
    },
    refetchInterval: 60_000,
  });
  const decide = useMutation({
    mutationFn: async ({
      claim,
      decision,
    }: {
      claim: string;
      decision: "accepted" | "rejected";
    }) => {
      requireOnline();
      const { error } = await db().rpc("decide_company_lecturer", {
        p_claim_id: claim,
        p_decision: decision,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey }),
        client.invalidateQueries({ queryKey: commissionKeys.requests(actor) }),
        client.invalidateQueries({ queryKey: commissionKeys.spend(actor) }),
      ]);
      setRejected(null);
    },
  });
  if (decisions.isPending) return <p>{t("companyDecisionLoading")}</p>;
  if (decisions.isError)
    return <Notice kind="error">{t("companyDecisionFailed")}</Notice>;
  if (!decisions.data.length)
    return <CompanyRejectedLecturers actor={actor} job={job} />;
  return (
    <section aria-label={t("companyDecisionHeading")}>
      <h3>{t("companyDecisionHeading")}</h3>
      <CompanyRejectedLecturers actor={actor} job={job} />
      {decisions.data.map((item) => (
        <div key={item.claim_id} className="platform-teacher">
          <div>
            <strong>{item.lecturer_name}</strong>
            {" · "}
            {t(
              item.status === "pending"
                ? "companyDecisionPending"
                : item.status === "accepted"
                  ? "companyDecisionAccepted"
                  : item.status === "review_required"
                    ? "companyDecisionReviewRequired"
                    : "companyDecisionAutomatic",
            )}
            {item.status === "pending" && (
              <p>
                {t("companyDecisionDeadline", {
                  deadline: dateTime(item.deadline, i18n.language, zone),
                  zone,
                })}
              </p>
            )}
            <div className="form-actions">
              {item.status !== "accepted" &&
                item.status !== "review_required" && (
                  <Button
                    variant="secondary"
                    disabled={!online || decide.isPending}
                    onClick={() =>
                      decide.mutate({
                        claim: item.claim_id,
                        decision: "accepted",
                      })
                    }
                  >
                    {t("companyDecisionAccept")}
                  </Button>
                )}
              {item.can_reject && item.status !== "review_required" && (
                <Button
                  variant="ghost"
                  disabled={!online || decide.isPending}
                  onClick={() => setRejected(item)}
                >
                  {t("companyDecisionReject")}
                </Button>
              )}
            </div>
          </div>
        </div>
      ))}
      {decide.isError && (
        <Notice kind="error">{t("companyDecisionFailed")}</Notice>
      )}
      <Dialog
        open={Boolean(rejected)}
        onOpenChange={(open) => {
          if (!open) setRejected(null);
        }}
        title={t("companyDecisionReject")}
        description={t("companyDecisionRejectHint")}
      >
        <p>{rejected?.lecturer_name}</p>
        <div className="form-actions">
          <Button
            variant="secondary"
            disabled={decide.isPending}
            onClick={() => setRejected(null)}
          >
            {common("cancel")}
          </Button>
          <Button
            disabled={!online || decide.isPending || !rejected}
            onClick={() => {
              if (rejected)
                decide.mutate({
                  claim: rejected.claim_id,
                  decision: "rejected",
                });
            }}
          >
            {t("companyDecisionReject")}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}

/** Include organisation-owned jobs that were created by staff without a request. */
export function AdditionalCompanyDecisions({
  actor,
  excludedJobs,
  zone,
}: {
  actor: string;
  excludedJobs: string[];
  zone: string;
}) {
  const { t } = useTranslation("platform");
  const jobs = useQuery({
    queryKey: ["company-decision-jobs", actor],
    queryFn: async () => {
      const { data, error } = await db().rpc("company_jobs_for_deletion");
      if (error) throw error;
      return data as { id: string; title: string; organisation_name: string }[];
    },
  });
  if (jobs.isPending) return null;
  if (jobs.isError)
    return <Notice kind="error">{t("companyDecisionFailed")}</Notice>;
  const additional = jobs.data.filter((job) => !excludedJobs.includes(job.id));
  if (!additional.length) return null;
  return (
    <section>
      <h2>{t("companyOtherJobs")}</h2>
      {additional.map((job) => (
        <article className="panel platform-request-card" key={job.id}>
          <span className="eyebrow">{job.organisation_name}</span>
          <h3>{job.title}</h3>
          <Button asChild variant="secondary">
            <Link to={`/jobs/${job.id}`}>{t("companyOpenJob")}</Link>
          </Button>
          <CompanyDecisions actor={actor} job={job.id} zone={zone} />
        </article>
      ))}
    </section>
  );
}
