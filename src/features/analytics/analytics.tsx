import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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
import { forecastQuery } from "../workbench/finance-api";
import { analyticsAccessQuery, analyticsReportQuery } from "./api";
import {
  analyticsPreset,
  analyticsUntil,
  type AnalyticsPeriod,
  type AnalyticsPreset,
} from "./period";
import { ReportPanels } from "./report-panels";
import {
  analyticsScopes,
  type AnalyticsAccess,
  type AnalyticsCurrency,
} from "./schema";
import {
  PeriodForm,
  ReportingPeriodSelect,
  ScenarioProbability,
  Totals,
} from "./report-ui";
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
}: {
  actor: string;
  access: AnalyticsAccess;
}) {
  const { t } = useTranslation("analytics");
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedScope = searchParams.get("scope");
  const [companyId, setCompanyId] = useState("");
  const [staffCompanyId, setStaffCompanyId] = useState("");
  const [preset, setPreset] = useState<AnalyticsPreset>("around");
  const [customPeriod, setCustomPeriod] = useState<AnalyticsPeriod | null>(
    null,
  );
  const [currency, setCurrency] = useState<AnalyticsCurrency>("EUR");
  const companies = access.organisations.filter((item) => item.company);
  const scopes = analyticsScopes.filter((scope) =>
    scope === "company" ? companies.length > 0 : access[scope],
  );
  const defaultScope = access.staff ? "staff" : scopes[0];
  const scope = scopes.find((item) => item === requestedScope) ?? defaultScope;
  const company = companies.find(({ id }) => id === companyId) ?? companies[0];
  const staffCompany = access.organisations.find(
    ({ id }) => id === staffCompanyId,
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

  return (
    <>
      <section className="panel">
        <div className="analytics-filters">
          {scopes.length > 1 && (
            <Field id="analytics-scope" label={t("scope")}>
              <select
                value={scope}
                onChange={(event) =>
                  setSearchParams(
                    (previous) => {
                      const next = new URLSearchParams(previous);
                      next.set("scope", event.target.value);
                      return next;
                    },
                    { replace: true },
                  )
                }
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
          {scope === "staff" && access.organisations.length > 0 && (
            <Field id="analytics-staff-company" label={t("organisation")}>
              <select
                value={staffCompany?.id ?? ""}
                onChange={(event) => setStaffCompanyId(event.target.value)}
              >
                <option value="">{t("allOrganisations")}</option>
                {access.organisations.map(({ id, name }) => (
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
            onChange={(value) => {
              setPreset(value);
              setCustomPeriod(null);
            }}
          />
        </div>
        <PeriodForm
          key={`${period.from}/${period.through}`}
          period={period}
          onApply={setCustomPeriod}
        />
        <p className="analytics-muted">{t("timeZone", { zone })}</p>
      </section>
      {query.isPending && <Loading />}
      {query.isError && <ErrorState retry={() => void query.refetch()} />}
      {query.isSuccess && (
        <ReportPanels
          scenario={
            query.data.can_model_pipeline &&
            !(scope === "staff" && organisation) && (
              <ScenarioPanel
                actor={actor}
                zone={query.data.time_zone}
                currency={currency}
              />
            )
          }
          report={query.data}
          companyFiltered={scope === "staff" && Boolean(organisation)}
          currency={currency}
          setCurrency={setCurrency}
        />
      )}
    </>
  );
}

function ScenarioPanel({
  actor,
  zone,
  currency,
}: {
  actor: string;
  zone: string;
  currency: AnalyticsCurrency;
}) {
  const { t, i18n } = useTranslation("analytics");
  const { format } = new Intl.NumberFormat(
    i18n.resolvedLanguage ?? i18n.language,
    {
      style: "currency",
      currency,
    },
  );
  const [probability, setProbability] = useState(0.5);
  const now = DateTime.now().setZone(zone);
  const period = {
    from: now.toISODate() ?? "",
    until: now.plus({ days: 90 }).toISODate() ?? "",
  };
  const forecast = useQuery(
    forecastQuery(
      actor,
      period,
      probability,
      Boolean(period.from && period.until),
    ),
  );
  const months = forecast.data?.months.filter(
    (month) => month.currency === currency,
  );
  const unknown =
    months?.reduce(
      (sum, row) => sum + row.pipeline_cost_unknown_positions,
      0,
    ) ?? 0;
  const cost = months?.reduce(
    (sum, row) => sum + (row.pipeline_lecturer_cost_known ?? 0),
    0,
  );
  const gross = months?.reduce(
    (sum, row) => sum + (row.pipeline_gross_known ?? 0),
    0,
  );

  return (
    <section className="panel">
      <h2>{t("scenario")}</h2>
      <p className="analytics-muted">{t("scenarioBasis")}</p>
      <ScenarioProbability value={probability} onChange={setProbability} />
      {forecast.isPending && <Loading />}
      {forecast.isError && <ErrorState retry={() => void forecast.refetch()} />}
      {forecast.isSuccess && (
        <Totals
          items={[
            {
              label: t("scenarioFees"),
              value:
                unknown && probability > 0
                  ? t("notAvailable")
                  : format(cost ?? 0),
            },
            ...(forecast.data.gross_authorized
              ? [{ label: t("scenarioGross"), value: format(gross ?? 0) }]
              : []),
          ]}
        />
      )}
      {unknown > 0 && (
        <p className="analytics-muted">
          {t("unknownPipeline", { count: unknown })}
        </p>
      )}
    </section>
  );
}

export function AnalyticsPage() {
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
  return (
    <div className="portal-analytics">
      <PageHeading
        title={t("analytics")}
        description={t("analytics:description")}
      />
      {online && learning.isSuccess && hasLearningAnalytics(learning.data) && (
        <div className="form-actions">
          <Button asChild variant="secondary">
            <Link to="/analytics/learning">{t("learningAnalytics:title")}</Link>
          </Button>
        </div>
      )}
      {actor && portalInternalEdition ? (
        access.isPending ? (
          <Loading />
        ) : access.isError ? (
          <ErrorState retry={() => void access.refetch()} />
        ) : (
          <AnalyticsView key={actor} actor={actor} access={access.data} />
        )
      ) : (
        <p className="panel">{t("analytics:unavailable")}</p>
      )}
    </div>
  );
}
