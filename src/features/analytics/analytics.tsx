import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import {
  ErrorState,
  Field,
  Loading,
  PageHeading,
} from "../../components/common";
import { Button } from "../../components/ui/button";
import { portalInternalEdition } from "../../lib/installation-brand";
import { useAuth } from "../auth/auth-context";
import { forecastQuery } from "../workbench/finance-api";
import {
  analyticsAccessQuery,
  analyticsPreset,
  analyticsReportQuery,
  analyticsUntil,
  type AnalyticsPeriod,
  type AnalyticsPreset,
} from "./api";
import {
  BarChart,
  ChartKey,
  ChartTable,
  LineChart,
  TimeDonut,
  type ChartSeries,
} from "./charts";
import {
  analyticsScopes,
  type AnalyticsAccess,
  type AnalyticsCurrency,
  type AnalyticsReport,
  type AnalyticsScope,
} from "./schema";
import "./i18n";
import "./analytics.css";

const presets = ["around", "historyYear", "nextQuarter"] as const;
const currencyCodes = ["EUR", "AUD"] as const;

type Reading = { label: string; value: string };

function Totals({ items }: { items: Reading[] }) {
  return (
    <dl className="analytics-totals">
      {items.map(({ label, value }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function PeriodForm({
  period,
  onApply,
}: {
  period: AnalyticsPeriod;
  onApply: (period: AnalyticsPeriod) => void;
}) {
  const { t } = useTranslation("analytics");
  const [error, setError] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextPeriod = {
      from: String(form.get("from")),
      through: String(form.get("through")),
    };
    if (!analyticsUntil(nextPeriod)) {
      setError(true);
      return;
    }
    setError(false);
    onApply(nextPeriod);
  }
  return (
    <form onSubmit={submit}>
      <div className="analytics-filters analytics-date-filters">
        <Field id="analytics-from" label={t("from")}>
          <input name="from" type="date" defaultValue={period.from} required />
        </Field>
        <Field id="analytics-through" label={t("through")}>
          <input
            name="through"
            type="date"
            defaultValue={period.through}
            required
          />
        </Field>
        <Button type="submit" variant="secondary">
          {t("apply")}
        </Button>
      </div>
      {error && (
        <p className="error" role="alert">
          {t("invalidPeriod")}
        </p>
      )}
    </form>
  );
}

function AnalyticsView({
  actor,
  access,
}: {
  actor: string;
  access: AnalyticsAccess;
}) {
  const { t } = useTranslation("analytics");
  const [selectedScope, setSelectedScope] = useState<AnalyticsScope | null>(
    null,
  );
  const [companyId, setCompanyId] = useState("");
  const [staffCompanyId, setStaffCompanyId] = useState("");
  const [preset, setPreset] = useState<AnalyticsPreset>("around");
  const [customPeriod, setCustomPeriod] = useState<AnalyticsPeriod | null>(
    null,
  );
  const [currency, setCurrency] = useState<AnalyticsCurrency>("EUR");
  const companies = access.organisations.filter((item) => item.company);
  const scopes = analyticsScopes.filter((scope) =>
    scope === "company" ? companies.length > 0 : access[scope],
  );
  const defaultScope = access.staff ? "staff" : scopes[0];
  const scope =
    selectedScope && scopes.includes(selectedScope)
      ? selectedScope
      : defaultScope;
  const company = companies.find(({ id }) => id === companyId) ?? companies[0];
  const staffCompany = access.organisations.find(
    ({ id }) => id === staffCompanyId,
  );
  const zone =
    (scope === "company" ? company?.time_zone : access.time_zone) ?? "UTC";
  const now = DateTime.now().setZone(zone);
  const period = customPeriod ?? analyticsPreset(preset, now);
  const organisation =
    scope === "company"
      ? company?.id
      : scope === "staff"
        ? staffCompany?.id
        : null;
  const query = useQuery({
    ...analyticsReportQuery(
      actor,
      scope ?? "personal",
      organisation ?? null,
      period,
    ),
    enabled: Boolean(scope && analyticsUntil(period)),
  });
  if (!scope) return <p className="panel">{t("unavailable")}</p>;

  return (
    <>
      <section className="panel">
        <div className="analytics-filters">
          {scopes.length > 1 && (
            <Field id="analytics-scope" label={t("scope")}>
              <select
                value={scope}
                onChange={(event) =>
                  setSelectedScope(event.target.value as AnalyticsScope)
                }
              >
                {scopes.map((item) => (
                  <option key={item} value={item}>
                    {t(item)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {scope === "company" && (
            <Field id="analytics-company" label={t("organisation")}>
              <select
                value={company?.id}
                onChange={(event) => setCompanyId(event.target.value)}
              >
                {companies.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {scope === "staff" && access.organisations.length > 0 && (
            <Field id="analytics-staff-company" label={t("organisation")}>
              <select
                value={staffCompany?.id ?? ""}
                onChange={(event) => setStaffCompanyId(event.target.value)}
              >
                <option value="">{t("allOrganisations")}</option>
                {access.organisations.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field id="analytics-period" label={t("period")}>
            <select
              value={customPeriod ? "custom" : preset}
              onChange={(event) => {
                setPreset(event.target.value as AnalyticsPreset);
                setCustomPeriod(null);
              }}
            >
              {customPeriod && <option value="custom">{t("custom")}</option>}
              {presets.map((item) => (
                <option key={item} value={item}>
                  {t(item)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <PeriodForm
          key={`${period.from}/${period.through}`}
          period={period}
          onApply={setCustomPeriod}
        />
        <p className="analytics-muted">{t("timeZone", { zone })}</p>
      </section>
      {query.isPending && <Loading />}
      {query.isError && <ErrorState retry={() => void query.refetch()} />}
      {query.isSuccess && (
        <ReportPanels
          actor={actor}
          report={query.data}
          companyFiltered={scope === "staff" && Boolean(organisation)}
          currency={currency}
          setCurrency={setCurrency}
        />
      )}
    </>
  );
}

function ReportPanels({
  report,
  actor,
  companyFiltered,
  currency,
  setCurrency,
}: {
  report: AnalyticsReport;
  actor: string;
  companyFiltered: boolean;
  currency: AnalyticsCurrency;
  setCurrency: (currency: AnalyticsCurrency) => void;
}) {
  const { t, i18n } = useTranslation("analytics");
  const [activity, setActivity] = useState<"assignments" | "monthlyHours">(
    "assignments",
  );
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const numbers = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const percentages = new Intl.NumberFormat(locale, { style: "percent" });
  const money = new Intl.NumberFormat(locale, { style: "currency", currency });
  const date = new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
  const labels = report.months.map(({ month }) =>
    date.format(new Date(`${month}T00:00:00Z`)),
  );
  const table = { labels, month: t("month"), title: t("data") };
  const hours = (value: number) =>
    t("scheduledHours", { value: numbers.format(value) });
  const sum = (values: (number | null)[]) =>
    values.reduce<number>((total, value) => total + (value ?? 0), 0);

  const assignments: ChartSeries[] = [
    {
      name: t("past"),
      tone: "past",
      values: report.months.map((month) =>
        month.history ? month.past_assignments : null,
      ),
    },
    {
      name: t("future"),
      tone: "future",
      values: report.months.map((month) =>
        month.forecast ? month.future_assignments : null,
      ),
    },
  ];
  if (report.months[0].open_positions !== null)
    assignments.push({
      name: t("open"),
      tone: "open",
      values: report.months.map((month) =>
        month.forecast ? month.open_positions : null,
      ),
    });
  const teaching: ChartSeries[] = [
    {
      name: t("past"),
      tone: "past",
      values: report.months.map((month) =>
        month.history ? month.past_minutes / 60 : null,
      ),
    },
    {
      name: t("future"),
      tone: "future",
      values: report.months.map((month) =>
        month.forecast ? month.future_minutes / 60 : null,
      ),
    },
  ];

  const showingHours = activity === "monthlyHours";
  const activitySeries = showingHours ? teaching : assignments;
  const formatActivity = showingHours ? hours : numbers.format;

  return (
    <>
      <div className="analytics-figures">
        <section className="panel">
          <div className="analytics-section-heading">
            <h2>{t(activity)}</h2>
            <Field id="analytics-activity" label={t("monthlyMetric")}>
              <select
                value={activity}
                onChange={(event) =>
                  setActivity(
                    event.target.value === "monthlyHours"
                      ? "monthlyHours"
                      : "assignments",
                  )
                }
              >
                <option value="assignments">{t("assignments")}</option>
                <option value="monthlyHours">{t("monthlyHours")}</option>
              </select>
            </Field>
          </div>
          <Totals
            items={activitySeries.map(({ name, values }) => ({
              label: name,
              value: formatActivity(sum(values)),
            }))}
          />
          <ChartKey series={activitySeries} />
          <BarChart
            labels={labels}
            series={activitySeries}
            format={formatActivity}
          />
          {!showingHours && (
            <p className="analytics-muted">{t("allocationNote")}</p>
          )}
          {!showingHours && assignments.length > 2 && (
            <p className="analytics-muted">{t("openNote")}</p>
          )}
          <ChartTable
            {...table}
            series={activitySeries}
            format={formatActivity}
          />
        </section>
        <section className="panel">
          <h2>{t("hours")}</h2>
          <TimeDonut
            past={sum(teaching[0].values)}
            future={sum(teaching[1].values)}
            pastLabel={t("past")}
            futureLabel={t("future")}
            empty={t("emptyHours")}
            format={hours}
            percent={percentages.format}
          />
          <p className="analytics-muted">{t("hoursNote")}</p>
          <ChartTable {...table} series={teaching} format={hours} />
        </section>
      </div>
      <MoneyPanel
        report={report}
        companyFiltered={companyFiltered}
        currency={currency}
        setCurrency={setCurrency}
        format={money.format}
        table={table}
      />
      {report.can_model_pipeline && !companyFiltered && (
        <ScenarioPanel
          actor={actor}
          zone={report.time_zone}
          currency={currency}
          format={money.format}
        />
      )}
    </>
  );
}

const metrics = ["fees", "gross", "lecturerCash", "customerCash"] as const;
type Metric = (typeof metrics)[number];
const keyByMetric = {
  fees: ["past_net", "future_net"],
  gross: ["past_gross", "future_gross"],
  lecturerCash: ["lecturer_cash", null],
  customerCash: ["customer_cash", null],
} as const;

function MoneyPanel({
  report,
  companyFiltered,
  currency,
  setCurrency,
  format,
  table,
}: {
  report: AnalyticsReport;
  companyFiltered: boolean;
  currency: AnalyticsCurrency;
  setCurrency: (currency: AnalyticsCurrency) => void;
  format: (amount: number) => string;
  table: { labels: string[]; month: string; title: string };
}) {
  const { t } = useTranslation("analytics");
  const [selected, setSelected] = useState<Metric | null>(null);
  const first = report.months[0].currencies[currency];
  const available = metrics.filter(
    (metric) => first[keyByMetric[metric][0]] !== null,
  );
  const metric =
    selected && available.includes(selected) ? selected : available[0];
  if (!metric) return null;
  const [pastKey, futureKey] = keyByMetric[metric];
  const series: ChartSeries[] = [
    {
      name: t(futureKey ? "pastConfirmed" : "cash"),
      tone: "past",
      values: report.months.map((month) =>
        month.history ? month.currencies[currency][pastKey] : null,
      ),
    },
  ];
  if (futureKey)
    series.push({
      name: t("futureConfirmed"),
      tone: "future",
      values: report.months.map((month) =>
        month.forecast ? month.currencies[currency][futureKey] : null,
      ),
    });
  const unknown = report.months.reduce(
    (total, month) => total + (month.currencies[currency].missing_gross ?? 0),
    0,
  );

  return (
    <section className="panel">
      <div className="analytics-section-heading">
        <h2>{t("financialTrend")}</h2>
        <div className="analytics-filters">
          <Field id="analytics-metric" label={t("financeMetric")}>
            <select
              value={metric}
              onChange={(event) => setSelected(event.target.value as Metric)}
            >
              {available.map((item) => (
                <option key={item} value={item}>
                  {t(item)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="analytics-currency" label={t("currency")}>
            <select
              value={currency}
              onChange={(event) =>
                setCurrency(event.target.value as AnalyticsCurrency)
              }
            >
              {currencyCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>
      <Totals
        items={series.map(({ name, values }) => ({
          label: name,
          value: values.some((value) => value !== null)
            ? format(
                values.reduce<number>((sum, value) => sum + (value ?? 0), 0),
              )
            : "—",
        }))}
      />
      <ChartKey series={series} />
      <LineChart labels={table.labels} series={series} format={format} />
      <p className="analytics-muted">
        {t(futureKey ? "commitmentNote" : "cashNote")}
      </p>
      {metric === "gross" && unknown > 0 && (
        <p className="analytics-muted">
          {t("unknownGross", { count: unknown })}
        </p>
      )}
      {companyFiltered && first.past_net !== null && (
        <p className="analytics-muted">{t("cashScope")}</p>
      )}
      <ChartTable {...table} series={series} format={format} />
    </section>
  );
}

function ScenarioPanel({
  actor,
  zone,
  currency,
  format,
}: {
  actor: string;
  zone: string;
  currency: AnalyticsCurrency;
  format: (amount: number) => string;
}) {
  const { t } = useTranslation("analytics");
  const [probability, setProbability] = useState(0.5);
  const now = DateTime.now().setZone(zone);
  const period = {
    from: now.toISODate() ?? "",
    until: now.plus({ days: 90 }).toISODate() ?? "",
  };
  const forecast = useQuery(
    forecastQuery(
      actor,
      period,
      probability,
      Boolean(period.from && period.until),
    ),
  );
  const months = forecast.data?.months.filter(
    (month) => month.currency === currency,
  );
  const unknown =
    months?.reduce(
      (sum, row) => sum + row.pipeline_cost_unknown_positions,
      0,
    ) ?? 0;
  const cost = months?.reduce(
    (sum, row) => sum + (row.pipeline_lecturer_cost_known ?? 0),
    0,
  );
  const gross = months?.reduce(
    (sum, row) => sum + (row.pipeline_gross_known ?? 0),
    0,
  );
  const choices = [0, 0.25, 0.5, 0.75, 1];

  return (
    <section className="panel">
      <h2>{t("scenario")}</h2>
      <p className="analytics-muted">{t("scenarioBasis")}</p>
      <Field id="analytics-probability" label={t("probability")}>
        <select
          value={probability}
          onChange={(event) => setProbability(Number(event.target.value))}
        >
          {choices.map((value) => (
            <option key={value} value={value}>
              {value * 100} %
            </option>
          ))}
        </select>
      </Field>
      {forecast.isPending && <Loading />}
      {forecast.isError && <ErrorState retry={() => void forecast.refetch()} />}
      {forecast.isSuccess && (
        <Totals
          items={[
            {
              label: t("scenarioFees"),
              value:
                unknown && probability > 0
                  ? t("notAvailable")
                  : format(cost ?? 0),
            },
            ...(forecast.data.gross_authorized
              ? [{ label: t("scenarioGross"), value: format(gross ?? 0) }]
              : []),
          ]}
        />
      )}
      {unknown > 0 && (
        <p className="analytics-muted">
          {t("unknownPipeline", { count: unknown })}
        </p>
      )}
    </section>
  );
}

export function AnalyticsPage() {
  const { t } = useTranslation();
  const { session } = useAuth();
  const actor = session?.user.id ?? "";
  const access = useQuery({
    ...analyticsAccessQuery(actor),
    enabled: Boolean(actor && portalInternalEdition),
  });
  return (
    <div className="portal-analytics">
      <PageHeading
        title={t("analytics")}
        description={t("analytics:description")}
      />
      {actor && portalInternalEdition ? (
        access.isPending ? (
          <Loading />
        ) : access.isError ? (
          <ErrorState retry={() => void access.refetch()} />
        ) : (
          <AnalyticsView key={actor} actor={actor} access={access.data} />
        )
      ) : (
        <p className="panel">{t("analytics:unavailable")}</p>
      )}
    </div>
  );
}
