/** Responsive, accessible monthly trend from the current actor-scoped original-currency projections. */
import { currencyCodes, type CurrencyCode } from "../../lib/currencies.ts";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { money } from "../../lib/dates";
import { monthlyEarningsTrend, monthlyInvoiceTrend } from "./api";
import type { EarningRecord, InvoiceRecord } from "./types";
import "./i18n";

type TrendPoint = {
  currency: CurrencyCode;
  month: string;
  amount: number;
  details: string;
};

/** Group visible values without querying other companies or converting currencies. */
export function FinanceTrendChart({
  earnings,
  invoices,
  source,
  zone,
}: {
  earnings: EarningRecord[];
  invoices: InvoiceRecord[];
  source: "earnings" | "invoices";
  zone: string;
}) {
  const { t, i18n } = useTranslation("commercial");
  const points: TrendPoint[] =
    source === "earnings"
      ? monthlyEarningsTrend(earnings, zone).map((month) => {
          const states = [
            ["expected", month.expected],
            ["invoiceReviewStage", month.review],
            ["completed", month.completed],
            ["invoiced", month.invoiced],
            ["paid", month.paid],
          ] as const;
          return {
            currency: month.currency,
            month: month.month,
            amount: states.reduce((sum, [, value]) => sum + value, 0),
            details: states
              .filter(([, value]) => value !== 0)
              .map(
                ([label, value]) =>
                  `${t(label)}: ${money(value, month.currency, i18n.language)}`,
              )
              .join(" · "),
          };
        })
      : monthlyInvoiceTrend(invoices).map((month) => ({
          currency: month.currency,
          month: month.month,
          amount: month.invoiced,
          details: `${t("invoicePaidTrend")}: ${money(month.paid, month.currency, i18n.language)} · ${t("invoiceOutstandingTrend")}: ${money(month.outstanding, month.currency, i18n.language)}`,
        }));
  if (!points.length) return null;
  const sourceLabel =
    source === "earnings" ? t("earningsTrendSource") : t("invoiceTrendSource");
  return (
    <section
      className="panel finance-trends"
      aria-labelledby="finance-trends-title"
    >
      <div className="commercial-section-heading">
        <div>
          <h2 id="finance-trends-title">{t("financeTrends")}</h2>
          <p className="muted commercial-small">{sourceLabel}</p>
        </div>
      </div>
      <div className="finance-trend-currencies">
        {currencyCodes.map((currency) => {
          const months = points
            .filter((point) => point.currency === currency)
            .slice(-12);
          if (!months.length) return null;
          const max = Math.max(...months.map((point) => point.amount), 0.01);
          return (
            <section className="finance-trend-currency" key={currency}>
              <h3>{currency}</h3>
              <ol aria-label={t("financeTrends")}>
                {months.map((point) => {
                  const date = DateTime.fromISO(`${point.month}-01`, { zone })
                    .setLocale(i18n.language)
                    .toLocaleString({ month: "short", year: "numeric" });
                  const amount = money(
                    point.amount,
                    point.currency,
                    i18n.language,
                  );
                  return (
                    <li className="finance-trend-row" key={point.month}>
                      <time dateTime={`${point.month}-01`}>{date}</time>
                      <progress
                        aria-label={`${date}: ${amount}`}
                        max={max}
                        value={point.amount}
                      />
                      <strong>{amount}</strong>
                      {point.details && (
                        <small className="muted">{point.details}</small>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
    </section>
  );
}
