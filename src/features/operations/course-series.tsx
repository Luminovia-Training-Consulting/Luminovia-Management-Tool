import { useId, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Field, Notice } from "../../components/common";
import { TimeZoneOptions } from "../../components/time-zone-options";
import { Button } from "../../components/ui/button";
import { dateTime } from "../../lib/dates";
import { requireOnline, useOnline } from "../../lib/online";
import { useRequestKey } from "../../lib/request-key";
import { db } from "../../lib/supabase";
import {
  courseSeriesClasses,
  courseSeriesRequest,
  courseSeriesResult,
} from "./course-series-schema";
import { courseSeriesSessions } from "./course-series-schedule";
import "./course-series-i18n";
import { z } from "zod";

type ReviewedRequest = Omit<
  z.infer<typeof courseSeriesRequest>,
  "p_request_id"
>;
const week = [1, 2, 3, 4, 5, 6, 7];

export function CourseSeriesForm({
  actor,
  organisations,
  templates,
  defaultTemplate,
  defaultOrganisation = "",
  academic = false,
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
  onOpen?: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  const { t, i18n } = useTranslation("courseSeries");
  const instanceId = useId();
  const client = useQueryClient();
  const online = useOnline();
  const requestKey = useRequestKey();
  const [organisation, setOrganisation] = useState(defaultOrganisation);
  const [runKeys, setRunKeys] = useState(() => [
    crypto.randomUUID(),
    crypto.randomUUID(),
  ]);
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
      void client.invalidateQueries({ queryKey: ["operations"] });
      void client.invalidateQueries({ queryKey: ["course-workspaces", actor] });
    },
  });

  const change = () => {
    setReviewed(undefined);
    setInvalid(false);
    plan.reset();
  };
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online || plan.isPending) return;
    const form = new FormData(event.currentTarget);
    const value = (name: string) => String(form.get(name) ?? "");
    const schedule = {
      days: Number(value("days")),
      start: value("start"),
      end: value("end"),
      weekdays: form.getAll("weekday").map(Number),
      excludedDates: value("excluded"),
      zone,
    };
    const body = courseSeriesRequest.safeParse({
      p_organisation_id: organisation,
      p_template_id: value("template"),
      p_time_zone: zone,
      p_runs: runKeys.map((key) => ({
        delivery_type: value(`${key}-delivery`),
        venue: value(`${key}-venue`).trim(),
        class_id: value(`${key}-class`) || null,
        sessions: courseSeriesSessions({
          ...schedule,
          firstDay: value(`${key}-date`),
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
  const results = plan.data?.run_ids;
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
            onChange={(event) => setOrganisation(event.currentTarget.value)}
          >
            <option value="">{t("choose")}</option>
            {organisations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </Field>
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
              onChange={(event) => setZone(event.currentTarget.value)}
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
              defaultValue="09:00"
              required
            />
          </Field>
          <Field id={id("end")} label={t("end")}>
            <input
              id={id("end")}
              name="end"
              type="time"
              defaultValue="17:00"
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
        {runKeys.map((key, index) => (
          <fieldset className="panel" key={key}>
            <legend>{t("run", { number: index + 1 })}</legend>
            <div className="form-row">
              <Field id={id(`${key}-date`)} label={t("firstDay")}>
                <input
                  id={id(`${key}-date`)}
                  type="date"
                  name={`${key}-date`}
                  required
                />
              </Field>
              <Field id={id(`${key}-delivery`)} label={t("delivery")}>
                <select id={id(`${key}-delivery`)} name={`${key}-delivery`}>
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
            {runKeys.length > 2 && (
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  setRunKeys((items) => items.filter((item) => item !== key));
                  change();
                }}
              >
                {t("remove", { number: index + 1 })}
              </Button>
            )}
          </fieldset>
        ))}
        <div className="form-actions">
          {runKeys.length < 12 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setRunKeys((items) => [...items, crypto.randomUUID()]);
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
          {reviewed.p_runs.map((run, index) => (
            <details
              key={runKeys[index]}
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
