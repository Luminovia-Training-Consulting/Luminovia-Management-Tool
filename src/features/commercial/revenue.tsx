/**
 * Capability-gated revenue grouped by currency. Keep offers, accepted revenue and historically
 * unknown gross values visibly distinct.
 */
import { FinanceRows } from "./finance-rows";
import { currencyCodes } from "../../lib/currencies.ts";
import { useDeferredValue, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { money } from "../../lib/dates";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading } from "../../components/common";
import { downloadCsv } from "./api";
import {
  commissionAccessQuery,
  commissionReportQuery,
  revenueTotals,
} from "./commission-api";
import "./platform-i18n";
import "./platform.css";

/** Load permitted revenue projections and preserve visibly unknown historical gross amounts. */
export function RevenuePanel() {
  const { t, i18n } = useTranslation("platform");
  const common = useTranslation().t;
  const { session } = useAuth();
  const actor = session!.user.id;
  const access = useQuery(commissionAccessQuery(actor));
  const report = useQuery({
    ...commissionReportQuery(actor),
    enabled: Boolean(access.data?.can_manage_gross),
  });
  const [search, setSearch] = useState("");
  const [currency, setCurrency] = useState("");
  const language = i18n.language;
  const deferredSearch = useDeferredValue(search);
  const rows = useMemo(() => {
    const needle = deferredSearch.toLocaleLowerCase(language);
    return (report.data ?? []).filter(
      (row) =>
        (!currency || row.currency === currency) &&
        (!needle ||
          `${row.title} ${row.organisation_name} ${row.lecturer_name ?? ""}`
            .toLocaleLowerCase(language)
            .includes(needle)),
    );
  }, [report.data, currency, deferredSearch, language]);
  const { totals, hasAccepted } = useMemo(
    () => ({
      totals: revenueTotals(rows),
      hasAccepted: rows.some((row) => row.claim_id),
    }),
    [rows],
  );
  if (!access.data?.can_manage_gross) return null;
  if (report.isPending) return <Loading />;
  if (report.isError) return <ErrorState retry={() => void report.refetch()} />;
  return (
    <section className="platform-revenue">
      <div className="commercial-section-heading">
        <div>
          <h2>{t("revenue")}</h2>
          <p className="muted commercial-small">{t("revenueHint")}</p>
          {hasAccepted && (
            <p className="muted commercial-small">{t("acceptedImmutable")}</p>
          )}
        </div>
        <Button
          variant="secondary"
          disabled={!rows.length || search !== deferredSearch}
          onClick={() =>
            downloadCsv("luminovia-platform-revenue.csv", [
              [
                common("title"),
                t("organisations"),
                t("grossTotal"),
                t("lecturerShare"),
                t("platformShare"),
                "ISO 4217",
                common("status"),
              ],
              ...rows.map((row) => [
                row.title,
                row.organisation_name,
                row.gross_total_amount,
                row.lecturer_net_total_amount,
                row.platform_total_amount,
                row.currency,
                common(row.status),
              ]),
            ])
          }
        >
          <Download size={16} />
          {t("exportRevenue")}
        </Button>
      </div>
      <div className="platform-filters panel">
        <Field id="revenue-search" label={t("revenueSearch")}>
          <input
            id="revenue-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </Field>
        <Field id="revenue-currency" label={common("currency")}>
          <select
            id="revenue-currency"
            value={currency}
            onChange={(event) => setCurrency(event.target.value)}
          >
            <option value="">{t("allCurrencies")}</option>
            {currencyCodes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {totals.length ? (
        <div className="platform-spend-grid">
          {totals.map((group) => (
            <section className="panel platform-spend-card" key={group.currency}>
              <span className="eyebrow">{group.currency}</span>
              <dl>
                {(
                  [
                    ["offered", "offeredGross"],
                    ["accepted", "acceptedGross"],
                    ["lecturer", "acceptedNet"],
                    ["platform", "acceptedPlatform"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <dt>{t(label)}</dt>
                    <dd>{money(group[key], group.currency, i18n.language)}</dd>
                  </div>
                ))}
              </dl>
              {group.unknown > 0 && (
                <p className="muted commercial-small">
                  {t("unknownGross", { count: group.unknown })}
                </p>
              )}
            </section>
          ))}
        </div>
      ) : (
        <p className="panel commercial-empty">{t("revenueEmpty")}</p>
      )}
      {rows.length > 0 && (
        <FinanceRows
          key={JSON.stringify([deferredSearch, currency])}
          label={t("revenue")}
          total={rows.length}
          panel
        >
          {(shown) => (
            <table className="commercial-table">
              <thead>
                <tr>
                  <th>{common("title")}</th>
                  <th>{t("organisations")}</th>
                  <th>{t("grossTotal")}</th>
                  <th>{t("lecturerShare")}</th>
                  <th>{t("platformShare")}</th>
                  <th>{common("status")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((row) => (
                  <tr key={`${row.job_id}:${row.claim_id ?? "unclaimed"}`}>
                    <td>
                      <Link to={`/jobs/${row.job_id}`}>{row.title}</Link>
                      <small>{row.lecturer_name}</small>
                    </td>
                    <td>{row.organisation_name}</td>
                    <td>
                      {row.gross_total_amount === null
                        ? "—"
                        : money(
                            Number(row.gross_total_amount),
                            row.currency,
                            i18n.language,
                          )}
                    </td>
                    <td>
                      {money(
                        Number(row.lecturer_net_total_amount),
                        row.currency,
                        i18n.language,
                      )}
                    </td>
                    <td>
                      {row.platform_total_amount === null
                        ? "—"
                        : money(
                            Number(row.platform_total_amount),
                            row.currency,
                            i18n.language,
                          )}
                      <small>
                        {row.platform_percent === null
                          ? t("legacyPricing")
                          : `${Number(row.platform_percent).toLocaleString(i18n.language)} %`}
                      </small>
                    </td>
                    <td>{common(row.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </FinanceRows>
      )}
    </section>
  );
}
