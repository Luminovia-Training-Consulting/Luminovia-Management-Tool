import { useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router-dom";
import { DateTime } from "luxon";
import { Download, ClipboardCheck } from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { permissionsQuery, userRolesQuery } from "../../lib/queries";
import { useOnline } from "../../lib/online";
import { dateTime } from "../../lib/dates";
import { Button } from "../../components/ui/button";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { downloadCsv } from "../commercial/api";
import {
  deliveryCsvRows,
  deliveryDraft,
  deliveryHistoryQuery,
  deliveryKeys,
  deliverySessionQuery,
  deliverySessionsQuery,
  deliveryWrite,
  type DeliveryForm,
  type DeliveryScope,
  type DeliverySession,
} from "./api";
import "./i18n";
import "./delivery.css";

function DeliveryDetail({
  row,
  actor,
  onSaved,
}: {
  row: DeliverySession;
  actor: string;
  onSaved: () => void;
}) {
  const { t, i18n } = useTranslation("delivery");
  const online = useOnline();
  const client = useQueryClient();
  const source = row.draft ?? row.submission;
  const zone = source?.time_zone ?? row.time_zone;
  const local = (value: string | null | undefined, fallback: string) =>
    DateTime.fromISO(value ?? fallback)
      .setZone(zone)
      .toFormat("yyyy-MM-dd'T'HH:mm");
  const [form, setForm] = useState<DeliveryForm>({
    outcome: source?.outcome ?? "completed",
    start: local(source?.actual_start, row.scheduled_start),
    end: local(source?.actual_end, row.scheduled_end),
    zone,
    notes: source?.notes ?? "",
    reason: row.status === "draft" ? (row.draft?.correction_reason ?? "") : "",
  });
  const [initialForm] = useState(() => JSON.stringify(form));
  const draftDirty = JSON.stringify(form) !== initialForm;
  const [note, setNote] = useState("");
  const receipt = useRef<{ signature: string; key: string } | null>(null);
  const history = useQuery(deliveryHistoryQuery(actor, row.session_id));
  const write = useMutation({
    mutationFn: async (
      action:
        | "save"
        | "submit"
        | "confirm"
        | "dispute"
        | "request_correction"
        | "customer",
    ) => {
      const payload: Record<string, unknown> = {
        p_session_id: row.session_id,
        p_expected_version: row.version,
      };
      const name =
        action === "save"
          ? "save_delivery_draft"
          : action === "submit"
            ? "submit_delivery"
            : action === "customer"
              ? "confirm_customer_delivery"
              : "review_delivery";
      if (action === "save")
        payload.p_payload = deliveryDraft(form, Boolean(row.submission));
      if (name === "review_delivery") {
        payload.p_action = action;
        payload.p_note = note;
      }
      const signature = JSON.stringify({ name, payload });
      if (receipt.current?.signature !== signature)
        receipt.current = { signature, key: crypto.randomUUID() };
      return deliveryWrite(name, {
        ...payload,
        p_request_id: receipt.current.key,
      });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: deliveryKeys.all(actor) });
      onSaved();
    },
  });
  const set = (key: keyof DeliveryForm, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const busy = write.isPending || !online;
  const error = write.error as { code?: string; message?: string } | null;
  return (
    <section className="delivery-card delivery-detail" aria-label={row.title}>
      <h2>{row.title}</h2>
      <p>
        {row.lecturer_name} ·{" "}
        {dateTime(row.scheduled_start, i18n.language, row.time_zone)} –{" "}
        {dateTime(row.scheduled_end, i18n.language, row.time_zone)} ·{" "}
        {row.time_zone}
      </p>
      <p className="delivery-status">
        {t("statusLabel")}: {t(row.status)}
      </p>
      <div className="delivery-summary">
        <div>
          <span>{t("scheduled")}</span>
          <strong>{t("minutes", { count: row.scheduled_minutes })}</strong>
        </div>
        <div>
          <span>{t("actual")}</span>
          <strong>{t("minutes", { count: row.actual_minutes })}</strong>
        </div>
      </div>
      {row.customer_confirmed && <p>{t("customerConfirmed")}</p>}
      <div className="delivery-actions">
        <Link className="text-link" to={`/jobs/${row.job_id}`}>
          {t("job")}
        </Link>
        {row.invoice_id && (
          <Link className="text-link" to="/finance">
            {t("finance")}
          </Link>
        )}
      </div>
      <p className="delivery-hint">{t("immutable")}</p>
      {!online && <Notice kind="error">{t("offline")}</Notice>}
      {write.isError && (
        <Notice kind="error">
          {t(
            error?.code === "40001"
              ? "conflict"
              : error?.message === "delivery_invalid"
                ? "invalid"
                : "error",
          )}
        </Notice>
      )}
      {row.can_edit && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            write.mutate("save");
          }}
        >
          <h3>{t("draftTitle")}</h3>
          <Field id="delivery-outcome" label={t("outcome")}>
            <select
              id="delivery-outcome"
              value={form.outcome}
              disabled={busy}
              onChange={(event) => set("outcome", event.target.value)}
            >
              {(
                ["completed", "partial", "cancelled", "interrupted"] as const
              ).map((value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ))}
            </select>
          </Field>
          <Field id="delivery-zone" label={t("zone")}>
            <input
              id="delivery-zone"
              value={form.zone}
              maxLength={100}
              disabled={busy}
              onChange={(event) => set("zone", event.target.value)}
              required
            />
          </Field>
          <div className="form-row">
            <Field id="delivery-start" label={t("start")}>
              <input
                id="delivery-start"
                type="datetime-local"
                value={form.start}
                disabled={busy || form.outcome === "cancelled"}
                onChange={(event) => set("start", event.target.value)}
                required={form.outcome !== "cancelled"}
              />
            </Field>
            <Field id="delivery-end" label={t("end")}>
              <input
                id="delivery-end"
                type="datetime-local"
                value={form.end}
                disabled={busy || form.outcome === "cancelled"}
                onChange={(event) => set("end", event.target.value)}
                required={form.outcome !== "cancelled"}
              />
            </Field>
          </div>
          <Field id="delivery-notes" label={t("notes")}>
            <textarea
              id="delivery-notes"
              value={form.notes}
              maxLength={4000}
              minLength={form.outcome !== "completed" ? 5 : undefined}
              required={form.outcome !== "completed"}
              disabled={busy}
              onChange={(event) => set("notes", event.target.value)}
            />
          </Field>
          {row.submission && (
            <Field
              id="delivery-reason"
              label={t("reason")}
              hint={t("reasonHint")}
            >
              <textarea
                id="delivery-reason"
                value={form.reason}
                maxLength={1000}
                minLength={5}
                required
                disabled={busy}
                onChange={(event) => set("reason", event.target.value)}
              />
            </Field>
          )}
          <Button type="submit" disabled={busy}>
            {t("save")}
          </Button>
        </form>
      )}
      {row.can_edit && row.status === "draft" && row.draft && (
        <div>
          <p className="delivery-hint">{t("submitHint")}</p>
          <Button
            disabled={busy || draftDirty}
            onClick={() => write.mutate("submit")}
          >
            {t("submit")}
          </Button>
        </div>
      )}
      {row.can_review && (
        <div>
          <Field id="delivery-decision" label={t("decisionNote")}>
            <textarea
              id="delivery-decision"
              value={note}
              maxLength={2000}
              disabled={busy}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
          <div className="delivery-actions">
            {row.status === "submitted" && (
              <Button disabled={busy} onClick={() => write.mutate("confirm")}>
                {t("confirm")}
              </Button>
            )}
            <Button
              variant="secondary"
              disabled={busy || note.trim().length < 5}
              onClick={() => write.mutate("request_correction")}
            >
              {t("requestCorrection")}
            </Button>
            <Button
              variant="danger"
              disabled={busy || note.trim().length < 5}
              onClick={() => write.mutate("dispute")}
            >
              {t("dispute")}
            </Button>
          </div>
        </div>
      )}
      {row.can_customer_confirm && (
        <Button disabled={busy} onClick={() => write.mutate("customer")}>
          {t("customerConfirm")}
        </Button>
      )}
      <h3>{t("history")}</h3>
      {history.isPending ? (
        <Loading />
      ) : history.isError ? (
        <ErrorState retry={() => void history.refetch()} />
      ) : (
        <>
          {!history.data.submissions.length && <p>{t("noHistory")}</p>}
          <ol className="delivery-history">
            {history.data.submissions.map((sub) => (
              <li key={sub.id}>
                <strong>
                  {t("revision", { number: sub.revision })} · {t(sub.outcome)}
                </strong>
                <p>{dateTime(sub.created_at, i18n.language, sub.time_zone)}</p>
                {sub.actual_start && (
                  <p>
                    {t("historyStart")}:{" "}
                    {dateTime(sub.actual_start, i18n.language, sub.time_zone)}
                    <br />
                    {t("historyEnd")}:{" "}
                    {dateTime(sub.actual_end!, i18n.language, sub.time_zone)}
                  </p>
                )}
                {sub.notes && <p>{sub.notes}</p>}
                {sub.correction_reason && (
                  <p>
                    {t("reason")}: {sub.correction_reason}
                  </p>
                )}
              </li>
            ))}
          </ol>
          <ol className="delivery-history">
            {history.data.events.map((event) => (
              <li key={event.id}>
                {t(event.action)} ·{" "}
                {dateTime(event.created_at, i18n.language, row.time_zone)}
                {event.note && <p>{event.note}</p>}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

export function TeachingDelivery() {
  const { session } = useAuth();
  const actor = session!.user.id;
  const { t, i18n } = useTranslation("delivery");
  const perms = useQuery(permissionsQuery(actor));
  const roles = useQuery(userRolesQuery(actor));
  const [scope, setScope] = useState<DeliveryScope>("own");
  const [params, setParams] = useSearchParams();
  const selected = params.get("session") ?? "";
  const [saved, setSaved] = useState(false);
  const client = useQueryClient();
  const sessions = useInfiniteQuery(deliverySessionsQuery(actor, scope));
  const detail = useQuery(deliverySessionQuery(actor, selected));
  const rows = sessions.data?.pages.flatMap((page) => page.items) ?? [];
  const management = Boolean(
    perms.data?.some((p) => ["courses.manage", "finance.manage"].includes(p)),
  );
  const customer = roles.data?.includes("client");
  const headers = [
    "csvTitle",
    "csvLecturer",
    "csvClaim",
    "csvSession",
    "csvScheduledStart",
    "csvScheduledEnd",
    "csvActualStart",
    "csvActualEnd",
    "csvZone",
    "csvScheduledMinutes",
    "csvActualMinutes",
    "csvStatus",
    "csvOutcome",
    "csvRevision",
    "csvCustomerConfirmed",
  ].map((key) => t(key));
  return (
    <>
      <PageHeading
        eyebrow="Luminovia Portal"
        title={t("title")}
        description={t("description")}
        action={<ClipboardCheck aria-hidden="true" />}
      />
      <div className="delivery-toolbar">
        <Field id="delivery-scope" label={t("scope")}>
          <select
            id="delivery-scope"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value as DeliveryScope);
              setParams({});
              setSaved(false);
            }}
          >
            <option value="own">{t("own")}</option>
            {management && (
              <option value="management">{t("management")}</option>
            )}
            {customer && <option value="customer">{t("customer")}</option>}
          </select>
        </Field>
        <Button
          variant="secondary"
          onClick={() => {
            setSaved(false);
            void client.invalidateQueries({
              queryKey: deliveryKeys.all(actor),
            });
          }}
        >
          {t("refresh")}
        </Button>
        <Button
          variant="secondary"
          disabled={!rows.length}
          onClick={() =>
            downloadCsv(
              `luminovia-delivery-${i18n.language}.csv`,
              deliveryCsvRows(rows, headers),
            )
          }
        >
          <Download size={18} aria-hidden="true" />
          {t("export")}
        </Button>
      </div>
      <p className="delivery-hint">{t("exportHint")}</p>
      {saved && <Notice>{t("saved")}</Notice>}
      <div className="delivery-grid">
        <div className="delivery-list">
          {sessions.isPending ? (
            <Loading />
          ) : sessions.isError ? (
            <ErrorState retry={() => void sessions.refetch()} />
          ) : !rows.length ? (
            <p>{t("empty")}</p>
          ) : (
            rows.map((row) => (
              <article
                key={row.session_id}
                className="delivery-card"
                data-selected={selected === row.session_id}
              >
                <h2>{row.title}</h2>
                <p>
                  {row.lecturer_name} ·{" "}
                  {dateTime(row.scheduled_start, i18n.language, row.time_zone)}
                </p>
                <p>{t(row.status)}</p>
                <Button
                  variant="secondary"
                  aria-expanded={selected === row.session_id}
                  onClick={() => {
                    setParams({ session: row.session_id });
                    setSaved(false);
                  }}
                >
                  {t("details")}
                </Button>
              </article>
            ))
          )}
          {sessions.hasNextPage && (
            <Button
              variant="secondary"
              disabled={sessions.isFetchingNextPage}
              onClick={() => void sessions.fetchNextPage()}
            >
              {t("more")}
            </Button>
          )}
        </div>
        <div>
          {selected &&
            (detail.isPending ? (
              <Loading />
            ) : detail.isError ? (
              <ErrorState retry={() => void detail.refetch()} />
            ) : (
              <DeliveryDetail
                key={`${detail.data.session_id}:${detail.data.version}`}
                row={detail.data}
                actor={actor}
                onSaved={() => setSaved(true)}
              />
            ))}
        </div>
      </div>
    </>
  );
}
