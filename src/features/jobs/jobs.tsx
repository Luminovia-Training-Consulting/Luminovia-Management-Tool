/**
 * Marketplace entry and exact actor-scoped job detail with immediate allocation.
 * Discovery owns bounded server paging and URL filters; only the atomic online
 * RPC confirms every session and preserves the accepted commercial snapshot.
 */
import { JobPricingPanel } from "../commercial/pricing";
import { JobLifecyclePanel } from "./lifecycle";
import { JobWithdrawalPanel } from "./withdrawal";
import { JobBriefing } from "./briefing";
import { JobRelatedNavigation } from "./related-navigation";
import { JobSubstitutionPanel, JobWaitlist } from "./lifecycle-extra";
import { refreshJobState } from "./lifecycle-api";
import { jobDetailQuery } from "./discovery-api";
import { ResourceComments } from "../comments/comments";
import { AssignmentAmendments } from "../changes/changes";
import { JobBuildingBlockReference } from "../operations/building-blocks";
import "../commercial/platform-i18n";
import { JobDocuments } from "../files/files";
import {
  claimsQuery,
  permissionsQuery,
  profileQuery,
  topicsQuery,
  userRolesQuery,
} from "../../lib/queries";
import { useRef, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CalendarDays, CheckCircle2, ChevronLeft, MapPin } from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { hasTeachingRole } from "../auth/internal-capabilities";
import { db } from "../../lib/supabase";
import { dateTime, money } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import {
  ErrorState,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";

/** Return from a job detail view to the job list. */
function BackLink() {
  const { t } = useTranslation();
  return (
    <Button variant="ghost" asChild>
      <NavLink to="/jobs">
        <ChevronLeft size={18} />
        {t("back")}
      </NavLink>
    </Button>
  );
}

/** Display own accepted terms and request new allocation only through the atomic claim RPC. */
export function JobDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const lifeText = useTranslation("jobLifecycle").t;
  const { session } = useAuth();
  const online = useOnline();
  const client = useQueryClient();
  const [accepted, setAccepted] = useState<string | null>(null);
  // Network uncertainty preserves the same operation; only a confirmed claim
  // later receives a fresh identity for a genuine reopening.
  const key = useRef(crypto.randomUUID());
  const permissions = useQuery(permissionsQuery(session!.user.id));
  const roles = useQuery(userRolesQuery(session!.user.id));
  const teaching = roles.isSuccess && hasTeachingRole(roles.data);
  if (!teaching && accepted !== null) setAccepted(null);
  const jobs = useQuery(jobDetailQuery(session!.user.id, id ?? ""));
  const topics = useQuery(topicsQuery);
  const claims = useQuery(claimsQuery(session!.user.id));
  const profile = useQuery(profileQuery(session!.user.id));
  const job = jobs.data;
  // Bind consent to the actor-authorized detail and every displayed quote field.
  // A role or offer refresh may replace the price without changing the route.
  const consent = job
    ? JSON.stringify([
        job.id,
        job.terms_version,
        job.amount,
        job.total_amount,
        job.currency,
        job.rate_unit,
        job.terms,
      ])
    : null;
  const ownClaim = claims.data?.find((c) => c.job_id === id);
  // This is guidance from current server-confirmed assignments. The claim RPC
  // still rechecks every instant atomically, including concurrent allocations.
  const assignmentConflict = Boolean(
    job &&
    claims.data?.some(
      (existing) =>
        existing.job_id !== job.id &&
        existing.assignment_sessions.some(
          (assigned) =>
            !assigned.released_at &&
            job.job_sessions.some(
              (offered) =>
                Date.parse(offered.starts_at) < Date.parse(assigned.ends_at) &&
                Date.parse(offered.ends_at) > Date.parse(assigned.starts_at),
            ),
        ),
    ),
  );
  const claim = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (
        !job ||
        !teaching ||
        accepted !== consent ||
        assignmentConflict ||
        !claims.isSuccess
      )
        throw new Error("invalid");
      // The browser submits no winner/lecturer ID. The server atomically checks
      // the current actor, eligibility, every session and accepted terms.
      const { data, error } = await db().rpc("claim_job", {
        p_job_id: job.id,
        p_idempotency_key: key.current,
        p_terms_version: job.terms_version,
      });
      if (error) throw error;
      return data as { status: string; claim_id?: string };
    },
    onSuccess: async (result) => {
      await refreshJobState(client);
      // A later, explicitly reopened assignment is a new operation. Failed
      // requests retain their key; confirmed responses can safely retire it.
      if (result.status === "confirmed") key.current = crypto.randomUUID();
    },
  });
  if (jobs.isPending) return <Loading />;
  // Filled offers can deny general detail while the separate, reduced
  // waitlist RPC still permits interest. Only the server's access-denied code
  // takes this path; transport, validation and server faults retain retry UI.
  // Check the denial even when Query retains previously authorised job data.
  const detailDenied = Boolean(
    jobs.isError &&
    jobs.error &&
    typeof jobs.error === "object" &&
    "code" in jobs.error &&
    jobs.error.code === "42501",
  );
  if (jobs.isError && !detailDenied)
    return <ErrorState retry={() => void jobs.refetch()} />;
  if (detailDenied || !job)
    return (
      <>
        <BackLink />
        <Notice kind="error">
          {t(
            claim.data?.status === "filled"
              ? "claim_filled"
              : "claim_unavailable",
          )}
        </Notice>
        {id && teaching && <JobWaitlist jobId={id} />}
      </>
    );
  const zone = profile.data?.time_zone ?? job.time_zone;
  // An accepted claim remains the source for agreed fees and conditions
  // even if the current offer is subsequently edited.
  const terms = ownClaim ?? job;
  const result = claim.data?.status;
  const resultKey =
    result &&
    [
      "filled",
      "conflict",
      "not_eligible",
      "prerequisite_missing",
      "terms_changed",
      "unavailable",
    ].includes(result)
      ? `claim_${result}`
      : "error";
  return (
    <>
      <BackLink />
      <PageHeading
        eyebrow={job.customer_name}
        title={job.title}
        action={
          <span className={`status status-${job.status}`}>{t(job.status)}</span>
        }
      />
      {permissions.data?.includes("jobs.manage") && (
        <JobPricingPanel job={job} />
      )}
      <JobRelatedNavigation actor={session!.user.id} jobId={job.id} />
      <JobLifecyclePanel job={job} />
      <JobWithdrawalPanel key={job.id} jobId={job.id} zone={job.time_zone} />
      {teaching && <JobWaitlist jobId={job.id} />}
      <JobSubstitutionPanel jobId={job.id} />
      {teaching && ownClaim?.status === "confirmed" && (
        <div className="form-actions">
          <Button asChild variant="secondary">
            <Link to={`/finance?claim=${encodeURIComponent(ownClaim.id)}`}>
              {t("submitInvoice")}
            </Link>
          </Button>
        </div>
      )}
      <div className="detail-layout">
        <div>
          <section className="panel">
            <div className="inline-meta">
              <span>
                <MapPin size={17} />
                {job.location || t(job.delivery_type)}
              </span>
              <span>{t(job.delivery_type)}</span>
            </div>
            <h2>{t("description")}</h2>
            <p className="preserve-text">{job.description}</p>
            <JobBuildingBlockReference jobId={job.id} />
            <h2>{t("sessions")}</h2>
            <p className="muted">
              {t("timezone")}: {zone}
              {zone !== job.time_zone && ` · ${job.time_zone}`}
            </p>
            <ol className="session-list">
              {[...job.job_sessions]
                .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
                .map((s) => (
                  <li key={s.id}>
                    <CalendarDays size={18} />
                    <div>
                      <strong>
                        {dateTime(s.starts_at, i18n.language, zone)}
                      </strong>
                      <span>
                        {t("end")}: {dateTime(s.ends_at, i18n.language, zone)}
                      </span>
                      {zone !== job.time_zone && (
                        <small>
                          {dateTime(s.starts_at, i18n.language, job.time_zone)}{" "}
                          · {job.time_zone}
                        </small>
                      )}
                    </div>
                  </li>
                ))}
            </ol>
            <h2>{t("requirements")}</h2>
            {job.job_requirements.length ? (
              <div className="tags">
                {job.job_requirements.map((r) => (
                  <span key={r.topic_id} className="badge">
                    {topics.data?.find((t) => t.id === r.topic_id)?.[
                      i18n.language === "de" ? "label_de" : "label_en"
                    ] ?? t("expertise")}
                  </span>
                ))}
              </div>
            ) : (
              <p>{t("noRequirements")}</p>
            )}
            {job.requires_contract && <p>{t("contractRequired")}</p>}
          </section>
          <JobBriefing
            jobId={job.id}
            archived={job.status === "archived"}
            managementHint={permissions.data?.includes("jobs.manage") ?? false}
          />
          <JobDocuments
            jobId={job.id}
            canManage={permissions.data?.includes("jobs.manage") ?? false}
          />
          <ResourceComments kind="job" resourceId={job.id} />
          {ownClaim && session && (
            <AssignmentAmendments
              actor={session.user.id}
              claimId={ownClaim.id}
            />
          )}
        </div>
        <aside className="claim-panel panel">
          <p className="eyebrow">
            {i18n.getFixedT(i18n.language, "platform")("lecturerShare")}
          </p>
          <div className="amount">
            {terms.total_amount === null
              ? i18n.getFixedT(i18n.language, "platform")("privateCompensation")
              : money(terms.total_amount, terms.currency, i18n.language)}
          </div>
          <p>
            {terms.amount !== null && (
              <>
                {money(terms.amount, terms.currency, i18n.language)}{" "}
                {t(terms.rate_unit)}
              </>
            )}
          </p>
          <small>{lifeText("positionFeeHint")}</small>
          <hr />
          <h2>{t(ownClaim ? "termsSnapshot" : "terms")}</h2>
          <p className="preserve-text">{terms.terms}</p>
          <small>
            {t("termsVersion")} {terms.terms_version}
          </small>
          {job.claim_deadline && (
            <p>
              {t("claimDeadline")}:{" "}
              {dateTime(job.claim_deadline, i18n.language, zone)}
            </p>
          )}
          {ownClaim ? (
            <Notice>
              <CheckCircle2 size={20} />
              {t("confirmed")}
            </Notice>
          ) : teaching ? (
            <>
              <p>{t("claimHelp")}</p>
              {assignmentConflict && (
                <Notice kind="error">{t("claim_conflict")}</Notice>
              )}
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={accepted === consent}
                  onChange={(e) =>
                    setAccepted(e.target.checked ? consent : null)
                  }
                />
                <span>{t("acceptTerms")}</span>
              </label>
              <Button
                className="full-width"
                onClick={() => claim.mutate()}
                disabled={
                  accepted !== consent ||
                  assignmentConflict ||
                  !claims.isSuccess ||
                  !online ||
                  claim.isPending ||
                  job.status !== "published" ||
                  job.amount === null ||
                  job.total_amount === null
                }
              >
                {t(claim.isPending ? "claiming" : "claim")}
              </Button>
            </>
          ) : null}
          {claim.isError && <Notice kind="error">{t("error")}</Notice>}
          {result && result !== "confirmed" && (
            <Notice kind="error">
              {result === "already_assigned"
                ? lifeText("alreadyAssigned")
                : t(resultKey)}
            </Notice>
          )}
          {ownClaim && (
            <Button variant="secondary" asChild>
              <Link to={`/calendar?assignment=${encodeURIComponent(job.id)}`}>
                {t("viewCalendar")}
              </Link>
            </Button>
          )}
        </aside>
      </div>
    </>
  );
}
