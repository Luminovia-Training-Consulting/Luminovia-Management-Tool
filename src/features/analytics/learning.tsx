import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { portalInternalEdition } from "../../lib/installation-brand";
import { useOnline } from "../../lib/online";
import { useAuth } from "../auth/auth-context";
import {
  analyticsPreset,
  type AnalyticsPeriod,
  type AnalyticsPreset,
} from "./period";
import { analyticsScopes, type AnalyticsScope } from "./schema";
import {
  hasLearningAnalytics,
  learningAnalyticsAccessQuery,
  learningAnalyticsReportQuery,
} from "./learning-api";
import {
  learningReportStatus,
  type LearningAnalyticsAccess,
  type LearningAnalyticsReport,
  type LearningReportStatus,
} from "./learning-schema";
import {
  BarChart,
  ChartKey,
  ChartTable,
  LineChart,
  TimeDonut,
  type ChartSeries,
} from "./charts";
import { PeriodForm, Totals } from "./report-ui";
import "./learning-i18n";

const presets = ["around", "historyYear", "nextQuarter"] as const;
const coursesPerPage = 25;

function learningReportPages(total: number) {
  return Math.max(1, Math.ceil(total / coursesPerPage));
}

function LearningReport({
  report,
  page,
  setPage,
}: {
  report: LearningAnalyticsReport;
  page: number;
  setPage: (page: number) => void;
}) {
  const { t, i18n } = useTranslation("learningAnalytics");
  const number = new Intl.NumberFormat(i18n.language, {
    maximumFractionDigits: 0,
  });
  const percent = new Intl.NumberFormat(i18n.language, {
    style: "percent",
    maximumFractionDigits: 0,
  });
  const hours = new Intl.NumberFormat(i18n.language, {
    style: "unit",
    unit: "hour",
    maximumFractionDigits: 1,
  });
  const labels = report.months.map(({ month }) =>
    DateTime.fromISO(month, { zone: "UTC" })
      .setLocale(i18n.language)
      .toLocaleString({ month: "short", year: "2-digit" }),
  );
  const { totals, courses } = report;
  const pages = learningReportPages(totals.courses);
  const counts: ChartSeries[] = [
    {
      name: t("finished"),
      values: report.months.map((month) => month.finished),
      tone: "past",
    },
    {
      name: t("upcoming"),
      values: report.months.map((month) => month.upcoming),
      tone: "future",
    },
  ];
  const participation: ChartSeries[] = [
    {
      name: t("enrolments"),
      values: report.months.map((month) => month.enrolments),
      tone: "past",
    },
    {
      name: t("completions"),
      values: report.months.map((month) => month.completions),
      tone: "open",
    },
  ];
  const rate = (count: number, total: number) =>
    total === 0 ? "—" : percent.format(count / total);
  const readings = [
    "courses",
    "upcoming",
    "participants",
    "enrolments",
    "completions",
    "certificates",
    "sessions",
  ] as const;

  if (!totals.courses) return <p className="panel">{t("empty")}</p>;
  return (
    <>
      <Totals
        items={[
          ...readings.map((key) => ({
            label: t(key === "upcoming" ? "upcomingCourses" : key),
            value: number.format(totals[key]),
          })),
          { label: t("minutes"), value: hours.format(totals.minutes / 60) },
          {
            label: t("completionRate"),
            value: rate(totals.completions, totals.enrolments),
          },
          {
            label: t("attendanceRate"),
            value: rate(totals.present, totals.present + totals.absent),
          },
        ]}
      />
      <section className="panel">
        <h2>{t("coursesOverTime")}</h2>
        <ChartKey series={counts} />
        <BarChart labels={labels} series={counts} format={number.format} />
        <ChartTable
          title={t("data")}
          month={t("month")}
          labels={labels}
          series={counts}
          format={number.format}
        />
      </section>
      <section className="panel">
        <h2>{t("participantsOverTime")}</h2>
        <ChartKey series={participation} />
        <LineChart
          labels={labels}
          series={participation}
          format={number.format}
        />
        <ChartTable
          title={t("data")}
          month={t("month")}
          labels={labels}
          series={participation}
          format={number.format}
        />
      </section>
      <section className="panel">
        <h2>{t("attendance")}</h2>
        <TimeDonut
          past={totals.present}
          future={totals.absent}
          pastLabel={t("present")}
          futureLabel={t("absent")}
          empty={t("attendanceEmpty")}
          format={number.format}
          percent={percent.format}
        />
        <p>
          {t("excused")} · {number.format(totals.excused)}
        </p>
        <p className="analytics-muted">{t("attendanceBasis")}</p>
      </section>
      <section className="panel">
        <h2>{t("courseBreakdown")}</h2>
        <div
          className="analytics-scroll analytics-data"
          role="region"
          aria-label={t("courseBreakdown")}
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                {[
                  "course",
                  "status",
                  "courseStart",
                  "enrolments",
                  "completions",
                  "certificates",
                  "sessions",
                  "minutes",
                  "attendanceRate",
                ].map((key) => (
                  <th scope="col" key={key}>
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {courses.map((course) => (
                <tr key={course.id}>
                  <th scope="row">
                    {course.status === "archived" ? (
                      course.title
                    ) : (
                      <Link to={`/courses/${course.id}/workspace`}>
                        {course.title}
                      </Link>
                    )}
                    <div className="analytics-muted">
                      {course.organisation}
                      {course.class_name ? ` · ${course.class_name}` : ""}
                    </div>
                  </th>
                  <td>{t(course.status)}</td>
                  <td>
                    {course.starts_at
                      ? DateTime.fromISO(course.starts_at)
                          .setZone(report.time_zone)
                          .setLocale(i18n.language)
                          .toLocaleString(DateTime.DATE_MED)
                      : "—"}
                  </td>
                  <td>{number.format(course.enrolments)}</td>
                  <td>{number.format(course.completions)}</td>
                  <td>{number.format(course.certificates)}</td>
                  <td>{number.format(course.sessions)}</td>
                  <td>{hours.format(course.minutes / 60)}</td>
                  <td>
                    {rate(course.present, course.present + course.absent)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="form-actions">
            <Button
              variant="secondary"
              disabled={page === 1}
              onClick={() => setPage(page - 1)}
            >
              {t("previous")}
            </Button>
            <span role="status">{t("page", { page, pages })}</span>
            <Button
              variant="secondary"
              disabled={page >= pages}
              onClick={() => setPage(page + 1)}
            >
              {t("next")}
            </Button>
          </div>
        )}
      </section>
    </>
  );
}

function LearningAnalyticsView({
  actor,
  access,
}: {
  actor: string;
  access: LearningAnalyticsAccess;
}) {
  const { t } = useTranslation("learningAnalytics");
  const [selectedScope, setScope] = useState<AnalyticsScope>();
  const [organisationId, setOrganisation] = useState("");
  const [preset, setPreset] = useState<AnalyticsPreset>("around");
  const [periodOverride, setPeriod] = useState<AnalyticsPeriod>();
  const [status, setStatus] = useState<LearningReportStatus>("all");
  const [search, setSearch] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [dateFormVersion, resetDateForm] = useState(0);
  const [page, setPage] = useState(1);

  const companies = access.organisations.filter(({ company }) => company);
  const scopes = analyticsScopes.filter((scope) =>
    scope === "company" ? companies.length > 0 : access[scope],
  );
  const scope =
    selectedScope && scopes.includes(selectedScope)
      ? selectedScope
      : access.staff
        ? "staff"
        : scopes[0];
  const organisations = scope === "company" ? companies : access.organisations;
  const organisation =
    organisations.find(({ id }) => id === organisationId) ??
    (scope === "company" ? companies[0] : undefined);
  const zone = access.time_zone ?? "UTC";
  const period =
    periodOverride ?? analyticsPreset(preset, DateTime.now().setZone(zone));
  const query = useQuery({
    ...learningAnalyticsReportQuery(actor, {
      scope: scope ?? "personal",
      organisation: scope === "personal" ? null : (organisation?.id ?? null),
      period,
      status,
      search,
      page,
    }),
    enabled: Boolean(scope),
  });
  const lastPage = query.isSuccess
    ? learningReportPages(query.data.totals.courses)
    : page;
  if (page > lastPage) {
    setPage(lastPage);
    return <Loading />;
  }
  if (!scope) return <p className="panel">{t("unavailable")}</p>;

  function searchCourses(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchDraft.trim());
    setPage(1);
  }

  function resetFilters() {
    setOrganisation("");
    setPreset("around");
    setPeriod(undefined);
    setStatus("all");
    setSearch("");
    setSearchDraft("");
    setPage(1);
    resetDateForm((version) => version + 1);
  }

  return (
    <>
      <section className="panel">
        <div className="analytics-filters">
          {scopes.length > 1 && (
            <Field id="learning-scope" label={t("scope")}>
              <select
                value={scope}
                onChange={(event) => {
                  setScope(event.target.value as AnalyticsScope);
                  setOrganisation("");
                  setPage(1);
                }}
              >
                {scopes.map((value) => (
                  <option key={value} value={value}>
                    {t(value)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {scope !== "personal" && organisations.length > 0 && (
            <Field id="learning-company" label={t("organisation")}>
              <select
                value={organisation?.id ?? ""}
                onChange={(event) => {
                  setOrganisation(event.target.value);
                  setPage(1);
                }}
              >
                {scope === "staff" && (
                  <option value="">{t("allOrganisations")}</option>
                )}
                {organisations.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field id="learning-period" label={t("period")}>
            <select
              value={periodOverride ? "custom" : preset}
              onChange={(event) => {
                setPreset(event.target.value as AnalyticsPreset);
                setPeriod(undefined);
                setPage(1);
              }}
            >
              {periodOverride && <option value="custom">{t("custom")}</option>}
              {presets.map((value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="learning-status" label={t("status")}>
            <select
              value={status}
              onChange={(event) => {
                setStatus(learningReportStatus.parse(event.target.value));
                setPage(1);
              }}
            >
              {learningReportStatus.options.map((value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <PeriodForm
          idPrefix="learning-dates"
          key={`${period.from}/${period.through}/${dateFormVersion}`}
          period={period}
          onApply={(next) => {
            setPeriod(next);
            setPage(1);
          }}
        />
        <form
          className="analytics-filters analytics-date-filters"
          onSubmit={searchCourses}
        >
          <Field id="learning-search" label={t("search")}>
            <input
              type="search"
              name="search"
              maxLength={120}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
          </Field>
          <Button type="submit" variant="secondary">
            {t("applySearch")}
          </Button>
        </form>
        <div className="analytics-filter-footer">
          <p className="analytics-muted">{t("zone", { zone })}</p>
          <Button type="button" variant="ghost" onClick={resetFilters}>
            {t("resetFilters")}
          </Button>
        </div>
        <p className="analytics-muted">{t("cohortBasis")}</p>
      </section>
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        <LearningReport report={query.data} page={page} setPage={setPage} />
      )}
    </>
  );
}

export function LearningAnalyticsPage() {
  const { t } = useTranslation("learningAnalytics");
  const actor = useAuth().session?.user.id ?? "";
  const online = useOnline();
  const access = useQuery({
    ...learningAnalyticsAccessQuery(actor),
    enabled: Boolean(actor && online),
  });
  return (
    <div className="portal-analytics">
      <PageHeading title={t("title")} description={t("description")} />
      {portalInternalEdition && (
        <div className="form-actions">
          <Button asChild variant="secondary">
            <Link to="/finance/analytics">{t("general")}</Link>
          </Button>
        </div>
      )}
      {!online ? (
        <Notice>{t("offline")}</Notice>
      ) : access.isPending ? (
        <Loading />
      ) : access.isError ? (
        <ErrorState retry={() => void access.refetch()} />
      ) : hasLearningAnalytics(access.data) ? (
        <LearningAnalyticsView actor={actor} access={access.data} />
      ) : (
        <p className="panel">{t("unavailable")}</p>
      )}
    </div>
  );
}
