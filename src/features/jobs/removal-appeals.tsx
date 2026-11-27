import { useId, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { z } from "zod";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { notificationKeys } from "../notifications/api";
import "./removal-appeals-i18n";

const records = z
  .array(
    z.object({
      claim_id: z.uuid(),
      job_id: z.uuid(),
      title: z.string(),
      display_name: z.string(),
      removal_reason: z.string().nullable(),
      reason: z.string(),
      created_at: z.iso.datetime({ offset: true }),
      decision: z.boolean().nullable(),
      decision_reason: z.string().nullable(),
    }),
  )
  .max(30);

type Appeal = z.infer<typeof records>[number];

export function SubmitRemovalAppeal({
  actor,
  claim,
}: {
  actor: string;
  claim: string;
}) {
  const { t } = useTranslation("removalAppeals");
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const id = useId();
  const client = useQueryClient();
  const online = useOnline();
  const submit = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { error } = await db().rpc("submit_assignment_removal_appeal", {
        p_claim_id: claim,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: notificationKeys.all(actor) }),
  });
  if (submit.isSuccess) return <Notice>{t("pending")}</Notice>;
  if (!editing)
    return (
      <Button size="sm" disabled={!online} onClick={() => setEditing(true)}>
        {t("open")}
      </Button>
    );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (reason.trim().length >= 5) submit.mutate();
      }}
    >
      <Field id={id} label={t("appealReason")}>
        <textarea
          id={id}
          minLength={5}
          maxLength={1000}
          required
          disabled={submit.isPending}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {submit.isError && <Notice kind="error">{t("failed")}</Notice>}
      <Button
        type="submit"
        size="sm"
        disabled={!online || submit.isPending || reason.trim().length < 5}
      >
        {t("send")}
      </Button>
    </form>
  );
}

export function RemovalAppealsPanel({ actor }: { actor: string }) {
  const { t } = useTranslation("removalAppeals");
  const [pending, setPending] = useState(true);
  const client = useQueryClient();
  const key = ["assignment-removal-appeals", actor] as const;
  const query = useInfiniteQuery({
    queryKey: [...key, pending],
    initialPageParam: null as Appeal | null,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await db()
        .rpc("assignment_removal_appeals", {
          p_pending: pending,
          p_before_at: pageParam?.created_at ?? null,
          p_before_id: pageParam?.claim_id ?? null,
        })
        .abortSignal(signal);
      if (error) throw error;
      return records.parse(data);
    },
    getNextPageParam: (page) => (page.length === 30 ? page.at(-1) : undefined),
  });
  const rows = query.data?.pages.flat() ?? [];
  return (
    <section className="panel">
      <h2>{t("heading")}</h2>
      <div className="form-actions">
        <Button
          type="button"
          variant="secondary"
          aria-pressed={pending}
          onClick={() => setPending(true)}
        >
          {t("pendingFilter")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          aria-pressed={!pending}
          onClick={() => setPending(false)}
        >
          {t("decidedFilter")}
        </Button>
      </div>
      {query.isPending && <Loading />}
      {query.isError && <ErrorState retry={() => void query.refetch()} />}
      {query.isSuccess && !rows.length && <p>{t("empty")}</p>}
      {rows.length > 0 && (
        <ul className="section-stack">
          {rows.map((item) => (
            <li key={item.claim_id}>
              <h3>
                <Link to={`/jobs/${item.job_id}`}>{item.title}</Link>
              </h3>
              <p>{item.display_name}</p>
              {item.removal_reason && (
                <p>
                  <strong>{t("removalReason")}</strong> {item.removal_reason}
                </p>
              )}
              <p>
                <strong>{t("appealReason")}</strong> {item.reason}
              </p>
              {item.decision === null ? (
                <AppealDecision
                  claim={item.claim_id}
                  refresh={() => client.invalidateQueries({ queryKey: key })}
                />
              ) : (
                <p>
                  <strong>{t(item.decision ? "approved" : "rejected")}</strong>{" "}
                  {item.decision_reason}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <Button
          type="button"
          variant="secondary"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {t("more")}
        </Button>
      )}
    </section>
  );
}

function AppealDecision({
  claim,
  refresh,
}: {
  claim: string;
  refresh: () => Promise<void>;
}) {
  const { t } = useTranslation("removalAppeals");
  const [reason, setReason] = useState("");
  const id = useId();
  const online = useOnline();
  const review = useMutation({
    mutationFn: async (approve: boolean) => {
      requireOnline();
      const { error } = await db().rpc("review_assignment_removal_appeal", {
        p_claim_id: claim,
        p_approve: approve,
        p_reason: reason.trim(),
      });
      if (error) throw error;
    },
    onSuccess: refresh,
  });
  const disabled = !online || review.isPending || reason.trim().length < 5;
  return (
    <div className="section-stack">
      <Field id={id} label={t("decisionReason")}>
        <textarea
          id={id}
          maxLength={1000}
          value={reason}
          disabled={review.isPending}
          onChange={(event) => setReason(event.target.value)}
        />
      </Field>
      {review.isError && <Notice kind="error">{t("failed")}</Notice>}
      <div className="form-actions">
        <Button
          type="button"
          disabled={disabled}
          onClick={() => {
            if (window.confirm(t("confirmApproval"))) review.mutate(true);
          }}
        >
          {t("approve")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={() => {
            if (window.confirm(t("confirmRejection"))) review.mutate(false);
          }}
        >
          {t("reject")}
        </Button>
      </div>
    </div>
  );
}
