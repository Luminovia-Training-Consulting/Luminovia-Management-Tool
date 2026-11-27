import { lazy, Suspense, useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Field, Notice } from "../../components/common";
import { RecurrenceFields } from "../../components/recurrence-fields";
import { TimeZoneOptions } from "../../components/time-zone-options";
import { Button } from "../../components/ui/button";
import { dateTime } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { useRequestKey } from "../../lib/request-key";
import type { LocalScheduleEntry, RecurrenceRule } from "../../lib/recurrence";
import { db } from "../../lib/supabase";
import {
  courseSeriesClasses,
  courseSeriesRequest,
  courseSeriesResult,
} from "./course-series-schema";
import {
  courseSeriesSessions,
  courseSeriesWorkload,
} from "./course-series-schedule";
import "./course-series-i18n";
import { z } from "zod";

import type { OperationalPreset } from "./operational-preset-schema";

declare const __PORTAL_INTERNAL_EDITION__: boolean;
const OperationalPresetPicker = lazy(() =>
  import("./operational-presets").then(({ OperationalPresetPicker }) => ({
    default: OperationalPresetPicker,
  })),
);

type ReviewedRequest = Omit<
  z.infer<typeof courseSeriesRequest>,
  "p_request_id"
>;
const week = [1, 2, 3, 4, 5, 6, 7];
const maxRuns = 12;

export function CourseSeriesForm({
  actor,
  organisations,
  templates,
  defaultTemplate,
  defaultOrganisation = "",
  academic = false,
  canPrepareOffer = false,
  savedRuns,
  onSaved,
  onOpen,
  onBusy,
}: {
  actor: string;
  organisations: { id: string; name: string }[];
  templates: {
    id: string;
    title: string;
    owner_organisation_id?: string | null;
  }[];
  defaultTemplate?: string;
  defaultOrganisation?: string;
  academic?: boolean;
  canPrepareOffer?: boolean;
  savedRuns?: readonly string[];
  onSaved?: (runs: string[]) => void;
  onOpen?: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  const { t, i18n } = useTranslation("courseSeries");
  const instanceId = useId();
  const client = useQueryClient();
  const online = useOnline();
  const requestKey = useRequestKey();
  const [organisation, setOrganisation] = useState(defaultOrganisation);
  const [runs, setRuns] = useState(() => [
    { key: crypto.randomUUID(), firstDay: "" },
    { key: crypto.randomUUID(), firstDay: "" },
  ]);
  const [adoption, setAdoption] = useState<{
    preset: OperationalPreset;
    delivery: boolean;
  }>();
  const [deliveryOverrides, setDeliveryOverrides] = useState<
    Record<string, "online" | "onsite">
  >({});
  const [zoneEdited, setZoneEdited] = useState(false);
  const [startEdited, setStart] = useState<string>();
  const [endEdited, setEnd] = useState<string>();
  const start = startEdited ?? adoption?.preset.config.starts_at ?? "09:00";
  const end = endEdited ?? adoption?.preset.config.ends_at ?? "17:00";
  const deliveryDefault =
    adoption?.delivery && adoption.preset.config.delivery?.mode === "onsite"
      ? "onsite"
      : "online";
  const [recurrence, setRecurrence] = useState<RecurrenceRule | null>(null);
  const focusRun = useRef<string>(undefined);
  const [zone, setZone] = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin",
  );
  const [reviewed, setReviewed] = useState<ReviewedRequest>();
  const [invalid, setInvalid] = useState(false);
  const classes = useQuery({
    queryKey: ["course-series-classes", actor, organisation],
    enabled: Boolean(organisation) && online,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc(
          "course_series_classes",
          { p_organisation_id: organisation },
          { get: true },
        )
        .abortSignal(signal);
      if (error) throw error;
      return courseSeriesClasses.parse(data);
    },
  });
  const eligibleTemplates = templates.filter(
    (template) =>
      !template.owner_organisation_id ||
      template.owner_organisation_id === organisation,
  );
  const plan = useMutation({
    mutationFn: async ({
      body,
      save,
    }: {
      body: ReviewedRequest;
      save: boolean;
    }) => {
      requireOnline();
      const { data, error } = await db().rpc("plan_course_series", {
        ...body,
        p_request_id: save ? requestKey.forInput(JSON.stringify(body)) : null,
      });
      if (error) throw error;
      const response = courseSeriesResult.parse(data);
      if (
        response.conflicts.some(
          ({ run_no, session_no }) =>
            session_no > (body.p_runs[run_no - 1]?.sessions.length ?? 0),
        ) ||
        response.run_ids.length !==
          (save && response.conflicts.length === 0 ? body.p_runs.length : 0)
      )
        throw new Error("invalid_course_series_receipt");
      return response;
    },
    onMutate: () => onBusy?.(true),
    onSettled: () => onBusy?.(false),
    onSuccess: (result) => {
      if (!result.run_ids.length) return;
      onSaved?.(result.run_ids);
      void client.invalidateQueries({ queryKey: ["operations"] });
      void client.invalidateQueries({ queryKey: ["course-workspaces", actor] });
    },
  });

  const change = () => {
    setReviewed(undefined);
    setInvalid(false);
    plan.reset();
  };
  const existingDates = runs.filter(({ firstDay }) => firstDay);
  const lastDate = existingDates.reduce(
    (latest, { firstDay }) => (firstDay > latest ? firstDay : latest),
    "",
  );

  function addRepeatedDates(entries: LocalScheduleEntry[]) {
    const dates = entries
      .slice(1)
      .map(({ starts_at }) => starts_at.slice(0, 10));
    let nextDate = 0;
    const filled = runs.map((run) =>
      !run.firstDay && nextDate < dates.length
        ? { ...run, firstDay: dates[nextDate++] }
        : run,
    );
    const appended = dates
      .slice(nextDate)
      .map((firstDay) => ({ key: crypto.randomUUID(), firstDay }));
    focusRun.current =
      filled.find((run, index) => run !== runs[index])?.key ?? appended[0]?.key;
    setRuns([...filled, ...appended]);
    setRecurrence(null);
    change();
  }

  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online || plan.isPending) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "");
    const schedule = {
      days: Number(value("days")),
      start,
      end,
      weekdays: form.getAll("weekday").map(Number),
      excludedDates: value("excluded"),
      zone,
    };
    const body = courseSeriesRequest.safeParse({
      p_organisation_id: organisation,
      p_template_id: value("template"),
      p_time_zone: zone,
      p_runs: runs.map(({ key, firstDay }) => ({
        delivery_type:
          value(`${key}-delivery`) === "inherit"
            ? deliveryDefault
            : value(`${key}-delivery`),
        venue: value(`${key}-venue`).trim(),
        class_id: value(`${key}-class`) || null,
        ...(adoption
          ? {
              operational_preset: {
                id: adoption.preset.id,
                revision: adoption.preset.revision,
                apply_delivery:
                  adoption.delivery &&
                  !deliveryOverrides[key] &&
                  !value(`${key}-venue`).trim(),
              },
            }
          : {}),
        sessions: courseSeriesSessions({
          ...schedule,
          firstDay,
          days: value(`${key}-days`)
            ? Number(value(`${key}-days`))
            : schedule.days,
          start: value(`${key}-start`) || schedule.start,
          end: value(`${key}-end`) || schedule.end,
        }),
      })),
      p_request_id: null,
    });
    setInvalid(!body.success);
    if (!body.success) return;
    const { p_organisation_id, p_template_id, p_time_zone, p_runs } = body.data;
    const payload = { p_organisation_id, p_template_id, p_time_zone, p_runs };
    setReviewed(payload);
    plan.mutate({ body: payload, save: false });
  }
  const dateDisplay = new Intl.DateTimeFormat(i18n.language, {
    weekday: "short",
    timeZone: "UTC",
  });
  const id = (name: string) => `${instanceId}-${name}`;
  const results = savedRuns?.length ? savedRuns : plan.data?.run_ids;
  const workload =
    reviewed && plan.data?.conflicts.length === 0
      ? courseSeriesWorkload(reviewed.p_runs)
      : null;
  const hourFormat = new Intl.NumberFormat(i18n.language, {
    style: "unit",
    unit: "hour",
    maximumFractionDigits: 2,
  });
  if (results?.length) {
    return (
      <>
        <Notice kind="success">{t("saved")}</Notice>
        <ul className="session-list">
          {results.map((run, index) => (
            <li key={run}>
              <Link
                className="text-link"
                to={
                  academic
                    ? `/courses/${run}/workspace`
                    : `/courses?run=${encodeURIComponent(run)}`
                }
                onClick={onOpen}
              >
                {t("open", { number: index + 1 })}
              </Link>
              {!academic && canPrepareOffer && (
                <Button asChild variant="secondary">
                  <Link to={`/courses?offer=${encodeURIComponent(run)}`}>
                    {t("prepareOffer", { number: index + 1 })}
                  </Link>
                </Button>
              )}
            </li>
          ))}
        </ul>
      </>
    );
  }
  return (
    <form onChange={change} onSubmit={review}>
      <fieldset disabled={plan.isPending}>
        <Field id={id("organisation")} label={t("organisation")}>
          <select
            id={id("organisation")}
            required
            value={organisation}
            onChange={(event) => {
              setOrganisation(event.currentTarget.value);
              setAdoption(undefined);
            }}
          >
            <option value="">{t("choose")}</option>
            {organisations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </Field>
        {__PORTAL_INTERNAL_EDITION__ && !academic && organisation && (
          <Suspense fallback={null}>
            <OperationalPresetPicker
              key={organisation}
              actor={actor}
              organisation={organisation}
              applied={adoption?.preset}
              dirtyZone={zoneEdited || existingDates.length > 0}
              dirtyDelivery={Object.keys(deliveryOverrides).length > 0}
              disabled={plan.isPending}
              onApply={(preset, inheritZone, inheritDelivery) => {
                if (preset.config.time_zone && inheritZone)
                  setZone(preset.config.time_zone);
                const delivery = Boolean(
                  preset.config.delivery && inheritDelivery,
                );
                if (delivery) setDeliveryOverrides({});
                setAdoption({ preset, delivery });
                change();
              }}
              onClear={() => {
                setAdoption(undefined);
                change();
              }}
            />
          </Suspense>
        )}
        <Field id={id("template")} label={t("template")}>
          <select
            key={organisation}
            id={id("template")}
            name="template"
            required
            defaultValue={defaultTemplate ?? ""}
          >
            <option value="">{t("choose")}</option>
            {eligibleTemplates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.title}
              </option>
            ))}
          </select>
        </Field>
        <div className="form-row">
          <Field id={id("zone")} label={t("zone")}>
            <select
              id={id("zone")}
              required
              value={zone}
              onChange={(event) => {
                setZoneEdited(true);
                setZone(event.currentTarget.value);
              }}
            >
              <TimeZoneOptions current={zone} />
            </select>
          </Field>
          <Field id={id("days")} label={t("days")}>
            <input
              id={id("days")}
              name="days"
              type="number"
              min={1}
              max={60}
              defaultValue={1}
              required
            />
          </Field>
          <Field id={id("start")} label={t("start")}>
            <input
              id={id("start")}
              name="start"
              type="time"
              value={start}
              onChange={(event) => setStart(event.currentTarget.value)}
              required
            />
          </Field>
          <Field id={id("end")} label={t("end")}>
            <input
              id={id("end")}
              name="end"
              type="time"
              value={end}
              onChange={(event) => setEnd(event.currentTarget.value)}
              required
            />
          </Field>
        </div>
        <fieldset>
          <legend>{t("weekdays")}</legend>
          <div className="form-actions">
            {week.map((day) => (
              <label className="checkbox-label" key={day}>
                <input
                  type="checkbox"
                  name="weekday"
                  value={day}
                  defaultChecked={day <= 5}
                />
                {dateDisplay.format(new Date(Date.UTC(2024, 0, day)))}
              </label>
            ))}
          </div>
        </fieldset>
        <Field
          id={id("excluded")}
          label={t("exclusions")}
          hint={t("exclusionsHint")}
        >
          <textarea
            id={id("excluded")}
            name="excluded"
            maxLength={720}
            rows={2}
          />
        </Field>
        {classes.isError && <Notice kind="error">{t("classError")}</Notice>}
        {runs.map(({ key, firstDay }, index) => (
          <fieldset className="panel" key={key}>
            <legend>{t("run", { number: index + 1 })}</legend>
            <div className="form-row">
              <Field id={id(`${key}-date`)} label={t("firstDay")}>
                <input
                  id={id(`${key}-date`)}
                  type="date"
                  name={`${key}-date`}
                  required
                  value={firstDay}
                  onChange={(event) => {
                    const date = event.currentTarget.value;
                    setRuns((items) =>
                      items.map((item) =>
                        item.key === key ? { ...item, firstDay: date } : item,
                      ),
                    );
                  }}
                  ref={(input) => {
                    if (input && focusRun.current === key) {
                      focusRun.current = undefined;
                      input.focus();
                    }
                  }}
                />
              </Field>
              <Field id={id(`${key}-delivery`)} label={t("delivery")}>
                <select
                  id={id(`${key}-delivery`)}
                  name={`${key}-delivery`}
                  value={
                    deliveryOverrides[key] ??
                    (adoption?.delivery ? "inherit" : "online")
                  }
                  onChange={(event) => {
                    if (event.currentTarget.value === "inherit") {
                      setDeliveryOverrides((previous) =>
                        Object.fromEntries(
                          Object.entries(previous).filter(
                            ([runKey]) => runKey !== key,
                          ),
                        ),
                      );
                      return;
                    }
                    const explicit =
                      event.currentTarget.value === "onsite"
                        ? "onsite"
                        : "online";
                    setDeliveryOverrides((previous) => ({
                      ...previous,
                      [key]: explicit,
                    }));
                  }}
                >
                  {adoption?.delivery && (
                    <option value="inherit">
                      {i18n.language.startsWith("de")
                        ? "Aus Kundenvorlage"
                        : "From customer preset"}
                      {adoption.preset.config.delivery?.mode === "hybrid"
                        ? " · Hybrid"
                        : ""}
                    </option>
                  )}
                  <option value="online">{t("online")}</option>
                  <option value="onsite">{t("onsite")}</option>
                </select>
              </Field>
              <Field id={id(`${key}-venue`)} label={t("venue")}>
                <input
                  id={id(`${key}-venue`)}
                  name={`${key}-venue`}
                  maxLength={500}
                />
              </Field>
              <Field id={id(`${key}-class`)} label={t("class")}>
                <select
                  key={organisation}
                  id={id(`${key}-class`)}
                  name={`${key}-class`}
                >
                  <option value="">{t("noClass")}</option>
                  {classes.data?.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <details>
              <summary>{t("runScheduleOverrides")}</summary>
              <p>{t("runScheduleOverridesHelp")}</p>
              <div className="form-row">
                <Field id={id(`${key}-days`)} label={t("runTeachingDays")}>
                  <input
                    id={id(`${key}-days`)}
                    name={`${key}-days`}
                    type="number"
                    min={1}
                    max={60}
                  />
                </Field>
                <Field id={id(`${key}-start`)} label={t("runStart")}>
                  <input
                    id={id(`${key}-start`)}
                    name={`${key}-start`}
                    type="time"
                  />
                </Field>
                <Field id={id(`${key}-end`)} label={t("runEnd")}>
                  <input
                    id={id(`${key}-end`)}
                    name={`${key}-end`}
                    type="time"
                  />
                </Field>
              </div>
            </details>
            {runs.length > 2 && (
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  setRuns((items) => items.filter((item) => item.key !== key));
                  change();
                }}
              >
                {t("remove", { number: index + 1 })}
              </Button>
            )}
          </fieldset>
        ))}
        {existingDates.length < maxRuns && (
          <fieldset>
            <legend>{t("repeatStartDates")}</legend>
            <p className="muted">{t("repeatStartDatesHint")}</p>
            <RecurrenceFields
              anchor={{
                starts_at: lastDate ? `${lastDate}T${start}` : "",
                ends_at: lastDate ? `${lastDate}T${end}` : "",
              }}
              zone={zone}
              value={recurrence}
              onChange={setRecurrence}
              max={maxRuns + 1 - existingDates.length}
              onApply={addRepeatedDates}
            />
          </fieldset>
        )}
        <div className="form-actions">
          {runs.length < maxRuns && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                const key = crypto.randomUUID();
                setRuns((items) => [...items, { key, firstDay: "" }]);
                change();
              }}
            >
              {t("add")}
            </Button>
          )}
          <Button type="submit" disabled={!online}>
            {t("review")}
          </Button>
        </div>
      </fieldset>
      {invalid && <Notice kind="error">{t("invalid")}</Notice>}
      {plan.isError && <Notice kind="error">{t("error")}</Notice>}
      {reviewed && (
        <section aria-label={t("reviewed")}>
          <h3>{t("reviewed")}</h3>
          {workload && (
            <section aria-labelledby={id("workload")}>
              <h4 id={id("workload")}>{t("workload")}</h4>
              <p className="muted">{t("workloadBasis")}</p>
              <dl className="commercial-facts">
                <dt>{t("totalSessions")}</dt>
                <dd>{workload.sessions}</dd>
                <dt>{t("totalHours")}</dt>
                <dd>{hourFormat.format(workload.hours)}</dd>
                <dt>{t("simultaneousInstructors")}</dt>
                <dd>{workload.simultaneous}</dd>
                <dt>{t("openInstructorAssignments")}</dt>
                <dd>{workload.runs.length}</dd>
              </dl>
            </section>
          )}
          {reviewed.p_runs.map((run, index) => (
            <details
              key={runs[index].key}
              open={
                !plan.data ||
                Boolean(
                  plan.data.conflicts.some((item) => item.run_no === index + 1),
                )
              }
            >
              <summary>
                {t("run", { number: index + 1 })} ·{" "}
                {dateTime(
                  run.sessions[0].starts_at,
                  i18n.language,
                  reviewed.p_time_zone,
                )}{" "}
                ({reviewed.p_time_zone})
                {workload &&
                  ` · ${t("runWorkload", {
                    count: workload.runs[index].sessions,
                    hours: hourFormat.format(workload.runs[index].hours),
                  })}`}
              </summary>
              <ol className="session-list">
                {run.sessions.map(({ starts_at, ends_at }, position) => {
                  const conflict = plan.data?.conflicts.find(
                    (item) =>
                      item.run_no === index + 1 &&
                      item.session_no === position + 1,
                  );
                  return (
                    <li key={starts_at}>
                      {dateTime(starts_at, i18n.language, reviewed.p_time_zone)}{" "}
                      – {dateTime(ends_at, i18n.language, reviewed.p_time_zone)}
                      {conflict && (
                        <Notice kind="error">
                          {t(`conflict_${conflict.reason}`)}
                        </Notice>
                      )}
                    </li>
                  );
                })}
              </ol>
            </details>
          ))}
          {((plan.isSuccess && plan.data.conflicts.length === 0) ||
            (plan.isError && plan.variables?.save)) && (
            <Button
              type="button"
              disabled={!online || plan.isPending}
              onClick={() => plan.mutate({ body: reviewed, save: true })}
            >
              {t("save")}
            </Button>
          )}
        </section>
      )}
    </form>
  );
}
