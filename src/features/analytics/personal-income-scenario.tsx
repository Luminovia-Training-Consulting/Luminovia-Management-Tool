/** Local planning overlay for the authorized personal report. No assumptions are saved or sent. */
import { useState } from "react";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { Field } from "../../components/common";
import { ChartKey, ChartTable, LineChart, type ChartSeries } from "./charts";
import type { AnalyticsPeriod } from "./period";
import { Totals } from "./report-ui";
import type { AnalyticsCurrency, AnalyticsReport } from "./schema";

const sum = (values: ChartSeries["values"]) =>
  values.reduce<number>(
    (cents, value) => cents + Math.round((value ?? 0) * 100),
    0,
  ) / 100;

/** Only entire future months receive the extra amount; confirmed values keep the report's date bounds. */
export function PersonalIncomeScenario({
  report,
  period,
  currency,
}: {
  report: AnalyticsReport;
  period: AnalyticsPeriod;
  currency: AnalyticsCurrency;
}) {
  const { t, i18n } = useTranslation("analytics");
  const [assumptions, setAssumptions] = useState<
    Partial<Record<AnalyticsCurrency, string>>
  >({});
  const raw = assumptions[currency] ?? "";
  const amount = Number(raw);
  const valid =
    Number.isFinite(amount) &&
    amount >= 0 &&
    amount <= 1000000 &&
    /^\d*(?:\.\d{1,2})?$/.test(raw);
  const today = DateTime.now().setZone(report.time_zone).toISODate() ?? "";
  const months = report.months.filter(({ forecast }) => forecast);
  const eligible = months.map(
    ({ month }) =>
      month > today &&
      month >= period.from &&
      (DateTime.fromISO(month, { zone: "UTC" }).endOf("month").toISODate() ??
        "") <= period.through,
  );
  const confirmed = months.map(
    (month) => month.currencies[currency]?.future_net ?? null,
  );
  const extra = eligible.map((whole) => (valid ? (whole ? amount : 0) : null));
  const estimate = confirmed.map((value, index) =>
    value === null || extra[index] === null ? null : sum([value, extra[index]]),
  );
  const series: ChartSeries[] = [
    { name: t("futureConfirmed"), tone: "future", values: confirmed },
    { name: t("personalExtra"), tone: "open", values: extra },
    { name: t("personalEstimate"), tone: "past", values: estimate },
  ];
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const { format } = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
  });
  const date = new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
  const labels = months.map(({ month }) =>
    date.format(new Date(`${month}T00:00:00Z`)),
  );

  return (
    <section className="panel">
      <h2>{t("personalScenario")}</h2>
      <p className="analytics-muted">{t("personalScenarioBasis")}</p>
      {months.length > 0 && confirmed.some((value) => value !== null) ? (
        <>
          {eligible.includes(true) ? (
            <Field
              id="analytics-personal-scenario"
              label={t("personalExtraInput", { currency })}
              error={!valid}
            >
              <input
                type="number"
                min={0}
                max={1000000}
                step="0.01"
                value={raw}
                onChange={(event) =>
                  setAssumptions({
                    ...assumptions,
                    [currency]: event.target.value,
                  })
                }
              />
            </Field>
          ) : (
            <p className="analytics-muted">{t("personalNoFullMonth")}</p>
          )}
          {!valid && <p role="alert">{t("personalExtraInvalid")}</p>}
          <Totals
            items={series.map(({ name, values }) => ({
              label: name,
              value: values.some((value) => value !== null)
                ? format(sum(values))
                : "—",
            }))}
          />
          <ChartKey series={series} />
          <LineChart labels={labels} series={series} format={format} />
          <ChartTable
            labels={labels}
            month={t("month")}
            title={t("data")}
            series={series}
            format={format}
          />
        </>
      ) : (
        <p className="analytics-muted">{t("emptyScenario")}</p>
      )}
    </section>
  );
}
