import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Field } from "../../components/common";
import { Button } from "../../components/ui/button";
import {
  analyticsUntil,
  type AnalyticsPeriod,
  type AnalyticsPreset,
} from "./period";
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

const presets = ["around", "historyYear", "nextQuarter"] as const;

export function ReportingPeriodSelect({
  preset,
  custom,
  onChange,
}: {
  preset: AnalyticsPreset;
  custom: boolean;
  onChange: (value: AnalyticsPreset) => void;
}) {
  const { t } = useTranslation("analytics");
  return (
    <Field id="analytics-period" label={t("period")}>
      <select
        value={custom ? "custom" : preset}
        onChange={(event) => {
          const value = event.target.value;
          const next = presets.find((item) => item === value);
          if (next) onChange(next);
        }}
      >
        {custom && <option value="custom">{t("custom")}</option>}
        {presets.map((item) => (
          <option key={item} value={item}>
            {t(item)}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function ScenarioProbability({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const { t } = useTranslation("analytics");
  return (
    <Field id="analytics-probability" label={t("probability")}>
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((choice) => (
          <option key={choice} value={choice}>
            {choice * 100} %
          </option>
        ))}
      </select>
    </Field>
  );
}
