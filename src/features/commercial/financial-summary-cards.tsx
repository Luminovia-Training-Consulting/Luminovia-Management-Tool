/** Dashboard cards for the original-currency summary authorized by the server. */
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Wallet } from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { money } from "../../lib/dates";
import { ErrorState, Loading } from "../../components/common";
import { dashboardFinancialSummaryQuery } from "./financial-summary-api";
import "./platform-i18n";
import "./platform.css";

const destinations = {
  platform: "/admin/finance",
  client: "/client",
  lecturer: "/finance",
};

/** Link each currency total to its existing detailed workflow. */
export function FinancialSummaryCards() {
  const { t, i18n } = useTranslation("platform");
  const { session } = useAuth();
  const summary = useQuery(dashboardFinancialSummaryQuery(session!.user.id));
  if (summary.isPending) return <Loading />;
  if (summary.isError)
    return <ErrorState retry={() => void summary.refetch()} />;
  if (!summary.data.length) return null;
  return (
    <div className="platform-spend-grid">
      {summary.data.map((row) => {
        const label =
          row.kind === "platform"
            ? t("acceptedPlatform")
            : row.kind === "client"
              ? row.organisation_name
              : t("ownCompensation");
        return (
          <Link
            className="panel platform-summary"
            to={destinations[row.kind]}
            key={
              row.kind === "client"
                ? `${row.organisation_id}-${row.currency}`
                : row.currency
            }
          >
            <Wallet size={21} />
            <div>
              <span>
                {label} · {row.currency}
              </span>
              <strong>{money(row.amount, row.currency, i18n.language)}</strong>
              {row.kind === "platform" && (
                <small>
                  {t("acceptedGross")}:{" "}
                  {money(row.accepted_gross, row.currency, i18n.language)}
                </small>
              )}
              {row.kind === "client" && <small>{t("confirmedSpend")}</small>}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
