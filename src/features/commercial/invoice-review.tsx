/** Lecturer review requests and finance-only resolution notes for cancelled or incomplete accepted blocks. */
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  commercialKeys,
  invoiceReviewCandidatesQuery,
  invoiceReviewCasesQuery,
} from "./api";
import "./i18n";
import type { InvoiceReviewCandidate, InvoiceReviewCase } from "./types";

/** Translate the closed database reason enum without rendering provider/database messages. */
function reasonLabel(
  reason: InvoiceReviewCandidate["reason"] | InvoiceReviewCase["reason"],
  t: (key: string) => string,
) {
  return t(
    {
      cancelled: "invoiceReviewCancelled",
      partial_delivery: "invoiceReviewPartial",
      schedule_mismatch: "invoiceReviewSchedule",
    }[reason],
  );
}

/** Let a lecturer request an audited human review without creating or authorizing an invoice. */
export function MyInvoiceReviewRequests({
  actor,
  zone,
}: {
  actor: string;
  zone: string;
}) {
  const { t } = useTranslation("commercial");
  const cache = useQueryClient();
  const requests = useQuery(invoiceReviewCandidatesQuery(actor));
  const requestIds = useRef(new Map<string, string>());
  const [failed, setFailed] = useState(false);
  const create = useMutation({
    mutationFn: async (claimId: string) => {
      requireOnline();
      const requestId = requestIds.current.get(claimId) ?? crypto.randomUUID();
      requestIds.current.set(claimId, requestId);
      const { data, error } = await db().rpc("request_invoice_review", {
        p_claim_id: claimId,
        p_request_id: requestId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      setFailed(false);
      await cache.invalidateQueries({
        queryKey: commercialKeys.finance(actor),
      });
    },
    onError: () => setFailed(true),
  });
  const online = useOnline();

  if (requests.isPending) return <Loading />;
  if (requests.isError)
    return <ErrorState retry={() => void requests.refetch()} />;
  if (!requests.data.length) return null;
  return (
    <section className="panel invoice-review-request-list">
      <h2>{t("invoiceReviewRequired")}</h2>
      <p className="muted">{t("invoiceReviewAuditNote")}</p>
      {failed && <Notice kind="error">{t("invoiceReviewFailed")}</Notice>}
      {requests.data.map((request) => (
        <article className="invoice-review-row" key={request.claim_id}>
          <div>
            <strong>{request.title}</strong>
            <p>{reasonLabel(request.reason, t)}</p>
            {request.scheduled_end && (
              <small>
                {DateTime.fromISO(request.scheduled_end)
                  .setZone(zone)
                  .toLocaleString(DateTime.DATETIME_MED)}
              </small>
            )}
            {request.review_status === "pending" && (
              <p role="status">{t("invoiceReviewPending")}</p>
            )}
            {request.review_status === "resolved" && (
              <p role="status">
                {t("invoiceReviewResolved")}
                {request.resolution_note ? `: ${request.resolution_note}` : ""}
              </p>
            )}
          </div>
          {!request.review_status && (
            <Button
              type="button"
              variant="secondary"
              disabled={!online || create.isPending}
              onClick={() => create.mutate(request.claim_id)}
            >
              {create.isPending && create.variables === request.claim_id
                ? t("saving")
                : t("requestInvoiceReview")}
            </Button>
          )}
        </article>
      ))}
    </section>
  );
}

/** Let only finance managers record a review note; never alter accepted totals or payment state. */
export function InvoiceReviewQueue({ actor }: { actor: string }) {
  const { t, i18n } = useTranslation("commercial");
  const cache = useQueryClient();
  const queue = useQuery(invoiceReviewCasesQuery(actor));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState(false);
  const resolve = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      requireOnline();
      const { error } = await db().rpc("resolve_invoice_review_request", {
        p_request_id: id,
        p_note: note.trim(),
      });
      if (error) throw error;
      return id;
    },
    onSuccess: async (id) => {
      setNotes((current) => ({ ...current, [id]: "" }));
      setFailed(false);
      await cache.invalidateQueries({
        queryKey: commercialKeys.finance(actor),
      });
    },
    onError: () => setFailed(true),
  });
  const online = useOnline();

  if (queue.isPending) return <Loading />;
  if (queue.isError) return <ErrorState retry={() => void queue.refetch()} />;
  if (!queue.data.length) return null;
  return (
    <section className="panel invoice-review-queue">
      <h2>{t("invoiceReviewQueue")}</h2>
      <p className="muted">{t("invoiceReviewAuditNote")}</p>
      {failed && <Notice kind="error">{t("invoiceReviewFailed")}</Notice>}
      {queue.data.map((review) => {
        const note = notes[review.id] ?? "";
        return (
          <article className="invoice-review-row" key={review.id}>
            <div>
              <strong>{review.title}</strong>
              <p>
                {review.lecturer_name} · {reasonLabel(review.reason, t)}
              </p>
              <p>
                {new Intl.NumberFormat(i18n.language, {
                  style: "currency",
                  currency: review.currency,
                }).format(Number(review.accepted_total))}
              </p>
            </div>
            <Field
              id={`invoice-review-note-${review.id}`}
              label={t("invoiceReviewResolutionNote")}
            >
              <textarea
                rows={3}
                maxLength={1000}
                value={note}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setNotes((current) => ({ ...current, [review.id]: value }));
                }}
              />
            </Field>
            <Button
              type="button"
              disabled={!online || note.trim().length < 10 || resolve.isPending}
              onClick={() => resolve.mutate({ id: review.id, note })}
            >
              {resolve.isPending && resolve.variables?.id === review.id
                ? t("saving")
                : t("resolveInvoiceReview")}
            </Button>
          </article>
        );
      })}
    </section>
  );
}
