import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { z } from "zod";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { money } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { commercialKeys, invoiceSeriesOptionsQuery } from "./api";
import type { InvoiceSeriesRecord } from "./invoice-series-schema";
import { ManageInvoiceSeriesCorrections } from "./invoice-series-correction";
import "./i18n";

function amountInCents(input: string) {
  const normalized = input.trim().replace(",", ".");
  return /^\d{1,10}(?:\.\d{1,2})?$/.test(normalized)
    ? Math.round(Number(normalized) * 100)
    : 0;
}

function seriesDate(day: string, language: string) {
  return DateTime.fromISO(day, { zone: "UTC" })
    .setLocale(language)
    .toLocaleString(DateTime.DATE_MED);
}

export function InvoiceSeriesSummary({
  entry,
}: {
  entry: InvoiceSeriesRecord;
}) {
  const { t, i18n } = useTranslation("commercial");
  const format = (amount: number) =>
    money(amount, entry.currency, i18n.language);
  return (
    <div className="invoice-series-summary">
      <p>
        <strong>
          {t(
            entry.kind === "interim"
              ? "invoiceSeriesInterim"
              : "invoiceSeriesFinal",
          )}
        </strong>
        {" · "}
        {t("invoiceExceptionContractVersion", {
          version: entry.contract_version,
        })}
        {" · "}
        {t("invoiceSeriesDue", {
          date: seriesDate(entry.due_on, i18n.language),
        })}
      </p>
      <p>
        {entry.kind === "final" && entry.amount === 0 && entry.state === "paid"
          ? t("invoiceSeriesFullyCredited")
          : t("invoiceSeriesPayable", { amount: format(entry.amount) })}
      </p>
      {entry.kind === "final" && (
        <details>
          <summary>
            {t("invoiceSeriesReconciled", {
              amount: format(entry.credit_amount),
            })}
          </summary>
          <p>
            {t("invoiceSeriesGross", { amount: format(entry.gross_amount) })}
          </p>
          <ul>
            {entry.credits.map((credit) => (
              <li key={credit.payment_id}>
                {credit.invoice_number} · {format(credit.amount)} ·{" "}
                {seriesDate(credit.paid_at, i18n.language)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function MyInvoiceSeries({
  entries,
  onSubmit,
}: {
  entries: InvoiceSeriesRecord[];
  onSubmit: (entry: InvoiceSeriesRecord) => void;
}) {
  const { t } = useTranslation("commercial");
  const online = useOnline();
  const waiting = entries.filter(
    ({ state }) => state === "ready" || state === "stale",
  );
  if (!waiting.length) return null;
  return (
    <section className="panel invoice-review-request-list">
      <h2>{t("invoiceSeriesWaiting")}</h2>
      {waiting.map((entry) => (
        <article key={entry.id} className="invoice-review-row">
          <div>
            <strong>{entry.title}</strong>
            <InvoiceSeriesSummary entry={entry} />
            <p>{entry.note}</p>
          </div>
          {entry.state === "ready" ? (
            <Button disabled={!online} onClick={() => onSubmit(entry)}>
              {t(
                entry.kind === "interim"
                  ? "invoiceSeriesSubmitInterim"
                  : "invoiceSeriesSubmitFinal",
              )}
            </Button>
          ) : (
            <Notice>{t("invoiceSeriesStale")}</Notice>
          )}
        </article>
      ))}
    </section>
  );
}

export function ManageInvoiceSeries({
  actor,
  claimId,
  title,
  canManageCorrections,
  close,
}: {
  actor: string;
  claimId: string;
  title: string;
  canManageCorrections: boolean;
  close: () => void;
}) {
  const { t, i18n } = useTranslation("commercial");
  const online = useOnline();
  const client = useQueryClient();
  const prefix = useId();
  const [contract, setContract] = useState("");
  const [amount, setAmount] = useState("");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [revokeId, setRevokeId] = useState("");
  const [revocationNote, setRevocationNote] = useState("");
  const retry = useRef<{ signature: string; id: string } | null>(null);
  const options = useQuery({
    ...invoiceSeriesOptionsQuery(actor, claimId),
    enabled: online,
  });
  const rules = options.data;
  const kind = rules?.can_interim ? "interim" : "final";
  const selectedContract = rules?.contracts.some(
    (version) => version.id === contract,
  )
    ? contract
    : rules?.contracts.length === 1
      ? rules.contracts[0].id
      : "";
  const amountCents = amountInCents(amount);
  const creditCents = Math.round((rules?.credited ?? 0) * 100);
  const ceilingCents = Math.round((rules?.ceiling ?? 0) * 100);
  const maximumCents =
    kind === "interim" ? ceilingCents - creditCents : ceilingCents;
  const available =
    (rules?.can_interim || rules?.can_final) && rules.contracts.length > 0;
  const amountInvalid =
    amountCents <= 0 ||
    amountCents > maximumCents ||
    (kind === "final" && amountCents < creditCents);
  const refresh = () =>
    client.invalidateQueries({ queryKey: commercialKeys.finance(actor) });
  const action = useMutation({
    mutationFn: async (mode: "approve" | "revoke") => {
      requireOnline();
      if (mode === "revoke") {
        const { error } = await db().rpc("revoke_invoice_series_entry", {
          p_approval_id: revokeId,
          p_note: revocationNote.trim(),
        });
        if (error) throw error;
        return;
      }
      const payload = {
        p_claim_id: claimId,
        p_contract_id: selectedContract,
        p_kind: kind,
        p_amount: amountCents / 100,
        p_due_on: due,
        p_note: note.trim(),
      };
      const signature = JSON.stringify(payload);
      if (retry.current?.signature !== signature)
        retry.current = { signature, id: crypto.randomUUID() };
      const { data, error } = await db().rpc("approve_invoice_series_entry", {
        ...payload,
        p_client_id: retry.current.id,
      });
      if (error) throw error;
      z.uuid().parse(data);
    },
    onSuccess: async (_result, mode) => {
      if (mode === "approve") {
        setAmount("");
        setDue("");
        setNote("");
        retry.current = null;
      } else {
        setRevokeId("");
        setRevocationNote("");
      }
      await refresh();
    },
    onError: refresh,
  });
  const conflict =
    action.error && "code" in action.error && action.error.code === "PT409";
  const format = (value: number) =>
    money(value, rules?.currency ?? "EUR", i18n.language);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title={t("invoiceSeriesManage")}
      description={title}
    >
      {!online && <Notice>{t("failed")}</Notice>}
      {online && options.isPending && <Loading />}
      {options.isError && <ErrorState retry={() => void options.refetch()} />}
      <ManageInvoiceSeriesCorrections
        actor={actor}
        claimId={claimId}
        canManage={canManageCorrections}
      />
      {rules && (
        <div className="invoice-exception">
          <p>
            {t("invoiceSeriesReceived", { amount: format(rules.credited) })}
          </p>
          {rules.approvals.map((entry) => (
            <fieldset key={entry.id}>
              <legend>
                {entry.invoice_number ??
                  t(
                    entry.state === "ready"
                      ? "invoiceExceptionReady"
                      : entry.state === "stale"
                        ? "invoiceSeriesNeedsReview"
                        : "invoiceSeriesRevoked",
                  )}
              </legend>
              <InvoiceSeriesSummary entry={entry} />
              <p>{entry.note}</p>
              {(entry.state === "ready" || entry.state === "stale") &&
                (revokeId === entry.id ? (
                  <>
                    <Field
                      id={prefix + "-revoke"}
                      label={t("invoiceExceptionRevokeNote")}
                    >
                      <textarea
                        rows={2}
                        maxLength={1000}
                        value={revocationNote}
                        onChange={(event) =>
                          setRevocationNote(event.currentTarget.value)
                        }
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={
                        !online ||
                        action.isPending ||
                        revocationNote.trim().length < 10
                      }
                      onClick={() => action.mutate("revoke")}
                    >
                      {t("invoiceExceptionRevoke")}
                    </Button>
                  </>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!online || action.isPending}
                    onClick={() => {
                      setRevocationNote("");
                      setRevokeId(entry.id);
                    }}
                  >
                    {t("invoiceExceptionRevoke")}
                  </Button>
                ))}
            </fieldset>
          ))}
          {available ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                action.mutate("approve");
              }}
            >
              <fieldset disabled={!online || action.isPending}>
                <legend>
                  {t(
                    kind === "interim"
                      ? "invoiceSeriesInterim"
                      : "invoiceSeriesFinal",
                  )}
                </legend>
                <p>
                  {t(
                    kind === "interim"
                      ? "invoiceSeriesInterimHelp"
                      : "invoiceSeriesFinalHelp",
                  )}
                </p>
                <Field
                  id={prefix + "-contract"}
                  label={t("invoiceExceptionContract")}
                >
                  <select
                    value={selectedContract}
                    onChange={(event) => setContract(event.currentTarget.value)}
                    required
                  >
                    <option value="">{t("selectParent")}</option>
                    {rules.contracts.map((version) => (
                      <option key={version.id} value={version.id}>
                        {t(version.kind)} ·{" "}
                        {t("version", { version: version.version })} ·{" "}
                        {seriesDate(
                          version.effective_from.slice(0, 10),
                          i18n.language,
                        )}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  id={prefix + "-amount"}
                  label={t(
                    kind === "interim"
                      ? "invoiceExceptionAmount"
                      : "invoiceSeriesGrossField",
                    { currency: rules.currency },
                  )}
                  hint={t("invoiceExceptionMaximum", {
                    amount: format(maximumCents / 100),
                  })}
                >
                  <input
                    type="text"
                    inputMode="decimal"
                    maxLength={13}
                    value={amount}
                    onChange={(event) => setAmount(event.currentTarget.value)}
                    required
                  />
                </Field>
                {kind === "final" && !amountInvalid && (
                  <p>
                    {t("invoiceSeriesPayable", {
                      amount: format((amountCents - creditCents) / 100),
                    })}
                  </p>
                )}
                <Field id={prefix + "-due"} label={t("invoiceExceptionDue")}>
                  <input
                    type="date"
                    value={due}
                    onChange={(event) => setDue(event.currentTarget.value)}
                    required
                  />
                </Field>
                <Field
                  id={prefix + "-note"}
                  label={t("invoiceReviewResolutionNote")}
                >
                  <textarea
                    value={note}
                    rows={3}
                    maxLength={1000}
                    onChange={(event) => setNote(event.currentTarget.value)}
                    required
                  />
                </Field>
                <Button
                  type="submit"
                  disabled={
                    !selectedContract ||
                    amountInvalid ||
                    !z.iso.date().safeParse(due).success ||
                    note.trim().length < 10
                  }
                >
                  {t("invoiceSeriesApprove")}
                </Button>
              </fieldset>
            </form>
          ) : (
            <p className="muted">
              {t(
                rules.contracts.length
                  ? "invoiceSeriesUnavailable"
                  : "invoiceExceptionMissingContract",
              )}
            </p>
          )}
          {action.isError && (
            <Notice kind="error">
              {t(conflict ? "invoiceSeriesStale" : "invoiceReviewFailed")}
            </Notice>
          )}
        </div>
      )}
    </Dialog>
  );
}
