import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowUpRight, CalendarDays, MapPin } from "lucide-react";
import type { Job } from "../../lib/types";
import { dateTime, money } from "../../lib/dates";
import "./lifecycle-i18n";
import "../commercial/platform-i18n";
export function JobCard({ job, index = 0 }: { job: Job; index?: number }) {
  const { t, i18n } = useTranslation();
  const lifeText = useTranslation("jobLifecycle").t;
  const priceText = useTranslation("platform").t;
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
            {priceText("lecturerShare")} · {lifeText("perPosition")} ·{" "}
            {t("sessionCount", { count: job.job_sessions.length })}
            {(job.capacity ?? 1) > 1 &&
              ` · ${job.capacity} ${lifeText("positions")}`}
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
