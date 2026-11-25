import { financeRoots, type FinanceScope } from "../../app/finance-access";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { currencyCodes } from "../../lib/currencies";
import { DateTime } from "luxon";
import { useTranslation } from "react-i18next";
import {
  ErrorState,
  Field,
  Loading,
  PageHeading,
} from "../../components/common";
import { Button } from "../../components/ui/button";
import { portalInternalEdition } from "../../lib/installation-brand";
import { useAuth } from "../auth/auth-context";
import RevenueForecast from "./revenue-forecast";
import { analyticsAccessQuery, analyticsReportQuery } from "./api";
import {
  analyticsPreset,
  type AnalyticsPreset,
  analyticsUntil,
  type AnalyticsPeriod,
} from "./period";
import { ReportPanels } from "./report-panels";
import { PersonalIncomeScenario } from "./personal-income-scenario";
import {
  analyticsScopes,
  type AnalyticsAccess,
  type AnalyticsCurrency,
} from "./schema";
import { PeriodForm, ReportingPeriodSelect } from "./report-ui";
import {
  hasLearningAnalytics,
  learningAnalyticsAccessQuery,
} from "./learning-api";
import { useOnline } from "../../lib/online";
import "./i18n";
import "./learning-i18n";

function AnalyticsView({
  actor,
  access,
  fixedScope,
}: {
  actor: string;
  access: AnalyticsAccess;
  fixedScope?: FinanceScope;
}) {
  const { t } = useTranslation("analytics");
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedScope = searchParams.get("scope");
  const [companyId, setCompanyId] = useState("");
  const [staffCompanyId, setStaffCompanyId] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [dateFormVersion, resetDateForm] = useState(0);
  const [preset, setPreset] = useState<AnalyticsPreset>("around");
  const [customPeriod, setCustomPeriod] = useState<AnalyticsPeriod | null>(
    null,
  );
  const [currency, setCurrency] = useState<AnalyticsCurrency>("EUR");
  const companies = access.organisations.filter((item) => item.company);
  const scopes = analyticsScopes.filter(
    (scope) =>
      (!fixedScope || fixedScope === scope) &&
      (scope === "company" ? companies.length > 0 : access[scope]),
  );
  const defaultScope = scopes.includes("staff") ? "staff" : scopes[0];
  const scope = scopes.find((item) => item === requestedScope) ?? defaultScope;
  const company = companies.find(({ id }) => id === companyId) ?? companies[0];
  const staffCompany = access.organisations.find(
    ({ id }) => id === staffCompanyId,
  );
  const companyNeedle = companySearch.trim().toLocaleLowerCase();
  const staffOptions = access.organisations.filter(
    ({ id, name }) =>
      id === staffCompany?.id ||
      name.toLocaleLowerCase().includes(companyNeedle),
  );
  const zone =
    (scope === "company" ? company?.time_zone : access.time_zone) ?? "UTC";
  const now = DateTime.now().setZone(zone);
  const period = customPeriod ?? analyticsPreset(preset, now);
  const organisation =
    scope === "company"
      ? company?.id
      : scope === "staff"
        ? staffCompany?.id
        : null;
  const query = useQuery({
    ...analyticsReportQuery(
      actor,
      scope ?? "personal",
      organisation ?? null,
      period,
    ),
    enabled: Boolean(scope && analyticsUntil(period)),
  });
  if (!scope) return <p className="panel">{t("unavailable")}</p>;
  const selectedCurrency = query.data?.months.some(
    (month) => month.currencies[currency],
  )
    ? currency
    : (currencyCodes.find((code) =>
        query.data?.months.some((month) => month.currencies[code]),
      ) ?? currency);

  function resetFilters() {
    setCompanyId("");
    setStaffCompanyId("");
    setCompanySearch("");
    setPreset("around");
    setCustomPeriod(null);
    setCurrency("EUR");
    resetDateForm((version) => version + 1);
  }

  return (
    <>
      <section className="panel">
        <div className="analytics-filters">
          {scopes.length > 1 && (
            <Field id="analytics-scope" label={t("scope")}>
              <select
                value={scope}
                onChange={(event) => {
                  setPreset("around");
                  setCustomPeriod(null);
                  resetDateForm((version) => version + 1);
                  setSearchParams(
                    (previous) => {
                      const next = new URLSearchParams(previous);
                      next.set("scope", event.target.value);
                      return next;
                    },
                    { replace: true },
                  );
                }}
              >
                {scopes.map((item) => (
                  <option key={item} value={item}>
                    {t(item)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {scope === "company" && (
            <Field id="analytics-company" label={t("organisation")}>
              <select
                value={company?.id}
                onChange={(event) => setCompanyId(event.target.value)}
              >
                {companies.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {scope === "staff" && access.organisations.length > 8 && (
            <Field id="analytics-company-search" label={t("companySearch")}>
              <input
                type="search"
                value={companySearch}
                maxLength={120}
                onChange={(event) => setCompanySearch(event.target.value)}
              />
            </Field>
          )}
          {scope === "staff" && access.organisations.length > 0 && (
            <Field id="analytics-staff-company" label={t("organisation")}>
              <select
                value={staffCompany?.id ?? ""}
                onChange={(event) => setStaffCompanyId(event.target.value)}
              >
                <option value="">{t("allOrganisations")}</option>
                {staffOptions.length === 0 && (
                  <option disabled>{t("noCompanyMatches")}</option>
                )}
                {staffOptions.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <ReportingPeriodSelect
            preset={preset}
            custom={Boolean(customPeriod)}
            staff={scope === "staff"}
            onChange={(value) => {
              setPreset(value);
              setCustomPeriod(null);
            }}
          />
        </div>
        <details className="analytics-data">
          <summary>{t("customDates")}</summary>
          <PeriodForm
            key={`${period.from}/${period.through}/${dateFormVersion}`}
            period={period}
            onApply={setCustomPeriod}
          />
        </details>
        <div className="analytics-filter-footer">
          <p className="analytics-muted">{t("timeZone", { zone })}</p>
          <Button type="button" variant="ghost" onClick={resetFilters}>
            {t("resetFilters")}
          </Button>
        </div>
      </section>
      {query.isPending && <Loading />}
      {query.isError && <ErrorState retry={() => void query.refetch()} />}
      {query.isSuccess &&
        scope === "staff" &&
        query.data.can_model_pipeline &&
        !organisation && (
          <RevenueForecast
            key={`forecast-${dateFormVersion}`}
            actor={actor}
            zone={query.data.time_zone}
            preferredCurrency={selectedCurrency}
          />
        )}
      {query.isSuccess && (
        <ReportPanels
          key={dateFormVersion}
          personal={scope === "personal"}
          scenario={
            scope === "personal" && (
              <PersonalIncomeScenario
                report={query.data}
                period={period}
                currency={selectedCurrency}
              />
            )
          }
          report={query.data}
          staff={scope === "staff"}
          companyFiltered={scope === "staff" && Boolean(organisation)}
          currency={selectedCurrency}
          setCurrency={setCurrency}
        />
      )}
    </>
  );
}

export function AnalyticsPage({ scope }: { scope?: FinanceScope } = {}) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const actor = session?.user.id ?? "";
  const online = useOnline();
  const learning = useQuery({
    ...learningAnalyticsAccessQuery(actor),
    enabled: Boolean(actor && portalInternalEdition && online),
  });
  const access = useQuery({
    ...analyticsAccessQuery(actor),
    enabled: Boolean(actor && portalInternalEdition),
  });
  const canSeeLearning =
    learning.isSuccess &&
    (scope === "company"
      ? learning.data.organisations.some(({ company }) => company)
      : scope
        ? learning.data[scope]
        : hasLearningAnalytics(learning.data));
  return (
    <div className="portal-analytics">
      <PageHeading
        title={t("analytics")}
        description={t("analytics:description")}
      />
      {online && canSeeLearning && (
        <div className="form-actions">
          <Button asChild variant="secondary">
            <Link
              to={`${financeRoots[scope ?? "personal"]}/analytics/learning`}
            >
              {t("learningAnalytics:title")}
            </Link>
          </Button>
        </div>
      )}
      {actor && portalInternalEdition ? (
        access.isPending ? (
          <Loading />
        ) : access.isError ? (
          <ErrorState retry={() => void access.refetch()} />
        ) : (
          <AnalyticsView
            key={actor}
            actor={actor}
            access={access.data}
            fixedScope={scope}
          />
        )
      ) : (
        <p className="panel">{t("analytics:unavailable")}</p>
      )}
    </div>
  );
}
