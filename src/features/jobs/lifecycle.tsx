import { useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { useAuth } from "../auth/auth-context";
import { dateTime, money, zonedInstant } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import type { Job } from "../../lib/types";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import {
  cancelAssignment,
  lifecycleQuery,
  manageOffer,
  setCapacity,
  refreshJobState,
} from "./lifecycle-api";
import "./lifecycle-i18n";
import "./lifecycle.css";

type OfferInput = Parameters<typeof manageOffer>[0];
type Confirmation = {
  kind: "cancel" | "reopen" | "duplicate";
  version: number;
  claim?: string;
};
export function JobLifecyclePanel({ job }: { job: Job }) {
  const { session } = useAuth();
  const { t, i18n } = useTranslation("jobLifecycle");
  const online = useOnline();
  const client = useQueryClient();
  const navigate = useNavigate();
  const state = useQuery(lifecycleQuery(session!.user.id, job.id));
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [reason, setReason] = useState("");
  const [reopenDeadline, setReopenDeadline] = useState("");
  const [copyTitle, setCopyTitle] = useState(job.title);
  const [editing, setEditing] = useState(false);
  const [newCapacity, setNewCapacity] = useState<number | null>(null);
  const request = useRef<{ signature: string; key: string } | null>(null);
  const keyFor = (signature: string) => {
    if (request.current?.signature !== signature)
      request.current = { signature, key: crypto.randomUUID() };
    return request.current.key;
  };
  const change = useMutation({
    mutationFn: async (
      input:
        | Omit<OfferInput, "request">
        | { claim: string; reason: string }
        | { job: string; capacity: number; version: number },
    ) => {
      const key = keyFor(JSON.stringify(input));
      return "claim" in input
        ? cancelAssignment(input.claim, input.reason, key)
        : "capacity" in input
          ? setCapacity(input.job, input.capacity, input.version, key)
          : manageOffer({ ...input, request: key });
    },
    onSuccess: async (result, input) => {
      await refreshJobState(client);
      setConfirmation(null);
      setEditing(false);
      setNewCapacity(null);
      if ("action" in input && input.action === "duplicate")
        navigate(`/jobs/${result}`);
    },
  });
  if (state.isPending) return <Loading />;
  if (state.isError) return <ErrorState retry={() => void state.refetch()} />;
  const info = state.data;
  const capacity = info.capacity ?? job.capacity ?? 1;
  const maxNetBudget =
    info.max_net_budget !== undefined
      ? info.max_net_budget
      : job.total_amount === null
        ? null
        : (Math.round(Number(job.total_amount) * 100) * capacity) / 100;
  const confirmedCount =
    info.confirmed_count ??
    info.claims.filter((claim) => claim.status === "confirmed").length;
  if (!info.can_manage && !info.claims.length && capacity === 1) return null;
  const active = info.claims.some((claim) => claim.status === "confirmed");
  const cancelled = info.claims.some((claim) => claim.status === "cancelled");
  const openConfirmation = (kind: Confirmation["kind"], claim?: string) => {
    setReason("");
    setReopenDeadline(
      job.claim_deadline
        ? DateTime.fromISO(job.claim_deadline)
            .setZone(job.time_zone)
            .toFormat("yyyy-MM-dd'T'HH:mm")
        : "",
    );
    setCopyTitle(job.title);
    change.reset();
    setConfirmation({ kind, claim, version: info.version });
  };
  const confirm = (event: FormEvent) => {
    event.preventDefault();
    if (!confirmation) return;
    if (confirmation.kind === "cancel" && confirmation.claim)
      change.mutate({ claim: confirmation.claim, reason: reason.trim() });
    else
      change.mutate({
        job: job.id,
        action: confirmation.kind === "duplicate" ? "duplicate" : "reopen",
        version: confirmation.version,
        payload:
          confirmation.kind === "duplicate"
            ? { title: copyTitle.trim() }
            : {
                reason: reason.trim(),
                claim_deadline: reopenDeadline
                  ? zonedInstant(reopenDeadline, job.time_zone)
                  : null,
              },
      });
  };
  return (
    <section className="panel job-lifecycle" aria-label={t("heading")}>
      <h2>{t("heading")}</h2>
      <p className="muted">{t("help")}</p>
      <div className="job-life-capacity">
        <strong>
          {capacity} {t("positions")}
        </strong>
        <span>{t("filledPositions", { count: confirmedCount })}</span>
        <span>
          {t("openPositions", {
            count:
              info.open_positions ??
              (job.status === "published"
                ? Math.max(0, capacity - confirmedCount)
                : 0),
          })}
        </span>
      </div>
      {info.can_manage && (
        <p>
          {maxNetBudget !== null && (
            <strong>
              {t("maxNetBudget")}:{" "}
              {money(maxNetBudget, job.currency, i18n.language)}
            </strong>
          )}
          {info.gross_budget !== undefined && info.gross_budget !== null && (
            <>
              {" "}
              ·{" "}
              <strong>
                {t("maxGrossBudget")}:{" "}
                {money(info.gross_budget, job.currency, i18n.language)}
              </strong>
            </>
          )}
        </p>
      )}
      {confirmedCount > 0 && job.status === "draft" && (
        <p>{t("vacancyStatusHint")}</p>
      )}
      {info.can_set_capacity && (
        <form
          className="job-life-actions"
          onSubmit={(event) => {
            event.preventDefault();
            change.mutate({
              job: job.id,
              capacity: newCapacity ?? capacity,
              version: info.version,
            });
          }}
        >
          <Field
            id="capacity-update"
            label={t("positions")}
            hint={t("perPositionHint")}
          >
            <input
              id="capacity-update"
              type="number"
              min="1"
              max="20"
              step="1"
              value={newCapacity ?? capacity}
              onChange={(event) => setNewCapacity(Number(event.target.value))}
            />
          </Field>
          <Button
            disabled={
              !online ||
              change.isPending ||
              !Number.isInteger(newCapacity ?? capacity) ||
              (newCapacity ?? capacity) < 1 ||
              (newCapacity ?? capacity) > 20 ||
              (newCapacity ?? capacity) === capacity
            }
          >
            {t("saveCapacity")}
          </Button>
        </form>
      )}
      {info.can_manage && (
        <div className="job-life-actions">
          {info.can_edit && (
            <Button
              variant="secondary"
              onClick={() => {
                change.reset();
                setEditing(!editing);
              }}
              disabled={!online || change.isPending}
            >
              {t("edit")}
            </Button>
          )}
          {cancelled
            ? confirmedCount < capacity &&
              job.status !== "published" && (
                <Button
                  onClick={() => openConfirmation("reopen")}
                  disabled={!online || change.isPending}
                >
                  {t("reopen")}
                </Button>
              )
            : !active &&
              (["draft", "published", "archived"] as const)
                .filter((status) => status !== job.status)
                .map((action) => (
                  <Button
                    key={action}
                    variant="secondary"
                    disabled={!online || change.isPending}
                    onClick={() =>
                      change.mutate({
                        job: job.id,
                        action,
                        version: info.version,
                      })
                    }
                  >
                    {t(action)}
                  </Button>
                ))}
          {!active && cancelled && job.status !== "archived" && (
            <Button
              variant="secondary"
              disabled={!online || change.isPending}
              onClick={() =>
                change.mutate({
                  job: job.id,
                  action: "archived",
                  version: info.version,
                })
              }
            >
              {t("archived")}
            </Button>
          )}
          {info.can_duplicate && (
            <Button
              variant="secondary"
              onClick={() => openConfirmation("duplicate")}
              disabled={!online || change.isPending}
            >
              {t("duplicate")}
            </Button>
          )}
        </div>
      )}
      {editing && (
        <EditOffer
          key={job.id}
          job={job}
          version={info.version}
          pending={change.isPending}
          save={(input) => change.mutate(input)}
        />
      )}
      {change.isError && (
        <Notice kind="error">
          {typeof change.error === "object" &&
          "code" in change.error &&
          change.error.code === "40001"
            ? t("stale")
            : t("failed")}
        </Notice>
      )}
      {change.isSuccess && <Notice>{t("saved")}</Notice>}
      {cancelled && <p className="muted">{t("frozen")}</p>}
      {info.claims.length ? (
        <ol className="job-life-history">
          {info.claims.map((claim) => (
            <li key={claim.id}>
              <div className="job-life-history-head">
                <strong>{claim.lecturer_name}</strong>
                <span className="badge">{t(claim.status)}</span>
              </div>
              <small>
                {dateTime(claim.created_at, i18n.language, job.time_zone)}
              </small>
              <ul>
                {claim.sessions.map((session) => (
                  <li key={session.starts_at}>
                    {dateTime(session.starts_at, i18n.language, job.time_zone)}{" "}
                    – {dateTime(session.ends_at, i18n.language, job.time_zone)}
                    {session.released_at && (
                      <span className="badge">{t("released")}</span>
                    )}
                  </li>
                ))}
              </ul>
              {claim.events
                .filter((event) => event.type === "cancelled")
                .map((event) => (
                  <p className="preserve-text" key={event.created_at}>
                    {event.reason}
                  </p>
                ))}
              {claim.can_cancel && (
                <Button
                  variant="secondary"
                  disabled={!online || change.isPending}
                  onClick={() => openConfirmation("cancel", claim.id)}
                >
                  {t("cancel")}
                </Button>
              )}
            </li>
          ))}
        </ol>
      ) : info.can_manage ? (
        <p>{t("empty")}</p>
      ) : null}
      <Dialog
        open={Boolean(confirmation)}
        onOpenChange={(open) => {
          if (!open && !change.isPending) setConfirmation(null);
        }}
        title={t(
          confirmation?.kind === "cancel"
            ? "cancel"
            : confirmation?.kind === "duplicate"
              ? "duplicate"
              : "reopen",
        )}
        description={t(
          confirmation?.kind === "cancel"
            ? "cancelDescription"
            : confirmation?.kind === "duplicate"
              ? "duplicateHelp"
              : "reopenDescription",
        )}
      >
        <form className="job-life-form" onSubmit={confirm}>
          {confirmation?.kind === "duplicate" ? (
            <Field id="job-copy-title" label={t("copyTitle")}>
              <input
                id="job-copy-title"
                value={copyTitle}
                maxLength={200}
                required
                onChange={(event) => setCopyTitle(event.target.value)}
              />
            </Field>
          ) : (
            <Field id="job-cancel-reason" label={t("reason")}>
              <textarea
                id="job-cancel-reason"
                value={reason}
                minLength={5}
                maxLength={1000}
                required
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          )}
          {confirmation?.kind === "reopen" && (
            <Field
              id="reopen-deadline"
              label={`${t("deadline")} · ${job.time_zone}`}
              hint={t("deadlineZone")}
            >
              <input
                id="reopen-deadline"
                type="datetime-local"
                value={reopenDeadline}
                onChange={(event) => setReopenDeadline(event.target.value)}
              />
            </Field>
          )}
          <Button
            disabled={
              !online ||
              change.isPending ||
              (confirmation?.kind === "duplicate"
                ? !copyTitle.trim()
                : reason.trim().length < 5) ||
              (confirmation?.kind === "reopen" &&
                Boolean(
                  reopenDeadline &&
                  !zonedInstant(reopenDeadline, job.time_zone),
                ))
            }
          >
            {t(
              confirmation?.kind === "cancel"
                ? "cancelConfirm"
                : confirmation?.kind === "duplicate"
                  ? "duplicate"
                  : "reopen",
            )}
          </Button>
          {change.isError && <Notice kind="error">{t("failed")}</Notice>}
        </form>
      </Dialog>
    </section>
  );
}

function EditOffer({
  job,
  version,
  pending,
  save,
}: {
  job: Job;
  version: number;
  pending: boolean;
  save: (input: Omit<OfferInput, "request">) => void;
}) {
  const { t } = useTranslation("jobLifecycle");
  const online = useOnline();
  // Capture the reviewed version once; a background refresh must not approve a stale draft.
  const [expectedVersion] = useState(version);
  const [title, setTitle] = useState(job.title),
    [description, setDescription] = useState(job.description),
    [location, setLocation] = useState(job.location),
    [terms, setTerms] = useState(job.terms);
  const [deadline, setDeadline] = useState(
    job.claim_deadline
      ? DateTime.fromISO(job.claim_deadline)
          .setZone(job.time_zone)
          .toFormat("yyyy-MM-dd'T'HH:mm")
      : "",
  );
  const instant = deadline ? zonedInstant(deadline, job.time_zone) : null;
  return (
    <form
      className="job-life-form"
      onSubmit={(event) => {
        event.preventDefault();
        save({
          job: job.id,
          action: "edit",
          version: expectedVersion,
          payload: {
            title,
            description,
            location,
            terms,
            claim_deadline: instant,
          },
        });
      }}
    >
      <Field id="offer-title" label={t("title")}>
        <input
          id="offer-title"
          value={title}
          maxLength={200}
          required
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <Field id="offer-description" label={t("description")}>
        <textarea
          id="offer-description"
          value={description}
          maxLength={12000}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <Field id="offer-location" label={t("location")}>
        <input
          id="offer-location"
          value={location}
          maxLength={500}
          onChange={(event) => setLocation(event.target.value)}
        />
      </Field>
      <Field id="offer-terms" label={t("terms")}>
        <textarea
          id="offer-terms"
          value={terms}
          maxLength={12000}
          required
          onChange={(event) => setTerms(event.target.value)}
        />
      </Field>
      <Field
        id="offer-deadline"
        label={`${t("deadline")} · ${job.time_zone}`}
        hint={t("deadlineZone")}
      >
        <input
          id="offer-deadline"
          type="datetime-local"
          value={deadline}
          onChange={(event) => setDeadline(event.target.value)}
        />
      </Field>
      <Button
        disabled={
          !online ||
          pending ||
          !title.trim() ||
          !terms.trim() ||
          Boolean(deadline && !instant)
        }
      >
        {t("save")}
      </Button>
    </form>
  );
}
