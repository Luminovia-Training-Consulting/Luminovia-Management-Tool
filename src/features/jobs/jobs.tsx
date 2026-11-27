import { SessionScroll } from "../../components/session-scroll";
/**
 * Marketplace entry and exact actor-scoped job detail with immediate allocation.
 * Discovery owns bounded server paging and URL filters; only the atomic online
 * RPC confirms every session and preserves the accepted commercial snapshot.
 */
import { isDatabasePermissionDenied } from "../../lib/database-errors";
import { JobPricingPanel } from "../commercial/pricing";
import { JobLifecyclePanel } from "./lifecycle";
import { JobWithdrawalPanel } from "./withdrawal";
import { JobSickDay } from "./sick-day";
import { JobBriefing } from "./briefing";
import { JobRelatedNavigation } from "./related-navigation";
import { JobWaitlist } from "./lifecycle-extra";
import { lifecycleQuery, refreshJobState } from "./lifecycle-api";
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
import { offerDelivery } from "../training/delivery-schema";
import "../training/delivery-i18n";
import { db } from "../../lib/supabase";
import { dateTime, money } from "../../lib/dates";
import type { Job } from "../../lib/types";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import {
  ErrorState,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";

/** Return from a job detail view to the job list. */
function BackLink({
  companyDispatchOnly = false,
}: { companyDispatchOnly?: boolean } = {}) {
  const { t } = useTranslation();
  return (
    <Button variant="ghost" asChild>
      <NavLink to={companyDispatchOnly ? "/client" : "/jobs"}>
        <ChevronLeft size={18} />
        {t("back")}
      </NavLink>
    </Button>
  );
}

/** Summarize the authorised offer and its current staffing beside the detail actions. */
function JobDetailLabels({ actor, job }: { actor: string; job: Job }) {
  const { t, i18n } = useTranslation();
  const lifeText = useTranslation("jobLifecycle").t;
  // Share the lifecycle panel's actor/job query. Offer status describes the
  // vacancy, not staffing; only visible confirmed claims supply names. A
  // failed refresh can retain cached data, so don't use it after an error.
  const lifecycle = useQuery(lifecycleQuery(actor, job.id));
  const lecturers = lifecycle.isSuccess
    ? lifecycle.data.claims
        .filter(({ status }) => status === "confirmed")
        .map(({ lecturer_name }) => lecturer_name.trim())
        .filter(Boolean)
    : [];
  const company = job.customer_name.trim();
  return (
    <div className="job-detail-labels">
      <span className={`status status-${job.status}`}>
        {job.urgent_reopened_at && job.status === "published"
          ? t("sickDay:urgent")
          : t(job.status)}
      </span>
      <span className="badge">
        {company
          ? lifeText("detailCompany", { name: company })
          : lifeText("noCompany")}
      </span>
      {lecturers.length > 0 && (
        <span className="badge">
          {lifeText("detailLecturers", {
            count: lecturers.length,
            names: new Intl.ListFormat(i18n.language).format(lecturers),
          })}
        </span>
      )}
    </div>
  );
}

/** Display own accepted terms and request new allocation only through the atomic claim RPC. */
export function JobDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const lifeText = useTranslation("jobLifecycle").t;
  const deliveryText = useTranslation("trainingDelivery").t;
  const { session } = useAuth();
  const online = useOnline();
  const client = useQueryClient();
  const [editButtonTarget, setEditButtonTarget] =
    useState<HTMLDivElement | null>(null);
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
  const structuredDelivery = useQuery({
    queryKey: ["training-offer-delivery", session!.user.id, job?.id],
    enabled: online && Boolean(job && !job.dispatch_only),
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("training_offer_delivery", { p_job_id: job!.id })
        .abortSignal(signal);
      if (error) throw error;
      return offerDelivery.nullable().parse(data);
    },
  });
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
  const detailDenied = jobs.isError && isDatabasePermissionDenied(jobs.error);
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
  const companyDispatchOnly = job.dispatch_only === true;
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
  const sessions = [...job.job_sessions].sort(
    (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at),
  );
  const period =
    sessions.length > 0
      ? new Intl.DateTimeFormat(i18n.language, {
          dateStyle: "medium",
          timeStyle: "short",
          timeZone: job.time_zone,
        }).formatRange(
          new Date(sessions[0].starts_at),
          new Date(sessions.at(-1)!.ends_at),
        )
      : null;
  return (
    <>
      <BackLink companyDispatchOnly={companyDispatchOnly} />
      <PageHeading title={job.title} />
      <div className="section-stack job-detail-sections">
        <div className="job-detail-toolbar">
          {!companyDispatchOnly && (
            <JobRelatedNavigation
              actor={session!.user.id}
              jobId={job.id}
              showReadiness={
                permissions.data?.includes("courses.manage") ||
                (teaching &&
                  claims.isSuccess &&
                  ownClaim?.status === "confirmed")
              }
              afterWorkspace={<div ref={setEditButtonTarget} />}
            />
          )}
          <JobDetailLabels actor={session!.user.id} job={job} />
        </div>
        {permissions.data?.includes("jobs.manage") && (
          <div id="job-pricing" tabIndex={-1}>
            <JobPricingPanel job={job} />
          </div>
        )}
        {!companyDispatchOnly &&
          teaching &&
          ownClaim?.status === "confirmed" && (
            <div className="form-actions">
              <JobSickDay
                key={ownClaim.id}
                claim={ownClaim}
                zone={job.time_zone}
              />
              <Button asChild variant="secondary">
                <Link to={`/finance?claim=${encodeURIComponent(ownClaim.id)}`}>
                  {t("submitInvoice")}
                </Link>
              </Button>
            </div>
          )}
        {!companyDispatchOnly && (
          <JobWithdrawalPanel
            key={job.id}
            jobId={job.id}
            zone={job.time_zone}
          />
        )}
        {!companyDispatchOnly && teaching && <JobWaitlist jobId={job.id} />}
      </div>
      <div
        className={
          companyDispatchOnly
            ? "job-detail-content"
            : "job-detail-content detail-layout"
        }
      >
        <div className="section-stack job-detail-sections">
          <section className="panel">
            <div className="inline-meta">
              {structuredDelivery.data ? (
                <>
                  <span>{deliveryText(structuredDelivery.data.mode)}</span>
                  {structuredDelivery.data.locations.map(
                    ({ city, country }) => (
                      <span key={`${city}:${country}`}>
                        <MapPin size={17} aria-hidden="true" />
                        {[city, country].filter(Boolean).join(", ")}
                      </span>
                    ),
                  )}
                </>
              ) : (
                <>
                  {job.location && (
                    <span>
                      <MapPin size={17} />
                      {job.location}
                    </span>
                  )}
                  <span>{t(job.delivery_type)}</span>
                </>
              )}
            </div>
            <h2>{t("description")}</h2>
            <p className="preserve-text">{job.description}</p>
            {!companyDispatchOnly && (
              <JobBuildingBlockReference
                jobId={job.id}
                canManage={permissions.data?.includes("jobs.manage") ?? false}
              />
            )}
            {period && (
              <>
                <h2>{lifeText("deliveryPeriod")}</h2>
                <p>
                  {period} · {job.time_zone}
                </p>
              </>
            )}
            <h2>{t("sessions")}</h2>
            <p className="muted">
              {t("timezone")}: {zone}
              {zone !== job.time_zone && ` · ${job.time_zone}`}
            </p>
            {sessions.length > 0 && (
              <SessionScroll label={t("sessions")}>
                <ol className="session-list">
                  {sessions.map((s) => (
                    <li key={s.id}>
                      <CalendarDays size={18} aria-hidden="true" />
                      <div>
                        <strong>
                          {dateTime(s.starts_at, i18n.language, zone)}
                        </strong>
                        <span>
                          {t("end")}: {dateTime(s.ends_at, i18n.language, zone)}
                        </span>
                        {zone !== job.time_zone && (
                          <small>
                            {dateTime(
                              s.starts_at,
                              i18n.language,
                              job.time_zone,
                            )}{" "}
                            –{" "}
                            {dateTime(s.ends_at, i18n.language, job.time_zone)}
                            {" · "}
                            {job.time_zone}
                          </small>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              </SessionScroll>
            )}
            {!companyDispatchOnly && (
              <>
                <h2>{t("requirements")}</h2>
                {job.job_requirements.length ? (
                  <div className="tags">
                    {job.job_requirements.map((r) => (
                      <span key={r.topic_id} className="badge">
                        {topics.data?.find((t) => t.id === r.topic_id)?.[
                          i18n.language.startsWith("de")
                            ? "label_de"
                            : "label_en"
                        ] ?? t("expertise")}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p>{t("noRequirements")}</p>
                )}
                {job.requires_contract && <p>{t("contractRequired")}</p>}
              </>
            )}
          </section>
          <JobLifecyclePanel
            key={job.id}
            job={job}
            dispatchOnly={companyDispatchOnly}
            editButtonTarget={editButtonTarget}
          />
          {!companyDispatchOnly && (
            <>
              <JobBriefing
                jobId={job.id}
                archived={job.status === "archived"}
                managementHint={
                  permissions.data?.includes("jobs.manage") ?? false
                }
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
            </>
          )}
        </div>
        {!companyDispatchOnly && (
          <aside className="claim-panel panel">
            {job.company_internal ? (
              <p>
                {i18n.getFixedT(i18n.language, "platform")("internalStaffing")}
              </p>
            ) : (
              <>
                <p className="eyebrow">
                  {i18n.getFixedT(i18n.language, "platform")("lecturerShare")}
                </p>
                <div className="amount">
                  {terms.total_amount === null
                    ? i18n.getFixedT(
                        i18n.language,
                        "platform",
                      )("privateCompensation")
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
              </>
            )}
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
                    (!job.company_internal &&
                      (job.amount === null || job.total_amount === null))
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
        )}
      </div>
    </>
  );
}
