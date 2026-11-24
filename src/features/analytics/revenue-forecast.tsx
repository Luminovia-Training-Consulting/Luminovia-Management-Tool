import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { financeRoots } from "../../app/finance-access";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading } from "../../components/common";
import { currencyCodes, type CurrencyCode } from "../../lib/currencies";
import { forecastQuery } from "../workbench/finance-api";
import {
  BarChart,
  ChartKey,
  ChartTable,
  LineChart,
  type ChartSeries,
} from "./charts";
import { ScenarioProbability, Totals } from "./report-ui";

function total(values: ChartSeries["values"]) {
  let cents = 0;
  for (const value of values) {
    if (value === null) return null;
    cents += Math.round(value * 100);
  }
  return cents / 100;
}

export default function RevenueForecast({
  actor,
  zone,
  currency,
  compact = false,
}: {
  actor: string;
  zone: string;
  currency?: CurrencyCode;
  compact?: boolean;
}) {
  const { t, i18n } = useTranslation("analytics");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const [probability, setProbability] = useState(0.5);
  const [days, setDays] = useState(90);
  const [selectedCurrency, setCurrency] = useState<CurrencyCode>();
  const now = DateTime.now().setZone(zone);
  const period = {
    from: now.toISODate() ?? "",
    until: now.plus({ days }).toISODate() ?? "",
  };
  const forecast = useQuery(
    forecastQuery(
      actor,
      period,
      probability,
      Boolean(period.from && period.until),
    ),
  );
  const data = forecast.isSuccess ? forecast.data : undefined;
  const currencies = currencyCodes.filter((code) =>
    data?.months.some((month) => month.currency === code),
  );
  const activeCurrency =
    currency ??
    (selectedCurrency && currencies.includes(selectedCurrency)
      ? selectedCurrency
      : (currencies[0] ?? "EUR"));
  const months = (data?.months ?? []).filter(
    ({ currency }) => currency === activeCurrency,
  );
  const { format } = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: activeCurrency,
  });
  const date = new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
  const labels = months.map(({ month }) =>
    date.format(new Date(`${month}T00:00:00Z`)),
  );
  const gross: ChartSeries[] = data?.gross_authorized
    ? [
        {
          name: t("revenueConfirmed"),
          tone: "past",
          values: months.map((row) => row.accepted_gross_known),
        },
        {
          name: t("scenarioGross"),
          tone: "open",
          values: months.map((row) => row.pipeline_gross_known),
        },
        {
          name: t("revenueExpected"),
          tone: "future",
          values: months.map(
            ({
              accepted_gross_known: confirmed,
              pipeline_gross_known: open,
            }) =>
              confirmed === null || open === null
                ? null
                : total([confirmed, open]),
          ),
        },
      ]
    : [];
  const costs: ChartSeries[] = [
    {
      name: t("confirmedCosts"),
      tone: "past",
      values: months.map((row) => row.accepted_lecturer_cost),
    },
    {
      name: t("scenarioFees"),
      tone: "future",
      values: months.map((row) =>
        data?.pipeline_probability === 0 ? 0 : row.pipeline_lecturer_cost_known,
      ),
    },
  ];
  const unknownCosts = months.reduce(
    (sum, row) => sum + row.pipeline_cost_unknown_positions,
    0,
  );
  const unknownGross = months.reduce(
    (sum, row) => sum + (row.unknown_gross_claims ?? 0),
    0,
  );
  const table = { labels, format, month: t("month"), title: t("data") };
  const totals = (series: ChartSeries[]) =>
    series.map(({ name, values }) => {
      const amount = total(values);
      return {
        label: name,
        value: amount === null ? t("notAvailable") : format(amount),
      };
    });

  return (
    <section className="panel">
      <div className="analytics-section-heading">
        <h2>
          {compact
            ? t(gross.length ? "revenueForecast" : "financeForecast")
            : t("scenario")}
        </h2>
        {compact && (
          <Button asChild variant="secondary">
            <Link to={`${financeRoots.staff}/analytics`}>
              {t("openForecastAnalytics")}
            </Link>
          </Button>
        )}
      </div>
      <p className="analytics-muted">{t("scenarioBasis")}</p>
      <div className="analytics-filters">
        <ScenarioProbability value={probability} onChange={setProbability} />
        <Field id="analytics-forecast-window" label={t("forecastWindow")}>
          <select
            value={days}
            onChange={(event) => setDays(Number(event.target.value))}
          >
            {[30, 60, 90].map((count) => (
              <option value={count} key={count}>
                {t("forecastDays", { count })}
              </option>
            ))}
          </select>
        </Field>
        {compact && currencies.length > 1 && (
          <Field id="finance-forecast-currency" label={t("currency")}>
            <select
              value={activeCurrency}
              onChange={(event) =>
                setCurrency(event.target.value as CurrencyCode)
              }
            >
              {currencies.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </select>
          </Field>
        )}
      </div>
      {forecast.isPending && <Loading />}
      {forecast.isError && <ErrorState retry={() => void forecast.refetch()} />}
      {data &&
        (months.length ? (
          <>
            {gross.length > 0 && (
              <section>
                {!compact && <h3>{t("revenueForecast")}</h3>}
                <Totals items={totals(gross)} />
                <p className="analytics-muted">{t("revenueForecastTiming")}</p>
                {!compact && (
                  <>
                    <ChartKey series={gross} />
                    <LineChart labels={labels} series={gross} format={format} />
                    <ChartTable {...table} series={gross} />
                  </>
                )}
                {unknownGross > 0 && (
                  <p className="analytics-muted">
                    {t("unknownGross", { count: unknownGross })}
                  </p>
                )}
              </section>
            )}
            {(!compact || !gross.length) && (
              <section>
                <h3>{t("forecastCosts")}</h3>
                <Totals items={totals(costs)} />
                {!compact && (
                  <>
                    <ChartKey series={costs} />
                    <BarChart labels={labels} series={costs} format={format} />
                    <ChartTable {...table} series={costs} />
                  </>
                )}
                {data.pipeline_probability > 0 && unknownCosts > 0 && (
                  <p className="analytics-muted">
                    {t("unknownPipeline", { count: unknownCosts })}
                  </p>
                )}
              </section>
            )}
          </>
        ) : (
          <p className="analytics-muted">{t("emptyScenario")}</p>
        ))}
    </section>
  );
}
