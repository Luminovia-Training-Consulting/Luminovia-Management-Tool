/** Company-only accepted gross fee history, grouped by the server's company-local months. */
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { money } from "../../lib/dates";
import type { CompanyMonthlySpending } from "./commission-api";
import "./commercial.css";

export function CompanySpendingChart({
  rows,
}: {
  rows: CompanyMonthlySpending[];
}) {
  const { t, i18n } = useTranslation("platform");
  const groups = new Map<string, CompanyMonthlySpending[]>();
  for (const row of rows) {
    const key = `${row.organisation_id}:${row.currency}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return (
    <section
      className="panel finance-trends"
      aria-labelledby="company-spending-title"
    >
      <div className="commercial-section-heading">
        <div>
          <h2 id="company-spending-title">{t("monthlyAcceptedSpending")}</h2>
          <p className="muted commercial-small">
            {t("monthlyAcceptedSpendingHint")}
          </p>
        </div>
      </div>
      {!groups.size && <p>{t("noAcceptedSpending")}</p>}
      <div className="finance-trend-currencies">
        {[...groups].map(([key, group]) => {
          const first = group[0];
          const current = DateTime.now()
            .setZone(first.time_zone)
            .startOf("month");
          const byMonth = new Map(
            group.map((row) => [row.month_start.slice(0, 7), row]),
          );
          const points = Array.from({ length: 12 }, (_, index) => {
            const month = current.minus({ months: 11 - index });
            return { month, entry: byMonth.get(month.toFormat("yyyy-MM")) };
          });
          const maximum = Math.max(
            0.01,
            ...points.map(({ entry }) => Number(entry?.gross_amount ?? 0)),
          );
          return (
            <section className="finance-trend-currency" key={key}>
              <h3>
                {first.organisation_name} · {first.currency}
              </h3>
              <p className="muted commercial-small">{first.time_zone}</p>
              <ol
                aria-label={`${t("monthlyAcceptedSpending")}: ${first.organisation_name} ${first.currency}`}
              >
                {points.map(({ month, entry }) => {
                  const label = month
                    .setLocale(i18n.language)
                    .toLocaleString({ month: "short", year: "numeric" });
                  const amount = Number(entry?.gross_amount ?? 0);
                  const formatted = money(
                    amount,
                    first.currency,
                    i18n.language,
                  );
                  return (
                    <li
                      className="finance-trend-row"
                      key={month.toFormat("yyyy-MM")}
                    >
                      <time dateTime={month.toISODate() ?? ""}>{label}</time>
                      <progress
                        aria-label={`${first.organisation_name} ${label}: ${formatted}`}
                        max={maximum}
                        value={amount}
                      />
                      <strong>{formatted}</strong>
                      <small className="muted">
                        {t("acceptedAssignmentsCount", {
                          count: Number(entry?.claim_count ?? 0),
                        })}
                      </small>
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
