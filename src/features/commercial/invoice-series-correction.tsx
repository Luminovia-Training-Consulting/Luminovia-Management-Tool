import { useRequestKey } from "../../lib/request-key";
import { useEffect, useId, useState } from "react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { DateTime } from "luxon";
import { ErrorState, Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { money } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  commercialKeys,
  downloadCsv,
  invoiceSeriesCorrectionsQuery,
} from "./api";
import type {
  InvoiceSeriesCorrection,
  InvoiceSeriesCorrectionOptions,
} from "./invoice-series-correction-schema";
import "./i18n";

function cents(input: string) {
  const value = input.trim().replace(",", ".");
  return /^\d{1,10}(?:\.\d{1,2})?$/.test(value)
    ? Math.round(Number(value) * 100)
    : null;
}

function useCorrectionAction<T>(
  actor: string,
  run: (input: T) => Promise<unknown>,
  done?: () => void,
) {
  const query = useQueryClient();
  const refresh = () =>
    query.invalidateQueries({ queryKey: commercialKeys.finance(actor) });
  return useMutation({
    mutationFn: (input: T) => {
      requireOnline();
      return run(input);
    },
    onSuccess: async () => {
      done?.();
      await refresh();
    },
    onError: (error) => {
      if ("code" in error && error.code === "PT409") return refresh();
    },
  });
}

function CorrectionError({ error }: { error: Error | null }) {
  const { t } = useTranslation("commercial");
  if (!error) return null;
  return (
    <Notice kind="error">
      {t(
        "code" in error && error.code === "PT409"
          ? error.message === "Duplicate active repayment reference"
            ? "correctionDuplicateReceipt"
            : "correctionConflict"
          : "failed",
      )}
    </Notice>
  );
}

function CorrectionFacts({ item }: { item: InvoiceSeriesCorrection }) {
  const { t, i18n } = useTranslation("commercial");
  const format = (amount: number) =>
    money(amount, item.currency, i18n.language);
  const status = t("correctionStatus_" + item.state);
  const date = (value: string) =>
    DateTime.fromISO(value.slice(0, 10), { zone: "UTC" })
      .setLocale(i18n.language)
      .toLocaleString(DateTime.DATE_MED);
  const exportCorrection = () => {
    downloadCsv("luminovia-correction-" + item.id + ".csv", [
      [
        t("correctionEvidence"),
        t("reference"),
        t("due"),
        t("total"),
        "ISO 4217",
        t("status"),
      ],
      [
        t("correctionReviewed"),
        item.id,
        item.due_on,
        item.reviewed_total,
        item.currency,
        status,
      ],
      [
        t("correctionRepaymentAgreed"),
        item.claim_id,
        item.due_on,
        -item.balance,
        item.currency,
        status,
      ],
      [
        t("invoiceExceptionContractVersion", {
          version: item.contract_version,
        }),
        item.id,
        item.proposed_at,
        "",
        item.currency,
        item.note,
      ],
      ...(item.responded_at
        ? [
            [
              t("status"),
              item.id,
              item.responded_at,
              "",
              item.currency,
              item.dispute_note ?? status,
            ],
          ]
        : []),
      ...(item.withdrawn_at
        ? [
            [
              t("correctionWithdrawReason"),
              item.id,
              item.withdrawn_at,
              "",
              item.currency,
              item.withdrawal_note,
            ],
          ]
        : []),
      ...item.credits.map((record) => [
        t("invoiceSeriesInterim"),
        record.invoice_number + " / " + record.payment_id,
        record.paid_at,
        record.amount,
        item.currency,
        "",
      ]),
      ...item.repayments.map((record) => [
        t("correctionReceipt"),
        record.reference + " / " + record.id,
        record.received_on,
        record.amount,
        item.currency,
        record.voided_at
          ? [
              t("correctionReceiptVoided"),
              record.voided_at,
              record.void_note,
            ].join(" · ")
          : t("received"),
      ]),
    ]);
  };
  return (
    <div className="invoice-series-summary">
      <p>
        <strong>{status}</strong> ·{" "}
        {t("invoiceExceptionContractVersion", {
          version: item.contract_version,
        })}
      </p>
      <dl className="commercial-facts">
        <dt>{t("correctionReviewed")}</dt>
        <dd>{format(item.reviewed_total)}</dd>
        <dt>{t("correctionInterimPaid")}</dt>
        <dd>{format(item.credited)}</dd>
        <dt>{t("correctionBalance")}</dt>
        <dd>{format(item.balance)}</dd>
        <dt>{t("correctionOutstanding")}</dt>
        <dd>{format(item.outstanding)}</dd>
        <dt>{t("invoiceExceptionDue")}</dt>
        <dd>
          <time dateTime={item.due_on}>{date(item.due_on)}</time>
        </dd>
      </dl>
      <p>{item.note}</p>
      {item.dispute_note && (
        <p>
          {t("correctionDisputeReason")} {item.dispute_note}
        </p>
      )}
      {item.withdrawal_note && (
        <p>
          {t("correctionWithdrawReason")} {item.withdrawal_note}
        </p>
      )}
      <details>
        <summary>{t("correctionEvidence")}</summary>
        <ul>
          {item.credits.map((receipt) => (
            <li key={receipt.payment_id}>
              {receipt.invoice_number} · {format(receipt.amount)} ·{" "}
              {date(receipt.paid_at)}
            </li>
          ))}
        </ul>
        <Button type="button" variant="ghost" onClick={exportCorrection}>
          {t("correctionExport")}
        </Button>
      </details>
    </div>
  );
}

const reasonLabels = {
  dispute: "correctionDispute",
  withdraw: "correctionWithdraw",
  void: "correctionVoid",
} as const;
function CorrectionReasonAction({
  actor,
  id,
  mode,
}: {
  actor: string;
  id: string;
  mode: keyof typeof reasonLabels;
}) {
  const { t } = useTranslation("commercial");
  const online = useOnline();
  const prefix = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const save = useCorrectionAction(
    actor,
    async () => {
      const p_note = reason.trim();
      const { error } =
        mode === "dispute"
          ? await db().rpc("dispute_invoice_series_correction", {
              p_correction_id: id,
              p_note,
            })
          : mode === "withdraw"
            ? await db().rpc("withdraw_invoice_series_correction", {
                p_correction_id: id,
                p_note,
              })
            : await db().rpc("void_invoice_series_repayment", {
                p_repayment_id: id,
                p_note,
              });
      if (error) throw error;
    },
    () => {
      setOpen(false);
      setReason("");
    },
  );
  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        disabled={!online}
        onClick={() => setOpen(true)}
      >
        {t(reasonLabels[mode])}
      </Button>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Field id={prefix} label={t("correctionReason")}>
        <textarea
          rows={2}
          maxLength={1000}
          value={reason}
          onChange={(event) => setReason(event.currentTarget.value)}
        />
      </Field>
      <div className="form-actions">
        <Button
          type="submit"
          disabled={!online || save.isPending || reason.trim().length < 10}
        >
          {t(reasonLabels[mode])}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={save.isPending}
          onClick={() => {
            setOpen(false);
            setReason("");
          }}
        >
          {t("correctionCancel")}
        </Button>
      </div>
      <CorrectionError error={save.error} />
    </form>
  );
}

function CorrectionAcknowledgement({
  actor,
  id,
}: {
  actor: string;
  id: string;
}) {
  const { t } = useTranslation("commercial");
  const online = useOnline();
  const [verified, setVerified] = useState(false);
  const save = useCorrectionAction(actor, async () => {
    const { error } = await db().rpc("acknowledge_invoice_series_correction", {
      p_correction_id: id,
    });
    if (error) throw error;
  });
  return (
    <div>
      <label className="commercial-claim">
        <input
          type="checkbox"
          checked={verified}
          onChange={(event) => setVerified(event.currentTarget.checked)}
        />
        {t("correctionConfirmDetails")}
      </label>
      <div className="form-actions">
        <Button
          disabled={!online || !verified || save.isPending}
          onClick={() => save.mutate()}
        >
          {t("correctionAcknowledge")}
        </Button>
        <CorrectionReasonAction actor={actor} id={id} mode="dispute" />
      </div>
      <CorrectionError error={save.error} />
    </div>
  );
}

function CorrectionRepaymentForm({
  actor,
  item,
}: {
  actor: string;
  item: InvoiceSeriesCorrection;
}) {
  const { t } = useTranslation("commercial");
  const online = useOnline();
  const prefix = useId();
  const [amount, setAmount] = useState("");
  const [received, setReceived] = useState("");
  const [reference, setReference] = useState("");
  const retry = useRequestKey();
  const entered = cents(amount) ?? 0;
  const save = useCorrectionAction(
    actor,
    async () => {
      const payload = {
        p_correction_id: item.id,
        p_amount: entered / 100,
        p_received_on: received,
        p_reference: reference.trim(),
      };
      const signature = JSON.stringify(payload);
      const retryId = retry.forInput(signature);
      const { data, error } = await db().rpc(
        "record_invoice_series_repayment",
        { ...payload, p_client_id: retryId },
      );
      if (error) throw error;
      z.uuid().parse(data);
    },
    () => {
      setAmount("");
      setReceived("");
      setReference("");
      retry.clear();
    },
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <fieldset disabled={!online || save.isPending}>
        <legend>{t("correctionRecordReceipt")}</legend>
        <p>{t("correctionActualReceiptHelp")}</p>
        <Field
          id={prefix + "-amount"}
          label={t("invoiceExceptionAmount", { currency: item.currency })}
        >
          <input
            value={amount}
            maxLength={13}
            inputMode="decimal"
            onChange={(event) => setAmount(event.currentTarget.value)}
          />
        </Field>
        <Field id={prefix + "-received"} label={t("correctionReceivedOn")}>
          <input
            type="date"
            value={received}
            onChange={(event) => setReceived(event.currentTarget.value)}
          />
        </Field>
        <Field
          id={prefix + "-reference"}
          label={t("correctionReceiptReference")}
        >
          <input
            value={reference}
            maxLength={200}
            onChange={(event) => setReference(event.currentTarget.value)}
          />
        </Field>
        <Button
          disabled={
            entered <= 0 ||
            entered > Math.round(item.outstanding * 100) ||
            !z.iso.date().safeParse(received).success ||
            reference.trim().length < 3
          }
        >
          {t("correctionRecordReceipt")}
        </Button>
      </fieldset>
      <CorrectionError error={save.error} />
    </form>
  );
}

function CorrectionProposal({
  actor,
  options,
}: {
  actor: string;
  options: InvoiceSeriesCorrectionOptions;
}) {
  const { t, i18n } = useTranslation("commercial");
  const online = useOnline();
  const prefix = useId();
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState("");
  const [estimate, setEstimate] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const retry = useRequestKey();
  const amount = cents(estimate);
  const contract =
    options.contracts.find(({ id }) => id === chosen) ??
    (options.contracts.length === 1 ? options.contracts[0] : undefined);
  const validAmount =
    amount !== null &&
    amount < Math.round(options.credited * 100) &&
    amount <= Math.round(options.ceiling * 100);
  const save = useCorrectionAction(actor, async () => {
    if (!validAmount || !contract) return;
    const payload = {
      p_claim_id: options.claim_id,
      p_contract_id: contract.id,
      p_reviewed_total: amount / 100,
      p_due_on: due,
      p_note: note.trim(),
    };
    const signature = JSON.stringify(payload);
    const retryId = retry.forInput(signature);
    const { data, error } = await db().rpc(
      "propose_invoice_series_correction",
      { ...payload, p_client_id: retryId },
    );
    if (error) throw error;
    z.uuid().parse(data);
  });
  return (
    <details onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t("correctionPropose")}</summary>
      {open && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <fieldset disabled={!online || save.isPending}>
            <legend>{t("correctionPropose")}</legend>
            <p>{t("correctionProposalHelp")}</p>
            <Field
              id={prefix + "-contract"}
              label={t("invoiceExceptionContract")}
            >
              <select
                value={contract?.id ?? ""}
                onChange={(event) => setChosen(event.currentTarget.value)}
              >
                <option value="">{t("selectParent")}</option>
                {options.contracts.map((version) => (
                  <option key={version.id} value={version.id}>
                    {t(version.kind)} ·{" "}
                    {t("version", { version: version.version })} ·{" "}
                    {version.effective_from.slice(0, 10)}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id={prefix + "-amount"}
              label={t("invoiceSeriesGrossField", {
                currency: options.currency,
              })}
            >
              <input
                value={estimate}
                inputMode="decimal"
                maxLength={13}
                onChange={(event) => setEstimate(event.currentTarget.value)}
              />
            </Field>
            {validAmount && (
              <p>
                {t("correctionBalance")}:{" "}
                {money(
                  (amount - Math.round(options.credited * 100)) / 100,
                  options.currency,
                  i18n.language,
                )}
              </p>
            )}
            <Field id={prefix + "-due"} label={t("invoiceExceptionDue")}>
              <input
                type="date"
                value={due}
                onChange={(event) => setDue(event.currentTarget.value)}
              />
            </Field>
            <Field
              id={prefix + "-note"}
              label={t("invoiceReviewResolutionNote")}
            >
              <textarea
                rows={3}
                maxLength={1000}
                value={note}
                onChange={(event) => setNote(event.currentTarget.value)}
              />
            </Field>
            <Button
              disabled={
                !validAmount ||
                !contract ||
                !z.iso.date().safeParse(due).success ||
                note.trim().length < 10
              }
            >
              {t("correctionSend")}
            </Button>
          </fieldset>
          <CorrectionError error={save.error} />
        </form>
      )}
    </details>
  );
}

function RepaymentHistory({
  actor,
  item,
  canManage,
}: {
  actor: string;
  item: InvoiceSeriesCorrection;
  canManage: boolean;
}) {
  const { t, i18n } = useTranslation("commercial");
  if (!item.repayments.length) return null;
  return (
    <details>
      <summary>{t("correctionRepaymentHistory")}</summary>
      <ul>
        {item.repayments.map((receipt) => (
          <li key={receipt.id}>
            <p>
              {receipt.received_on} ·{" "}
              {money(receipt.amount, item.currency, i18n.language)} ·{" "}
              {receipt.reference}
            </p>
            {receipt.voided_at ? (
              <p>
                {t("correctionReceiptVoided")} · {receipt.void_note}
              </p>
            ) : (
              canManage && (
                <CorrectionReasonAction
                  actor={actor}
                  id={receipt.id}
                  mode="void"
                />
              )
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function ManageInvoiceSeriesCorrections({
  actor,
  claimId,
  canManage,
}: {
  actor: string;
  claimId: string;
  canManage: boolean;
}) {
  const { t } = useTranslation("commercial");
  const online = useOnline();
  const result = useQuery({
    ...invoiceSeriesCorrectionsQuery(actor, claimId, true),
    enabled: online,
  });
  if (result.isError) return <ErrorState retry={() => void result.refetch()} />;
  const data = result.data;
  if (!data || (!data.options?.can_propose && !data.entries.length))
    return null;
  return (
    <section className="invoice-exception">
      <h3>{t("correctionHeading")}</h3>
      {canManage && data.options?.can_propose && (
        <CorrectionProposal actor={actor} options={data.options} />
      )}
      {data.entries.map((item) => (
        <fieldset key={item.id}>
          <legend>
            {t("invoiceExceptionContractVersion", {
              version: item.contract_version,
            })}
          </legend>
          <CorrectionFacts item={item} />
          <RepaymentHistory actor={actor} item={item} canManage={canManage} />
          {canManage && item.state === "acknowledged" && (
            <CorrectionRepaymentForm actor={actor} item={item} />
          )}
          {canManage && item.state !== "withdrawn" && item.repaid === 0 && (
            <CorrectionReasonAction
              actor={actor}
              id={item.id}
              mode="withdraw"
            />
          )}
        </fieldset>
      ))}
    </section>
  );
}

export function MyInvoiceSeriesCorrections({ actor }: { actor: string }) {
  const { t } = useTranslation("commercial");
  const online = useOnline();
  const { hash } = useLocation();
  const result = useQuery({
    ...invoiceSeriesCorrectionsQuery(actor, null, false),
    enabled: online,
  });
  const target = result.data?.entries.find(
    (item) => hash === "#correction-" + item.id,
  )?.id;
  useEffect(() => {
    if (!target) return;
    const article = document.getElementById("correction-" + target);
    article?.focus({ preventScroll: true });
    article?.scrollIntoView?.({ block: "nearest" });
  }, [target]);
  if (result.isError) return <ErrorState retry={() => void result.refetch()} />;
  if (!result.data?.entries.length) return null;
  return (
    <section className="panel invoice-review-request-list">
      <h2>{t("correctionHeading")}</h2>
      {result.data.entries.map((item) => (
        <article
          key={item.id}
          id={"correction-" + item.id}
          tabIndex={-1}
          className="invoice-review-row"
        >
          <div>
            <strong>{item.title}</strong>
            <CorrectionFacts item={item} />
            <RepaymentHistory actor={actor} item={item} canManage={false} />
          </div>
          {item.state === "proposed" && (
            <CorrectionAcknowledgement actor={actor} id={item.id} />
          )}
        </article>
      ))}
    </section>
  );
}
