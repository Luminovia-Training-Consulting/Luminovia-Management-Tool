/** Collect a scanned receipt and submit or review the exact expense revision. */
import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { currencyCodes } from "../../lib/currencies";
import { dateTime, money } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import { useRequestKey } from "../../lib/request-key";
import { uploadExpenseReceipt, saveExpenseReceipt } from "../files/api";
import {
  expenseCategories,
  expenseInvoicesQuery,
  expenseKey,
  expenseOptionsQuery,
  saveExpense,
  type Expense,
  type ExpenseAction,
} from "./expense-api";

type ExpenseFormProps = {
  actor: string;
  zone: string;
  expense: Expense | null;
  onDone: () => void;
};

function useExpenseCommand({
  actor,
  expense,
  onDone,
}: Pick<ExpenseFormProps, "actor" | "expense" | "onDone">) {
  const key = useRequestKey();
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      action,
      payload,
    }: {
      action: ExpenseAction;
      payload: Record<string, string | null>;
    }) =>
      saveExpense(
        action,
        expense,
        payload,
        key.forInput(JSON.stringify([action, payload])),
      ),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: expenseKey(actor) }),
        client.invalidateQueries({
          queryKey: ["accounting-settlement-journal", actor],
        }),
      ]);
      onDone();
    },
  });
}

function ExpenseFailure({ error }: { error: unknown }) {
  const { t } = useTranslation("expenses");
  const code =
    error && typeof error === "object" && "code" in error ? error.code : null;
  return (
    <Notice kind="error">
      {t(
        code === "PT409" ? "stale" : code === "23505" ? "duplicate" : "failed",
      )}
    </Notice>
  );
}

function values(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  const fields = new FormData(event.currentTarget);
  return (name: string) => String(fields.get(name) ?? "").trim();
}

const todayIn = (zone: string) => DateTime.now().setZone(zone).toISODate()!;
const decimal = "[0-9]{1,10}([.,][0-9]{1,2})?";

/** Only the scanned, confirmed receipt version is eligible for a submission. */
export function ExpenseSubmissionForm({
  actor,
  zone,
  expense,
  onDone,
}: ExpenseFormProps) {
  const { t, i18n } = useTranslation("expenses");
  const id = useId();
  const online = useOnline();
  const [claim, setClaim] = useState(expense?.claim_id ?? "");
  const [session, setSession] = useState(expense?.session_id ?? "");
  const [receipt, setReceipt] = useState(
    expense
      ? { id: expense.receipt_version_id, name: expense.receipt_name }
      : null,
  );
  const assignment = useQuery({
    ...expenseOptionsQuery(actor),
    enabled: online,
  });
  const sessions =
    assignment.data?.find(({ claim_id }) => claim_id === claim)?.sessions ?? [];
  const receiptKey = useRequestKey();
  const upload = useMutation({
    mutationFn: (file: File) =>
      uploadExpenseReceipt(
        file,
        receiptKey.forInput(
          JSON.stringify([file.name, file.size, file.lastModified]),
        ),
        actor,
      ),
    onSuccess: (document) => {
      setReceipt({
        id: document.current_version_id!,
        name: document.original_name,
      });
      receiptKey.clear();
    },
  });
  const save = useExpenseCommand({ actor, expense, onDone });
  const busy = upload.isPending || save.isPending;
  if (assignment.isPending && online) return <Loading />;
  if (assignment.isError && !expense)
    return <ErrorState retry={() => void assignment.refetch()} />;
  if (!expense && online && assignment.data?.length === 0)
    return <Notice>{t("noAssignments")}</Notice>;
  return (
    <form
      className="expense-form"
      onSubmit={(event) => {
        const read = values(event);
        if (!receipt || !online || busy) return;
        save.mutate({
          action: expense ? "resubmit" : "submit",
          payload: {
            claim_id: claim,
            session_id: session || null,
            spent_on: read("spent_on"),
            currency: read("currency"),
            amount: read("amount").replace(",", "."),
            category: read("category"),
            description: read("description"),
            receipt_version_id: receipt.id,
          },
        });
      }}
    >
      <fieldset disabled={!online || busy}>
        {expense?.review_note && <Notice>{expense.review_note}</Notice>}
        <Field id={id + "-claim"} label={t("assignment")}>
          <select
            id={id + "-claim"}
            value={claim}
            disabled={Boolean(expense)}
            onChange={(event) => {
              setClaim(event.currentTarget.value);
              setSession("");
            }}
            required
          >
            <option value="">—</option>
            {expense &&
              !assignment.data?.some(({ claim_id }) => claim_id === claim) && (
                <option value={expense.claim_id}>{expense.title}</option>
              )}
            {assignment.data?.map(({ claim_id, title }) => (
              <option value={claim_id} key={claim_id}>
                {title}
              </option>
            ))}
          </select>
        </Field>
        <Field id={id + "-session"} label={t("session")}>
          <select
            id={id + "-session"}
            value={session}
            onChange={(event) => setSession(event.currentTarget.value)}
          >
            <option value="">{t("noSession")}</option>
            {expense?.session_id &&
              expense.session_starts_at &&
              !sessions.some(({ id }) => id === expense.session_id) && (
                <option value={expense.session_id}>
                  {dateTime(expense.session_starts_at, i18n.language, zone)}
                </option>
              )}
            {sessions.map(({ id: sessionId, starts_at }) => (
              <option value={sessionId} key={sessionId}>
                {dateTime(starts_at, i18n.language, zone)}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-row">
          <Field id={id + "-category"} label={t("category")}>
            <select
              id={id + "-category"}
              name="category"
              defaultValue={expense?.category ?? "travel"}
            >
              {expenseCategories.map((category) => (
                <option key={category} value={category}>
                  {t("category." + category)}
                </option>
              ))}
            </select>
          </Field>
          <Field id={id + "-spent"} label={t("spentOn")}>
            <input
              id={id + "-spent"}
              name="spent_on"
              type="date"
              max={todayIn(zone)}
              defaultValue={expense?.spent_on ?? todayIn(zone)}
              required
            />
          </Field>
        </div>
        <div className="form-row">
          <Field id={id + "-amount"} label={t("amount")}>
            <input
              id={id + "-amount"}
              name="amount"
              type="text"
              inputMode="decimal"
              pattern={decimal}
              defaultValue={expense?.requested_amount}
              required
            />
          </Field>
          <Field id={id + "-currency"} label={t("currency")}>
            <select
              id={id + "-currency"}
              name="currency"
              defaultValue={expense?.currency ?? currencyCodes[0]}
            >
              {currencyCodes.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field id={id + "-description"} label={t("description")}>
          <textarea
            id={id + "-description"}
            name="description"
            rows={3}
            maxLength={1000}
            defaultValue={expense?.description}
            required
          />
        </Field>
        <Field id={id + "-receipt"} label={t("upload")} hint={t("uploadHint")}>
          <input
            id={id + "-receipt"}
            type="file"
            accept="application/pdf,image/png,image/jpeg,image/webp"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) {
                setReceipt(null);
                upload.mutate(file);
              }
            }}
          />
        </Field>
        {upload.isPending && <p role="status">{t("scanning")}</p>}
        {upload.isError && <Notice kind="error">{t("uploadError")}</Notice>}
        {receipt && <p className="expense-receipt-name">{receipt.name}</p>}
        <div className="form-actions">
          <Button
            type="submit"
            disabled={!receipt || !claim || !online || busy}
          >
            {t("new")}
          </Button>
        </div>
      </fieldset>
      {save.isError && <ExpenseFailure error={save.error} />}
    </form>
  );
}

/** Review, record a payment, or link an existing compatible lecturer invoice. */
export function ExpenseReviewForm({
  actor,
  zone,
  expense,
  onDone,
}: ExpenseFormProps & { expense: Expense }) {
  const { t, i18n } = useTranslation("expenses");
  const id = useId();
  const online = useOnline();
  const invoiceOptions = useQuery({
    ...expenseInvoicesQuery(actor, expense.id),
    enabled: online,
  });
  const save = useExpenseCommand({ actor, expense, onDone });
  const receipt = useMutation({
    mutationFn: () =>
      saveExpenseReceipt(
        expense.id,
        expense.receipt_version_id,
        expense.receipt_name,
      ),
  });
  const [action, setAction] = useState<ExpenseAction>(
    expense.state === "submitted"
      ? "approve"
      : expense.state === "approved"
        ? "reimburse"
        : "link",
  );
  const reviewing = expense.state === "submitted";
  const approving = action === "approve";
  const linking = action === "link";
  const reimbursing = action === "reimburse";
  const invoiceId = invoiceOptions.data?.some(
    ({ id: candidate }) => candidate === expense.invoice_id,
  )
    ? (expense.invoice_id ?? "")
    : "";
  return (
    <form
      className="expense-form"
      onSubmit={(event) => {
        const read = values(event);
        const payload: Record<string, string | null> = {};
        if (reviewing) payload.note = read("note");
        if (approving) payload.amount = read("amount").replace(",", ".");
        if (linking || approving) payload.invoice_id = read("invoice") || null;
        if (reimbursing) {
          payload.paid_on = read("paid_on");
          payload.reference = read("reference");
        }
        if (online) save.mutate({ action, payload });
      }}
    >
      <p>{expense.description}</p>
      <Button
        type="button"
        variant="secondary"
        disabled={!online || receipt.isPending}
        onClick={() => receipt.mutate()}
      >
        {t("download")}
      </Button>
      {receipt.isError && <Notice kind="error">{t("uploadError")}</Notice>}
      <fieldset disabled={!online || save.isPending}>
        <Field id={id + "-action"} label={t("status")}>
          <select
            id={id + "-action"}
            value={action}
            onChange={(event) =>
              setAction(event.currentTarget.value as ExpenseAction)
            }
          >
            {reviewing ? (
              <>
                <option value="approve">{t("approve")}</option>
                <option value="correction">{t("requestCorrection")}</option>
                <option value="rejected">{t("reject")}</option>
              </>
            ) : (
              <>
                {expense.state === "approved" && (
                  <option value="reimburse">{t("reimburse")}</option>
                )}
                <option value="link">{t("link")}</option>
              </>
            )}
          </select>
        </Field>
        {approving && (
          <Field
            id={id + "-amount"}
            label={t("approvedAmount") + " (" + expense.currency + ")"}
          >
            <input
              id={id + "-amount"}
              name="amount"
              type="text"
              inputMode="decimal"
              pattern={decimal}
              defaultValue={expense.requested_amount}
              required
            />
          </Field>
        )}
        {reviewing && (
          <Field id={id + "-reason"} label={t("reason")} hint={t("reasonHint")}>
            <textarea
              id={id + "-reason"}
              name="note"
              rows={3}
              maxLength={1000}
              required={!approving}
            />
          </Field>
        )}
        {(approving || linking) && invoiceOptions.isSuccess && (
          <Field id={id + "-invoice"} label={t("invoice")}>
            <select
              id={id + "-invoice"}
              name="invoice"
              defaultValue={invoiceId}
            >
              <option value="">{t("invoiceNone")}</option>
              {invoiceOptions.data.map(({ id: candidate, number }) => (
                <option key={candidate} value={candidate}>
                  {number}
                </option>
              ))}
            </select>
          </Field>
        )}
        {(approving || linking) && invoiceOptions.isError && (
          <ErrorState retry={() => void invoiceOptions.refetch()} />
        )}
        {reimbursing && (
          <>
            <p>
              {t("approvedAmount")} ·{" "}
              {money(
                Number(expense.approved_amount),
                expense.currency,
                i18n.language,
              )}
            </p>
            <Field id={id + "-paid"} label={t("paymentDate")}>
              <input
                id={id + "-paid"}
                name="paid_on"
                type="date"
                min={expense.spent_on}
                max={todayIn(zone)}
                defaultValue={todayIn(zone)}
                required
              />
            </Field>
            <Field id={id + "-reference"} label={t("paymentReference")}>
              <input
                id={id + "-reference"}
                name="reference"
                maxLength={200}
                required
              />
            </Field>
          </>
        )}
        <div className="form-actions">
          <Button type="submit" disabled={linking && !invoiceOptions.isSuccess}>
            {t(
              approving
                ? "approve"
                : linking
                  ? "link"
                  : reimbursing
                    ? "reimburse"
                    : action === "correction"
                      ? "requestCorrection"
                      : "reject",
            )}
          </Button>
        </div>
      </fieldset>
      {save.isError && <ExpenseFailure error={save.error} />}
    </form>
  );
}
