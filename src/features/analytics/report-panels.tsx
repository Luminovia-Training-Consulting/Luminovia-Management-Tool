import { currencyCodes } from "../../lib/currencies.ts";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Field } from "../../components/common";
import {
  BarChart,
  ChartKey,
  ChartTable,
  LineChart,
  TimeDonut,
  type ChartSeries,
} from "./charts";
import type { AnalyticsCurrency, AnalyticsReport } from "./schema";
import { Totals } from "./report-ui";

export function ReportPanels({
  report,
  scenario,
  companyFiltered,
  currency,
  setCurrency,
}: {
  report: AnalyticsReport;
  scenario?: ReactNode;
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
      {scenario}
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
  const currencies = currencyCodes.filter((code) =>
    report.months.some((month) => month.currencies[code] !== undefined),
  );
  const first = report.months.find((month) => month.currencies[currency])
    ?.currencies[currency];
  if (!first) return null;
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
        month.history ? (month.currencies[currency]?.[pastKey] ?? null) : null,
      ),
    },
  ];
  if (futureKey)
    series.push({
      name: t("futureConfirmed"),
      tone: "future",
      values: report.months.map((month) =>
        month.forecast
          ? (month.currencies[currency]?.[futureKey] ?? null)
          : null,
      ),
    });
  const unknown = report.months.reduce(
    (total, month) => total + (month.currencies[currency]?.missing_gross ?? 0),
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
              {currencies.map((code) => (
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
