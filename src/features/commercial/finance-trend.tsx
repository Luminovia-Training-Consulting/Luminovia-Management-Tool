/** Responsive, accessible monthly trend from the current actor-scoped original-currency projections. */
import { currencyCodes, type CurrencyCode } from "../../lib/currencies.ts";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { money } from "../../lib/dates";
import {
  monthlyEarningsTrend,
  monthlyInvoiceTrend,
  type MonthlyEarningsTrend,
  type MonthlyInvoiceTrend,
} from "./api";
import type { EarningRecord, InvoiceRecord } from "./types";
import "./i18n";

type TrendMonth = MonthlyEarningsTrend | MonthlyInvoiceTrend;

const earningStages = [
  ["expected", "expected"],
  ["invoiceReviewStage", "review"],
  ["completed", "completed"],
  ["invoiced", "invoiced"],
  ["paid", "paid"],
] as const;

/** Group visible values without querying other companies or converting currencies. */
export function FinanceTrendChart({
  earnings,
  invoices,
  source,
  zone,
}: {
  earnings?: EarningRecord[];
  invoices?: InvoiceRecord[];
  source: "earnings" | "invoices";
  zone: string;
}) {
  const { t, i18n } = useTranslation("commercial");
  const shownEarnings = source === "earnings" ? earnings : undefined;
  const shownInvoices = source === "invoices" ? invoices : undefined;
  const byCurrency = useMemo(() => {
    const months = shownEarnings
      ? monthlyEarningsTrend(shownEarnings, zone)
      : monthlyInvoiceTrend(shownInvoices ?? []);
    const groups = new Map<CurrencyCode, TrendMonth[]>();
    for (const month of months) {
      const group = groups.get(month.currency);
      if (group) group.push(month);
      else groups.set(month.currency, [month]);
    }
    return groups;
  }, [shownEarnings, shownInvoices, zone]);
  if (!byCurrency.size) return null;
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
          const months = byCurrency.get(currency);
          if (!months?.length) return null;
          const visible = months.slice(-12).map((point) => {
            if ("outstanding" in point)
              return {
                month: point.month,
                amount: point.invoiced,
                details: `${t("invoicePaidTrend")}: ${money(point.paid, currency, i18n.language)} · ${t("invoiceOutstandingTrend")}: ${money(point.outstanding, currency, i18n.language)}`,
              };
            let amount = 0;
            const details: string[] = [];
            for (const [label, key] of earningStages) {
              const value = point[key];
              amount += value;
              if (value !== 0)
                details.push(
                  `${t(label)}: ${money(value, currency, i18n.language)}`,
                );
            }
            return { month: point.month, amount, details: details.join(" · ") };
          });
          const max = Math.max(...visible.map((point) => point.amount), 0.01);
          return (
            <section className="finance-trend-currency" key={currency}>
              <h3>{currency}</h3>
              <ol aria-label={t("financeTrends")}>
                {visible.map((point) => {
                  const date = DateTime.fromISO(`${point.month}-01`, { zone })
                    .setLocale(i18n.language)
                    .toLocaleString({ month: "short", year: "numeric" });
                  const amount = money(point.amount, currency, i18n.language);
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
