/** Scoped finance approval and lecturer access to reviewed final invoices. */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { formatUtcDate, money } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  commercialKeys,
  financePendingInvoiceExceptionsQuery,
  invoiceExceptionOptionsQuery,
  myInvoiceExceptionsQuery,
} from "./api";
import type { InvoiceException } from "./invoice-exception-schema";
import { parseInvoiceAmountCents } from "./invoice-submission";
import "./i18n";

export function InvoiceExceptionDecision({
  actor,
  requestId,
  sharedNote = "",
  validNote = false,
  worksheetCents,
  approvedOnly = false,
}: {
  actor: string;
  requestId: string;
  sharedNote?: string;
  validNote?: boolean;
  worksheetCents?: number;
  approvedOnly?: boolean;
}) {
  const { t, i18n } = useTranslation("commercial");
  const client = useQueryClient();
  const online = useOnline();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [contract, setContract] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [reason, setReason] = useState("");
  const options = useQuery({
    ...invoiceExceptionOptionsQuery(actor, requestId),
    enabled: open && online,
  });
  const refresh = () =>
    client.invalidateQueries({ queryKey: commercialKeys.finance(actor) });
  const action = useMutation({
    mutationFn: async (
      input:
        | { kind: "approve"; contract: string; amount: number; due: string }
        | { kind: "revoke"; id: string; note: string },
    ) => {
      requireOnline();
      if (input.kind === "approve") {
        const { data, error } = await db().rpc("approve_invoice_exception", {
          p_request_id: requestId,
          p_contract_id: input.contract,
          p_amount: input.amount,
          p_due_on: input.due,
          p_note: sharedNote,
        });
        if (error) throw error;
        z.uuid().parse(data);
        return;
      }
      const { error } = await db().rpc("revoke_invoice_exception", {
        p_exception_id: input.id,
        p_note: input.note,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setReason("");
      return refresh();
    },
    onError: refresh,
  });
  const active = options.data?.active;
  const contracts = options.data?.contracts ?? [];
  const chosen = contracts.some((option) => option.id === contract)
    ? contract
    : contracts.length === 1
      ? contracts[0].id
      : "";
  const selectedAmount = (parseInvoiceAmountCents(amount) ?? 0) / 100;
  const conflict =
    action.error && "code" in action.error && action.error.code === "PT409";

  return (
    <div className="invoice-exception">
      <Button
        type="button"
        variant="secondary"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((current) => !current)}
      >
        {t(
          approvedOnly
            ? "manageInvoiceException"
            : active
              ? "invoiceExceptionReady"
              : "openInvoiceException",
        )}
      </Button>
      <div id={id} hidden={!open}>
        {open && (
          <>
            {!online && <Notice>{t("failed")}</Notice>}
            {online && options.isPending && <Loading />}
            {options.isError && (
              <ErrorState retry={() => void options.refetch()} />
            )}
            {options.isSuccess && active && (
              <fieldset>
                <legend>{t("invoiceExceptionReady")}</legend>
                <p>
                  {t("invoiceExceptionContractVersion", {
                    version: active.contract_version,
                  })}
                  {" · "}
                  {money(active.amount, options.data.currency, i18n.language)}
                  {" · "}
                  {formatUtcDate(active.due_on, i18n.language)}
                </p>
                <Field
                  id={id + "-reason"}
                  label={t("invoiceExceptionRevokeNote")}
                >
                  <textarea
                    rows={2}
                    value={reason}
                    maxLength={1000}
                    disabled={!online || action.isPending}
                    onChange={(event) => setReason(event.currentTarget.value)}
                  />
                </Field>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={
                    !online || action.isPending || reason.trim().length < 10
                  }
                  onClick={() =>
                    action.mutate({
                      kind: "revoke",
                      id: active.id,
                      note: reason.trim(),
                    })
                  }
                >
                  {t("invoiceExceptionRevoke")}
                </Button>
              </fieldset>
            )}
            {options.isSuccess &&
              !active &&
              (!approvedOnly && options.data.can_approve && contracts.length ? (
                <fieldset disabled={!online || action.isPending}>
                  <legend>{t("openInvoiceException")}</legend>
                  <p>{t("invoiceExceptionHelp")}</p>
                  <Field
                    id={id + "-contract"}
                    label={t("invoiceExceptionContract")}
                  >
                    <select
                      value={chosen}
                      onChange={(event) =>
                        setContract(event.currentTarget.value)
                      }
                    >
                      <option value="">{t("selectParent")}</option>
                      {contracts.map((item) => (
                        <option value={item.id} key={item.id}>
                          {t(item.kind)} ·{" "}
                          {t("version", { version: item.version })} ·{" "}
                          {formatUtcDate(
                            item.effective_from.slice(0, 10),
                            i18n.language,
                          )}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    id={id + "-amount"}
                    label={t("invoiceExceptionAmount", {
                      currency: options.data.currency,
                    })}
                    hint={t("invoiceExceptionMaximum", {
                      amount: money(
                        options.data.maximum_amount,
                        options.data.currency,
                        i18n.language,
                      ),
                    })}
                  >
                    <input
                      type="text"
                      inputMode="decimal"
                      maxLength={13}
                      value={amount}
                      onChange={(event) => setAmount(event.currentTarget.value)}
                    />
                  </Field>
                  {worksheetCents !== undefined && worksheetCents > 0 && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() =>
                        setAmount((worksheetCents / 100).toFixed(2))
                      }
                    >
                      {t("invoiceExceptionUseWorksheet")}
                    </Button>
                  )}
                  <Field id={id + "-due"} label={t("invoiceExceptionDue")}>
                    <input
                      type="date"
                      value={due}
                      onChange={(event) => setDue(event.currentTarget.value)}
                    />
                  </Field>
                  <Button
                    type="button"
                    disabled={
                      !chosen ||
                      !validNote ||
                      !z.iso.date().safeParse(due).success ||
                      selectedAmount <= 0 ||
                      selectedAmount > options.data.maximum_amount
                    }
                    onClick={() =>
                      action.mutate({
                        kind: "approve",
                        contract: chosen,
                        amount: selectedAmount,
                        due,
                      })
                    }
                  >
                    {t("invoiceExceptionApprove")}
                  </Button>
                </fieldset>
              ) : (
                <Notice>
                  {t(
                    approvedOnly || contracts.length
                      ? "invoiceExceptionNotReady"
                      : "invoiceExceptionMissingContract",
                  )}
                </Notice>
              ))}
            {action.isError && (
              <Notice kind="error">
                {t(
                  conflict ? "invoiceExceptionConflict" : "invoiceReviewFailed",
                )}
              </Notice>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function FinancePendingInvoiceExceptions({ actor }: { actor: string }) {
  const { t } = useTranslation("commercial");
  const online = useOnline();
  const query = useQuery({
    ...financePendingInvoiceExceptionsQuery(actor),
    enabled: online,
  });
  if (!online || query.isPending) return null;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  if (!query.data?.length) return null;
  return (
    <section className="panel invoice-review-queue">
      <h2>{t("financePendingInvoiceExceptions")}</h2>
      {query.data.map((approval) => (
        <article key={approval.request_id} className="invoice-review-row">
          <div>
            <strong>{approval.title}</strong>
            <p>{approval.lecturer_name}</p>
          </div>
          <InvoiceExceptionDecision
            actor={actor}
            requestId={approval.request_id}
            approvedOnly
          />
        </article>
      ))}
    </section>
  );
}

export function MyInvoiceExceptions({
  actor,
  onSubmit,
}: {
  actor: string;
  onSubmit: (approval: InvoiceException) => void;
}) {
  const { t, i18n } = useTranslation("commercial");
  const online = useOnline();
  const query = useQuery({
    ...myInvoiceExceptionsQuery(actor),
    enabled: online,
  });
  if (!online || query.isPending) return null;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  if (!query.data?.length) return null;
  return (
    <section className="panel invoice-review-request-list">
      <h2>{t("approvedInvoiceExceptions")}</h2>
      {query.data.map((approval) => (
        <article className="invoice-review-row" key={approval.id}>
          <strong>{approval.title}</strong>
          <p>
            {t("invoiceExceptionContractVersion", {
              version: approval.contract_version,
            })}{" "}
            · {money(approval.amount, approval.currency, i18n.language)} ·{" "}
            {t("invoiceExceptionDue")}{" "}
            {formatUtcDate(approval.due_on, i18n.language)}
          </p>
          <Button type="button" onClick={() => onSubmit(approval)}>
            {t("submitInvoiceException")}
          </Button>
        </article>
      ))}
    </section>
  );
}
