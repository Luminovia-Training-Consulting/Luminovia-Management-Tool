/** Date-range filter shared by retained finance operations; retired timesheet UI is not loaded. */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatUtcDate } from "../../lib/dates";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { type FinancePeriod, financePeriodSchema } from "./finance-api";
import "./finance-i18n";
import "./finance.css";

/** Validate the complete date range before requesting finance facts. */
export function FinancePeriodFilter({
  period,
  onChange,
}: {
  period: FinancePeriod;
  onChange: (period: FinancePeriod) => void;
}) {
  const { t, i18n } = useTranslation("financeOps");
  const [draft, setDraft] = useState(period),
    [invalid, setInvalid] = useState(false);
  const fromField = useRef<HTMLInputElement>(null);
  const untilField = useRef<HTMLInputElement>(null);
  const changed = draft.from !== period.from || draft.until !== period.until;
  return (
    <form
      className="panel finance-period"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = financePeriodSchema.safeParse(draft);
        setInvalid(!parsed.success);
        if (parsed.success) onChange(parsed.data);
        else untilField.current?.focus();
      }}
    >
      <Field id="finance-from" label={t("from")}>
        <input
          id="finance-from"
          ref={fromField}
          type="date"
          required
          value={draft.from}
          onChange={(event) => {
            setDraft({ ...draft, from: event.target.value });
            setInvalid(false);
          }}
        />
      </Field>
      <Field id="finance-until" label={t("until")}>
        <input
          id="finance-until"
          ref={untilField}
          type="date"
          required
          value={draft.until}
          aria-describedby={invalid ? "finance-period-error" : undefined}
          onChange={(event) => {
            setDraft({ ...draft, until: event.target.value });
            setInvalid(false);
          }}
        />
      </Field>
      <div className="finance-period-actions">
        <Button type="submit">{t("apply")}</Button>
        {changed && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDraft(period);
              setInvalid(false);
              fromField.current?.focus();
            }}
          >
            {t("resetPeriodDraft")}
          </Button>
        )}
      </div>
      <p>{t("periodHelp")}</p>
      <p role="status">
        {t("appliedPeriod", {
          from: formatUtcDate(period.from, i18n.language),
          until: formatUtcDate(period.until, i18n.language),
        })}
        {changed && <> · {t("unappliedPeriod")}</>}
      </p>
      {invalid && (
        <div id="finance-period-error">
          <Notice kind="error">{t("periodError")}</Notice>
        </div>
      )}
    </form>
  );
}
