import { useId, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { DateTime } from "luxon";
import {
  expandRecurrence,
  RecurrenceError,
  type LocalScheduleEntry,
  type RecurrenceRule,
} from "../lib/recurrence";
import { dateTime } from "../lib/dates";
import { Field, Notice } from "./common";
import { Button } from "./ui/button";
import "./recurrence-fields.css";

/** Edit a finite repetition rule and preview every occurrence before applying it. */
export function RecurrenceFields({
  anchor,
  zone,
  value,
  onChange,
  max,
  disabled,
  onApply,
}: {
  anchor: LocalScheduleEntry;
  zone: string;
  value: RecurrenceRule | null;
  onChange: (rule: RecurrenceRule | null) => void;
  max: number;
  disabled?: boolean;
  onApply?: (entries: LocalScheduleEntry[]) => void;
}) {
  const id = useId();
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage ?? i18n.language;
  const word = (de: string, en: string) =>
    language.startsWith("de") ? de : en;
  const { starts_at, ends_at } = anchor;
  const first = DateTime.fromISO(starts_at, { zone: "UTC" });
  const weekday = first.isValid ? first.weekday : 1;
  const result = useMemo(() => {
    if (!value) return null;
    try {
      return {
        entries: expandRecurrence({ starts_at, ends_at }, zone, value, max),
      };
    } catch (error) {
      return {
        error:
          error instanceof RecurrenceError
            ? error
            : new RecurrenceError("rule"),
      };
    }
  }, [starts_at, ends_at, zone, value, max]);
  const weekdayFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(language, { weekday: "short", timeZone: "UTC" }),
    [language],
  );
  const format = (wall: string) =>
    dateTime(`${wall}:00Z`, language, "UTC", "short");
  const days = value?.weekdays ?? [weekday];
  const error = result?.error;
  const entries = result?.entries;
  const messages = {
    anchor: word(
      "Gib zuerst Beginn und Ende des ersten Termins ein.",
      "Set the start and end of the first appointment.",
    ),
    rule: word(
      "Wähle eine gültige Regel mit mindestens zwei Terminen.",
      "Choose a valid rule with at least two appointments.",
    ),
    limit: word(
      `Die Serie darf höchstens ${max} Termine enthalten.`,
      `The series can have up to ${max} appointments.`,
    ),
    "local-time": word(
      `Die Ortszeit ${error?.localTime ? format(error.localTime) : ""} ist in ${zone} ungültig oder mehrdeutig. Ändere die Uhrzeit oder die Wiederholungsregel.`,
      `The local time ${error?.localTime ? format(error.localTime) : ""} is invalid or ambiguous in ${zone}. Change the time or the repetition rule.`,
    ),
  };
  const ends = value?.end;
  return (
    <fieldset className="schedule-recurrence" disabled={disabled}>
      <Field id={`${id}-frequency`} label={word("Wiederholung", "Repeat")}>
        <select
          value={value?.frequency ?? ""}
          onChange={(event) => {
            const frequency = event.currentTarget.value as
              RecurrenceRule["frequency"] | "";
            onChange(
              frequency
                ? {
                    ...value,
                    frequency,
                    interval: 1,
                    end: value?.end ?? {
                      type: "count",
                      count: Math.min(4, max),
                    },
                  }
                : null,
            );
          }}
        >
          <option value="">{word("Einmalig", "Does not repeat")}</option>
          <option value="daily">{word("Täglich", "Daily")}</option>
          <option value="weekly">{word("Wöchentlich", "Weekly")}</option>
          <option value="monthly">{word("Monatlich", "Monthly")}</option>
          <option value="yearly">{word("Jährlich", "Yearly")}</option>
        </select>
      </Field>
      {value && (
        <>
          <div className="form-row">
            <Field
              id={`${id}-interval`}
              label={
                {
                  daily: word("Alle … Tage", "Every … days"),
                  weekly: word("Alle … Wochen", "Every … weeks"),
                  monthly: word("Alle … Monate", "Every … months"),
                  yearly: word("Alle … Jahre", "Every … years"),
                }[value.frequency]
              }
            >
              <input
                type="number"
                min={1}
                max={52}
                step={1}
                value={Number.isFinite(value.interval) ? value.interval : ""}
                onChange={(event) =>
                  onChange({
                    ...value,
                    interval: event.currentTarget.valueAsNumber,
                  })
                }
              />
            </Field>
            <Field
              id={`${id}-ending`}
              label={word("Serie endet", "Series ends")}
            >
              <select
                value={value.end.type}
                onChange={(event) =>
                  onChange({
                    ...value,
                    end:
                      event.currentTarget.value === "until"
                        ? {
                            type: "until",
                            date: first.plus({ months: 1 }).toISODate() ?? "",
                          }
                        : { type: "count", count: Math.min(4, max) },
                  })
                }
              >
                <option value="count">
                  {word("Nach einer Anzahl", "After a number of appointments")}
                </option>
                <option value="until">
                  {word("An einem Datum", "On a date")}
                </option>
              </select>
            </Field>
            {ends?.type === "until" ? (
              <Field
                id={`${id}-until`}
                label={word("Letzter möglicher Termin", "Last possible date")}
              >
                <input
                  type="date"
                  min={first.toISODate() ?? undefined}
                  value={ends.date}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      end: { type: "until", date: event.currentTarget.value },
                    })
                  }
                />
              </Field>
            ) : (
              ends?.type === "count" && (
                <Field
                  id={`${id}-count`}
                  label={word("Anzahl der Termine", "Number of appointments")}
                >
                  <input
                    type="number"
                    min={2}
                    max={max}
                    step={1}
                    value={Number.isFinite(ends.count) ? ends.count : ""}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        end: {
                          type: "count",
                          count: event.currentTarget.valueAsNumber,
                        },
                      })
                    }
                  />
                </Field>
              )
            )}
          </div>
          {value.frequency === "weekly" && (
            <fieldset className="schedule-recurrence-days">
              <legend>{word("Wochentage", "Days of the week")}</legend>
              {Array.from({ length: 7 }, (_, index) => index + 1).map((day) => (
                <label className="checkbox-label" key={day}>
                  <input
                    type="checkbox"
                    checked={days.includes(day)}
                    onChange={(event) =>
                      onChange({
                        ...value,
                        weekdays: event.currentTarget.checked
                          ? [...days, day]
                          : days.filter((selected) => selected !== day),
                      })
                    }
                  />
                  {weekdayFormatter.format(new Date(Date.UTC(2024, 0, day)))}
                </label>
              ))}
            </fieldset>
          )}
          {value.frequency === "monthly" && (
            <Field
              id={`${id}-monthly`}
              label={word("Muster im Monat", "Monthly pattern")}
            >
              <select
                value={value.monthlyPattern ?? "day-of-month"}
                onChange={(event) =>
                  onChange({
                    ...value,
                    monthlyPattern:
                      event.currentTarget.value === "weekday"
                        ? "weekday"
                        : "day-of-month",
                  })
                }
              >
                <option value="day-of-month">
                  {word("Gleicher Kalendertag", "Same day of the month")}
                </option>
                <option value="weekday">
                  {word(
                    "Gleiche Position des Wochentags",
                    "Same weekday position",
                  )}
                </option>
              </select>
            </Field>
          )}
          <p className="muted">
            {word(
              "Der erste Termin gehört zur Serie. Übersprungene Kalendertage werden nicht verschoben, etwa der 31. in einem kürzeren Monat.",
              "The first appointment is part of the series. Missing dates are skipped, for example the 31st in a shorter month.",
            )}
          </p>
          {error && <Notice kind="error">{messages[error.reason]}</Notice>}
          {entries && (
            <div className="schedule-recurrence-preview">
              <p role="status">
                {word(
                  `${entries.length} Termine · ${zone}`,
                  `${entries.length} appointments · ${zone}`,
                )}
              </p>
              <ol>
                {entries.slice(0, 5).map((entry) => (
                  <li key={entry.starts_at}>
                    {format(entry.starts_at)} – {format(entry.ends_at)}
                  </li>
                ))}
              </ol>
              {entries.length > 5 && (
                <details>
                  <summary>
                    {word(
                      "Weitere Termine anzeigen",
                      "Show remaining appointments",
                    )}
                  </summary>
                  <ol start={6}>
                    {entries.slice(5).map((entry) => (
                      <li key={entry.starts_at}>
                        {format(entry.starts_at)} – {format(entry.ends_at)}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
              {onApply && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => onApply(entries)}
                >
                  {word("Wiederholungen ergänzen", "Add repeats")}
                </Button>
              )}
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
