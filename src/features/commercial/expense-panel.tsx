/** Collapsible finance entry for lecturer submissions and authorised review. */
import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { Download, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { downloadCsv } from "../../lib/csv";
import { currencyCodes } from "../../lib/currencies";
import { formatUtcDate, money } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import { saveExpenseReceipt } from "../files/api";
import {
  expenseReportQuery,
  expenseStates,
  type Expense,
  type ExpenseReportFilters,
} from "./expense-api";
import { ExpenseReviewForm, ExpenseSubmissionForm } from "./expense-forms";
import { FinanceRows } from "./finance-rows";
import "./expense-i18n";
import "./expenses.css";

type Props = { actor: string; zone: string; manager: boolean };
type Period = Pick<ExpenseReportFilters, "p_from" | "p_through">;
type FilterName =
  | "p_state"
  | "p_currency"
  | "p_assignment"
  | "p_lecturer"
  | "p_customer"
  | "p_course";

function periodFor(zone: string, unit: "month" | "quarter" | "year"): Period {
  const now = DateTime.now().setZone(zone);
  return {
    p_from: now.startOf(unit).toISODate()!,
    p_through: now.endOf(unit).toISODate()!,
  };
}

const noFilters = {
  p_state: null,
  p_currency: null,
  p_assignment: null,
  p_lecturer: null,
  p_customer: null,
  p_course: null,
};

function optionsFromRows(
  rows: readonly Expense[],
  key: keyof Expense,
  label: keyof Expense,
): [string, string][] {
  return Array.from(
    new Map(
      rows.flatMap((row) => {
        const value = row[key],
          description = row[label];
        return value && description
          ? [[value, description] as [string, string]]
          : [];
      }),
    ),
  ).sort((first, second) => first[1].localeCompare(second[1]));
}

/** Fetch only while the finance subsection is opened. */
export default function ExpensesPanel(props: Props) {
  const { t } = useTranslation("expenses");
  const [open, setOpen] = useState(false);
  return (
    <details
      className="panel expense-panel"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("title")}</summary>
      {open && <ExpenseWorkspace {...props} />}
    </details>
  );
}

function ExpenseWorkspace({ actor, zone, manager }: Props) {
  const { t, i18n } = useTranslation("expenses");
  const id = useId();
  const online = useOnline();
  const [period, setPeriod] = useState(() => periodFor(zone, "year"));
  const [formDates, setFormDates] = useState(period);
  const [filters, setFilters] =
    useState<Omit<ExpenseReportFilters, keyof Period>>(noFilters);
  const [editor, setEditor] = useState<Expense | "new" | null>(null);
  const [saved, setSaved] = useState(false);
  const base = useQuery({
    ...expenseReportQuery(actor, manager, { ...period, ...noFilters }),
    enabled: online,
  });
  const isFiltered = Object.values(filters).some(Boolean);
  const filtered = useQuery({
    ...expenseReportQuery(actor, manager, { ...period, ...filters }),
    enabled: online && isFiltered,
  });
  const report = isFiltered ? filtered : base;
  const download = useMutation({
    mutationFn: (item: Expense) =>
      saveExpenseReceipt(item.id, item.receipt_version_id, item.receipt_name),
  });
  const result = online && report.isSuccess ? report.data : null;
  const rows = result?.items ?? [];
  const openEditor = (item: Expense | "new") => {
    setSaved(false);
    setEditor(item);
  };
  const setFilter = (key: FilterName, value: string) => {
    setFilters((current) => ({ ...current, [key]: value || null }));
  };
  const setCurrentPeriod = (unit: "month" | "quarter" | "year") => {
    const updated = periodFor(zone, unit);
    setFormDates(updated);
    setPeriod(updated);
  };
  const submitDates = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPeriod(formDates);
  };
  const dimensions: {
    name: FilterName;
    label: string;
    values: [string, string][];
  }[] = [
    {
      name: "p_state",
      label: t("status"),
      values: expenseStates.map((state) => [state, t("state." + state)]),
    },
    {
      name: "p_currency",
      label: t("currency"),
      values: currencyCodes.map((code) => [code, code]),
    },
  ];
  if (manager) {
    const options = base.data?.items ?? [];
    dimensions.push(
      {
        name: "p_customer",
        label: t("customer"),
        values: optionsFromRows(options, "customer_id", "customer_name"),
      },
      {
        name: "p_lecturer",
        label: t("lecturer"),
        values: optionsFromRows(options, "lecturer_id", "lecturer_name"),
      },
      {
        name: "p_course",
        label: t("course"),
        values: optionsFromRows(options, "course_id", "title"),
      },
      {
        name: "p_assignment",
        label: t("assignment"),
        values: optionsFromRows(options, "claim_id", "title"),
      },
    );
  }
  const exportReport = () =>
    downloadCsv("lecturer-expenses.csv", [
      [
        "expense_id",
        "assignment_id",
        "assignment",
        "session_id",
        "lecturer",
        "customer",
        "course_run_id",
        "spent_on",
        "category",
        "state",
        "currency",
        "requested_amount",
        "approved_amount",
        "invoice_number",
        "invoice_state",
        "paid_on",
        "payment_reference",
      ],
      ...rows.map((row) => [
        row.id,
        row.claim_id,
        row.title,
        row.session_id,
        row.lecturer_name,
        row.customer_name,
        row.course_id,
        row.spent_on,
        row.category,
        row.state,
        row.currency,
        row.requested_amount,
        row.approved_amount,
        row.invoice_number,
        row.invoice_state,
        row.paid_on,
        row.payment_reference,
      ]),
    ]);
  return (
    <div className="expense-workspace">
      <div className="form-actions">
        {!manager && (
          <Button
            type="button"
            onClick={() => openEditor("new")}
            disabled={!online}
          >
            <Plus size={16} />
            {t("new")}
          </Button>
        )}
        {manager && rows.length > 0 && (
          <Button type="button" variant="secondary" onClick={exportReport}>
            <Download size={16} />
            {t("export")}
          </Button>
        )}
      </div>
      <form className="expense-filter-form" onSubmit={submitDates}>
        <div className="form-actions">
          {(["month", "quarter", "year"] as const).map((preset) => (
            <Button
              key={preset}
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setCurrentPeriod(preset)}
            >
              {t(preset)}
            </Button>
          ))}
        </div>
        <div className="form-row expense-dates">
          <Field id={id + "-from"} label={t("from")}>
            <input
              id={id + "-from"}
              type="date"
              value={formDates.p_from}
              max={formDates.p_through}
              required
              onChange={(event) =>
                setFormDates({
                  ...formDates,
                  p_from: event.currentTarget.value,
                })
              }
            />
          </Field>
          <Field id={id + "-through"} label={t("to")}>
            <input
              id={id + "-through"}
              type="date"
              value={formDates.p_through}
              min={formDates.p_from}
              required
              onChange={(event) =>
                setFormDates({
                  ...formDates,
                  p_through: event.currentTarget.value,
                })
              }
            />
          </Field>
          <Button type="submit" variant="secondary">
            {t("applyFilters")}
          </Button>
        </div>
      </form>
      <div className="form-row expense-dimensions">
        {dimensions.map(({ name, label, values }) => (
          <Field key={name} id={id + "-" + name} label={label}>
            <select
              id={id + "-" + name}
              value={filters[name] ?? ""}
              onChange={(event) => setFilter(name, event.currentTarget.value)}
            >
              <option value="">{t("all")}</option>
              {values.map(([value, caption]) => (
                <option value={value} key={value}>
                  {caption}
                </option>
              ))}
            </select>
          </Field>
        ))}
      </div>
      {saved && (
        <Notice kind="success">
          {t(manager ? "reviewConfirmed" : "confirmed")}
        </Notice>
      )}
      {download.isError && <Notice kind="error">{t("uploadError")}</Notice>}
      {!online ? (
        <Notice>{t("offline", { ns: "translation" })}</Notice>
      ) : report.isPending ? (
        <Loading />
      ) : report.isError ? (
        <ErrorState retry={() => void report.refetch()} />
      ) : !rows.length ? (
        <Notice>{t("empty")}</Notice>
      ) : null}
      {result && Boolean(result.totals.length) && (
        <section className="expense-totals" aria-label={t("totals")}>
          {result.totals.map((total) => (
            <article key={total.currency}>
              <strong>{total.currency}</strong>
              <dl>
                {(
                  [
                    ["submitted", "submittedTotal"],
                    ["approved", "approvedTotal"],
                    ["paid", "paidTotal"],
                    ["outstanding", "outstandingTotal"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key}>
                    <dt>{t(label)}</dt>
                    <dd>
                      {money(Number(total[key]), total.currency, i18n.language)}
                    </dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </section>
      )}
      {!!rows.length && (
        <FinanceRows total={rows.length} label={t("title")} scroll={false}>
          {(limit) => (
            <ul className="expense-list">
              {rows.slice(0, limit).map((row) => {
                const reviewable =
                  manager &&
                  row.lecturer_id !== actor &&
                  ["submitted", "approved", "reimbursed"].includes(row.state);
                const correctable = !manager && row.state === "correction";
                return (
                  <li key={row.id}>
                    <div>
                      <strong>{row.title}</strong>
                      <p className="muted">
                        {[
                          row.lecturer_name,
                          row.customer_name,
                          formatUtcDate(row.spent_on, i18n.language),
                          t("category." + row.category),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <p>{row.description}</p>
                      {row.review_note && (
                        <p className="muted">{row.review_note}</p>
                      )}
                      {row.invoice_number && (
                        <p>
                          {t("invoice")} · {row.invoice_number}
                        </p>
                      )}
                      {row.paid_on && (
                        <p>
                          {t("paymentDate")} ·{" "}
                          {formatUtcDate(row.paid_on, i18n.language)} ·{" "}
                          {row.payment_reference}
                        </p>
                      )}
                    </div>
                    <div className="expense-amounts">
                      <span>{t("state." + row.state)}</span>
                      <strong>
                        {money(
                          Number(row.requested_amount),
                          row.currency,
                          i18n.language,
                        )}
                      </strong>
                      {row.approved_amount && (
                        <span>
                          {t("approvedTotal")} ·{" "}
                          {money(
                            Number(row.approved_amount),
                            row.currency,
                            i18n.language,
                          )}
                        </span>
                      )}
                    </div>
                    <div className="form-actions">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={!online || download.isPending}
                        onClick={() => download.mutate(row)}
                      >
                        {t("download")}
                      </Button>
                      {(reviewable || correctable) && (
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          disabled={!online}
                          onClick={() => openEditor(row)}
                        >
                          {t(
                            correctable
                              ? "edit"
                              : row.state === "submitted"
                                ? "review"
                                : "manageApproved",
                          )}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </FinanceRows>
      )}
      {manager && <p className="muted">{t("settlementNote")}</p>}
      <Dialog
        open={editor !== null}
        onOpenChange={(next) => {
          if (!next) setEditor(null);
        }}
        title={t(
          editor === "new"
            ? "new"
            : manager
              ? editor?.state === "submitted"
                ? "review"
                : "manageApproved"
              : "edit",
        )}
        description={
          editor && editor !== "new" ? editor.title : t("uploadHint")
        }
      >
        {editor &&
          (manager && editor !== "new" ? (
            <ExpenseReviewForm
              key={editor.id}
              actor={actor}
              zone={zone}
              expense={editor}
              onDone={() => {
                setEditor(null);
                setSaved(true);
              }}
            />
          ) : (
            <ExpenseSubmissionForm
              key={editor === "new" ? "new" : editor.id}
              actor={actor}
              zone={zone}
              expense={editor === "new" ? null : editor}
              onDone={() => {
                setEditor(null);
                setSaved(true);
              }}
            />
          ))}
      </Dialog>
    </div>
  );
}
