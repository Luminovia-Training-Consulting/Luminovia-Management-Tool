/** Protected assignment reconciliation and downloadable confirmation from the finance list. */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { ErrorState, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { currencyCodes } from "../../lib/currencies";
import { money } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { downloadPortalDocument } from "../learning/api";
import "./assignment-finance-i18n";

const decimal = z.string().regex(/^-?\d+(?:\.\d+)?$/);
const optional = decimal.nullable();
const currency = z.enum(currencyCodes);
const reportSchema = z.object({
  currency,
  claim_status: z.string(),
  agreed_lecturer: decimal,
  adjustment_lecturer: decimal,
  agreed_customer: optional,
  contract_margin: optional,
  approved_timesheet_minutes: z.number().int().nonnegative().nullable(),
  recorded_teaching_minutes: z.number().int().nonnegative().nullable(),
  delivered_minutes: z.number().int().nonnegative().nullable(),
  lecturer_invoices: z.array(
    z.object({
      id: z.uuid(),
      number: z.string(),
      state: z.string(),
      amount: decimal,
    }),
  ),
  lecturer_invoiced: optional,
  lecturer_paid: optional,
  lecturer_outstanding: optional,
  cancellation_compensation: optional,
  customer_invoice_number: z.string().nullable(),
  customer_invoice_grouped: z.boolean().nullable(),
  customer_invoiced: optional,
  customer_net_invoiced: optional,
  customer_received: optional,
  customer_retained: optional,
  customer_outstanding: optional,
  expenses: z.array(
    z.object({
      currency,
      approved: decimal,
      paid: decimal,
      outstanding: decimal,
    }),
  ),
});

/** Query only when the actor opens a specific current finance assignment. */
function Reconciliation({
  actor,
  claimId,
}: {
  actor: string;
  claimId: string;
}) {
  const { t, i18n } = useTranslation("assignmentFinance");
  const query = useQuery({
    queryKey: ["assignment-finance-reconciliation", actor, claimId],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc(
          "assignment_finance_reconciliation",
          { p_claim_id: claimId },
          { get: true },
        )
        .abortSignal(signal);
      if (error) throw error;
      return reportSchema.parse(data);
    },
  });
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  const report = query.data;
  const display = (value: string, code = report.currency) =>
    money(Number(value), code, i18n.language);
  const amountRow = (key: string, value: string | null) =>
    value !== null && (
      <div key={key}>
        <dt>{t(key)}</dt>
        <dd>{display(value)}</dd>
      </div>
    );
  return (
    <div className="section-stack">
      <dl className="record-facts">
        {amountRow("agreedLecturer", report.agreed_lecturer)}
        {amountRow("adjustments", report.adjustment_lecturer)}
        {amountRow("agreedCustomer", report.agreed_customer)}
        {amountRow("margin", report.contract_margin)}
        {amountRow("cancellation", report.cancellation_compensation)}
        {report.delivered_minutes !== null && (
          <div>
            <dt>{t("confirmedDelivery")}</dt>
            <dd>{report.delivered_minutes} min</dd>
          </div>
        )}
        {report.recorded_teaching_minutes !== null && (
          <div>
            <dt>{t("delivery")}</dt>
            <dd>{report.recorded_teaching_minutes} min</dd>
          </div>
        )}
        {report.approved_timesheet_minutes !== null && (
          <div>
            <dt>{t("approvedTime")}</dt>
            <dd>{report.approved_timesheet_minutes} min</dd>
          </div>
        )}
      </dl>
      {report.lecturer_invoices.length > 0 && (
        <section>
          <h3>{t("lecturerInvoices")}</h3>
          <ul className="session-list">
            {report.lecturer_invoices.map((invoice) => (
              <li key={invoice.id}>
                {invoice.number} · {display(invoice.amount)} ·{" "}
                {t("state." + invoice.state)}
              </li>
            ))}
          </ul>
          <dl className="record-facts">
            {amountRow("invoiced", report.lecturer_invoiced)}
            {amountRow("paid", report.lecturer_paid)}
            {amountRow("outstanding", report.lecturer_outstanding)}
          </dl>
        </section>
      )}
      {report.customer_invoice_number && (
        <section>
          <h3>
            {t("customerInvoice")} · {report.customer_invoice_number}
          </h3>
          {report.customer_invoice_grouped && <Notice>{t("grouped")}</Notice>}
          <dl className="record-facts">
            {amountRow("invoiced", report.customer_invoiced)}
            {amountRow("netInvoice", report.customer_net_invoiced)}
            {amountRow("received", report.customer_received)}
            {amountRow("retained", report.customer_retained)}
            {amountRow("outstanding", report.customer_outstanding)}
          </dl>
        </section>
      )}
      {report.expenses.length > 0 && (
        <section>
          <h3>{t("expenses")}</h3>
          <ul className="session-list">
            {report.expenses.map((expense) => (
              <li key={expense.currency}>
                {expense.currency} · {t("approved")}{" "}
                {display(expense.approved, expense.currency)}
                {" · "}
                {t("paid")} {display(expense.paid, expense.currency)}
                {" · "}
                {t("outstanding")}{" "}
                {display(expense.outstanding, expense.currency)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Hide online actions while the live finance authority is unavailable. */
export default function AssignmentFinanceAction({
  actor,
  claimId,
  title,
  manager,
}: {
  actor: string;
  claimId: string;
  title: string;
  manager: boolean;
}) {
  const { t, i18n } = useTranslation("assignmentFinance");
  const online = useOnline();
  const [open, setOpen] = useState(false);
  const download = useMutation({
    mutationFn: () => {
      const locale = i18n.language.startsWith("de") ? "de" : "en";
      return downloadPortalDocument(
        { kind: "assignment_confirmation", id: claimId, locale },
        locale === "de"
          ? "luminovia-auftragsbestaetigung.pdf"
          : "luminovia-assignment-confirmation.pdf",
      );
    },
  });
  if (!online) return null;
  return manager ? (
    <>
      <Button
        variant="secondary"
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
      >
        {t("reconciliation")}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={t("reconciliation")}
        description={title}
      >
        {open && <Reconciliation actor={actor} claimId={claimId} />}
      </Dialog>
    </>
  ) : (
    <>
      <Button
        variant="secondary"
        type="button"
        size="sm"
        disabled={download.isPending}
        onClick={() => download.mutate()}
      >
        <Download size={16} aria-hidden="true" />
        {t("confirmation")}
      </Button>
      {download.isError && <Notice kind="error">{t("downloadError")}</Notice>}
    </>
  );
}
