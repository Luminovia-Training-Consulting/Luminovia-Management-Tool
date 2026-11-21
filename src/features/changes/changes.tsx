/** Authenticated before/after review, explicit two-party consent and draft
 * authoring for the existing job workflow. Server snapshots own permissions and
 * transitions; this screen never confirms or applies a local optimistic change. */
import { useRef, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm, useFieldArray } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import { ArrowLeft, GitCompareArrows, Plus, RefreshCw } from "lucide-react";
import { useAuth } from "../auth/auth-context";
import { dateTime, zonedInstant } from "../../lib/dates";
import { useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Dialog } from "../../components/ui/dialog";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
  TextLink,
} from "../../components/common";
import {
  changeAssignmentAction,
  changeCandidatesQuery,
  changesQuery,
  refreshAssignmentChanges,
  saveAssignmentChange,
  type AssignmentChange,
  type AssignmentSnapshot,
  type ChangeCandidate,
  type ChangeInput,
} from "./api";
import "./i18n";
import "./changes.css";
/** Keep an unchanged uncertain form/action retry on its original request UUID.
 * A changed payload receives a new identity; nothing sensitive is persisted. */
function useRequest() {
  const key = useRef<{ payload: string; id: string } | null>(null);
  return (payload: unknown) => {
    const text = JSON.stringify(payload);
    if (key.current?.payload !== text)
      key.current = { payload: text, id: crypto.randomUUID() };
    return key.current!.id;
  };
}
/** Map server denial/conflict codes to bilingual recoverable UI messages,
 * without publishing SQL details or implying that a rejected write succeeded. */
function MutationError({ error }: { error: unknown }) {
  const { t } = useTranslation("changes");
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  return (
    <Notice kind="error">
      {t(
        code === "40001"
          ? "stale"
          : code === "23P01"
            ? "conflict"
            : code === "22023"
              ? "unsupported"
              : "error",
      )}
    </Notice>
  );
}
const formSchema = z.object({
  claim: z.string().uuid(),
  reason: z.string().trim().min(5).max(2000),
  location: z.string().max(500),
  scope: z.string().max(12000),
  terms: z.string().trim().min(1).max(12000),
  amount: z.string(),
  total_amount: z.string(),
  rate_unit: z.enum([
    "per_day",
    "per_hour",
    "per_teaching_unit",
    "fixed_total",
  ]),
  cancel: z.boolean(),
  sessions: z
    .array(
      z.object({ starts_at: z.string().min(1), ends_at: z.string().min(1) }),
    )
    .min(1)
    .max(60),
});
// Customer forms deliberately contain no private terms or compensation. Their
// hidden defaults must not require invented terms merely to pass form validation.
const customerFormSchema = formSchema.extend({ terms: z.string().max(12000) });
/** Edit one captured draft snapshot. Polling does not replace reviewed fields;
 * zoned inputs become explicit instants before the server revalidates them. */
function ChangeForm({
  candidates,
  original,
  initialClaim,
  onDone,
}: {
  candidates: ChangeCandidate[];
  original?: AssignmentChange;
  initialClaim?: string;
  onDone: (id?: string) => void;
}) {
  const { t } = useTranslation("changes");
  const online = useOnline(),
    client = useQueryClient(),
    request = useRequest();
  const [invalidTime, setInvalidTime] = useState(false),
    [invalidMoney, setInvalidMoney] = useState(false);
  const [invalidLocation, setInvalidLocation] = useState(false);
  const [selected, setSelected] = useState(
    original?.claim_id ?? initialClaim ?? candidates[0]?.claim_id ?? "",
  );
  const candidate = candidates.find((item) => item.claim_id === selected);
  const source = original?.proposed ?? candidate?.current;
  const [formSource] = useState(() => source);
  const linkedCourse = Boolean(source?.course_run_id);
  const scheduleEditable =
    !linkedCourse ||
    (original?.schedule_editable ?? candidate?.schedule_editable ?? false);
  const zone = source?.time_zone ?? "Europe/Berlin";
  const customerView =
    original?.customer_view ?? candidate?.customer_view ?? false;
  const canPrice = original?.can_price ?? candidate?.can_price ?? false;
  const commissioned =
    original?.commissioned ?? candidate?.commissioned ?? false;
  const defaults = (s: AssignmentSnapshot | undefined) => ({
    claim: selected,
    reason: original?.reason ?? "",
    location: s?.location ?? "",
    scope: s?.scope ?? "",
    terms: s?.terms ?? "",
    amount: String(s?.amount ?? ""),
    total_amount: String(s?.total_amount ?? ""),
    rate_unit: s?.rate_unit ?? ("per_day" as const),
    cancel: s?.cancel ?? false,
    sessions: (s?.sessions ?? []).map((session) => ({
      starts_at: DateTime.fromISO(session.starts_at)
        .setZone(s!.time_zone)
        .toFormat("yyyy-MM-dd'T'HH:mm"),
      ends_at: DateTime.fromISO(session.ends_at)
        .setZone(s!.time_zone)
        .toFormat("yyyy-MM-dd'T'HH:mm"),
    })),
  });
  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(customerView ? customerFormSchema : formSchema),
    defaultValues: defaults(formSource),
  });
  const { fields, append, remove } = useFieldArray({
    control,
    name: "sessions",
  });
  const save = useMutation({
    mutationFn: async (values: z.infer<typeof formSchema>) => {
      setInvalidTime(false);
      setInvalidMoney(false);
      setInvalidLocation(false);
      if (
        source?.delivery_type === "online" &&
        values.location !== source.location
      ) {
        try {
          const url = new URL(values.location);
          if (url.protocol !== "https:" || url.username || url.password)
            throw new Error("invalid_location");
        } catch {
          setInvalidLocation(true);
          throw new Error("invalid_location");
        }
      }
      const changes: ChangeInput["changes"] = {
        location: values.location,
        scope: values.scope,
      };
      // Unchanged inputs retain exact instants even if the local editor
      // displays whole minutes. The server rechecks linked-course eligibility.
      if (scheduleEditable && !values.cancel) {
        const initial = defaults(formSource).sessions;
        changes.sessions = values.sessions.map((item, index) => {
          const existing = formSource?.sessions[index];
          const start =
            existing && item.starts_at === initial[index]?.starts_at
              ? existing.starts_at
              : zonedInstant(item.starts_at, zone);
          const end =
            existing && item.ends_at === initial[index]?.ends_at
              ? existing.ends_at
              : zonedInstant(item.ends_at, zone);
          if (!start || !end || Date.parse(end) <= Date.parse(start)) {
            setInvalidTime(true);
            throw new Error("time");
          }
          return { starts_at: start, ends_at: end };
        });
      }
      if (!customerView) {
        changes.terms = values.terms;
        changes.cancel = values.cancel;
      }
      if (canPrice) {
        const money = z.string().regex(/^\d{1,10}(?:[.,]\d{1,2})?$/);
        if (
          !money.safeParse(values.amount).success ||
          !money.safeParse(values.total_amount).success
        ) {
          setInvalidMoney(true);
          throw new Error("money");
        }
        changes.amount = Number(values.amount.replace(",", "."));
        changes.total_amount = Number(values.total_amount.replace(",", "."));
        changes.rate_unit = values.rate_unit;
      }
      const payload = { reason: values.reason, changes };
      return saveAssignmentChange(
        original?.id ?? null,
        values.claim,
        payload,
        original?.version ?? 0,
        request({
          claim: values.claim,
          version: original?.version ?? 0,
          payload,
        }),
      );
    },
    onSuccess: async (id) => {
      await refreshAssignmentChanges(client);
      onDone(id);
    },
  });
  return (
    <form noValidate onSubmit={handleSubmit((values) => save.mutate(values))}>
      <p className="muted">{t("scopeHint")}</p>
      <Field
        id="change-assignment"
        label={t("assignment")}
        error={Boolean(errors.claim)}
      >
        <select
          id="change-assignment"
          {...register("claim")}
          disabled={Boolean(original)}
          onChange={(event) => {
            const id = event.target.value;
            setSelected(id);
            const chosen = candidates.find((item) => item.claim_id === id);
            reset({ ...defaults(chosen?.current), claim: id });
          }}
        >
          {candidates.map((item) => (
            <option key={item.claim_id} value={item.claim_id}>
              {item.title} · {item.lecturer_name}
            </option>
          ))}
          {original && !candidate && (
            <option value={original.claim_id}>{original.original.title}</option>
          )}
        </select>
      </Field>
      <Field
        id="change-reason"
        label={t("reason")}
        error={Boolean(errors.reason)}
      >
        <textarea id="change-reason" rows={3} {...register("reason")} />
      </Field>
      <Field
        id="change-location"
        label={t("location")}
        error={Boolean(errors.location) || invalidLocation}
      >
        <input id="change-location" {...register("location")} />
      </Field>
      <Field id="change-scope" label={t("scope")} error={Boolean(errors.scope)}>
        <textarea id="change-scope" rows={4} {...register("scope")} />
      </Field>
      {!customerView && (
        <Field
          id="change-terms"
          label={t("terms")}
          error={Boolean(errors.terms)}
        >
          <textarea id="change-terms" rows={4} {...register("terms")} />
        </Field>
      )}
      {customerView && <p className="muted">{t("customerScope")}</p>}
      {commissioned && !customerView && (
        <p className="muted">{t("commissioned")}</p>
      )}
      {canPrice && (
        <fieldset className="changes-money">
          <legend>
            {t("currency")}: {source?.currency}
          </legend>
          <Field id="change-amount" label={t("amount")} error={invalidMoney}>
            <input
              id="change-amount"
              inputMode="decimal"
              {...register("amount")}
            />
          </Field>
          <Field
            id="change-total"
            label={t("total_amount")}
            error={invalidMoney}
          >
            <input
              id="change-total"
              inputMode="decimal"
              {...register("total_amount")}
            />
          </Field>
          <Field id="change-unit" label={t("rate_unit")}>
            <select
              id="change-unit"
              aria-readonly={commissioned}
              {...register("rate_unit")}
            >
              {(
                [
                  "per_day",
                  "per_hour",
                  "per_teaching_unit",
                  "fixed_total",
                ] as const
              )
                .filter((unit) => !commissioned || unit === source?.rate_unit)
                .map((unit) => (
                  <option key={unit} value={unit}>
                    {t(unit)}
                  </option>
                ))}
            </select>
          </Field>
        </fieldset>
      )}
      {!scheduleEditable ? (
        <p className="muted">{t("linkedSessions")}</p>
      ) : (
        <fieldset className="changes-sessions">
          <legend>{t("sessions")}</legend>
          <p className="muted">{t("dateHint", { zone })}</p>
          {linkedCourse && <p className="muted">{t("linkedSessionCount")}</p>}
          {fields.map((item, index) => (
            <div key={item.id} className="changes-session">
              <Field
                id={`change-start-${index}`}
                label={`${t("start")} ${index + 1}`}
                error={
                  Boolean(errors.sessions?.[index]?.starts_at) || invalidTime
                }
              >
                <input
                  type="datetime-local"
                  {...register(`sessions.${index}.starts_at`)}
                />
              </Field>
              <Field
                id={`change-end-${index}`}
                label={`${t("end")} ${index + 1}`}
                error={
                  Boolean(errors.sessions?.[index]?.ends_at) || invalidTime
                }
              >
                <input
                  type="datetime-local"
                  {...register(`sessions.${index}.ends_at`)}
                />
              </Field>
              {!linkedCourse && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={fields.length <= 1}
                  onClick={() => remove(index)}
                >
                  {t("removeSession")}
                </Button>
              )}
            </div>
          ))}
          {!linkedCourse && (
            <Button
              type="button"
              variant="secondary"
              disabled={fields.length >= 60}
              onClick={() => append({ starts_at: "", ends_at: "" })}
            >
              {t("addSession")}
            </Button>
          )}
        </fieldset>
      )}
      {!customerView && (
        <label className="checkbox-label">
          <input type="checkbox" {...register("cancel")} />
          {t("cancelCourse")}
        </label>
      )}
      {!customerView && <p className="muted">{t("cancelHint")}</p>}
      <div className="changes-controls">
        <Button disabled={!online || save.isPending || !source}>
          {t("save")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone()}>
          {t("cancel")}
        </Button>
      </div>
      {save.isError && <MutationError error={save.error} />}
    </form>
  );
}
/** Render authored comparison values as React text and format original currency
 * for display only; all financial calculations remain in PostgreSQL. */
function Value({
  snapshot,
  field,
}: {
  snapshot: AssignmentSnapshot;
  field:
    | "location"
    | "scope"
    | "terms"
    | "amount"
    | "total_amount"
    | "rate_unit"
    | "sessions"
    | "cancel";
}) {
  const { t, i18n } = useTranslation("changes");
  if (field === "sessions")
    return (
      <ol className="changes-session-summary">
        {snapshot.sessions.map((session, index) => (
          <li key={index}>
            {dateTime(session.starts_at, i18n.language, snapshot.time_zone)} —{" "}
            {dateTime(session.ends_at, i18n.language, snapshot.time_zone)}
          </li>
        ))}
      </ol>
    );
  if (field === "cancel")
    return <span>{snapshot.cancel ? t("yes") : "—"}</span>;
  if (field === "amount" || field === "total_amount")
    return (
      <span>
        {snapshot[field] === null || !snapshot.currency
          ? t("notVisible")
          : new Intl.NumberFormat(i18n.language, {
              style: "currency",
              currency: snapshot.currency,
            }).format(snapshot[field])}
      </span>
    );
  if (field === "rate_unit")
    return <span>{t(snapshot.rate_unit ?? "notVisible")}</span>;
  return <span className="changes-authored">{snapshot[field] || "—"}</span>;
}
/** Submit only the displayed immutable proposal/version. Consent is explicit,
 * and rejection/withdrawal require a reason before calling the server. */
function DetailActions({ change }: { change: AssignmentChange }) {
  const { t } = useTranslation("changes");
  const online = useOnline(),
    client = useQueryClient(),
    request = useRequest();
  const [note, setNote] = useState(""),
    [consent, setConsent] = useState(false);
  const mutation = useMutation({
    mutationFn: (
      action: "submit" | "accept" | "reject" | "withdraw" | "apply",
    ) =>
      changeAssignmentAction(
        change.id,
        action,
        change.version,
        note,
        request({ action, version: change.version, note }),
      ),
    onSuccess: () => refreshAssignmentChanges(client),
  });
  const disabled = !online || mutation.isPending;
  return (
    <section className="panel changes-decisions">
      <p>
        {t("managerApproval")}:{" "}
        <strong>{t(change.manager_approved ? "yes" : "no")}</strong> ·{" "}
        {t("lecturerApproval")}:{" "}
        <strong>{t(change.lecturer_approved ? "yes" : "no")}</strong>
      </p>
      {change.can_respond && (
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          {t("consent")}
        </label>
      )}
      {(change.can_respond || change.can_withdraw) && (
        <Field id="change-decision-note" label={t("note")}>
          <textarea
            id="change-decision-note"
            rows={2}
            maxLength={2000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      )}
      <div className="changes-controls">
        {change.can_submit && (
          <Button disabled={disabled} onClick={() => mutation.mutate("submit")}>
            {t("submit")}
          </Button>
        )}
        {change.can_respond && (
          <>
            <Button
              disabled={disabled || !consent}
              onClick={() => mutation.mutate("accept")}
            >
              {t("accept")}
            </Button>
            <Button
              variant="danger"
              disabled={disabled || note.trim().length < 5}
              onClick={() => mutation.mutate("reject")}
            >
              {t("reject")}
            </Button>
          </>
        )}
        {change.can_withdraw && (
          <Button
            variant="ghost"
            disabled={disabled || note.trim().length < 5}
            onClick={() => mutation.mutate("withdraw")}
          >
            {t("withdraw")}
          </Button>
        )}
        {change.can_apply && (
          <Button disabled={disabled} onClick={() => mutation.mutate("apply")}>
            {t("apply")}
          </Button>
        )}
      </div>
      {mutation.isError && <MutationError error={mutation.error} />}{" "}
      {mutation.isSuccess && <Notice>{t("saved")}</Notice>}
      <p className="muted">{t("amendmentHint")}</p>
    </section>
  );
}
/** Route owner for scoped list/detail and modal drafts. Any failed permission
 * refresh hides retained records; query state remains actor-scoped and online. */
export function ChangeRequestsPage() {
  const { t, i18n } = useTranslation("changes"),
    { session } = useAuth(),
    { id } = useParams<{ id: string }>(),
    [params] = useSearchParams(),
    navigate = useNavigate(),
    online = useOnline();
  const changes = useQuery(changesQuery(session!.user.id, id)),
    candidates = useQuery(changeCandidatesQuery(session!.user.id));
  const [edit, setEdit] = useState<AssignmentChange | null | undefined>();
  if (changes.isError || candidates.isError)
    return (
      <ErrorState
        retry={() => {
          void changes.refetch();
          void candidates.refetch();
        }}
      />
    );
  if (changes.isPending || candidates.isPending) return <Loading />;
  const selected = id ? changes.data[0] : undefined;
  if (id && !selected) return <ErrorState />;
  return (
    <>
      <PageHeading
        title={selected?.original.title ?? t("title")}
        description={t("intro")}
        action={
          <div className="changes-controls">
            <Button
              variant="secondary"
              disabled={!online || changes.isFetching}
              onClick={() => {
                void changes.refetch();
                void candidates.refetch();
              }}
            >
              <RefreshCw size={17} aria-hidden="true" />
              {t("refresh")}
            </Button>
            {!id && (
              <Button
                disabled={!online || !candidates.data.length}
                onClick={() => setEdit(null)}
              >
                <Plus size={17} aria-hidden="true" />
                {t("new")}
              </Button>
            )}
          </div>
        }
      />
      <p className="muted">{t("scopeHint")}</p>
      {!online && <Notice kind="error">{t("offline")}</Notice>}
      {selected ? (
        <>
          <Link to="/changes" className="text-link">
            <ArrowLeft size={16} aria-hidden="true" />
            {t("overview")}
          </Link>
          <section className="panel changes-summary">
            <span className={`badge changes-status-${selected.status}`}>
              {t(selected.status)}
            </span>
            <p className="changes-authored">{selected.reason}</p>
            <TextLink to={`/jobs/${selected.original.job_id}`}>
              {t("source")}
            </TextLink>
            {selected.can_edit && (
              <Button
                variant="secondary"
                disabled={!online}
                onClick={() => setEdit(selected)}
              >
                {t("edit")}
              </Button>
            )}
          </section>
          <section className="panel" aria-label={t("comparison")}>
            <h2>{t("comparison")}</h2>
            <div className="changes-comparison">
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t("field")}</th>
                    <th scope="col">{t("original")}</th>
                    <th scope="col">{t("proposed")}</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      "sessions",
                      "location",
                      "scope",
                      "terms",
                      "amount",
                      "total_amount",
                      "rate_unit",
                      "cancel",
                    ] as const
                  )
                    .filter(
                      (field) =>
                        !selected.customer_view ||
                        ["sessions", "location", "scope"].includes(field),
                    )
                    .map((field) => (
                      <tr key={field}>
                        <th scope="row">
                          {t(field === "cancel" ? "cancelCourse" : field)}
                        </th>
                        <td>
                          <Value snapshot={selected.original} field={field} />
                        </td>
                        <td>
                          <Value snapshot={selected.proposed} field={field} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
          <DetailActions
            key={`${selected.id}:${selected.version}`}
            change={selected}
          />
          <section className="panel changes-history">
            <h2>{t("history")}</h2>
            <ol>
              {selected.events.map((event, index) => (
                <li key={index}>
                  <strong>{t(`action_${event.action}`)}</strong> ·{" "}
                  {event.actor_name}
                  <small>
                    {dateTime(
                      event.created_at,
                      i18n.language,
                      selected.original.time_zone,
                    )}
                  </small>
                  {event.note && (
                    <p className="changes-authored">{event.note}</p>
                  )}
                </li>
              ))}
            </ol>
          </section>
        </>
      ) : (
        <>
          <div className="changes-cards">
            {changes.data.map((change) => (
              <article className="panel" key={change.id}>
                <div className="section-heading">
                  <GitCompareArrows className="blue" aria-hidden="true" />
                  <span className={`badge changes-status-${change.status}`}>
                    {t(change.status)}
                  </span>
                </div>
                <h2>
                  <Link to={`/changes/${change.id}`}>
                    {change.original.title}
                  </Link>
                </h2>
                <p className="changes-authored">{change.reason}</p>
                <TextLink to={`/changes/${change.id}`}>{t("open")}</TextLink>
              </article>
            ))}
          </div>
          {!changes.data.length && (
            <section className="panel">
              <p>{t("empty")}</p>
              {!candidates.data.length && (
                <p className="muted">{t("noAssignments")}</p>
              )}
            </section>
          )}
        </>
      )}
      <Dialog
        open={edit !== undefined}
        onOpenChange={(open) => {
          if (!open) setEdit(undefined);
        }}
        title={t(edit ? "edit" : "new")}
        description={t("intro")}
      >
        {edit !== undefined && (
          <ChangeForm
            candidates={candidates.data}
            original={edit ?? undefined}
            initialClaim={params.get("claim") ?? undefined}
            onDone={(change) => {
              setEdit(undefined);
              if (change) void navigate(`/changes/${change}`);
            }}
          />
        )}
      </Dialog>
    </>
  );
}
/** Existing job details call this with an authorised claim identifier. It links
 * to the same persisted amendments rather than creating a second workflow. */
export function AssignmentAmendments({
  actor,
  claimId,
}: {
  actor: string;
  claimId: string;
}) {
  const { t } = useTranslation("changes");
  const changes = useQuery(changesQuery(actor));
  if (changes.isError)
    return <ErrorState retry={() => void changes.refetch()} />;
  if (changes.isPending) return <Loading />;
  const relevant = changes.data.filter((change) => change.claim_id === claimId);
  return (
    <section className="panel changes-linked">
      <h2>{t("title")}</h2>
      {relevant.map((change) => (
        <p key={change.id}>
          <Link to={`/changes/${change.id}`}>
            {t(change.status)} · {change.reason}
          </Link>
        </p>
      ))}
      <TextLink to={`/changes?claim=${claimId}`}>{t("new")}</TextLink>
    </section>
  );
}
