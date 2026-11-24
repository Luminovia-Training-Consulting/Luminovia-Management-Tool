import { useId, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { requireOnline, useOnline } from "../../lib/online";
import { useRequestKey } from "../../lib/request-key";
import { db } from "../../lib/supabase";
import { accountRequest } from "../accounts/api";
import { mailDeliveryFailure } from "../developer-api/academy-mail-contract";
import "./mail-i18n";

type DeliveryFailure = z.infer<typeof mailDeliveryFailure>;
type Feedback =
  "retryQueued" | "inviteAccepted" | "inviteChecking" | "retryFailed";

function RecoveryRow({
  row,
  canWrite,
  academy,
  onResult,
}: {
  row: DeliveryFailure;
  canWrite: boolean;
  academy: boolean;
  onResult: (result: Feedback) => void;
}) {
  const { t, i18n } = useTranslation("adminMail");
  const field = useId();
  const request = useRequestKey();
  const [email, setEmail] = useState(row.recipient ?? "");
  const retry = useMutation({
    mutationFn: async () => {
      requireOnline();
      if (!canWrite || !row.retry_allowed || row.status !== "failed") {
        throw new Error("delivery_unavailable");
      }
      if (row.kind === "invitation") {
        const recipient = z.email().max(254).parse(email.trim().toLowerCase());
        const result = await accountRequest<{ status: string }>(
          `${academy ? "academy/" : ""}invitations/${row.id}/retry`,
          "POST",
          {
            email: recipient,
            idempotency_key: request.forInput(
              `invitation:${row.failed_at}:${recipient}`,
            ),
          },
        );
        if (
          result.status === "sent" ||
          result.status === "already_sent" ||
          result.status === "created"
        ) {
          return "inviteAccepted";
        }
        if (result.status === "in_progress") return "inviteChecking";
        throw new Error("delivery_unavailable");
      }
      const { data, error } = await db().rpc("retry_course_mail_delivery", {
        p_delivery_id: row.id,
        p_failed_at: row.failed_at,
        p_request_id: request.forInput(`course:${row.failed_at}`),
      });
      if (error || data !== row.id)
        throw error ?? new Error("delivery_unavailable");
      return "retryQueued";
    },
    onSuccess: onResult,
    onError: () => onResult("retryFailed"),
  });
  const date = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(row.failed_at));
  const errorKey = {
    smtp_recipient_rejected: "recipientRejected",
    smtp_sender_rejected: "senderRejected",
    smtp_ambiguous: "outcomeUncertain",
    smtp_connection: "errorConnect",
    smtp_tls: "errorTls",
  }[row.error_code ?? ""];

  return (
    <li>
      <strong>
        {t(row.kind === "course" ? "failedCourseMail" : "failedInvitation")}
      </strong>
      <p>
        {row.recipient ?? t("recipientUnavailable")} ·{" "}
        <time dateTime={row.failed_at}>{date}</time>
      </p>
      <p>
        {t(row.status === "uncertain" ? "outcomeUncertain" : "statusFailed")}
        {errorKey && errorKey !== "outcomeUncertain" ? ` · ${t(errorKey)}` : ""}
      </p>
      {row.status === "uncertain" && <p>{t("checkBeforeRetry")}</p>}
      {canWrite && row.status === "failed" && row.retry_allowed && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            retry.mutate();
          }}
        >
          {row.kind === "invitation" ? (
            <Field id={field} label={t("correctedRecipient")}>
              <input
                id={field}
                type="email"
                autoComplete="off"
                required
                maxLength={254}
                value={email}
                disabled={retry.isPending}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
          ) : (
            <p>{t("verifiedRecipientHint")}</p>
          )}
          <Button type="submit" variant="secondary" disabled={retry.isPending}>
            {t(retry.isPending ? "retrying" : "retryDelivery")}
          </Button>
        </form>
      )}
    </li>
  );
}

export function MailDeliveryRecovery({
  actor,
  readOnly,
  academy,
}: {
  actor: string;
  readOnly: boolean;
  academy: boolean;
}) {
  const { t } = useTranslation("adminMail");
  const cache = useQueryClient();
  const online = useOnline();
  const title = useId();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const queryKey = ["admin-mail-delivery", actor] as const;
  const failures = useQuery({
    queryKey,
    enabled: online,
    gcTime: 0,
    retry: false,
    refetchOnMount: "always",
    refetchInterval: 30_000,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("mail_delivery_failures", {}, { get: true })
        .abortSignal(signal);
      if (error) throw error;
      return z.array(mailDeliveryFailure).max(80).parse(data);
    },
  });
  const onResult = (result: Feedback) => {
    setFeedback(result);
    void cache.invalidateQueries({ queryKey });
  };
  return (
    <section className="panel" aria-labelledby={title}>
      <h2 id={title}>{t("deliveryFailures")}</h2>
      <p>{t("deliveryFailuresHelp")}</p>
      {online && failures.isSuccess && (
        <Button
          type="button"
          variant="secondary"
          disabled={failures.isFetching}
          onClick={() => void failures.refetch()}
        >
          {t("refreshFailures")}
        </Button>
      )}
      {feedback && (
        <Notice kind={feedback === "retryFailed" ? "error" : "success"}>
          {t(feedback)}
        </Notice>
      )}
      {!online ? (
        <p>{t("academyOnline")}</p>
      ) : failures.isPending ? (
        <Loading />
      ) : failures.isError ? (
        <ErrorState retry={() => void failures.refetch()} />
      ) : failures.data.length ? (
        <ul className="card-list">
          {failures.data.map((row) => (
            <RecoveryRow
              key={`${row.id}:${row.failed_at}`}
              row={row}
              canWrite={!readOnly}
              academy={academy}
              onResult={onResult}
            />
          ))}
        </ul>
      ) : (
        <p>{t("noDeliveryFailures")}</p>
      )}
    </section>
  );
}
