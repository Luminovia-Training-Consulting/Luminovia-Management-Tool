/** Preview time or date adjustments for selected editable course sessions. */
import { useId, useState } from "react";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { teachingWeekdays, type LocalTeachingSession } from "./schedule";
import "./course-plan-i18n";
import "./course-plan.css";

type Edit = { id: string; row: LocalTeachingSession };

export function CourseSessionBulkEdit({
  entries,
  zone,
  disabled,
  onApply,
}: {
  entries: Edit[];
  zone: string;
  disabled: boolean;
  onApply: (changes: Edit[]) => boolean;
}) {
  const { t, i18n } = useTranslation("coursePlan");
  const id = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [weekdayFilter, setWeekdayFilter] = useState("");
  const [firstDate, setFirstDate] = useState("");
  const [lastDate, setLastDate] = useState("");
  const [offset, setOffset] = useState("0");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [preview, setPreview] = useState<{ source: string; changes: Edit[] }>();
  const [error, setError] = useState(false);
  const eligible = entries.filter(({ row }) => row.starts_at && row.ends_at);
  const matching = eligible.filter(({ row }) => {
    const day = row.starts_at.slice(0, 10);
    return (
      (!firstDate || day >= firstDate) &&
      (!lastDate || day <= lastDate) &&
      (!weekdayFilter ||
        DateTime.fromISO(day, { zone: "UTC" }).weekday ===
          Number(weekdayFilter))
    );
  });
  const source = JSON.stringify([zone, eligible, selected, offset, start, end]);
  const changes = preview?.source === source ? preview.changes : null;

  function propose() {
    const days = Number(offset);
    if (offset === "" || !Number.isInteger(days) || Math.abs(days) > 365) {
      setPreview(undefined);
      setError(true);
      return;
    }
    const edits = eligible.flatMap((entry) => {
      if (!selected.includes(entry.id)) return [];
      const endpoints = (["starts_at", "ends_at"] as const).map(
        (key, index) => {
          const value = entry.row[key];
          const clock = (index === 0 ? start : end) || value.slice(11);
          const date = DateTime.fromISO(value.slice(0, 10), { zone: "UTC" })
            .plus({ days })
            .toISODate();
          return date ? `${date}T${clock}` : "";
        },
      );
      const [starts_at, ends_at] = endpoints;
      return starts_at === entry.row.starts_at && ends_at === entry.row.ends_at
        ? []
        : [{ id: entry.id, row: { starts_at, ends_at } }];
    });
    setError(edits.length === 0);
    setPreview(edits.length ? { source, changes: edits } : undefined);
  }

  function display(value: string) {
    return DateTime.fromISO(value, { zone: "UTC" })
      .setLocale(i18n.language)
      .toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY);
  }

  return (
    <details className="operations-schedule-planner">
      <summary>{t("bulkSchedule")}</summary>
      <div className="course-planner-fields" onChange={() => setError(false)}>
        <details className="course-planner-advanced">
          <summary>{t("bulkScheduleFilter")}</summary>
          <div className="form-row">
            <Field id={`${id}-weekday`} label={t("bulkScheduleWeekday")}>
              <select
                id={`${id}-weekday`}
                value={weekdayFilter}
                onChange={(e) => setWeekdayFilter(e.target.value)}
              >
                <option value="">{t("bulkScheduleAnyDay")}</option>
                {teachingWeekdays.map((day) => (
                  <option key={day} value={day}>
                    {DateTime.utc(2025, 1, 6)
                      .plus({ days: day - 1 })
                      .setLocale(i18n.language)
                      .toFormat("cccc")}
                  </option>
                ))}
              </select>
            </Field>
            <Field id={`${id}-from`} label={t("bulkScheduleFrom")}>
              <input
                id={`${id}-from`}
                type="date"
                value={firstDate}
                onChange={(e) => setFirstDate(e.target.value)}
              />
            </Field>
            <Field id={`${id}-through`} label={t("bulkScheduleThrough")}>
              <input
                id={`${id}-through`}
                type="date"
                value={lastDate}
                onChange={(e) => setLastDate(e.target.value)}
              />
            </Field>
          </div>
          <Button
            className="course-planner-filter-action"
            type="button"
            variant="secondary"
            size="sm"
            disabled={!matching.length}
            onClick={() => {
              setSelected(matching.map(({ id }) => id));
              setError(false);
            }}
          >
            {t("bulkScheduleSelectMatching", { count: matching.length })}
          </Button>
        </details>
        <div className="course-planner-actions">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setSelected(eligible.map((entry) => entry.id));
              setError(false);
            }}
          >
            {t("bulkScheduleAll")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setSelected([]);
              setError(false);
            }}
          >
            {t("bulkScheduleClear")}
          </Button>
        </div>
        <fieldset className="course-planner-weekdays">
          <legend>{t("bulkScheduleSelect")}</legend>
          {eligible.map(({ id: key, row }) => (
            <label key={key} className="checkbox-label">
              <input
                type="checkbox"
                checked={selected.includes(key)}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setSelected((current) =>
                    checked
                      ? [...current, key]
                      : current.filter((entry) => entry !== key),
                  );
                }}
              />
              {display(row.starts_at)}
            </label>
          ))}
        </fieldset>
        <div className="form-row">
          <Field
            id={`${id}-offset`}
            label={t("bulkScheduleOffset")}
            hint={t("bulkScheduleOffsetHint")}
          >
            <input
              id={`${id}-offset`}
              type="number"
              min={-365}
              max={365}
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
            />
          </Field>
          <Field id={`${id}-start`} label={t("bulkScheduleStart")}>
            <input
              id={`${id}-start`}
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field id={`${id}-end`} label={t("bulkScheduleEnd")}>
            <input
              id={`${id}-end`}
              type="time"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </Field>
        </div>
        <div className="course-planner-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={
              disabled || !eligible.some((entry) => selected.includes(entry.id))
            }
            onClick={propose}
          >
            {t("bulkSchedulePreview")}
          </Button>
        </div>
        {error && <Notice kind="error">{t("bulkScheduleInvalid")}</Notice>}
        {changes && (
          <section className="course-planner-review">
            <h3 role="status">
              {t("bulkScheduleCount", { count: changes.length })} · {zone}
            </h3>
            <ol aria-label={t("bulkSchedulePreview")} tabIndex={0}>
              {changes.map(({ id: key, row }) => (
                <li key={key}>
                  {display(row.starts_at)} – {display(row.ends_at)}
                </li>
              ))}
            </ol>
            <div className="course-planner-actions">
              <Button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setError(!onApply(changes));
                  setPreview(undefined);
                }}
              >
                {t("bulkScheduleApply")}
              </Button>
            </div>
          </section>
        )}
      </div>
    </details>
  );
}
