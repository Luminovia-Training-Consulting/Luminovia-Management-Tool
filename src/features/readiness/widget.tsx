/** Course preparation derives status from scoped server records; the browser edits requirements and receipts, never an authoritative readiness percentage. Components render pending, denied and committed outcomes separately and preserve reviewed form state. */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ClipboardCheck } from "lucide-react";
import { ErrorState, Loading, TextLink } from "../../components/common";
import { readinessQuery } from "./api";
import "./i18n";
import "./readiness.css";

/** Share the actor-scoped readiness query with the centre while avoiding another polling timer on the dashboard. */
export function DashboardReadinessWidget({ actor }: { actor: string }) {
  const { t } = useTranslation("readiness");
  const courses = useQuery({
    ...readinessQuery(actor),
    refetchInterval: false,
  });
  const [openedAt] = useState(() => Date.now());
  const now = Math.max(openedAt, courses.dataUpdatedAt);
  const upcoming =
    courses.data?.filter(
      (course) => !course.ends_at || Date.parse(course.ends_at) >= now,
    ) ?? [];
  const missing = upcoming.filter(
    (course) => course.status !== "ready" && course.status !== "completed",
  );
  return (
    <section
      className="panel dashboard-widget readiness-widget"
      aria-label={t("title")}
    >
      <div className="section-heading">
        <h2>{t("title")}</h2>
        <ClipboardCheck aria-hidden="true" />
      </div>
      <p className="muted">{t("widgetHint")}</p>
      {courses.isError ? (
        <ErrorState retry={() => void courses.refetch()} />
      ) : courses.isPending ? (
        <Loading />
      ) : (
        <>
          <p className="readiness-widget-count">
            {t("widgetCount", { count: missing.length })}
          </p>
          <p>{t("widgetReady", { count: upcoming.length - missing.length })}</p>
          <ul className="readiness-documents">
            {missing.slice(0, 3).map((course) => (
              <li key={course.id}>
                <Link to={`/readiness/${course.id}`}>{course.title}</Link>
                <small>{t(course.status)}</small>
              </li>
            ))}
          </ul>
        </>
      )}
      <TextLink to="/readiness">{t("widgetOpen")}</TextLink>
    </section>
  );
}
