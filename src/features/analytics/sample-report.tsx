import { useState } from "react";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import { Field, Notice } from "../../components/common";
import {
  analyticsPreset,
  analyticsUntil,
  type AnalyticsPeriod,
  type AnalyticsPreset,
} from "./period";
import { ReportPanels } from "./report-panels";
import {
  PeriodForm,
  ReportingPeriodSelect,
  ScenarioProbability,
  Totals,
} from "./report-ui";
import type {
  AnalyticsCurrency,
  AnalyticsReport,
  AnalyticsScope,
} from "./schema";

const zone = "Europe/Berlin";
const sampleDate = "2030-05-05";
const today = DateTime.fromISO(sampleDate, { zone });
const companies = ["Northstar Learning", "Paper Bridge Studio"] as const;
type SampleCompany = (typeof companies)[number];

function sampleReport(
  scope: AnalyticsScope,
  period: AnalyticsPeriod,
  company: SampleCompany | "",
): AnalyticsReport | null {
  const until = analyticsUntil(period);
  if (!until) return null;
  const through = DateTime.fromISO(period.through, { zone });
  const firstMonth = DateTime.fromISO(period.from, {
    zone,
  }).startOf("month");
  const allCompanies = scope === "staff" && !company;
  const months: AnalyticsReport["months"] = [];
  let hasData = false;

  for (
    let month = firstMonth;
    month <= through;
    month = month.plus({ months: 1 })
  ) {
    const offset = Math.round(
      month.diff(today.startOf("month"), "months").months,
    );
    const date = month.toISODate();
    const scheduled = month.set({ day: 11 }).toISODate();
    if (!date || !scheduled) break;
    const inRange = scheduled >= period.from && scheduled < until;
    const variation = (offset + 12) % 4;
    const counts =
      offset >= -11 && offset <= 6 && inRange
        ? allCompanies
          ? variation * 2 + 3
          : variation + (company === companies[1] ? 2 : 1)
        : 0;
    hasData ||= counts > 0;
    const history = date < sampleDate && period.from < sampleDate;
    const forecast =
      month.endOf("month") >= today && period.through >= sampleDate;
    const past = scheduled < sampleDate ? counts : 0;
    const future = scheduled >= sampleDate ? counts : 0;
    const money = (
      pastCount: number,
      futureCount: number,
      net: number,
      gross: number,
    ) => ({
      past_net: scope !== "company" ? pastCount * net : null,
      future_net: scope !== "company" ? futureCount * net : null,
      past_gross: scope !== "personal" ? pastCount * gross : null,
      future_gross: scope !== "personal" ? futureCount * gross : null,
      missing_gross: scope !== "personal" ? 0 : null,
      lecturer_cash:
        scope === "personal" || allCompanies ? pastCount * net : null,
      customer_cash: scope !== "personal" ? pastCount * gross : null,
    });
    const audPast = Math.floor(past / 2);
    const audFuture = Math.floor(future / 2);
    months.push({
      month: date,
      history,
      forecast,
      past_assignments: past,
      future_assignments: future,
      past_minutes: past * 180,
      future_minutes: future * 180,
      open_positions: scope === "staff" ? Math.floor(future / 2) : null,
      currencies: {
        EUR: money(past - audPast, future - audFuture, 280, 540),
        AUD: money(audPast, audFuture, 470, 890),
      },
    });
  }
  return hasData
    ? { time_zone: zone, can_model_pipeline: allCompanies, months }
    : null;
}

export function SampleAnalytics({ scope }: { scope: AnalyticsScope }) {
  const { t, i18n } = useTranslation("analytics");
  const [company, setCompany] = useState<SampleCompany | "">(
    scope === "company" ? companies[0] : "",
  );
  const [custom, setCustom] = useState<AnalyticsPeriod>();
  const [preset, setPreset] = useState<AnalyticsPreset>("around");
  const [currency, setCurrency] = useState<AnalyticsCurrency>("EUR");
  const [probability, setProbability] = useState(0.5);
  const period = custom ?? analyticsPreset(preset, today);
  const report = sampleReport(scope, period, company);
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const date = today.toLocaleString(DateTime.DATE_MED, { locale });
  const money = new Intl.NumberFormat(locale, { style: "currency", currency });

  return (
    <div className="portal-analytics">
      <Notice>{t("sampleNotice", { date })}</Notice>
      <section className="panel">
        <h2>{t(scope)}</h2>
        {scope === "company" && <p>{company}</p>}
        <div className="analytics-filters">
          {scope === "staff" && (
            <Field id="sample-analytics-company" label={t("organisation")}>
              <select
                value={company}
                onChange={(event) => {
                  const value = event.target.value;
                  setCompany(companies.find((item) => item === value) ?? "");
                }}
              >
                <option value="">{t("allOrganisations")}</option>
                {companies.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </Field>
          )}
          <ReportingPeriodSelect
            preset={preset}
            custom={Boolean(custom)}
            onChange={(value) => {
              setPreset(value);
              setCustom(undefined);
            }}
          />
        </div>
        <PeriodForm
          key={`${period.from}/${period.through}`}
          period={period}
          onApply={setCustom}
        />
        <p className="analytics-muted">{t("timeZone", { zone })}</p>
      </section>
      {report ? (
        <ReportPanels
          report={report}
          companyFiltered={scope === "staff" && Boolean(company)}
          currency={currency}
          setCurrency={setCurrency}
          scenario={
            report.can_model_pipeline && (
              <section className="panel">
                <h2>{t("scenario")}</h2>
                <p className="analytics-muted">{t("sampleScenarioBasis")}</p>
                <ScenarioProbability
                  value={probability}
                  onChange={setProbability}
                />
                <Totals
                  items={[
                    {
                      label: t("scenarioFees"),
                      value: money.format(
                        probability * (currency === "EUR" ? 1680 : 2820),
                      ),
                    },
                    {
                      label: t("scenarioGross"),
                      value: money.format(
                        probability * (currency === "EUR" ? 3240 : 5340),
                      ),
                    },
                  ]}
                />
              </section>
            )
          }
        />
      ) : (
        <p className="panel" role="status">
          {t("sampleEmpty")}
        </p>
      )}
    </div>
  );
}
