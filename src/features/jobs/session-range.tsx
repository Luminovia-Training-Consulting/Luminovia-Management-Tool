import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { sessionsForDateRange, type SessionWindow } from "./session-schedule";
import "./lifecycle-i18n";
import "./session-range.css";

/** Generate the daily rows explicitly, keeping existing hours for days in range. */
export function JobDateRange({
  prefix,
  sessions,
  onApply,
  disabled,
  requiredCount,
}: {
  prefix: string;
  sessions: SessionWindow[];
  onApply: (sessions: SessionWindow[]) => void;
  disabled?: boolean;
  requiredCount?: number;
}) {
  const { t } = useTranslation("jobLifecycle");
  const dates = sessions
    .map(({ starts_at }) => starts_at.slice(0, 10))
    .filter(Boolean)
    .sort();
  const [from, setFrom] = useState(dates[0] ?? "");
  const [through, setThrough] = useState(dates.at(-1) ?? "");
  const [error, setError] = useState<"invalidRange" | "rangeCountMismatch">();
  return (
    <div className="job-date-range">
      <div className="form-row">
        <Field id={`${prefix}-range-from`} label={t("rangeFrom")}>
          <input
            id={`${prefix}-range-from`}
            type="date"
            value={from}
            disabled={disabled}
            onChange={(event) => {
              setFrom(event.target.value);
              setError(undefined);
            }}
          />
        </Field>
        <Field id={`${prefix}-range-through`} label={t("rangeThrough")}>
          <input
            id={`${prefix}-range-through`}
            type="date"
            value={through}
            min={from || undefined}
            disabled={disabled}
            onChange={(event) => {
              setThrough(event.target.value);
              setError(undefined);
            }}
          />
        </Field>
      </div>
      <p className="muted">{t("rangeHelp")}</p>
      <Button
        type="button"
        variant="secondary"
        disabled={disabled || !from || !through}
        onClick={() => {
          const next = sessionsForDateRange(from, through, sessions);
          if (!next) return setError("invalidRange");
          if (requiredCount !== undefined && next.length !== requiredCount)
            return setError("rangeCountMismatch");
          setError(undefined);
          onApply(next);
        }}
      >
        {t("applyRange")}
      </Button>
      {error && (
        <Notice kind="error">{t(error, { count: requiredCount })}</Notice>
      )}
    </div>
  );
}
