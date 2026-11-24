import { isDatabasePermissionDenied } from "../../lib/database-errors";
import { useRequestKey } from "../../lib/request-key";
import { useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { requireOnline, useOnline } from "../../lib/online";
import {
  saveDownload,
  uploadDocument,
  type PortalDocument,
} from "../files/api";
import {
  accountingKeys,
  accountingWrite,
  customerCreditNotesQuery,
  type AccountingInvoice,
} from "./api";
import {
  customerCreditNoteInputSchema,
  type CustomerCreditNote,
} from "./schema";

const emptyForm = { reference: "", issued: "", amount: "", reason: "" };
export function CustomerCreditNotes({
  actor,
  invoice,
  onDenied,
}: {
  actor: string;
  invoice: AccountingInvoice;
  onDenied: () => void;
}) {
  const { t } = useTranslation("accounting");
  const online = useOnline();
  const client = useQueryClient();
  const notes = useInfiniteQuery(customerCreditNotesQuery(actor, invoice.id));
  const [form, setForm] = useState(emptyForm);
  const [document, setDocument] = useState<PortalDocument | null>(null);
  const [reviewed, setReviewed] = useState<string | null>(null);
  const uploadRequest = useRef<{ file: File; id: string } | null>(null);
  const saveRequest = useRequestKey();
  const proposal = customerCreditNoteInputSchema.safeParse({
    reference: form.reference,
    issued_on: form.issued,
    currency: invoice.currency,
    amount: form.amount.trim().replace(",", "."),
    reason: form.reason,
    issued_and_reviewed: true,
    document_version_id: document?.current_version_id,
  });
  const review =
    proposal.success && document?.status === "clean"
      ? JSON.stringify(proposal.data)
      : null;
  const confirmed = review !== null && reviewed === review;

  function rejectIfDenied(error: unknown) {
    if (isDatabasePermissionDenied(error)) {
      onDenied();
    }
  }

  const upload = useMutation({
    mutationFn: async (file: File) => {
      requireOnline();
      setDocument(null);
      setReviewed(null);
      if (
        file.type !== "application/pdf" &&
        !file.name.toLowerCase().endsWith(".pdf")
      ) {
        throw new Error("invalid_pdf");
      }
      if (uploadRequest.current?.file !== file) {
        uploadRequest.current = { file, id: crypto.randomUUID() };
      }
      return uploadDocument(file, {
        scope: "personal",
        kind: "material",
        ownerId: actor,
        clientId: uploadRequest.current.id,
      });
    },
    onSuccess: setDocument,
    onError: rejectIfDenied,
  });
  const save = useMutation({
    mutationFn: () => {
      if (!review || !confirmed || !proposal.success)
        throw new Error("invalid_credit_note");
      return accountingWrite("register_customer_credit_note", {
        p_invoice_id: invoice.id,
        p_payload: proposal.data,
        p_request_id: saveRequest.forInput(review),
      });
    },
    onSuccess: async () => {
      setForm(emptyForm);
      setDocument(null);
      setReviewed(null);
      saveRequest.clear();
      uploadRequest.current = null;
      await client.invalidateQueries({
        queryKey: accountingKeys.customerCreditNotes(actor, invoice.id),
      });
    },
    onError: rejectIfDenied,
  });
  const download = useMutation({
    mutationFn: (note: CustomerCreditNote) => {
      requireOnline();
      return saveDownload(
        note.document_id,
        note.reference + ".pdf",
        note.document_version_id,
      );
    },
    onError: rejectIfDenied,
  });
  const setField = (key: keyof typeof emptyForm, value: string) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setReviewed(null);
  };
  const busy = !online || upload.isPending || save.isPending;
  const available =
    notes.isSuccess && (notes.isFetchedAfterMount || !notes.isFetching);
  const rows = available ? notes.data.pages.flatMap((page) => page.items) : [];
  if (isDatabasePermissionDenied(notes.error)) {
    return <Notice kind="error">{t("creditHistoryUnavailable")}</Notice>;
  }

  return (
    <div className="accounting-form">
      <p>
        {t("creditInvoice", {
          number: invoice.number,
          amount: invoice.recorded_total,
          currency: invoice.currency,
        })}
      </p>
      <p className="accounting-hint">{t("creditEvidenceOnly")}</p>
      {notes.isPending && <Loading />}
      {notes.isError && (
        <Notice kind="error">
          {t("creditHistoryUnavailable")}{" "}
          <Button
            type="button"
            variant="secondary"
            disabled={!online}
            onClick={() => void notes.refetch()}
          >
            {t("creditRetry")}
          </Button>
        </Notice>
      )}
      {available &&
        (rows.length ? (
          <ul className="accounting-credit-notes">
            {rows.map((note) => (
              <li key={note.id}>
                <strong>{note.reference}</strong>
                {" · "}
                {note.amount} {note.currency}
                {" · "}
                {note.issued_on}
                <p>{note.reason}</p>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!online || download.isPending}
                  onClick={() => download.mutate(note)}
                >
                  {t("creditDownload", { reference: note.reference })}
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("creditEmpty")}</p>
        ))}
      {notes.hasNextPage && (
        <Button
          type="button"
          variant="secondary"
          disabled={!online || notes.isFetchingNextPage}
          onClick={() => void notes.fetchNextPage()}
        >
          {t("creditMore")}
        </Button>
      )}
      {download.isError && <Notice kind="error">{t("error")}</Notice>}
      <form
        className="accounting-form"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Field id="credit-note-reference" label={t("creditReference")}>
          <input
            id="credit-note-reference"
            required
            maxLength={80}
            value={form.reference}
            disabled={busy}
            onChange={(event) => setField("reference", event.target.value)}
          />
        </Field>
        <div className="form-row">
          <Field id="credit-note-issued" label={t("creditIssued")}>
            <input
              id="credit-note-issued"
              type="date"
              min={invoice.issued_on}
              max={DateTime.local().toISODate() ?? undefined}
              required
              value={form.issued}
              disabled={busy}
              onChange={(event) => setField("issued", event.target.value)}
            />
          </Field>
          <Field
            id="credit-note-amount"
            label={t("creditAmount", { currency: invoice.currency })}
            hint={t("amount")}
          >
            <input
              id="credit-note-amount"
              inputMode="decimal"
              maxLength={13}
              required
              value={form.amount}
              disabled={busy}
              onChange={(event) => setField("amount", event.target.value)}
            />
          </Field>
        </div>
        <Field id="credit-note-reason" label={t("creditReason")}>
          <textarea
            id="credit-note-reason"
            minLength={5}
            maxLength={1000}
            required
            rows={3}
            value={form.reason}
            disabled={busy}
            onChange={(event) => setField("reason", event.target.value)}
          />
        </Field>
        <Field id="credit-note-pdf" label={t("creditPdf")}>
          <input
            id="credit-note-pdf"
            type="file"
            accept="application/pdf,.pdf"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) upload.mutate(file);
            }}
          />
        </Field>
        {upload.isPending && <Loading />}
        {document && <p>{document.original_name}</p>}
        <label className="accounting-pick accounting-review">
          <input
            type="checkbox"
            required
            checked={confirmed}
            disabled={busy || !review}
            onChange={(event) =>
              setReviewed(event.target.checked ? review : null)
            }
          />
          <span>{t("creditConfirm")}</span>
        </label>
        {(save.isError || upload.isError) && (
          <Notice kind="error">{t("creditSaveError")}</Notice>
        )}
        {save.isSuccess && <Notice>{t("creditSaved")}</Notice>}
        <Button type="submit" disabled={busy || !confirmed}>
          {t("creditSave")}
        </Button>
      </form>
    </div>
  );
}
