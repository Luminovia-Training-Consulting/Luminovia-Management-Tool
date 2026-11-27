import { useId, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { z } from "zod";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { dateTime } from "../../lib/dates";
import i18n from "../../lib/i18n";
import { requireOnline, useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import {
  courseSeriesPattern,
  courseSeriesResult,
} from "./course-series-schema";
import {
  courseSeriesRevisionRequest,
  courseSeriesSnapshot,
} from "./course-series-revision-schema";
import { courseSeriesSessions } from "./course-series-schedule";
import "./course-series-i18n";

const revisionMessages = {
  revisionTitle: ["Serienmuster bearbeiten", "Edit series pattern"],
  revisionViewTitle: ["Serienmuster ansehen", "View series pattern"],
  revisionReadOnly: [
    "Das Serienmuster ist schreibgeschützt.",
    "The series pattern is read-only.",
  ],
  revisionNoPattern: [
    "Für diesen Durchlauf ist kein Terminmuster gespeichert.",
    "This run has no saved pattern.",
  ],
  revisionIntro: [
    "Wähle die Entwürfe, deren Terminmuster du bearbeiten möchtest.",
    "Select the drafts whose schedule patterns you want to edit.",
  ],
  revisionSelect: [
    "Muster für Durchlauf {{number}} ändern",
    "Change pattern for run {{number}}",
  ],
  revisionProtected: [
    "Änderungen am Serienmuster sind nur für Entwürfe ohne geschützte Termine verfügbar.",
    "Series pattern changes are available for drafts without protected sessions.",
  ],
  revisionLegacy: [
    "Für diesen Durchlauf ist noch kein Terminmuster gespeichert. Gib die gewünschten Regeln ein und vergleiche die Termine in der Vorschau.",
    "This run has no saved pattern. Enter the rules you want to use and compare the sessions in the preview.",
  ],
  revisionLegacySessions: [
    "Bisherige Termine anzeigen",
    "View existing sessions",
  ],
  revisionInvalid: [
    "Prüfe in Durchlauf {{number}} den Starttag, die Uhrzeiten, die Unterrichtswoche und die Ausnahmen. Alle vorgeschlagenen Termine müssen in der Zukunft liegen und zeitlich eindeutig sein.",
    "Check the start date, times, teaching week and exclusions for run {{number}}. Every proposed session must be in the future with an unambiguous time.",
  ],
  revisionReview: ["Terminänderungen prüfen", "Review schedule changes"],
  revisionCurrent: ["Aktuelle Termine", "Current sessions"],
  revisionProposed: ["Vorgeschlagene Termine", "Proposed sessions"],
  revisionConflict: [
    "Termin {{number}} · {{reason}}",
    "Session {{number}} · {{reason}}",
  ],
  revisionError: [
    "Die Änderung konnte nicht verarbeitet werden. Lade den aktuellen Stand der Serie oder prüfe deine Eingaben erneut.",
    "The change could not be processed. Reload the current series or review your entries again.",
  ],
  revisionReload: ["Serie neu laden", "Reload series"],
  revisionSave: ["Serienänderungen speichern", "Save series changes"],
  revisionSaved: [
    "Das Serienmuster wurde gespeichert.",
    "The series pattern was saved.",
  ],
} as const;

for (const [language, index] of [
  ["de", 0],
  ["en", 1],
] as const) {
  i18n.addResourceBundle(
    language,
    "courseSeries",
    Object.fromEntries(
      Object.entries(revisionMessages).map(([key, values]) => [
        key,
        values[index],
      ]),
    ),
    true,
  );
}

type Snapshot = NonNullable<z.infer<typeof courseSeriesSnapshot>>;
type Run = Snapshot["runs"][number];
type Pattern = z.infer<typeof courseSeriesPattern>;
type Change = { id: string; pattern: Pattern; sessions: Run["sessions"] };
type Result = z.infer<typeof courseSeriesResult>;

const week = [1, 2, 3, 4, 5, 6, 7];

function weekdayNames(language: string) {
  const format = new Intl.DateTimeFormat(language, {
    weekday: "short",
    timeZone: "UTC",
  });
  return week.map((day) => format.format(Date.UTC(2024, 0, day)));
}

function readPattern(fields: FormData, runId: string) {
  return courseSeriesPattern.safeParse({
    first_day: fields.get(runId + "-first"),
    days: Number(fields.get(runId + "-days")),
    start: fields.get(runId + "-start"),
    end: fields.get(runId + "-end"),
    weekdays: fields.getAll(runId + "-weekday").map(Number),
    excluded_dates: fields.get(runId + "-exclusions"),
  });
}

function PatternFields({ run }: { run: Run }) {
  const { t, i18n } = useTranslation("courseSeries");
  const baseId = useId();
  const { id, pattern } = run;
  const names = weekdayNames(i18n.language);
  return (
    <>
      {!pattern && <p className="muted">{t("revisionLegacy")}</p>}
      <div className="form-row">
        <Field id={baseId + "-first"} label={t("firstDay")}>
          <input
            name={id + "-first"}
            type="date"
            required
            defaultValue={pattern?.first_day}
          />
        </Field>
        <Field id={baseId + "-days"} label={t("days")}>
          <input
            name={id + "-days"}
            type="number"
            min={1}
            max={60}
            required
            defaultValue={pattern?.days}
          />
        </Field>
      </div>
      <div className="form-row">
        <Field id={baseId + "-start"} label={t("start")}>
          <input
            name={id + "-start"}
            type="time"
            required
            defaultValue={pattern?.start}
          />
        </Field>
        <Field id={baseId + "-end"} label={t("end")}>
          <input
            name={id + "-end"}
            type="time"
            required
            defaultValue={pattern?.end}
          />
        </Field>
      </div>
      <fieldset>
        <legend>{t("weekdays")}</legend>
        <div className="form-actions">
          {week.map((day) => (
            <label className="checkbox-label" key={day}>
              <input
                name={id + "-weekday"}
                type="checkbox"
                value={day}
                defaultChecked={pattern?.weekdays.includes(day)}
              />{" "}
              {names[day - 1]}
            </label>
          ))}
        </div>
      </fieldset>
      <Field
        id={baseId + "-exclusions"}
        label={t("exclusions")}
        hint={t("exclusionsHint")}
      >
        <textarea
          name={id + "-exclusions"}
          rows={2}
          maxLength={720}
          defaultValue={pattern?.excluded_dates}
        />
      </Field>
    </>
  );
}

function SessionDates({
  sessions,
  zone,
  label,
}: {
  sessions: Run["sessions"];
  zone: string;
  label: string;
}) {
  const { i18n } = useTranslation("courseSeries");
  return (
    <div>
      <p>
        <strong>{label}</strong>
      </p>
      <ol className="session-list" aria-label={label}>
        {sessions.map(({ starts_at, ends_at }) => (
          <li key={starts_at}>
            <time dateTime={starts_at}>
              {dateTime(starts_at, i18n.language, zone)}
            </time>
            {" – "}
            <time dateTime={ends_at}>
              {dateTime(ends_at, i18n.language, zone)}
            </time>
          </li>
        ))}
      </ol>
    </div>
  );
}

function ReadOnlyRun({
  run,
  zone,
  number,
}: {
  run: Run;
  zone: string;
  number: number;
}) {
  const { t, i18n } = useTranslation("courseSeries");
  const names = weekdayNames(i18n.language);
  const pattern = run.pattern;
  return (
    <details>
      <summary>{t("run", { number })}</summary>
      {pattern ? (
        <dl className="commercial-facts">
          <dt>{t("firstDay")}</dt>
          <dd>{pattern.first_day}</dd>
          <dt>{t("days")}</dt>
          <dd>{pattern.days}</dd>
          <dt>{t("start")}</dt>
          <dd>{pattern.start}</dd>
          <dt>{t("end")}</dt>
          <dd>{pattern.end}</dd>
          <dt>{t("weekdays")}</dt>
          <dd>{pattern.weekdays.map((day) => names[day - 1]).join(", ")}</dd>
          <dt>{t("exclusions")}</dt>
          <dd className="preserve-text">{pattern.excluded_dates || "—"}</dd>
        </dl>
      ) : (
        <p className="muted">{t("revisionNoPattern")}</p>
      )}
      <SessionDates
        sessions={run.sessions}
        zone={zone}
        label={t("revisionCurrent")}
      />
    </details>
  );
}

function RevisionEditor({
  courseId,
  snapshot,
  reload,
  onSaved,
}: {
  courseId: string;
  snapshot: Snapshot;
  reload: () => void;
  onSaved: (runIds: string[]) => void;
}) {
  const { t } = useTranslation("courseSeries");
  const online = useOnline();
  const [selected, setSelected] = useState<string[]>([]);
  const [invalid, setInvalid] = useState<number>();
  const [review, setReview] = useState<{ changes: Change[]; result: Result }>();
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const revision = useMutation({
    mutationFn: async ({
      changes,
      confirm,
    }: {
      changes: Change[];
      confirm: boolean;
    }) => {
      requireOnline();
      const body = courseSeriesRevisionRequest.parse({
        p_course_id: courseId,
        p_revision: snapshot.revision,
        p_changes: changes,
        p_confirm: confirm,
      });
      const { data, error } = await db().rpc("revise_course_series", body);
      if (error) throw error;
      const result = courseSeriesResult.parse(data);
      const expected = confirm && !result.conflicts.length ? changes : [];
      if (
        result.run_ids.length !== expected.length ||
        result.run_ids.some((id) => !expected.some((item) => item.id === id)) ||
        new Set(result.run_ids).size !== expected.length ||
        result.conflicts.some(
          ({ run_no, session_no }) =>
            session_no > (changes[run_no - 1]?.sessions.length ?? 0),
        )
      )
        throw new Error("invalid_course_series_receipt");
      return result;
    },
    onSuccess(result, { changes, confirm }) {
      if (confirm && result.run_ids.length) {
        setReview(undefined);
        setSelected([]);
        onSaved(result.run_ids);
        return;
      }
      setReview({ changes, result });
      requestAnimationFrame(() => reviewHeading.current?.focus());
    },
  });

  const clearReview = () => {
    setReview(undefined);
    setInvalid(undefined);
    revision.reset();
  };

  const preview = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!online || revision.isPending || !selected.length) return;
    clearReview();
    const fields = new FormData(event.currentTarget);
    const changes: Change[] = [];
    for (const [index, run] of snapshot.runs.entries()) {
      if (!run.editable || !selected.includes(run.id)) continue;
      const parsed = readPattern(fields, run.id);
      if (!parsed.success) {
        setInvalid(index + 1);
        return;
      }
      const pattern = parsed.data;
      const sessions = courseSeriesSessions({
        firstDay: pattern.first_day,
        days: pattern.days,
        start: pattern.start,
        end: pattern.end,
        weekdays: pattern.weekdays,
        excludedDates: pattern.excluded_dates,
        zone: snapshot.time_zone,
      });
      if (!sessions?.length) {
        setInvalid(index + 1);
        return;
      }
      changes.push({ id: run.id, pattern, sessions });
    }
    if (changes.length) revision.mutate({ changes, confirm: false });
  };

  return (
    <>
      <p>{t("revisionIntro")}</p>
      <p className="muted">
        {t("zone")} · {snapshot.time_zone}
      </p>
      <form onSubmit={preview} onChange={clearReview}>
        {snapshot.runs.map((run, index) => {
          const checked = selected.includes(run.id);
          return (
            <fieldset key={run.id} disabled={revision.isPending}>
              <legend>{t("run", { number: index + 1 })}</legend>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!run.editable}
                  onChange={() =>
                    setSelected((ids) =>
                      checked
                        ? ids.filter((id) => id !== run.id)
                        : [...ids, run.id],
                    )
                  }
                />{" "}
                {t("revisionSelect", { number: index + 1 })}
              </label>
              {!run.editable && (
                <p className="muted">{t("revisionProtected")}</p>
              )}
              {checked && (
                <>
                  <PatternFields run={run} />
                  {!run.pattern && (
                    <details>
                      <summary>{t("revisionLegacySessions")}</summary>
                      <SessionDates
                        sessions={run.sessions}
                        zone={snapshot.time_zone}
                        label={t("revisionCurrent")}
                      />
                    </details>
                  )}
                </>
              )}
            </fieldset>
          );
        })}
        <div className="form-actions">
          <Button
            type="submit"
            disabled={!online || !selected.length || revision.isPending}
          >
            {t("review")}
          </Button>
        </div>
      </form>
      {invalid !== undefined && (
        <Notice kind="error">
          {t("revisionInvalid", { number: invalid })}
        </Notice>
      )}
      {revision.isError && (
        <>
          <Notice kind="error">{t("revisionError")}</Notice>
          <Button
            variant="secondary"
            type="button"
            disabled={!online}
            onClick={reload}
          >
            {t("revisionReload")}
          </Button>
        </>
      )}
      {review && (
        <section aria-label={t("revisionReview")}>
          <h3 tabIndex={-1} ref={reviewHeading}>
            {t("revisionReview")}
          </h3>
          {review.changes.map(({ id, sessions }, index) => {
            const runIndex = snapshot.runs.findIndex((run) => run.id === id);
            return (
              <fieldset key={id}>
                <legend>{t("run", { number: runIndex + 1 })}</legend>
                <div className="form-row">
                  <SessionDates
                    sessions={snapshot.runs[runIndex].sessions}
                    zone={snapshot.time_zone}
                    label={t("revisionCurrent")}
                  />
                  <SessionDates
                    sessions={sessions}
                    zone={snapshot.time_zone}
                    label={t("revisionProposed")}
                  />
                </div>
                {review.result.conflicts
                  .filter(({ run_no }) => run_no === index + 1)
                  .map(({ session_no, reason }) => (
                    <Notice key={session_no + reason} kind="error">
                      {t("revisionConflict", {
                        number: session_no,
                        reason: t(`conflict_${reason}`),
                      })}
                    </Notice>
                  ))}
              </fieldset>
            );
          })}
          <div className="form-actions">
            <Button
              type="button"
              disabled={
                !online ||
                revision.isPending ||
                revision.isError ||
                Boolean(review.result.conflicts.length)
              }
              onClick={() =>
                revision.mutate({ changes: review.changes, confirm: true })
              }
            >
              {t("revisionSave")}
            </Button>
          </div>
        </section>
      )}
    </>
  );
}

export default function CourseSeriesRevision({
  actor,
  courseId,
  readOnly = false,
}: {
  actor: string;
  courseId: string;
  readOnly?: boolean;
}) {
  const { t } = useTranslation("courseSeries");
  const client = useQueryClient();
  const online = useOnline();
  const [saved, setSaved] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const series = useQuery({
    queryKey: ["course-series-revision", actor, courseId],
    enabled: online,
    retry: false,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_series_for_run", { p_course_id: courseId }, { get: true })
        .abortSignal(signal);
      if (error) throw error;
      return courseSeriesSnapshot.parse(data);
    },
  });
  if (!series.isFetchedAfterMount || series.isError || !series.data)
    return null;
  const snapshot = series.data;
  const canRevise = !readOnly && snapshot.runs.some((run) => run.editable);

  return (
    <details>
      <summary>{t(canRevise ? "revisionTitle" : "revisionViewTitle")}</summary>
      {saved && <Notice kind="success">{t("revisionSaved")}</Notice>}
      {canRevise ? (
        <RevisionEditor
          key={snapshot.revision + ":" + reloadCount}
          courseId={courseId}
          snapshot={snapshot}
          reload={() => {
            void series.refetch().then((result) => {
              if (result.isSuccess) setReloadCount((count) => count + 1);
            });
          }}
          onSaved={(runIds) => {
            setSaved(true);
            void series.refetch();
            void client.invalidateQueries({ queryKey: ["operations"] });
            void client.invalidateQueries({
              queryKey: ["course-workspaces", actor],
            });
            for (const id of runIds) {
              void client.invalidateQueries({
                queryKey: ["course-workspace", actor, id],
              });
            }
          }}
        />
      ) : (
        <>
          <p className="muted">
            {t(readOnly ? "revisionReadOnly" : "revisionProtected")}
          </p>
          <p className="muted">
            {t("zone")} · {snapshot.time_zone}
          </p>
          {snapshot.runs.map((run, index) => (
            <ReadOnlyRun
              key={run.id}
              run={run}
              number={index + 1}
              zone={snapshot.time_zone}
            />
          ))}
        </>
      )}
    </details>
  );
}
