/** Company-only accepted gross fee history, grouped by the server's company-local months. */
import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { downloadCsv } from "../../lib/csv";
import { money } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { sessionCacheBoundary } from "../auth/session-cache-boundary";
import {
  type CompanyMonthlySpending,
  readCompanyMonthlySpending,
} from "./commission-api";
import "./commercial.css";

type SpendingScope = {
  actor: string;
  organisation: string | null;
  boundary: string | null;
};

/** Download only a freshly authorised company projection for the displayed twelve-month window. */
function CompanySpendingDownload({
  actor,
  organisation,
  boundary,
}: SpendingScope) {
  const { t } = useTranslation("platform");
  const online = useOnline();
  const mounted = useRef(false);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<"empty" | "error" | null>(null);

  // The caller keys this action by account, session and selected company. An
  // earlier response must not download once any part of that scope changes.
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function exportSpending() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setResult(null);
    try {
      requireOnline();
      const fresh = await readCompanyMonthlySpending(organisation);
      const { data, error } = await db().auth.getSession();
      if (!mounted.current) return;
      requireOnline();
      if (error) throw error;
      if (
        data.session?.user.id !== actor ||
        sessionCacheBoundary(data.session?.access_token) !== boundary
      )
        return;

      const now = DateTime.now();
      const rows = fresh.filter((row) => {
        const current = now.setZone(row.time_zone).startOf("month");
        return (
          row.month_start >=
            current.minus({ months: 11 }).toFormat("yyyy-MM-dd") &&
          row.month_start <= current.toFormat("yyyy-MM-dd")
        );
      });
      if (!rows.length) {
        setResult("empty");
        return;
      }
      downloadCsv("company-accepted-fees.csv", [
        [
          t("companySpendingExportOrganisation"),
          t("companySpendingExportMonth"),
          t("companySpendingExportCurrency"),
          t("confirmedSpend"),
        ],
        ...rows.map((row) => [
          row.organisation_name,
          row.month_start.slice(0, 7),
          row.currency,
          row.gross_amount,
        ]),
      ]);
    } catch {
      if (mounted.current) setResult("error");
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <div>
      <Button
        variant="secondary"
        disabled={!online || busy}
        onClick={() => void exportSpending()}
      >
        {t(busy ? "companySpendingExportBusy" : "companySpendingExport")}
      </Button>
      {result === "empty" && <Notice>{t("noAcceptedSpending")}</Notice>}
      {result === "error" && (
        <Notice kind="error">{t("companySpendingExportFailed")}</Notice>
      )}
    </div>
  );
}

export function CompanySpendingChart({
  rows,
  exportScope,
}: {
  rows: CompanyMonthlySpending[];
  exportScope?: SpendingScope;
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
        {exportScope && (
          <CompanySpendingDownload
            key={JSON.stringify(exportScope)}
            {...exportScope}
          />
        )}
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
