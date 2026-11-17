/** Shows a versioned schedule/location proposal beside an assignment and preserves server ownership of every workflow transition. */
import { useRef, useState, type FormEvent } from "react";
import { DateTime } from "luxon";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import type { Job } from "../../lib/types";
import { zonedInstant, dateTime } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import {
  assignmentChangesQuery,
  applyAssignmentChange,
  proposeAssignmentChange,
  refreshAssignmentChanges,
  respondAssignmentChange,
  withdrawAssignmentChange,
} from "./assignment-change-api";
import { lifecycleQuery } from "./lifecycle-api";
import "./assignment-change-i18n";

/** Format an ISO instant for the browser's timezone-aware datetime-local input. */
function localInput(instant: string, zone: string) {
  return DateTime.fromISO(instant).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm");
}

/** Render the original/proposed comparison and capability-specific actions for the current actor. */
export function AssignmentChangePanel({ job }: { job: Job }) {
  const actor = useAuth().session!.user.id;
  const { t, i18n } = useTranslation("assignmentChange");
  const client = useQueryClient();
  const online = useOnline();
  const lifecycle = useQuery(lifecycleQuery(actor, job.id));
  const changes = useQuery(assignmentChangesQuery(actor, job.id));
  const [reason, setReason] = useState("");
  const [location, setLocation] = useState(job.location ?? "");
  const [starts, setStarts] = useState(
    job.job_sessions.map((s) => localInput(s.starts_at, job.time_zone)),
  );
  const [invalidTime, setInvalidTime] = useState(false);
  const requestKey = useRef<{ signature: string; id: string } | null>(null);
  const proposal = useMutation({
    mutationFn: async (input: {
      reason: string;
      location: string;
      sessions: { starts_at: string; ends_at: string }[];
    }) => {
      const signature = JSON.stringify(input);
      if (requestKey.current?.signature !== signature)
        requestKey.current = { signature, id: crypto.randomUUID() };
      return proposeAssignmentChange({
        job: job.id,
        ...input,
        requestId: requestKey.current.id,
      });
    },
    onSuccess: async () => {
      await refreshAssignmentChanges(client, actor, job.id);
      requestKey.current = null;
      setReason("");
    },
  });
  const decision = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean }) =>
      respondAssignmentChange(id, accept),
    onSuccess: () => refreshAssignmentChanges(client, actor, job.id),
  });
  const apply = useMutation({
    mutationFn: (id: string) => applyAssignmentChange(id),
    onSuccess: () => refreshAssignmentChanges(client, actor, job.id),
  });
  const close = useMutation({
    mutationFn: (id: string) => withdrawAssignmentChange(id),
    onSuccess: () => refreshAssignmentChanges(client, actor, job.id),
  });
  if (lifecycle.isPending || changes.isPending) return <Loading />;
  if (lifecycle.isError)
    return <ErrorState retry={() => void lifecycle.refetch()} />;
  if (changes.isError)
    return <ErrorState retry={() => void changes.refetch()} />;
  const manager = lifecycle.data.can_manage;
  if (!manager && changes.data.length === 0) return null;
  const hasOpenRequest = changes.data.some(
    (item) => item.status === "awaiting_response" || item.status === "accepted",
  );
  const canPropose =
    manager &&
    !hasOpenRequest &&
    lifecycle.data.claims.filter((c) => c.status === "confirmed").length === 1;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!canPropose || reason.trim().length < 5) return;
    try {
      const sessions = starts.map((value, index) => {
        const start = zonedInstant(value, job.time_zone);
        if (!start) throw new Error("Invalid local date/time");
        const prior = job.job_sessions[index];
        const duration =
          DateTime.fromISO(prior.ends_at).toMillis() -
          DateTime.fromISO(prior.starts_at).toMillis();
        const end = DateTime.fromISO(start)
          .plus({ milliseconds: duration })
          .toISO();
        if (!end) throw new Error("Invalid session end");
        return { starts_at: start, ends_at: end };
      });
      proposal.mutate({
        reason: reason.trim(),
        location: location.trim(),
        sessions,
      });
      setInvalidTime(false);
    } catch {
      setInvalidTime(true);
    }
  };
  return (
    <section className="panel" aria-label={t("heading")}>
      <h2>{t("heading")}</h2>
      {!online && <Notice kind="error">{t("offline")}</Notice>}
      {!proposal.isError && (decision.isError || apply.isError) ? (
        <Notice kind="error">{t("failed")}</Notice>
      ) : null}
      {proposal.isError && <Notice kind="error">{t("proposalRefused")}</Notice>}
      {proposal.isSuccess && <Notice>{t("submitted")}</Notice>}
      {invalidTime && <Notice kind="error">{t("invalidTime")}</Notice>}
      {close.isError && <Notice kind="error">{t("failed")}</Notice>}
      {changes.data.map((item) => (
        <article className="panel" key={item.id}>
          <h3>{t(`status.${item.status}`)}</h3>
          <p>{item.reason}</p>
          <dl>
            <dt>{t("location")}</dt>
            <dd>
              {item.original_location || t("none")} →{" "}
              {item.proposed_location || t("none")}
            </dd>
            <dt>{t("schedule")}</dt>
            <dd>
              <ol>
                {item.original_sessions.map((s, i) => (
                  <li key={i}>
                    {dateTime(s.starts_at, i18n.language, job.time_zone)} →{" "}
                    {dateTime(
                      item.proposed_sessions[i]?.starts_at ?? s.starts_at,
                      i18n.language,
                      job.time_zone,
                    )}
                  </li>
                ))}
              </ol>
            </dd>
          </dl>
          {item.can_decide && (
            <div className="job-life-actions">
              <Button
                disabled={!online || decision.isPending}
                onClick={() => decision.mutate({ id: item.id, accept: true })}
              >
                {t("accept")}
              </Button>
              <Button
                variant="secondary"
                disabled={!online || decision.isPending}
                onClick={() => decision.mutate({ id: item.id, accept: false })}
              >
                {t("reject")}
              </Button>
            </div>
          )}
          {item.can_apply && (
            <div className="job-life-actions">
              <Button
                disabled={!online || apply.isPending}
                onClick={() => apply.mutate(item.id)}
              >
                {t("apply")}
              </Button>
              <Button
                variant="secondary"
                disabled={!online || close.isPending}
                onClick={() => close.mutate(item.id)}
              >
                {t("close")}
              </Button>
            </div>
          )}
          {manager && item.status === "awaiting_response" && (
            <Button
              variant="secondary"
              disabled={!online || close.isPending}
              onClick={() => close.mutate(item.id)}
            >
              {t("close")}
            </Button>
          )}
        </article>
      ))}
      {canPropose && (
        <form onSubmit={submit}>
          <p className="muted">{t("eligibilityHelp")}</p>
          <Field id="assignment-change-reason" label={t("reason")}>
            <textarea
              id="assignment-change-reason"
              required
              minLength={5}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
          <Field id="assignment-change-location" label={t("location")}>
            <input
              id="assignment-change-location"
              maxLength={500}
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </Field>
          {starts.map((value, index) => (
            <Field
              key={index}
              id={`assignment-change-start-${index}`}
              label={t("start", { number: index + 1 })}
            >
              <input
                id={`assignment-change-start-${index}`}
                type="datetime-local"
                required
                value={value}
                onChange={(e) =>
                  setStarts(
                    starts.map((x, i) => (i === index ? e.target.value : x)),
                  )
                }
              />
            </Field>
          ))}
          <Button
            disabled={!online || proposal.isPending || reason.trim().length < 5}
          >
            {proposal.isPending ? t("sending") : t("propose")}
          </Button>
        </form>
      )}
    </section>
  );
}
