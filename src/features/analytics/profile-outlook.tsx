/** Compact, self-only teaching outlook for the private profile, using the existing report RPC. */
import { useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { financeRoots } from "../../app/finance-access";
import { ErrorState, Loading } from "../../components/common";
import { Button } from "../../components/ui/button";
import { currencyCodes } from "../../lib/currencies";
import { analyticsReportQuery } from "./api";
import { BarChart, ChartTable } from "./charts";
import { analyticsPreset } from "./period";
import { Totals } from "./report-ui";
import "./analytics.css";
import "./i18n";

/** Get the next 90 days in the actor's reporting zone; no staff or company data is requested. */
export function ProfileOutlook({
  actor,
  zone,
}: {
  actor: string;
  zone: string;
}) {
  const { t, i18n } = useTranslation("analytics");
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const period = analyticsPreset("nextQuarter", DateTime.now().setZone(zone));
  const query = useQuery(analyticsReportQuery(actor, "personal", null, period));
  const months = query.data?.months ?? [];
  const date = new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
  const numbers = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
  const labels = months.map(({ month }) =>
    date.format(new Date(`${month}T00:00:00Z`)),
  );
  const hours = (value: number) =>
    t("scheduledHours", { value: numbers.format(value) });
  const starts = months.reduce(
    (total, row) => total + row.future_assignments,
    0,
  );
  const duration = months.reduce((total, row) => total + row.future_minutes, 0);
  const fees = currencyCodes.flatMap((currency) => {
    const amounts = months.map((row) => row.currencies[currency]?.future_net);
    if (!amounts.some((amount) => amount != null && amount !== 0)) return [];
    const cents = amounts.reduce<number>(
      (total, amount) => total + Math.round((amount ?? 0) * 100),
      0,
    );
    return [
      {
        label: `${t("futureConfirmed")} (${currency})`,
        value: new Intl.NumberFormat(locale, {
          style: "currency",
          currency,
        }).format(cents / 100),
      },
    ];
  });
  const series = [
    {
      name: t("monthlyHours"),
      tone: "future" as const,
      values: months.map((row) => row.future_minutes / 60),
    },
  ];

  return (
    <section className="panel portal-analytics">
      <div className="analytics-section-heading">
        <h2>{t("profileOutlook")}</h2>
        <Button asChild variant="secondary">
          <Link to={`${financeRoots.personal}/analytics`}>
            {t("openPersonalAnalytics")}
          </Link>
        </Button>
      </div>
      <p className="analytics-muted">{t("profileOutlookBasis")}</p>
      {query.isPending && <Loading />}
      {query.isError && <ErrorState retry={() => void query.refetch()} />}
      {query.isSuccess && (
        <>
          <Totals
            items={[
              { label: t("assignments"), value: numbers.format(starts) },
              { label: t("hours"), value: hours(duration / 60) },
              ...fees,
            ]}
          />
          {duration > 0 ? (
            <>
              <BarChart labels={labels} series={series} format={hours} />
              <ChartTable
                title={t("data")}
                month={t("month")}
                labels={labels}
                series={series}
                format={hours}
              />
            </>
          ) : (
            <p className="analytics-muted">{t("emptyHours")}</p>
          )}
        </>
      )}
    </section>
  );
}
