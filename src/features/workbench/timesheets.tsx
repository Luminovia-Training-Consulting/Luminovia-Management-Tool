import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DateTime } from "luxon";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import { db } from "../../lib/supabase";
import { useOnline } from "../../lib/online";
import { dateTime, zonedInstant } from "../../lib/dates";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import { downloadCsv } from "../commercial/api";
import {
  downloadPortalDocument,
  type PortalDocumentRequest,
} from "../learning/api";
import {
  fetchTimesheets,
  financePeriodSchema,
  manageTimesheet,
  initialFinancePeriod,
  saveTimesheet,
  timesheetHistoryQuery,
  timesheetsKey,
  timesheetsQuery,
  type FinancePeriod,
  type Timesheet,
  type TimesheetAction,
  type Timesheets,
} from "./finance-api";
import "./finance-i18n";
import "./finance.css";

export function FinancePeriodFilter({
  period,
  onChange,
}: {
  period: FinancePeriod;
  onChange: (period: FinancePeriod) => void;
}) {
  const { t } = useTranslation("financeOps");
  const [draft, setDraft] = useState(period),
    [invalid, setInvalid] = useState(false);
  return (
    <form
      className="panel finance-period"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = financePeriodSchema.safeParse(draft);
        setInvalid(!parsed.success);
        if (parsed.success) onChange(parsed.data);
      }}
    >
      <Field id="finance-from" label={t("from")}>
        <input
          id="finance-from"
          type="date"
          value={draft.from}
          onChange={(event) => setDraft({ ...draft, from: event.target.value })}
        />
      </Field>
      <Field id="finance-until" label={t("until")}>
        <input
          id="finance-until"
          type="date"
          value={draft.until}
          onChange={(event) =>
            setDraft({ ...draft, until: event.target.value })
          }
        />
      </Field>
      <Button type="submit">{t("apply")}</Button>
      <p>{t("periodHelp")}</p>
      {invalid && <Notice kind="error">{t("periodError")}</Notice>}
    </form>
  );
}
function PdfButton({
  request,
  name,
  label,
}: {
  request: PortalDocumentRequest;
  name: string;
  label: string;
}) {
  const { t } = useTranslation("financeOps"),
    online = useOnline(),
    actor = useAuth().session!.user.id;
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
    },
    [actor],
  );
  const download = useMutation({
    mutationFn: async () => {
      const controller = new AbortController();
      pending.current = controller;
      await downloadPortalDocument(request, name, controller.signal);
    },
  });
  return (
    <>
      <Button
        variant="secondary"
        disabled={!online || download.isPending}
        onClick={() => download.mutate()}
      >
        {label}
      </Button>
      {download.isError && <Notice kind="error">{t("error")}</Notice>}
    </>
  );
}
function TimeForm({
  actor,
  source,
  sessions,
  zone,
  close,
  reload,
}: {
  actor: string;
  source: Timesheet | null;
  sessions: Timesheets["sessions"];
  zone: string;
  close: () => void;
  reload: () => Promise<void>;
}) {
  const { t, i18n } = useTranslation("financeOps");
  const online = useOnline(),
    client = useQueryClient();
  const [id] = useState(() => source?.id ?? crypto.randomUUID()),
    [session, setSession] = useState(source?.session_id ?? "");
  const [starts, setStarts] = useState(
      source
        ? DateTime.fromISO(source.starts_at)
            .setZone(zone)
            .toFormat("yyyy-MM-dd'T'HH:mm")
        : "",
    ),
    [ends, setEnds] = useState(
      source
        ? DateTime.fromISO(source.ends_at)
            .setZone(zone)
            .toFormat("yyyy-MM-dd'T'HH:mm")
        : "",
    );
  const [pause, setPause] = useState(source?.break_minutes ?? 0),
    [note, setNote] = useState(source?.note ?? ""),
    [invalid, setInvalid] = useState(false);
  const save = useMutation({
    mutationFn: async () => {
      const start = zonedInstant(starts, zone),
        end = zonedInstant(ends, zone);
      if (
        !start ||
        !end ||
        end <= start ||
        !Number.isInteger(pause) ||
        pause < 0
      ) {
        setInvalid(true);
        throw new Error("invalid_time");
      }
      setInvalid(false);
      return saveTimesheet(
        id,
        {
          session_id: session,
          starts_at: start,
          ends_at: end,
          break_minutes: pause,
          note,
        },
        source?.version ?? 0,
      );
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: timesheetsKey(actor) });
      close();
    },
  });
  const conflict = Boolean(
    save.error &&
    typeof save.error === "object" &&
    "code" in save.error &&
    save.error.code === "40001",
  );
  const selectable = sessions.filter(
    (item) => item.editable || item.id === session,
  );
  return (
    <form
      className="finance-time-form"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <fieldset disabled={save.isPending}>
        <legend className="sr-only">{t("new")}</legend>
        <Field id="timesheet-session" label={t("session")}>
          <select
            id="timesheet-session"
            required
            value={session}
            disabled={Boolean(source)}
            onChange={(event) => {
              setSession(event.target.value);
              const item = sessions.find((s) => s.id === event.target.value);
              if (item) {
                setStarts(
                  DateTime.fromISO(item.starts_at)
                    .setZone(zone)
                    .toFormat("yyyy-MM-dd'T'HH:mm"),
                );
                setEnds(
                  DateTime.fromMillis(
                    Math.min(Date.parse(item.ends_at), Date.now()),
                  )
                    .setZone(zone)
                    .startOf("minute")
                    .toFormat("yyyy-MM-dd'T'HH:mm"),
                );
              }
            }}
          >
            <option value="">{t("choose")}</option>
            {selectable.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} · {dateTime(item.starts_at, i18n.language, zone)}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-row">
          <Field id="timesheet-start" label={t("start")}>
            <input
              id="timesheet-start"
              type="datetime-local"
              required
              value={starts}
              onChange={(event) => setStarts(event.target.value)}
            />
          </Field>
          <Field id="timesheet-end" label={t("end")}>
            <input
              id="timesheet-end"
              type="datetime-local"
              required
              value={ends}
              onChange={(event) => setEnds(event.target.value)}
            />
          </Field>
        </div>
        <p>{zone}</p>
        <Field id="timesheet-break" label={t("break")}>
          <input
            id="timesheet-break"
            type="number"
            min="0"
            step="1"
            required
            value={pause}
            onChange={(event) => setPause(Number(event.target.value))}
          />
        </Field>
        <Field id="timesheet-note" label={t("note")}>
          <textarea
            id="timesheet-note"
            maxLength={2000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </fieldset>
      {save.isError && (
        <Notice kind="error">
          {t(invalid ? "invalid" : conflict ? "conflict" : "error")}
        </Notice>
      )}
      {conflict && (
        <Button type="button" variant="secondary" onClick={() => void reload()}>
          {t("reload")}
        </Button>
      )}
      <div className="finance-actions">
        <Button type="submit" disabled={!online || save.isPending || !session}>
          {t("save")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={save.isPending}
          onClick={close}
        >
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
function History({ actor, item }: { actor: string; item: Timesheet }) {
  const { t, i18n } = useTranslation("financeOps");
  const query = useQuery(timesheetHistoryQuery(actor, item.id));
  if (query.isPending) return <Loading />;
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  const actionKeys: Record<string, string> = {
    saved: "savedAction",
    submit: "submitAction",
    approve: "approveAction",
    reject: "rejectAction",
    request_correction: "correctionAction",
  };
  return (
    <ol className="finance-history">
      {query.data.map((entry) => (
        <li key={entry.id}>
          <strong>{t(actionKeys[entry.action] ?? "history")}</strong> ·{" "}
          {dateTime(entry.created_at, i18n.language, item.time_zone)}
          {[
            ["before", entry.before_state],
            ["after", entry.after_state],
          ].map(([kind, value]) => {
            const data = value as Record<string, unknown> | null;
            if (!data) return null;
            return (
              <div key={String(kind)}>
                <strong>{t(String(kind))}</strong>
                <p>
                  {typeof data.state === "string" &&
                  ["draft", "submitted", "approved", "rejected"].includes(
                    data.state,
                  )
                    ? t(data.state)
                    : ""}{" "}
                  ·{" "}
                  {typeof data.starts_at === "string"
                    ? dateTime(data.starts_at, i18n.language, item.time_zone)
                    : ""}{" "}
                  –{" "}
                  {typeof data.ends_at === "string"
                    ? dateTime(data.ends_at, i18n.language, item.time_zone)
                    : ""}
                </p>
                {typeof data.note === "string" && (
                  <p className="preserve-text">{data.note}</p>
                )}
                {typeof data.review_note === "string" && (
                  <p className="preserve-text">{data.review_note}</p>
                )}
              </div>
            );
          })}
        </li>
      ))}
    </ol>
  );
}
function ReviewActions({
  item,
  actor,
  canReview,
}: {
  item: Timesheet;
  actor: string;
  canReview: boolean;
}) {
  const { t } = useTranslation("financeOps"),
    online = useOnline(),
    client = useQueryClient();
  const [reason, setReason] = useState("");
  const request = useRef<{ signature: string; id: string } | null>(null);
  const action = useMutation({
    mutationFn: (kind: TimesheetAction) => {
      const signature = JSON.stringify({
        id: item.id,
        kind,
        version: item.version,
        reason,
      });
      if (request.current?.signature !== signature)
        request.current = { signature, id: crypto.randomUUID() };
      return manageTimesheet(item, kind, request.current.id, reason);
    },
    onSuccess: () =>
      client.invalidateQueries({ queryKey: timesheetsKey(actor) }),
  });
  const conflict = Boolean(
    action.error &&
    typeof action.error === "object" &&
    "code" in action.error &&
    action.error.code === "40001",
  );
  return (
    <div className="finance-review">
      {item.lecturer_id === actor && item.state === "draft" && (
        <Button
          disabled={!online || action.isPending}
          onClick={() => action.mutate("submit")}
        >
          {t("submit")}
        </Button>
      )}
      {canReview &&
        (item.state === "submitted" || item.state === "approved") && (
          <>
            <Field id={`review-${item.id}`} label={t("reason")}>
              <textarea
                id={`review-${item.id}`}
                maxLength={1000}
                value={reason}
                disabled={action.isPending}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            <div className="finance-actions">
              {item.state === "submitted" && (
                <Button
                  disabled={!online || action.isPending}
                  onClick={() => action.mutate("approve")}
                >
                  {t("approve")}
                </Button>
              )}
              <Button
                variant="secondary"
                disabled={
                  !online || action.isPending || reason.trim().length < 5
                }
                onClick={() =>
                  action.mutate(
                    item.state === "submitted"
                      ? "reject"
                      : "request_correction",
                  )
                }
              >
                {t(
                  item.state === "submitted" ? "reject" : "request_correction",
                )}
              </Button>
            </div>
          </>
        )}
      {action.isError && (
        <Notice kind="error">{t(conflict ? "conflict" : "error")}</Notice>
      )}
      {conflict && (
        <Button
          variant="ghost"
          onClick={() =>
            void client.invalidateQueries({ queryKey: timesheetsKey(actor) })
          }
        >
          {t("reload")}
        </Button>
      )}
      {action.isSuccess && <Notice>{t("changed")}</Notice>}
    </div>
  );
}
export function TimesheetsPage() {
  const actor = useAuth().session!.user.id,
    { t, i18n } = useTranslation("financeOps");
  const online = useOnline();
  const [params, setParams] = useSearchParams();
  const [defaultPeriod] = useState(initialFinancePeriod);
  const requestedPeriod = financePeriodSchema.safeParse({
    from: params.get("from"),
    until: params.get("until"),
  });
  const period = requestedPeriod.success ? requestedPeriod.data : defaultPeriod;
  const setPeriod = (value: FinancePeriod) => {
    const next = new URLSearchParams(params);
    next.set("from", value.from);
    next.set("until", value.until);
    next.delete("timesheet");
    setParams(next, { replace: true });
  };
  const [all, setAll] = useState(false),
    [editing, setEditing] = useState<{ item: Timesheet | null } | null>(null),
    [history, setHistory] = useState<Timesheet | null>(null);
  const query = useQuery(timesheetsQuery(actor, period, all));
  const csv = useMutation({
    mutationFn: async () => {
      const fresh = await fetchTimesheets(period, all);
      if ((await db().auth.getSession()).data.session?.user.id !== actor)
        throw new Error("account_changed");
      downloadCsv(`luminovia-timesheets-${period.from}-${period.until}.csv`, [
        [
          t("lecturer"),
          t("course"),
          t("start"),
          t("end"),
          t("break"),
          t("minutes", { count: 0 }),
          t("state"),
          t("note"),
        ],
        ...fresh.items.map((item) => [
          item.lecturer_name,
          item.title,
          item.starts_at,
          item.ends_at,
          item.break_minutes,
          item.minutes,
          t(item.state),
          item.note,
        ]),
      ]);
    },
  });
  return (
    <>
      <PageHeading title={t("timesheets")} description={t("timesheetsHelp")} />
      <FinancePeriodFilter
        key={`${period.from}:${period.until}`}
        period={period}
        onChange={setPeriod}
      />
      {query.data?.can_review && (
        <label className="notification-preference">
          <input
            type="checkbox"
            checked={all}
            onChange={(event) => setAll(event.target.checked)}
          />
          <span>{t("all")}</span>
        </label>
      )}
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        <>
          <p>{query.data.time_zone}</p>
          <div className="finance-actions">
            <Button
              disabled={!online || !query.data.sessions.some((s) => s.editable)}
              onClick={() => setEditing({ item: null })}
            >
              {t("new")}
            </Button>
            <Button
              variant="secondary"
              disabled={!online || csv.isPending}
              onClick={() => csv.mutate()}
            >
              {t("csv")}
            </Button>
            <PdfButton
              request={{
                kind: "earnings_statement",
                from: period.from,
                until: period.until,
                all,
              }}
              name={`luminovia-earnings-${period.from}-${period.until}.pdf`}
              label={t("statement")}
            />
            <Link to="/finance">{t("invoice")}</Link>
          </div>
          <p>{t("invoiceHelp")}</p>
          {csv.isError && <Notice kind="error">{t("error")}</Notice>}
          {!query.data.items.length ? (
            <p className="panel">{t("empty")}</p>
          ) : (
            <div className="finance-time-list">
              {query.data.items.map((item) => (
                <article
                  className="panel"
                  key={item.id}
                  aria-label={`${item.title} · ${item.lecturer_name}`}
                >
                  <h2>{item.title}</h2>
                  <p>
                    {item.lecturer_name} · {t(item.state)}
                  </p>
                  <p>
                    {dateTime(
                      item.starts_at,
                      i18n.language,
                      query.data.time_zone,
                    )}{" "}
                    –{" "}
                    {dateTime(
                      item.ends_at,
                      i18n.language,
                      query.data.time_zone,
                    )}
                  </p>
                  <p>
                    {t("minutes", { count: item.minutes })} · {t("break")}:{" "}
                    {item.break_minutes}
                  </p>
                  <p className="preserve-text">{item.note}</p>
                  {item.review_note && (
                    <p className="preserve-text">{item.review_note}</p>
                  )}
                  <div className="finance-actions">
                    {item.lecturer_id === actor &&
                      ["draft", "rejected"].includes(item.state) && (
                        <Button
                          variant="secondary"
                          disabled={!online}
                          onClick={() => setEditing({ item })}
                        >
                          {t("edit")}
                        </Button>
                      )}
                    <Button variant="ghost" onClick={() => setHistory(item)}>
                      {t("history")}
                    </Button>
                    <PdfButton
                      request={{
                        kind: "assignment_confirmation",
                        id: item.claim_id,
                      }}
                      name={`luminovia-assignment-${item.claim_id}.pdf`}
                      label={t("confirmation")}
                    />
                  </div>
                  <ReviewActions
                    actor={actor}
                    item={item}
                    canReview={query.data.can_review}
                  />
                </article>
              ))}
            </div>
          )}
          <Dialog
            open={Boolean(editing)}
            onOpenChange={(open) => {
              if (!open) setEditing(null);
            }}
            title={t(editing?.item ? "edit" : "new")}
            description={t("timesheetsHelp")}
          >
            {editing && (
              <TimeForm
                key={
                  editing.item
                    ? `${editing.item.id}:${editing.item.version}`
                    : "new"
                }
                actor={actor}
                source={editing.item}
                sessions={query.data.sessions}
                zone={query.data.time_zone}
                close={() => setEditing(null)}
                reload={async () => {
                  const fresh = await query.refetch();
                  const current = fresh.data?.items.find(
                    (item) => item.id === editing.item?.id,
                  );
                  setEditing(current ? { item: current } : null);
                }}
              />
            )}
          </Dialog>
        </>
      )}
      <p>{t("reviewHelp")}</p>
      <Dialog
        open={Boolean(history)}
        onOpenChange={(open) => {
          if (!open) setHistory(null);
        }}
        title={t("history")}
        description={history?.title ?? ""}
      >
        {history && <History actor={actor} item={history} />}
      </Dialog>
    </>
  );
}
