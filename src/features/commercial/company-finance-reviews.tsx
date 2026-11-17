import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { db } from "../../lib/supabase";
import { dateTime } from "../../lib/dates";
import { Notice } from "../../components/common";

type Review = {
  claim_id: string;
  job_id: string;
  job_title: string;
  lecturer_name: string;
  requested_at: string;
  invoices: { number: string; status: string }[];
};

/** Persistently shows unresolved billing cases without changing invoices or assignments. */
export function CompanyFinanceReviews({
  actor,
  zone,
}: {
  actor: string;
  zone: string;
}) {
  const { t, i18n } = useTranslation("platform");
  const invoiceText = useTranslation("commercial").t;
  const reviews = useQuery({
    queryKey: ["company-invoice-reviews", actor],
    queryFn: async () => {
      const { data, error } = await db().rpc("company_invoice_reviews");
      if (error) throw error;
      if (!Array.isArray(data))
        throw new Error("Invalid finance review response");
      return data as Review[];
    },
  });
  if (reviews.isPending) return null;
  if (reviews.isError)
    return <Notice kind="error">{t("companyDecisionFailed")}</Notice>;
  return (
    <section className="panel commercial-section">
      <h2>{t("companyFinanceReviews")}</h2>
      <p>{t("companyFinanceHint")}</p>
      {!reviews.data.length ? (
        <p>{t("companyFinanceNone")}</p>
      ) : (
        reviews.data.map((item) => (
          <article key={item.claim_id}>
            <h3>
              <Link to={`/jobs/${item.job_id}`}>{item.job_title}</Link>
            </h3>
            <p>
              {item.lecturer_name} ·{" "}
              {dateTime(item.requested_at, i18n.language, zone)} ({zone})
            </p>
            <ul>
              {item.invoices.map((invoice) => (
                <li key={invoice.number}>
                  {invoice.number} · {invoiceText(invoice.status)}
                </li>
              ))}
            </ul>
          </article>
        ))
      )}
    </section>
  );
}
