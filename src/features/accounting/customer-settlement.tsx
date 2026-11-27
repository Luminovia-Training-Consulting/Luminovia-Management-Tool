import { isDatabasePermissionDenied } from "../../lib/database-errors";
import { useRequestKey } from "../../lib/request-key";
import { useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { dateTime, zonedInstant } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import {
  accountingKeys,
  accountingWrite,
  customerCreditNotesQuery,
  customerSettlementQuery,
  type AccountingInvoice,
} from "./api";
import {
  accountingCents,
  accountingDecimal,
  type CustomerSettlement,
} from "./schema";

const commands = [
  "applyCredit",
  "reverseCredit",
  "recordRefund",
  "reverseRefund",
] as const;
type Command = (typeof commands)[number];

function activeEntries<T extends { id: string; reverses_id: string | null }>(
  entries: T[],
) {
  const reversed = new Set(entries.map(({ reverses_id }) => reverses_id));
  return entries.filter(
    (entry) => !entry.reverses_id && !reversed.has(entry.id),
  );
}

export function CustomerSettlementPanel({
  actor,
  invoice,
  onDenied,
}: {
  actor: string;
  invoice: Pick<AccountingInvoice, "id" | "number">;
  onDenied: () => void;
}) {
  const { t } = useTranslation("accounting");
  const query = useQuery(customerSettlementQuery(actor, invoice.id));
  const result = query.data;
  if (
    query.isPending ||
    (result && !query.isFetchedAfterMount && query.isFetching)
  )
    return <Loading />;
  if (query.isError || !result)
    return <ErrorState retry={() => void query.refetch()} />;
  return (
    <div>
      {invoice.number && <h3>{invoice.number}</h3>}
      <p role="status">{t(`settlementState.${result.status}`)}</p>
      <dl className="accounting-settlement-values">
        <dt>{t("total")}</dt>
        <dd>
          {result.original_total} {result.currency}
        </dd>
        <dt>{t("settlementCredits")}</dt>
        <dd>
          {result.credit_total} {result.currency}
        </dd>
        <dt>{t("settlementNet")}</dt>
        <dd>
          {result.net_total} {result.currency}
        </dd>
        <dt>{t("paid")}</dt>
        <dd>
          {result.received_total} {result.currency}
        </dd>
        <dt>{t("settlementRefunded")}</dt>
        <dd>
          {result.refunded_total} {result.currency}
        </dd>
        <dt>{t("outstanding")}</dt>
        <dd>
          {result.outstanding_total} {result.currency}
        </dd>
        <dt>{t("settlementRefundDue")}</dt>
        <dd>
          {result.refund_due_total} {result.currency}
        </dd>
      </dl>
      {result.can_manage && (
        <SettlementJournal actor={actor} result={result} onDenied={onDenied} />
      )}
    </div>
  );
}

function SettlementJournal({
  actor,
  result,
  onDenied,
}: {
  actor: string;
  result: CustomerSettlement;
  onDenied: () => void;
}) {
  const { t, i18n } = useTranslation("accounting");
  const online = useOnline();
  const client = useQueryClient();
  const notes = useInfiniteQuery(
    customerCreditNotesQuery(actor, result.invoice_id),
  );
  const [command, setCommand] = useState<Command>("applyCredit");
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [at, setAt] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const retry = useRequestKey();
  const applications = result.credit_applications ?? [];
  const refunds = result.refunds ?? [];
  const currentApplications = activeEntries(applications);
  const appliedNoteIds = new Set(
    currentApplications.map((entry) => entry.credit_note_id),
  );
  const unapplied = notes.isError
    ? []
    : (notes.data?.pages.flatMap((page) => page.items) ?? []).filter(
        (note) => !appliedNoteIds.has(note.id),
      );
  const choices = {
    applyCredit: unapplied,
    reverseCredit: currentApplications,
    recordRefund: [],
    reverseRefund: activeEntries(refunds),
  }[command];
  const isRefund = command === "recordRefund";
  const exactAmount = accountingDecimal.safeParse(
    amount.trim().replace(",", "."),
  );
  const refundAt = isRefund ? zonedInstant(at, "UTC") : null;
  const ready = isRefund
    ? confirmed &&
      exactAmount.success &&
      accountingCents(exactAmount.data) > 0n &&
      accountingCents(exactAmount.data) <=
        accountingCents(result.refund_due_total) &&
      refundAt !== null &&
      reason.trim().length > 0
    : choices.some((choice) => choice.id === target) &&
      reason.trim().length >= 5;

  const save = useMutation({
    mutationFn: () => {
      if (!ready || (refundAt && Date.parse(refundAt) > Date.now()))
        throw new Error("invalid_customer_settlement");
      const common = { p_invoice_id: result.invoice_id };
      const [name, payload] = (
        {
          applyCredit: [
            "apply_customer_invoice_credit_note",
            { ...common, p_credit_note_id: target, p_reason: reason },
          ],
          reverseCredit: [
            "reverse_customer_invoice_credit_note",
            { ...common, p_application_id: target, p_reason: reason },
          ],
          recordRefund: [
            "record_customer_invoice_refund",
            {
              ...common,
              p_amount: exactAmount.data,
              p_refunded_at: refundAt,
              p_reference: reason,
            },
          ],
          reverseRefund: [
            "reverse_customer_invoice_refund",
            { ...common, p_refund_id: target, p_reason: reason },
          ],
        } as const
      )[command];
      const signature = JSON.stringify({ name, payload });
      const retryId = retry.forInput(signature);
      return accountingWrite(name, {
        ...payload,
        p_request_id: retryId,
      });
    },
    onSuccess: async () => {
      setTarget("");
      setReason("");
      setAmount("");
      setAt("");
      setConfirmed(false);
      retry.clear();
      await client.invalidateQueries({
        queryKey: accountingKeys.customerSettlement(actor, result.invoice_id),
      });
    },
    onError: (error) => {
      if (isDatabasePermissionDenied(error)) onDenied();
    },
  });
  const busy = !online || save.isPending;
  return (
    <>
      <p className="accounting-hint">{t("settlementStaffHint")}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Field id="settlement-action" label={t("settlementAction")}>
          <select
            id="settlement-action"
            value={command}
            disabled={busy}
            onChange={(event) => {
              setCommand(event.target.value as Command);
              setTarget("");
              setReason("");
              setConfirmed(false);
              save.reset();
            }}
          >
            {commands.map((action) => (
              <option key={action} value={action}>
                {t(action)}
              </option>
            ))}
          </select>
        </Field>
        {isRefund ? (
          <>
            <div className="form-row">
              <Field
                id="settlement-amount"
                label={t("refundAmount", { currency: result.currency })}
              >
                <input
                  id="settlement-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => {
                    setAmount(event.target.value);
                    setConfirmed(false);
                  }}
                  disabled={busy}
                  required
                />
              </Field>
              <Field id="settlement-time" label={t("refundAt")}>
                <input
                  id="settlement-time"
                  type="datetime-local"
                  value={at}
                  onChange={(event) => {
                    setAt(event.target.value);
                    setConfirmed(false);
                  }}
                  disabled={busy}
                  required
                />
              </Field>
            </div>
          </>
        ) : (
          <Field id="settlement-entry" label={t("settlementEntry")}>
            <select
              id="settlement-entry"
              value={target}
              disabled={busy || !choices.length}
              required
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="">
                {t(choices.length ? "settlementSelect" : "settlementNone")}
              </option>
              {choices.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.reference} · {entry.amount} {result.currency}
                </option>
              ))}
            </select>
          </Field>
        )}
        {command === "applyCredit" && notes.hasNextPage && (
          <Button
            type="button"
            variant="secondary"
            disabled={busy || notes.isFetchingNextPage}
            onClick={() => void notes.fetchNextPage()}
          >
            {t("creditMore")}
          </Button>
        )}
        {command === "applyCredit" && notes.isError && (
          <Notice kind="error">
            {t("creditHistoryUnavailable")}{" "}
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => void notes.refetch()}
            >
              {t("creditRetry")}
            </Button>
          </Notice>
        )}
        <Field
          id="settlement-purpose"
          label={t(isRefund ? "refundBankReference" : "settlementReason")}
        >
          <input
            id="settlement-purpose"
            value={reason}
            maxLength={isRefund ? 120 : 1000}
            required
            disabled={busy}
            onChange={(event) => {
              setReason(event.target.value);
              setConfirmed(false);
            }}
          />
        </Field>
        {isRefund && (
          <label className="accounting-pick accounting-review">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>{t("refundReviewed")}</span>
          </label>
        )}
        {save.isError && (
          <Notice kind="error">{t("settlementConflict")}</Notice>
        )}
        {save.isSuccess && <Notice>{t("settlementSaved")}</Notice>}
        <Button type="submit" disabled={busy || !ready}>
          {t(command)}
        </Button>
      </form>
      <h3>{t("settlementJournal")}</h3>
      <ol className="accounting-history">
        {applications.map((entry) => (
          <li key={entry.id}>
            {entry.reference} · {entry.amount} {result.currency} ·{" "}
            {t(entry.reverses_id ? "reverseCredit" : "applyCredit")}
            <p>
              {entry.reason} ·{" "}
              {dateTime(entry.created_at, i18n.language, "UTC")}
            </p>
          </li>
        ))}
        {refunds.map((entry) => (
          <li key={entry.id}>
            {entry.reference} · {entry.amount} {result.currency} ·{" "}
            {t(entry.reverses_id ? "reverseRefund" : "recordRefund")}
            <p>
              {dateTime(
                entry.refunded_at ?? entry.created_at,
                i18n.language,
                "UTC",
              )}
            </p>
          </li>
        ))}
      </ol>
    </>
  );
}
