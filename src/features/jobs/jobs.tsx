import { JobDocuments } from "../files/files";
import { permissionsQuery } from "../../lib/queries";
import { useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarDays,
  CheckCircle2,
  MapPin,
  Search,
  SlidersHorizontal,
} from "lucide-react";
import { DateTime } from "luxon";
import { useAuth } from "../auth/auth-context";
import {
  claimsQuery,
  jobsQuery,
  profileQuery,
  topicsQuery,
} from "../../lib/queries";
import type { Job } from "../../lib/types";
import { db } from "../../lib/supabase";
import { dateTime, money } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { BackLink } from "../../app/shell";
export function JobCard({ job, index = 0 }: { job: Job; index?: number }) {
  const { t, i18n } = useTranslation();
  const first = [...job.job_sessions].sort((a, b) =>
    a.starts_at.localeCompare(b.starts_at),
  )[0];
  return (
    <article className={`job-card accent-${index % 4}`}>
      <div className="job-card-top">
        <span className="badge">{t(job.delivery_type)}</span>
        <span className={`status status-${job.status}`}>{t(job.status)}</span>
      </div>
      <p className="job-customer">{job.customer_name}</p>
      <h2>
        <Link to={`/jobs/${job.id}`}>
          {job.title}
          <ArrowUpRight size={21} />
        </Link>
      </h2>
      <p className="job-excerpt">{job.description}</p>
      <div className="job-meta">
        <span>
          <CalendarDays size={16} />
          {first
            ? dateTime(first.starts_at, i18n.language, job.time_zone)
            : "—"}
        </span>
        <span>
          <MapPin size={16} />
          {job.location || t(job.delivery_type)}
        </span>
      </div>
      <div className="job-card-bottom">
        <div>
          <strong>
            {money(job.total_amount, job.currency, i18n.language)}
          </strong>
          <small>
            {t("total")} ·{" "}
            {t("sessionCount", { count: job.job_sessions.length })}
          </small>
        </div>
        <Link
          className="round-link"
          to={`/jobs/${job.id}`}
          aria-label={`${t("details")}: ${job.title}`}
        >
          <ArrowUpRight size={21} />
        </Link>
      </div>
    </article>
  );
}
export function Jobs() {
  const { t, i18n } = useTranslation();
  const query = useQuery(jobsQuery);
  const topics = useQuery(topicsQuery);
  const [params, setParams] = useSearchParams();
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  const q = params.get("q") ?? "";
  const delivery = params.get("delivery") ?? "";
  const topic = params.get("topic") ?? "";
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const min = params.get("min") ?? "";
  const currency = params.get("currency") ?? "";
  const filtered =
    query.data?.filter((j) => {
      const search = [j.title, j.description, j.customer_name, j.location]
        .join(" ")
        .toLocaleLowerCase(i18n.language);
      const dates = j.job_sessions.map(
        (s) =>
          DateTime.fromISO(s.starts_at).setZone(j.time_zone).toISODate() ?? "",
      );
      return (
        search.includes(q.toLocaleLowerCase(i18n.language)) &&
        (!delivery || j.delivery_type === delivery) &&
        (!topic || j.job_requirements.some((r) => r.topic_id === topic)) &&
        (!(from || to) ||
          dates.some((d) => (!from || d >= from) && (!to || d <= to))) &&
        (!min || Number(j.total_amount) >= Number(min)) &&
        (!currency || j.currency === currency)
      );
    }) ?? [];
  return (
    <>
      <PageHeading
        eyebrow={t("opportunities")}
        title={t("jobs")}
        description={t("heroText")}
      />
      <section className="filters panel" aria-label={t("search")}>
        <div className="search-field">
          <Search size={20} />
          <label htmlFor="job-search" className="sr-only">
            {t("search")}
          </label>
          <input
            id="job-search"
            type="search"
            value={q}
            placeholder={t("search")}
            onChange={(e) => update("q", e.target.value)}
          />
          <SlidersHorizontal size={18} />
        </div>
        <div className="filter-grid">
          <Field id="filter-delivery" label={t("delivery")}>
            <select
              id="filter-delivery"
              value={delivery}
              onChange={(e) => update("delivery", e.target.value)}
            >
              <option value="">{t("all")}</option>
              <option value="online">{t("online")}</option>
              <option value="onsite">{t("onsite")}</option>
            </select>
          </Field>
          <Field id="filter-topic" label={t("topic")}>
            <select
              id="filter-topic"
              value={topic}
              onChange={(e) => update("topic", e.target.value)}
            >
              <option value="">{t("all")}</option>
              {topics.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {i18n.language === "de" ? t.label_de : t.label_en}
                </option>
              ))}
            </select>
          </Field>
          <Field id="filter-from" label={t("dateFrom")}>
            <input
              id="filter-from"
              type="date"
              value={from}
              onChange={(e) => update("from", e.target.value)}
            />
          </Field>
          <Field id="filter-to" label={t("dateTo")}>
            <input
              id="filter-to"
              type="date"
              value={to}
              onChange={(e) => update("to", e.target.value)}
            />
          </Field>
          <Field id="filter-min" label={t("minTotal")}>
            <input
              id="filter-min"
              type="number"
              min="0"
              step="1"
              value={min}
              onChange={(e) => update("min", e.target.value)}
            />
          </Field>
          <Field id="filter-currency" label={t("currency")}>
            <select
              id="filter-currency"
              value={currency}
              onChange={(e) => update("currency", e.target.value)}
            >
              <option value="">{t("all")}</option>
              <option>EUR</option>
              <option>AUD</option>
            </select>
          </Field>
        </div>
        {params.size > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setParams({})}>
            {t("resetFilters")}
          </Button>
        )}
      </section>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : filtered.length ? (
        <div className="jobs-grid">
          {filtered.map((job, index) => (
            <JobCard key={job.id} job={job} index={index} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <BriefcaseBusiness size={40} />
          <h2>{t("noJobs")}</h2>
          <p>{t("noJobsHint")}</p>
        </div>
      )}
    </>
  );
}
export function JobDetail() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const { session } = useAuth();
  const online = useOnline();
  const client = useQueryClient();
  const [accepted, setAccepted] = useState<number | null>(null);
  const key = useRef(crypto.randomUUID());
  const permissions = useQuery(permissionsQuery(session!.user.id));
  const jobs = useQuery(jobsQuery);
  const topics = useQuery(topicsQuery);
  const claims = useQuery(claimsQuery(session!.user.id));
  const profile = useQuery(profileQuery(session!.user.id));
  const job = jobs.data?.find((j) => j.id === id);
  const ownClaim = claims.data?.find((c) => c.job_id === id);
  const claim = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (!job || accepted !== job.terms_version) throw new Error("invalid");
      const { data, error } = await db().rpc("claim_job", {
        p_job_id: job.id,
        p_idempotency_key: key.current,
        p_terms_version: accepted,
      });
      if (error) throw error;
      return data as { status: string; claim_id?: string };
    },
    onSuccess: () => client.invalidateQueries(),
  });
  if (jobs.isPending) return <Loading />;
  if (jobs.isError) return <ErrorState retry={() => void jobs.refetch()} />;
  if (!job)
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
      </>
    );
  const zone = profile.data?.time_zone ?? job.time_zone;
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
      "mfa_required",
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
            <p className="preserve-text">{job.description}</p>
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
          <JobDocuments
            jobId={job.id}
            canManage={permissions.data?.includes("jobs.manage") ?? false}
          />
        </div>
        <aside className="claim-panel panel">
          <p className="eyebrow">{t("total")}</p>
          <div className="amount">
            {money(terms.total_amount, terms.currency, i18n.language)}
          </div>
          <p>
            {money(terms.amount, terms.currency, i18n.language)}{" "}
            {t(terms.rate_unit)}
          </p>
          <small>{t("totalHint")}</small>
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
          {ownClaim || result === "confirmed" ? (
            <Notice>
              <CheckCircle2 size={20} />
              {t("confirmed")}
            </Notice>
          ) : (
            <>
              <p>{t("claimHelp")}</p>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={accepted === job.terms_version}
                  onChange={(e) =>
                    setAccepted(e.target.checked ? job.terms_version : null)
                  }
                />
                <span>{t("acceptTerms")}</span>
              </label>
              <Button
                className="full-width"
                onClick={() => claim.mutate()}
                disabled={
                  accepted !== job.terms_version ||
                  !online ||
                  claim.isPending ||
                  job.status !== "published"
                }
              >
                {t(claim.isPending ? "claiming" : "claim")}
              </Button>
            </>
          )}
          {claim.isError && <Notice kind="error">{t("error")}</Notice>}
          {result && result !== "confirmed" && (
            <Notice kind="error">{t(resultKey)}</Notice>
          )}
          {ownClaim && (
            <Button variant="secondary" asChild>
              <Link to="/calendar">{t("viewCalendar")}</Link>
            </Button>
          )}
        </aside>
      </div>
    </>
  );
}
