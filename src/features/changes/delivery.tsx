import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { z } from "zod";
import { useAuth } from "../auth/auth-context";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
  TextLink,
} from "../../components/common";
import { Button } from "../../components/ui/button";
import { downloadCsv } from "../../lib/csv";
import { dateTime, zonedInstantForEdit } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { permissionsQuery, userRolesQuery } from "../../lib/queries";
import {
  deliveryDetailQuery,
  deliveryKey,
  deliveryListQuery,
  recordDelivery,
  type DeliveryAction,
} from "./delivery-api";
import {
  deliveryOutcomes,
  type DeliveryScope,
  type DeliverySession,
} from "./delivery-schema";
import { useRequest } from "./use-request";
import { notificationKeys } from "../notifications/api";
import "./delivery-i18n";
import "./changes.css";
import "./delivery.css";

type Cursor = { session_id: string; scheduled_start: string };

function DeliveryList({
  actor,
  scopes,
}: {
  actor: string;
  scopes: DeliveryScope[];
}) {
  const { t } = useTranslation("teachingDelivery");
  const [view, setView] = useState({
    scope: scopes[0],
    cursors: [] as Cursor[],
  });
  const scope = scopes.includes(view.scope) ? view.scope : scopes[0];
  const cursors = scope === view.scope ? view.cursors : [];
  return (
    <section className="panel delivery-stack">
      {scopes.length > 1 && (
        <Field id="delivery-scope" label={t("scope")}>
          <select
            id="delivery-scope"
            value={scope}
            onChange={(event) =>
              setView({
                scope: event.target.value as DeliveryScope,
                cursors: [],
              })
            }
          >
            {scopes.map((option) => (
              <option key={option} value={option}>
                {t(option)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <DeliveryListPage
        key={JSON.stringify([actor, scope, cursors.at(-1)])}
        actor={actor}
        scope={scope}
        cursors={cursors}
        onCursorsChange={(next) => setView({ scope, cursors: next })}
      />
    </section>
  );
}

/** Export through a fresh read of the active page and cancel the download when the view changes. */
function DeliveryListPage({
  actor,
  scope,
  cursors,
  onCursorsChange,
}: {
  actor: string;
  scope: DeliveryScope;
  cursors: Cursor[];
  onCursorsChange: (next: Cursor[]) => void;
}) {
  const { t, i18n } = useTranslation("teachingDelivery");
  const online = useOnline();
  const query = useQuery(deliveryListQuery(actor, scope, cursors.at(-1)));
  const exportPage = useMutation({
    mutationFn: async () => {
      requireOnline();
      const { data } = await query.refetch({ throwOnError: true });
      return data?.items ?? [];
    },
  });

  function downloadPage(items: DeliverySession[]) {
    if (!items.length) return;
    // List columns explicitly. Drafts, private notes and invoice IDs never
    // become columns, even for a current reviewer who can read them.
    downloadCsv(`luminovia-delivery-evidence-${scope}.csv`, [
      [
        t("csvCourse"),
        t("csvLecturer"),
        t("csvScheduledStart"),
        t("csvScheduledEnd"),
        t("csvScheduledZone"),
        t("csvScheduledMinutes"),
        t("start"),
        t("end"),
        t("csvActualZone"),
        t("csvActualMinutes"),
        t("outcome"),
        t("csvStatus"),
        t("csvRevision"),
      ],
      ...items.map((item) => [
        item.title,
        item.lecturer_name,
        item.scheduled_start,
        item.scheduled_end,
        item.time_zone,
        item.scheduled_minutes,
        item.submission?.actual_start,
        item.submission?.actual_end,
        item.submission?.time_zone,
        item.submission ? item.actual_minutes : null,
        item.submission?.outcome,
        item.status,
        item.submission?.revision,
      ]),
    ]);
  }

  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  if (query.isPending) return <Loading />;
  const { items, has_more: hasMore } = query.data;
  const last = items.at(-1);

  return (
    <>
      {!last && <p>{t("empty")}</p>}
      <ul className="delivery-items">
        {items.map((item) => (
          <li key={item.session_id}>
            <TextLink to={`/delivery?session=${item.session_id}`}>
              {item.title}
            </TextLink>
            <p className="muted">
              {dateTime(item.scheduled_start, i18n.language, item.time_zone)} ·{" "}
              {item.lecturer_name} · {t(item.status)}
            </p>
          </li>
        ))}
      </ul>
      <div className="changes-controls">
        {cursors.length > 0 && (
          <Button
            variant="secondary"
            onClick={() => onCursorsChange(cursors.slice(0, -1))}
          >
            {t("previous")}
          </Button>
        )}
        {hasMore && last && (
          <Button
            variant="secondary"
            onClick={() =>
              onCursorsChange([
                ...cursors,
                {
                  session_id: last.session_id,
                  scheduled_start: last.scheduled_start,
                },
              ])
            }
          >
            {t("next")}
          </Button>
        )}
        {last && (
          <Button
            variant="secondary"
            disabled={!online || exportPage.isPending}
            onClick={() =>
              exportPage.mutate(undefined, { onSuccess: downloadPage })
            }
          >
            {exportPage.isPending ? t("csvExporting") : t("csvExport")}
          </Button>
        )}
      </div>
      {exportPage.isError && <Notice kind="error">{t("csvError")}</Notice>}
    </>
  );
}

function DeliveryEditor({
  item,
  disabled,
  act,
}: {
  item: DeliverySession;
  disabled: boolean;
  act: (action: DeliveryAction) => void;
}) {
  const { t } = useTranslation("teachingDelivery");
  const draft = item.draft && "outcome" in item.draft ? item.draft : null;
  const existing = draft ?? item.submission;
  const zone = existing?.time_zone ?? item.time_zone;
  const initialStart = existing ? existing.actual_start : item.scheduled_start;
  const initialEnd = existing ? existing.actual_end : item.scheduled_end;
  const local = (instant: string | null) =>
    instant
      ? DateTime.fromISO(instant).setZone(zone).toFormat("yyyy-MM-dd'T'HH:mm")
      : "";
  const initial = {
    outcome: existing?.outcome ?? "completed",
    start: local(initialStart),
    end: local(initialEnd),
    notes: existing?.notes ?? "",
    correction: draft?.correction_reason ?? "",
  };
  const [form, setForm] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const changed = Object.keys(initial).some(
    (key) =>
      initial[key as keyof typeof initial] !==
      form[key as keyof typeof initial],
  );
  const cancellation = form.outcome === "cancelled";

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const start = cancellation
      ? null
      : zonedInstantForEdit(form.start, zone, initial.start, initialStart);
    const end = cancellation
      ? null
      : zonedInstantForEdit(form.end, zone, initial.end, initialEnd);
    if (
      !cancellation &&
      (!start || !end || Date.parse(end) <= Date.parse(start))
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    act({
      kind: "draft",
      draft: {
        outcome: form.outcome,
        actual_start: start,
        actual_end: end,
        time_zone: zone,
        notes: form.notes,
        correction_reason: form.correction,
      },
    });
  }

  return (
    <form className="panel delivery-stack" onSubmit={save}>
      <h2>{t("actual")}</h2>
      <p className="muted">{t("zone", { zone })}</p>
      <Field id="delivery-outcome" label={t("outcome")}>
        <select
          id="delivery-outcome"
          value={form.outcome}
          onChange={(event) =>
            setForm({
              ...form,
              outcome: event.target.value as typeof form.outcome,
            })
          }
        >
          {deliveryOutcomes.map((outcome) => (
            <option key={outcome} value={outcome}>
              {t(outcome)}
            </option>
          ))}
        </select>
      </Field>
      {!cancellation && (
        <div className="delivery-time-fields">
          <Field id="delivery-start" label={t("start")} error={invalid}>
            <input
              id="delivery-start"
              type="datetime-local"
              required
              value={form.start}
              onChange={(event) =>
                setForm({ ...form, start: event.target.value })
              }
            />
          </Field>
          <Field id="delivery-end" label={t("end")} error={invalid}>
            <input
              id="delivery-end"
              type="datetime-local"
              required
              value={form.end}
              onChange={(event) =>
                setForm({ ...form, end: event.target.value })
              }
            />
          </Field>
        </div>
      )}
      {invalid && <Notice kind="error">{t("invalidTime", { zone })}</Notice>}
      <Field id="delivery-notes" label={t("notes")}>
        <textarea
          id="delivery-notes"
          rows={3}
          maxLength={4000}
          required={form.outcome !== "completed"}
          minLength={form.outcome !== "completed" ? 5 : undefined}
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
        />
      </Field>
      {item.submission && (
        <Field id="delivery-correction" label={t("correctionReason")}>
          <textarea
            id="delivery-correction"
            rows={3}
            required
            minLength={5}
            maxLength={1000}
            value={form.correction}
            onChange={(event) =>
              setForm({ ...form, correction: event.target.value })
            }
          />
        </Field>
      )}
      <div className="changes-controls">
        <Button type="submit" disabled={disabled}>
          {t("save")}
        </Button>
        {item.status === "draft" && draft && (
          <Button
            type="button"
            variant="secondary"
            disabled={disabled || changed}
            onClick={() => act({ kind: "submit" })}
          >
            {t("submit")}
          </Button>
        )}
      </div>
    </form>
  );
}

function DeliveryReview({
  item,
  disabled,
  act,
}: {
  item: DeliverySession;
  disabled: boolean;
  act: (action: DeliveryAction) => void;
}) {
  const { t } = useTranslation("teachingDelivery");
  const [note, setNote] = useState("");
  if (!item.can_review && !item.can_customer_confirm) return null;
  return (
    <section className="panel delivery-stack">
      {item.can_review && (
        <Field id="delivery-review" label={t("reviewNote")}>
          <textarea
            id="delivery-review"
            rows={3}
            maxLength={2000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      )}
      <div className="changes-controls">
        {item.can_review && item.status === "submitted" && (
          <Button
            disabled={disabled}
            onClick={() => act({ kind: "confirm", note })}
          >
            {t("confirm")}
          </Button>
        )}
        {item.can_review &&
          (["request_correction", "dispute"] as const).map((kind) => (
            <Button
              key={kind}
              variant="secondary"
              disabled={disabled || note.trim().length < 5}
              onClick={() => act({ kind, note })}
            >
              {t(kind)}
            </Button>
          ))}
        {item.can_customer_confirm && (
          <Button
            disabled={disabled}
            onClick={() => act({ kind: "customer_confirm" })}
          >
            {t("customer_confirm")}
          </Button>
        )}
      </div>
    </section>
  );
}

function DeliveryDetail({
  actor,
  session,
}: {
  actor: string;
  session: string;
}) {
  const { t, i18n } = useTranslation("teachingDelivery");
  const query = useQuery(deliveryDetailQuery(actor, session));
  const client = useQueryClient();
  const request = useRequest();
  const online = useOnline();
  const mutation = useMutation({
    mutationFn: ({
      item,
      action,
    }: {
      item: DeliverySession;
      action: DeliveryAction;
    }) =>
      recordDelivery(
        item,
        action,
        request([item.session_id, item.version, action]),
      ),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: deliveryKey(actor) }),
        client.invalidateQueries({ queryKey: notificationKeys.all(actor) }),
      ]),
  });
  if (query.isError) return <ErrorState retry={() => void query.refetch()} />;
  if (query.isPending) return <Loading />;
  const { item, history } = query.data;
  const refresh = () => void query.refetch();
  const conflict =
    mutation.error &&
    typeof mutation.error === "object" &&
    "code" in mutation.error &&
    mutation.error.code === "PT409";
  const action = (value: DeliveryAction) =>
    mutation.mutate({ item, action: value });
  const disabled = !online || mutation.isPending || Boolean(conflict);
  const time = (instant: string, zone: string) =>
    dateTime(instant, i18n.language, zone);

  return (
    <>
      <TextLink to="/delivery">{t("overview")}</TextLink>
      <section className="panel delivery-stack">
        <h2>{item.title}</h2>
        <p>
          {item.lecturer_name} · {t(item.status)}
        </p>
        <p>
          {t("scheduled")} · {time(item.scheduled_start, item.time_zone)} —{" "}
          {time(item.scheduled_end, item.time_zone)}
        </p>
        {item.customer_confirmed && <p>{t("customer_confirmed")}</p>}
      </section>
      {!online && <Notice kind="error">{t("offline")}</Notice>}
      {mutation.isError && (
        <Notice kind="error">
          {t(conflict ? "conflict" : "error")}{" "}
          {conflict && (
            <Button
              variant="secondary"
              onClick={async () => {
                const refreshed = await query.refetch();
                if (refreshed.isSuccess) mutation.reset();
              }}
            >
              {t("refresh")}
            </Button>
          )}
        </Notice>
      )}
      {mutation.isSuccess && <Notice>{t("saved")}</Notice>}
      {item.can_edit && (
        <DeliveryEditor
          key={`editor:${item.version}`}
          item={item}
          disabled={disabled}
          act={action}
        />
      )}
      <DeliveryReview
        key={`review:${item.version}`}
        item={item}
        disabled={disabled}
        act={action}
      />
      <section className="panel delivery-stack">
        <h2>{t("history")}</h2>
        {!history.submissions.length && <p>{t("noHistory")}</p>}
        <ol className="delivery-history">
          {history.submissions.map((submission) => (
            <li key={submission.id}>
              <strong>
                {t("revision", { number: submission.revision })} ·{" "}
                {t(submission.outcome)}
              </strong>
              {submission.actual_start && submission.actual_end && (
                <p>
                  {time(submission.actual_start, submission.time_zone)} —{" "}
                  {time(submission.actual_end, submission.time_zone)}
                </p>
              )}
              {submission.notes && (
                <p className="changes-authored">{submission.notes}</p>
              )}
              {submission.correction_reason && (
                <p className="changes-authored">
                  {submission.correction_reason}
                </p>
              )}
              <ul className="delivery-stack">
                {history.events
                  .filter((event) => event.submission_id === submission.id)
                  .map((event) => (
                    <li key={event.id}>
                      {t(event.action)} ·{" "}
                      {time(event.created_at, item.time_zone)}
                      {event.note && (
                        <p className="changes-authored">{event.note}</p>
                      )}
                    </li>
                  ))}
              </ul>
            </li>
          ))}
        </ol>
        <Button
          variant="secondary"
          disabled={!online || query.isFetching}
          onClick={refresh}
        >
          {t("refresh")}
        </Button>
      </section>
    </>
  );
}

export function DeliveryPage() {
  const { t } = useTranslation("teachingDelivery");
  const actor = useAuth().session!.user.id;
  const [params] = useSearchParams();
  const selected = params.get("session");
  const permissions = useQuery({
    ...permissionsQuery(actor),
    enabled: !selected,
  });
  const roles = useQuery({ ...userRolesQuery(actor), enabled: !selected });
  const scopes: DeliveryScope[] = [];
  if (
    permissions.data?.includes("courses.manage") ||
    permissions.data?.includes("finance.manage")
  )
    scopes.push("management");
  if (
    roles.data?.some(
      (role) => role === "lecturer" || role === "senior_lecturer",
    )
  )
    scopes.push("own");
  if (roles.data?.includes("client")) scopes.push("customer");

  return (
    <div className="delivery-stack">
      <PageHeading title={t("title")} description={t("description")} />
      {selected ? (
        z.uuid().safeParse(selected).success ? (
          <DeliveryDetail key={selected} actor={actor} session={selected} />
        ) : (
          <ErrorState />
        )
      ) : roles.isError || permissions.isError ? (
        <ErrorState
          retry={() => {
            void roles.refetch();
            void permissions.refetch();
          }}
        />
      ) : roles.isPending || permissions.isPending ? (
        <Loading />
      ) : scopes.length ? (
        <DeliveryList actor={actor} scopes={scopes} />
      ) : (
        <p>{t("empty")}</p>
      )}
    </div>
  );
}
