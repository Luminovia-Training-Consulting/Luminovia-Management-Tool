/** Preview time or date adjustments for selected editable course sessions. */
import { useId, useState } from "react";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { teachingWeekdays, type LocalTeachingSession } from "./schedule";
import "./course-plan-i18n";
import "./course-plan.css";

type Edit<Row = LocalTeachingSession> = { id: string; row: Row };

export function CourseSessionBulkEdit<Row extends LocalTeachingSession>({
  entries,
  zone,
  disabled,
  canApply,
  onApply,
}: {
  entries: Edit<Row>[];
  zone: string;
  disabled: boolean;
  canApply: (rows: Row[]) => boolean;
  onApply: (changes: Edit[], rows: Row[]) => void;
}) {
  const { t, i18n } = useTranslation("coursePlan");
  const id = useId();
  const [open, setOpen] = useState(false);
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
  const visibleSessions = open ? eligible : [];
  const selectedIds = new Set(selected);
  const selectedCount = visibleSessions.filter(({ id }) =>
    selectedIds.has(id),
  ).length;
  const matching = visibleSessions.filter(({ row }) => {
    const day = row.starts_at.slice(0, 10);
    return (
      (!firstDate || day >= firstDate) &&
      (!lastDate || day <= lastDate) &&
      (!weekdayFilter ||
        DateTime.fromISO(day, { zone: "UTC" }).weekday ===
          Number(weekdayFilter))
    );
  });
  const previewSource = () =>
    JSON.stringify([zone, entries, selected, offset, start, end]);
  const changes =
    open && preview && preview.source === previewSource()
      ? preview.changes
      : null;

  function withChanges(changes: Edit[]) {
    const edits = new Map(changes.map(({ id, row }) => [id, row]));
    return entries.map(({ id, row }) => ({ ...row, ...edits.get(id) }));
  }

  function propose() {
    const days = Number(offset);
    if (offset === "" || !Number.isInteger(days) || Math.abs(days) > 365) {
      setPreview(undefined);
      setError(true);
      return;
    }
    const edits = eligible.flatMap((entry) => {
      if (!selectedIds.has(entry.id)) return [];
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
    const valid = edits.length > 0 && canApply(withChanges(edits));
    setError(!valid);
    setPreview(valid ? { source: previewSource(), changes: edits } : undefined);
  }

  function display(value: string) {
    return DateTime.fromISO(value, { zone: "UTC" })
      .setLocale(i18n.language)
      .toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY);
  }

  if (eligible.length === 0) return null;

  return (
    <details
      className="operations-schedule-planner"
      onToggle={(event) => {
        if (event.target === event.currentTarget)
          setOpen(event.currentTarget.open);
      }}
    >
      <summary>{t("bulkSchedule")}</summary>
      <div className="course-planner-fields" onChange={() => setError(false)}>
        <details className="course-planner-advanced">
          <summary>{t("bulkScheduleFilter")}</summary>
          <div className="form-row">
            <Field id={`${id}-weekday`} label={t("bulkScheduleWeekday")}>
              <select
                id={`${id}-weekday`}
                disabled={disabled}
                value={weekdayFilter}
                onChange={(e) => setWeekdayFilter(e.target.value)}
              >
                <option value="">{t("bulkScheduleAnyDay")}</option>
                {open &&
                  teachingWeekdays.map((day) => (
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
                disabled={disabled}
                type="date"
                value={firstDate}
                onChange={(e) => setFirstDate(e.target.value)}
              />
            </Field>
            <Field id={`${id}-through`} label={t("bulkScheduleThrough")}>
              <input
                id={`${id}-through`}
                disabled={disabled}
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
            disabled={disabled || !matching.length}
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
            disabled={disabled || selectedCount === eligible.length}
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
            disabled={disabled || selectedCount === 0}
            onClick={() => {
              setSelected([]);
              setError(false);
            }}
          >
            {t("bulkScheduleClear")}
          </Button>
        </div>
        <fieldset
          className="course-planner-weekdays course-bulk-session-options"
          disabled={disabled}
        >
          <legend>{t("bulkScheduleSelect")}</legend>
          {visibleSessions.map(({ id: key, row }) => (
            <label key={key} className="checkbox-label">
              <input
                type="checkbox"
                checked={selectedIds.has(key)}
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
        <p className="course-bulk-session-status muted" role="status">
          {t("bulkScheduleSelected", { count: selectedCount })}
        </p>
        <div className="form-row">
          <Field
            id={`${id}-offset`}
            label={t("bulkScheduleOffset")}
            hint={t("bulkScheduleOffsetHint")}
          >
            <input
              id={`${id}-offset`}
              disabled={disabled}
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
              disabled={disabled}
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field id={`${id}-end`} label={t("bulkScheduleEnd")}>
            <input
              id={`${id}-end`}
              disabled={disabled}
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
            disabled={disabled || selectedCount === 0}
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
                  const rows = withChanges(changes);
                  const valid = canApply(rows);
                  setError(!valid);
                  if (valid) onApply(changes, rows);
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
