/** Scoped finance approval and lecturer access to reviewed final invoices. */
import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { money } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  commercialKeys,
  invoiceExceptionOptionsQuery,
  myInvoiceExceptionsQuery,
} from "./api";
import type { InvoiceException } from "./invoice-exception-schema";
import "./i18n";

function displayDate(date: string, language: string) {
  return DateTime.fromISO(date, { zone: "UTC" })
    .setLocale(language)
    .toLocaleString(DateTime.DATE_MED);
}

function reviewedAmount(value: string) {
  const normalized = value.trim().replace(",", ".");
  return /^\d{1,10}(?:\.\d{1,2})?$/.test(normalized) ? Number(normalized) : 0;
}

export function InvoiceExceptionDecision({
  actor,
  requestId,
  sharedNote,
  validNote,
  worksheetCents,
}: {
  actor: string;
  requestId: string;
  sharedNote: string;
  validNote: boolean;
  worksheetCents?: number;
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
  const selectedAmount = reviewedAmount(amount);
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
        {t(active ? "invoiceExceptionReady" : "openInvoiceException")}
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
                  {displayDate(active.due_on, i18n.language)}
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
              (options.data.can_approve && contracts.length ? (
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
                          {displayDate(
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
                    contracts.length
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
            {displayDate(approval.due_on, i18n.language)}
          </p>
          <Button type="button" onClick={() => onSubmit(approval)}>
            {t("submitInvoiceException")}
          </Button>
        </article>
      ))}
    </section>
  );
}
