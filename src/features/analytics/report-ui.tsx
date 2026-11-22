import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Field } from "../../components/common";
import { Button } from "../../components/ui/button";
import { analyticsUntil, type AnalyticsPeriod } from "./api";
import "./i18n";
import "./analytics.css";

type Reading = { label: string; value: string };

export function Totals({ items }: { items: Reading[] }) {
  return (
    <dl className="analytics-totals">
      {items.map(({ label, value }) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PeriodForm({
  period,
  onApply,
  idPrefix = "analytics",
}: {
  period: AnalyticsPeriod;
  onApply: (period: AnalyticsPeriod) => void;
  idPrefix?: string;
}) {
  const { t } = useTranslation("analytics");
  const [error, setError] = useState(false);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const nextPeriod = {
      from: String(form.get("from")),
      through: String(form.get("through")),
    };
    if (!analyticsUntil(nextPeriod)) {
      setError(true);
      return;
    }
    setError(false);
    onApply(nextPeriod);
  }
  return (
    <form onSubmit={submit}>
      <div className="analytics-filters analytics-date-filters">
        <Field id={`${idPrefix}-from`} label={t("from")}>
          <input name="from" type="date" defaultValue={period.from} required />
        </Field>
        <Field id={`${idPrefix}-through`} label={t("through")}>
          <input
            name="through"
            type="date"
            defaultValue={period.through}
            required
          />
        </Field>
        <Button type="submit" variant="secondary">
          {t("apply")}
        </Button>
      </div>
      {error && (
        <p className="error" role="alert">
          {t("invalidPeriod")}
        </p>
      )}
    </form>
  );
}
