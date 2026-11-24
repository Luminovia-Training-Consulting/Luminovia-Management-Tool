import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Wallet } from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { money } from "../../lib/dates";
import { ErrorState, Loading } from "../../components/common";
import { commercialAccessQuery, earningsQuery, groupedEarnings } from "./api";
import {
  clientSpendQuery,
  commissionAccessQuery,
  commissionReportQuery,
  revenueTotals,
} from "./commission-api";
import "./platform-i18n";
import "./platform.css";

/** Display original-currency groups from the supplied authorized summary. */
export function FinancialSummaryCards() {
  const { t, i18n } = useTranslation("platform");
  const { session } = useAuth();
  const actor = session!.user.id;
  const access = useQuery(commissionAccessQuery(actor));
  const commercial = useQuery(commercialAccessQuery(actor));
  const gross = Boolean(access.data?.can_manage_gross);
  const client = Boolean(access.data?.can_request && !gross);
  const own = Boolean(!gross && !client && commercial.data?.can_submit_invoice);
  const report = useQuery({ ...commissionReportQuery(actor), enabled: gross });
  const spend = useQuery({ ...clientSpendQuery(actor), enabled: client });
  const earnings = useQuery({ ...earningsQuery(actor, false), enabled: own });
  if (access.isPending || commercial.isPending) return null;
  if (gross) {
    if (report.isPending) return <Loading />;
    if (report.isError)
      return <ErrorState retry={() => void report.refetch()} />;
    return (
      <div className="platform-spend-grid">
        {revenueTotals(report.data).map((group) => (
          <Link
            className="panel platform-summary"
            to="/admin/finance"
            key={group.currency}
          >
            <Wallet size={21} />
            <div>
              <span>
                {t("acceptedPlatform")} · {group.currency}
              </span>
              <strong>
                {money(group.platform, group.currency, i18n.language)}
              </strong>
              <small>
                {t("acceptedGross")}:{" "}
                {money(group.accepted, group.currency, i18n.language)}
              </small>
            </div>
          </Link>
        ))}
      </div>
    );
  }
  if (client) {
    if (spend.isPending) return <Loading />;
    if (spend.isError) return <ErrorState retry={() => void spend.refetch()} />;
    return (
      <div className="platform-spend-grid">
        {spend.data.map((row) => (
          <Link
            className="panel platform-summary"
            to="/client"
            key={`${row.organisation_id}-${row.currency}`}
          >
            <Wallet size={21} />
            <div>
              <span>
                {row.organisation_name} · {row.currency}
              </span>
              <strong>
                {money(
                  Number(row.gross_assigned_amount),
                  row.currency,
                  i18n.language,
                )}
              </strong>
              <small>{t("confirmedSpend")}</small>
            </div>
          </Link>
        ))}
      </div>
    );
  }
  if (own) {
    if (earnings.isPending) return <Loading />;
    if (earnings.isError)
      return <ErrorState retry={() => void earnings.refetch()} />;
    return (
      <div className="platform-spend-grid">
        {groupedEarnings(earnings.data).map((group) => (
          <Link
            className="panel platform-summary"
            to="/finance"
            key={group.currency}
          >
            <Wallet size={21} />
            <div>
              <span>
                {t("ownCompensation")} · {group.currency}
              </span>
              <strong>
                {money(
                  group.expected +
                    group.completed +
                    group.invoiced +
                    group.paid,
                  group.currency,
                  i18n.language,
                )}
              </strong>
            </div>
          </Link>
        ))}
      </div>
    );
  }
  return null;
}
