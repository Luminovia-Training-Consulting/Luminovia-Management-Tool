/** Staff schedule and review the existing assignment lifecycle, including a time-limited private audience. */
import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { dateTime, zonedInstant } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { useRequestKey } from "../../lib/request-key";
import { db } from "../../lib/supabase";
import { refreshJobState } from "./lifecycle-api";
import "../operations/course-plan.css";
import "./job-publication-i18n";

const audienceSchema = z.enum(["marketplace", "selected", "priority"]);
const personSchema = z.object({ id: z.uuid(), name: z.string() });
const planSchema = z.object({
  version: z.number().int().positive(),
  time_zone: z.string(),
  can_schedule: z.boolean(),
  state: z
    .enum([
      "scheduled",
      "active",
      "released",
      "expired",
      "cancelled",
      "blocked",
    ])
    .nullable(),
  audience: audienceSchema.nullable(),
  opens_at: z.iso.datetime({ offset: true }).nullable(),
  selection_ends_at: z.iso.datetime({ offset: true }).nullable(),
  invitees: z.array(
    personSchema.extend({
      status: z.enum([
        "accepted",
        "cancelled",
        "expired",
        "scheduled",
        "available",
      ]),
    }),
  ),
});
type Audience = z.infer<typeof audienceSchema>;
type Person = z.infer<typeof personSchema>;
type Schedule = {
  audience: Audience;
  opens_at: string | null;
  selection_ends_at: string | null;
  lecturer_ids: string[];
};
type Action =
  | { kind: "schedule"; payload: Schedule }
  | { kind: "cancel"; payload: Record<string, never> }
  | { kind: "cancel_invitation"; payload: { lecturer_id: string } };

export function JobPublicationWindow({
  actor,
  job,
}: {
  actor: string;
  job: string;
}) {
  const { t, i18n } = useTranslation("jobPublication");
  const client = useQueryClient();
  const online = useOnline();
  const request = useRequestKey();
  const [open, setOpen] = useState(false);
  const key = ["job-publication-plan", actor, job];
  const read = useQuery({
    queryKey: key,
    enabled: open && online,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("job_publication_plan", { p_job_id: job })
        .abortSignal(signal);
      if (error) throw error;
      return planSchema.parse(data);
    },
  });
  const change = useMutation({
    mutationFn: async ({
      action,
      version,
    }: {
      action: Action;
      version: number;
    }) => {
      requireOnline();
      const { data, error } = await db().rpc("job_publication_action", {
        p_job_id: job,
        p_action: action.kind,
        p_expected_version: version,
        p_request_id: request.forInput(JSON.stringify([job, version, action])),
        p_payload: action.payload,
      });
      if (error) throw error;
      return planSchema.parse(data);
    },
    onSuccess: (receipt) => {
      request.clear();
      client.setQueryData(key, receipt);
      void refreshJobState(client);
    },
  });
  const plan = read.data;
  const stale = z
    .object({ code: z.literal("40001") })
    .safeParse(change.error).success;
  const disabled = !online || change.isPending || stale;
  const display = (instant: string, zone: string) =>
    dateTime(instant, i18n.language, zone);
  const start = (action: Action) => {
    if (plan && !disabled) change.mutate({ action, version: plan.version });
  };
  return (
    <details
      className="operations-schedule-planner"
      id="planned-publication"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>{t("heading")}</summary>
      {open &&
        (!online && !plan ? (
          <Notice>{t("failed")}</Notice>
        ) : read.isPending ? (
          <Loading />
        ) : read.isError ? (
          <ErrorState retry={() => void read.refetch()} />
        ) : (
          plan && (
            <div className="course-planner-fields">
              {plan.state && (
                <section className="course-planner-fields">
                  <strong>{t(plan.state)}</strong>
                  {plan.audience && <span>{t(plan.audience)}</span>}
                  {plan.opens_at && (
                    <span>{display(plan.opens_at, plan.time_zone)}</span>
                  )}
                  {plan.selection_ends_at && (
                    <span>
                      {display(plan.selection_ends_at, plan.time_zone)}
                    </span>
                  )}
                  {!!plan.invitees.length && (
                    <ul className="session-list">
                      {plan.invitees.map((invitee) => (
                        <li key={invitee.id}>
                          <span>
                            {invitee.name} · {t(invitee.status)}
                          </span>
                          {(invitee.status === "available" ||
                            invitee.status === "scheduled") && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={disabled}
                              onClick={() =>
                                start({
                                  kind: "cancel_invitation",
                                  payload: { lecturer_id: invitee.id },
                                })
                              }
                            >
                              {t("cancelInvite")}
                            </Button>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {(plan.state === "scheduled" ||
                    (plan.state === "active" && plan.can_schedule)) && (
                    <div className="form-actions">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={disabled}
                        onClick={() => start({ kind: "cancel", payload: {} })}
                      >
                        {t("cancelPlan")}
                      </Button>
                    </div>
                  )}
                </section>
              )}
              {plan.can_schedule &&
                plan.state !== "scheduled" &&
                plan.state !== "active" && (
                  <PublicationForm
                    key={plan.version}
                    actor={actor}
                    job={job}
                    zone={plan.time_zone}
                    disabled={disabled}
                    submit={(payload) => start({ kind: "schedule", payload })}
                  />
                )}
              {change.isSuccess && <Notice kind="success">{t("saved")}</Notice>}
              {change.isError && (
                <Notice kind="error">{t(stale ? "stale" : "failed")}</Notice>
              )}
              {stale && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    void read.refetch().then((result) => {
                      if (result.isSuccess) change.reset();
                    })
                  }
                >
                  {t("reload")}
                </Button>
              )}
            </div>
          )
        ))}
    </details>
  );
}

function PublicationForm({
  actor,
  job,
  zone,
  disabled,
  submit,
}: {
  actor: string;
  job: string;
  zone: string;
  disabled: boolean;
  submit: (result: Schedule) => void;
}) {
  const { t, i18n } = useTranslation("jobPublication");
  const id = useId();
  const online = useOnline();
  const [audience, setAudience] = useState<Audience>("marketplace");
  const [future, setFuture] = useState(false);
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState("");
  const [invitees, setInvitees] = useState<Person[]>([]);
  const [review, setReview] = useState<Schedule>();
  const [invalid, setInvalid] = useState(false);
  const restricted = audience !== "marketplace";
  const candidates = useQuery({
    queryKey: ["job-publication-candidates", actor, job, search],
    enabled: restricted && online,
    retry: false,
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("job_publication_candidates", { p_job_id: job, p_search: search })
        .abortSignal(signal);
      if (error) throw error;
      return z.array(personSchema).parse(data);
    },
  });
  const selected = candidates.data?.find((person) => person.id === chosen);

  function prepare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const opens = future
      ? zonedInstant(String(fields.get("opens")), zone)
      : null;
    const ends = restricted
      ? zonedInstant(String(fields.get("ends")), zone)
      : null;
    if (
      (future && !opens) ||
      (restricted && (!ends || !invitees.length)) ||
      (opens && ends && opens >= ends)
    ) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setReview({
      audience,
      opens_at: opens,
      selection_ends_at: ends,
      lecturer_ids: restricted ? invitees.map(({ id: person }) => person) : [],
    });
  }
  return (
    <form className="course-planner-fields" onSubmit={prepare}>
      <p className="muted">{t("help")}</p>
      <fieldset disabled={disabled || Boolean(review)}>
        <div className="form-row">
          <Field id={`${id}-audience`} label={t("audience")}>
            <select
              id={`${id}-audience`}
              value={audience}
              onChange={(event) =>
                setAudience(audienceSchema.parse(event.target.value))
              }
            >
              {audienceSchema.options.map((value) => (
                <option value={value} key={value}>
                  {t(value)}
                </option>
              ))}
            </select>
          </Field>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={future}
              onChange={(event) => setFuture(event.target.checked)}
            />
            {t("scheduleLater")}
          </label>
        </div>
        {(future || restricted) && (
          <p className="muted">{t("zone", { zone })}</p>
        )}
        <div className="form-row">
          {future && (
            <Field id={`${id}-opens`} label={t("publishAt")}>
              <input
                type="datetime-local"
                id={`${id}-opens`}
                name="opens"
                required
              />
            </Field>
          )}
          {restricted && (
            <Field
              id={`${id}-ends`}
              label={t(
                audience === "priority" ? "priorityUntil" : "selectedUntil",
              )}
            >
              <input
                type="datetime-local"
                id={`${id}-ends`}
                name="ends"
                required
              />
            </Field>
          )}
        </div>
        {restricted && (
          <fieldset>
            <legend>{t("selectedLecturers")}</legend>
            <Field id={`${id}-search`} label={t("search")}>
              <input
                type="search"
                id={`${id}-search`}
                value={search}
                maxLength={120}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setChosen("");
                }}
              />
            </Field>
            {candidates.isPending ? (
              <Loading />
            ) : candidates.isError ? (
              <ErrorState retry={() => void candidates.refetch()} />
            ) : !candidates.data.length ? (
              <p className="muted">{t("noCandidates")}</p>
            ) : (
              <div className="form-row">
                <Field id={`${id}-choose`} label={t("choose")}>
                  <select
                    id={`${id}-choose`}
                    value={chosen}
                    onChange={(event) => setChosen(event.target.value)}
                  >
                    <option value="">{t("choose")}</option>
                    {candidates.data
                      .filter(
                        (person) =>
                          !invitees.some((item) => item.id === person.id),
                      )
                      .map((person) => (
                        <option value={person.id} key={person.id}>
                          {person.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <div className="form-actions">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!selected || invitees.length >= 40}
                    onClick={() => {
                      if (selected) setInvitees([...invitees, selected]);
                      setChosen("");
                    }}
                  >
                    {t("add")}
                  </Button>
                </div>
              </div>
            )}
            {!!invitees.length && (
              <ul className="session-list">
                {invitees.map((person) => (
                  <li key={person.id}>
                    <span>{person.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setInvitees(
                          invitees.filter(
                            ({ id: personId }) => personId !== person.id,
                          ),
                        )
                      }
                    >
                      {t("remove", { name: person.name })}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        )}
      </fieldset>
      {invalid && <Notice kind="error">{t("invalid")}</Notice>}
      {review ? (
        <section className="course-planner-review">
          <strong>{t(review.audience)}</strong>
          <span>
            {review.opens_at
              ? dateTime(review.opens_at, i18n.language, zone)
              : t("now")}
          </span>
          <div className="form-actions">
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              onClick={() => setReview(undefined)}
            >
              {t("cancelReview")}
            </Button>
            <Button
              type="button"
              disabled={disabled}
              onClick={() => submit(review)}
            >
              {t("confirm")}
            </Button>
          </div>
        </section>
      ) : (
        <div className="form-actions">
          <Button type="submit" disabled={disabled}>
            {t("review")}
          </Button>
        </div>
      )}
    </form>
  );
}
