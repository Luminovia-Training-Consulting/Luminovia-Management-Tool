/** Date-range filter shared by retained finance operations; retired timesheet UI is not loaded. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { financePeriodSchema, type FinancePeriod } from "./finance-api";
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
  const { t } = useTranslation("financeOps");
  const [draft, setDraft] = useState(period),
    [invalid, setInvalid] = useState(false);
  return (
    <form
      className="panel finance-period"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = financePeriodSchema.safeParse(draft);
        setInvalid(!parsed.success);
        if (parsed.success) onChange(parsed.data);
      }}
    >
      <Field id="finance-from" label={t("from")}>
        <input
          id="finance-from"
          type="date"
          value={draft.from}
          onChange={(event) => setDraft({ ...draft, from: event.target.value })}
        />
      </Field>
      <Field id="finance-until" label={t("until")}>
        <input
          id="finance-until"
          type="date"
          value={draft.until}
          onChange={(event) =>
            setDraft({ ...draft, until: event.target.value })
          }
        />
      </Field>
      <Button type="submit">{t("apply")}</Button>
      <p>{t("periodHelp")}</p>
      {invalid && <Notice kind="error">{t("periodError")}</Notice>}
    </form>
  );
}
