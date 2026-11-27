/** Review a proposed wall-clock schedule before replacing editable course draft sessions. */
import { useId, useState } from "react";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { resolveScheduleWindow } from "../../lib/dates";
import {
  teachingSchedule,
  teachingWeekdays,
  type LocalTeachingSession,
  type TeachingWeekday,
  type TeachingWindow,
} from "./schedule";
import "./course-plan-i18n";
import "./course-plan.css";

type Mode = "count" | "range" | "dates";

export function CourseSchedulePlanner({
  zone,
  suggestedDays,
  editedSessionCount,
  disabled,
  onApply,
}: {
  zone: string;
  suggestedDays?: number;
  editedSessionCount: number;
  disabled: boolean;
  onApply: (rows: LocalTeachingSession[]) => void;
}) {
  const { t, i18n } = useTranslation("coursePlan");
  const id = useId();
  const [mode, setMode] = useState<Mode>("count");
  const [firstDay, setFirstDay] = useState("");
  const [lastDay, setLastDay] = useState("");
  const [daysInput, setDaysInput] = useState<string>();
  const days = daysInput ?? String(suggestedDays ?? 1);
  const [dates, setDates] = useState("");
  const [start, setStart] = useState("09:00");
  const [end, setEnd] = useState("17:00");
  const [everyWeeks, setEveryWeeks] = useState("1");
  const [excludedDates, setExcludedDates] = useState("");
  const [selection, setSelection] = useState<TeachingWeekday[]>([
    1, 2, 3, 4, 5,
  ]);
  const [custom, setCustom] = useState<
    Partial<Record<TeachingWeekday, TeachingWindow[]>>
  >({});
  const [preview, setPreview] = useState<{
    rows: LocalTeachingSession[];
    zone: string;
  } | null>(null);
  const [error, setError] = useState(false);
  const reviewed = preview?.zone === zone ? preview.rows : null;
  const weekday = (day: TeachingWeekday) =>
    DateTime.utc(2025, 1, 6)
      .plus({ days: day - 1 })
      .setLocale(i18n.language)
      .toFormat("cccc");

  function generate() {
    const defaults = { start, end };
    const weekdays = Object.fromEntries(
      selection.map((day) => [day, custom[day] ?? [defaults]]),
    );
    const shared = { defaults, weekdays, excludedDates };
    try {
      const rows = teachingSchedule(
        mode === "dates"
          ? { ...shared, kind: mode, dates }
          : mode === "range"
            ? {
                ...shared,
                kind: mode,
                firstDay,
                lastDay,
                everyWeeks: Number(everyWeeks),
              }
            : {
                ...shared,
                kind: mode,
                firstDay,
                days: Number(days),
                everyWeeks: Number(everyWeeks),
              },
      );
      if (
        rows.some((row) => !resolveScheduleWindow({ ...row, time_zone: zone }))
      ) {
        throw new Error("invalid_schedule");
      }
      setPreview({ rows, zone });
      setError(false);
    } catch {
      setPreview(null);
      setError(true);
    }
  }

  return (
    <details
      className="operations-schedule-planner"
      open={suggestedDays !== undefined || undefined}
    >
      <summary>{t("schedulePlanner")}</summary>
      <div
        className="course-planner-fields"
        onChange={() => {
          setPreview(null);
          setError(false);
        }}
      >
        <div className="form-row">
          <Field id={`${id}-mode`} label={t("scheduleMode")}>
            <select
              id={`${id}-mode`}
              value={mode}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              <option value="count">{t("scheduleByCount")}</option>
              <option value="range">{t("scheduleByRange")}</option>
              <option value="dates">{t("scheduleByDates")}</option>
            </select>
          </Field>
          {mode === "dates" ? (
            <Field
              id={`${id}-dates`}
              label={t("scheduleByDates")}
              hint={t("scheduleDatesHint")}
            >
              <textarea
                id={`${id}-dates`}
                rows={2}
                value={dates}
                onChange={(e) => setDates(e.target.value)}
              />
            </Field>
          ) : (
            <>
              <Field id={`${id}-first`} label={t("firstDate")}>
                <input
                  id={`${id}-first`}
                  type="date"
                  value={firstDay}
                  onChange={(e) => setFirstDay(e.target.value)}
                />
              </Field>
              {mode === "count" ? (
                <Field id={`${id}-days`} label={t("scheduleByCount")}>
                  <input
                    id={`${id}-days`}
                    type="number"
                    min={1}
                    max={60}
                    value={days}
                    onChange={(e) => setDaysInput(e.target.value)}
                  />
                </Field>
              ) : (
                <Field id={`${id}-last`} label={t("scheduleLastDate")}>
                  <input
                    id={`${id}-last`}
                    type="date"
                    value={lastDay}
                    onChange={(e) => setLastDay(e.target.value)}
                  />
                </Field>
              )}
            </>
          )}
        </div>
        <div className="form-row">
          <Field id={`${id}-start`} label={t("dailyStart")}>
            <input
              id={`${id}-start`}
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field id={`${id}-end`} label={t("dailyEnd")}>
            <input
              id={`${id}-end`}
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </Field>
        </div>
        <details className="course-planner-advanced">
          <summary>{t("scheduleAdvanced")}</summary>
          {mode !== "dates" && (
            <Field id={`${id}-repeat`} label={t("scheduleRepeatWeeks")}>
              <select
                id={`${id}-repeat`}
                value={everyWeeks}
                onChange={(e) => setEveryWeeks(e.target.value)}
              >
                {[1, 2, 3, 4].map((week) => (
                  <option key={week} value={week}>
                    {week}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field
            id={`${id}-exclude`}
            label={t("scheduleExcludedDates")}
            hint={t("scheduleDatesHint")}
          >
            <textarea
              id={`${id}-exclude`}
              rows={2}
              value={excludedDates}
              onChange={(e) => setExcludedDates(e.target.value)}
            />
          </Field>
          <fieldset className="course-planner-weekdays">
            <legend>{t("scheduleWeekdays")}</legend>
            {teachingWeekdays.map((day) => (
              <label key={day} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={selection.includes(day)}
                  onChange={(e) => {
                    setSelection((current) =>
                      e.target.checked
                        ? [...current, day]
                        : current.filter((entry) => entry !== day),
                    );
                  }}
                />
                {weekday(day)}
              </label>
            ))}
          </fieldset>
          {selection
            .slice()
            .sort((a, b) => a - b)
            .map((day) => (
              <details key={day} className="course-planner-day">
                <summary>
                  {weekday(day)} ·{" "}
                  {t(custom[day] ? "scheduleCustom" : "scheduleDefaultHours")}
                </summary>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setPreview(null);
                    setCustom((current) => ({
                      ...current,
                      [day]: current[day] ? undefined : [{ start, end }],
                    }));
                  }}
                >
                  {t(custom[day] ? "scheduleResetHours" : "scheduleCustom")}
                </Button>
                {custom[day]?.map((slot, index) => (
                  <div className="session-form-row" key={index}>
                    {(["start", "end"] as const).map((endpoint) => (
                      <Field
                        key={endpoint}
                        id={`${id}-${day}-${index}-${endpoint}`}
                        label={`${t(endpoint)} ${index + 1}`}
                      >
                        <input
                          id={`${id}-${day}-${index}-${endpoint}`}
                          type="time"
                          value={slot[endpoint]}
                          onChange={(e) => {
                            const value = e.target.value;
                            setCustom((current) => ({
                              ...current,
                              [day]: current[day]?.map((row, i) =>
                                i === index
                                  ? { ...row, [endpoint]: value }
                                  : row,
                              ),
                            }));
                          }}
                        />
                      </Field>
                    ))}
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={custom[day]!.length === 1}
                      onClick={() => {
                        setPreview(null);
                        setCustom((current) => ({
                          ...current,
                          [day]: current[day]?.filter((_, i) => i !== index),
                        }));
                      }}
                    >
                      {t("remove")}
                    </Button>
                  </div>
                ))}
                {custom[day] && custom[day]!.length < 8 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setPreview(null);
                      setCustom((current) => ({
                        ...current,
                        [day]: [
                          ...(current[day] ?? []),
                          { start: "", end: "" },
                        ],
                      }));
                    }}
                  >
                    {t("addSession")}
                  </Button>
                )}
              </details>
            ))}
        </details>
      </div>
      <div className="course-planner-actions">
        <Button
          type="button"
          variant="secondary"
          disabled={disabled}
          onClick={generate}
        >
          {t("schedulePreview")}
        </Button>
      </div>
      {error && <Notice kind="error">{t("schedulePlannerInvalid")}</Notice>}
      {reviewed && (
        <section
          aria-labelledby={`${id}-review`}
          className="course-planner-review"
        >
          <h3 id={`${id}-review`} role="status">
            {t("schedulePreviewCount", { count: reviewed.length })} · {zone}
          </h3>
          <ol tabIndex={0} aria-label={t("schedulePreview")}>
            {reviewed.map((row) => (
              <li key={row.starts_at}>
                {DateTime.fromISO(row.starts_at, { zone: "UTC" })
                  .setLocale(i18n.language)
                  .toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)}
                {" · "}
                {row.starts_at.slice(11)}–{row.ends_at.slice(11)}
              </li>
            ))}
          </ol>
          {editedSessionCount > 0 && (
            <p>{t("scheduleReplaceHint", { count: editedSessionCount })}</p>
          )}
          <div className="course-planner-actions">
            <Button
              type="button"
              disabled={disabled}
              onClick={() => {
                onApply(reviewed);
                setPreview(null);
              }}
            >
              {t(editedSessionCount ? "scheduleReplace" : "scheduleApply")}
            </Button>
          </div>
        </section>
      )}
    </details>
  );
}
