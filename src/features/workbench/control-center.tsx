import { DateTime } from "luxon";
import { type ReactNode, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useAuth } from "../auth/auth-context";
import { permissionsQuery } from "../../lib/queries";
import { dateTime, money } from "../../lib/dates";
import { Button } from "../../components/ui/button";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { controlCenterQuery, forecastQuery } from "./finance-api";
import { FinancePeriodFilter } from "./finance-period";
import "./finance-i18n";
import "./finance.css";

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  const { t } = useTranslation("financeOps");
  return (
    <section className="panel" aria-label={title}>
      <h2>{title}</h2>
      <p className="muted">{t("visible", { count })}</p>
      {count ? children : <p>{t("noItems")}</p>}
    </section>
  );
}

export function ControlCenterPage() {
  const actor = useAuth().session!.user.id,
    { t, i18n } = useTranslation("financeOps");
  const [period, setPeriod] = useState(() => ({
      from: DateTime.now().minus({ days: 30 }).toISODate()!,
      until: DateTime.now().plus({ days: 60 }).toISODate()!,
    })),
    [draftProbability, setDraftProbability] = useState("0"),
    [probability, setProbability] = useState(0);
  const permissions = useQuery(permissionsQuery(actor));
  const permitted =
      !permissions.isError &&
      Boolean(permissions.data?.includes("jobs.manage")),
    canFinance =
      !permissions.isError &&
      Boolean(permissions.data?.includes("finance.manage"));
  const query = useQuery(controlCenterQuery(actor, period, permitted));
  const forecast = useQuery(
    forecastQuery(actor, period, probability, permitted && canFinance),
  );
  if (permissions.isPending) return <Loading />;
  if (permissions.isError)
    return <ErrorState retry={() => void permissions.refetch()} />;
  if (!permitted)
    return (
      <>
        <PageHeading title={t("controlCenter")} />
        <Notice kind="error">{t("denied")}</Notice>
      </>
    );
  const info = query.data;
  return (
    <>
      <PageHeading title={t("controlCenter")} description={t("controlHelp")} />
      <FinancePeriodFilter period={period} onChange={setPeriod} />
      {query.isPending ? (
        <Loading />
      ) : query.isError ? (
        <ErrorState retry={() => void query.refetch()} />
      ) : (
        info && (
          <>
            <p>
              {info.time_zone} · {t("bounded")}
            </p>
            <div className="finance-actions">
              <Button
                variant="secondary"
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                {t("refresh")}
              </Button>
              <Link to="/admin/audit">{t("openHistory")}</Link>
            </div>
            <div className="control-grid">
              <Section title={t("unstaffed")} count={info.unstaffed.length}>
                <ul>
                  {info.unstaffed.map((item) => (
                    <li key={item.id}>
                      <Link to={`/jobs/${item.id}`}>{item.title}</Link>
                      <p>
                        {item.customer_name} ·{" "}
                        {t("positions", { count: item.open_positions })}
                      </p>
                      <small>
                        {dateTime(
                          item.starts_at,
                          i18n.language,
                          info.time_zone,
                        )}
                      </small>
                    </li>
                  ))}
                </ul>
              </Section>
              <Section
                title={t("missing_documents")}
                count={info.missing_documents.length}
              >
                <ul>
                  {info.missing_documents.map((item) => (
                    <li key={item.id}>
                      <Link to={`/jobs/${item.id}`}>{item.title}</Link>
                    </li>
                  ))}
                </ul>
              </Section>
              <Section
                title={t("cancellations")}
                count={info.cancellations.length}
              >
                <ul>
                  {info.cancellations.map((item, index) => (
                    <li key={`${item.id}:${index}`}>
                      <Link to={`/jobs/${item.job_id}`}>{item.title}</Link>
                      <p>
                        {dateTime(
                          item.created_at,
                          i18n.language,
                          info.time_zone,
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </Section>
              <Section title={t("requests")} count={info.requests.length}>
                <ul>
                  {info.requests.map((item) => (
                    <li key={item.id}>
                      <strong>{item.title}</strong>
                      <p>{item.organisation_name}</p>
                      <Link
                        to={item.job_id ? `/jobs/${item.job_id}` : "/client"}
                      >
                        {item.job_id ? t("openJob") : t("requests")}
                      </Link>
                    </li>
                  ))}
                </ul>
              </Section>
              <Section
                title={t("contracts_expiring")}
                count={info.contracts_expiring.length}
              >
                <ul>
                  {info.contracts_expiring.map((item) => (
                    <li key={item.id}>
                      <Link to="/contracts">{t("contracts")}</Link> ·{" "}
                      {dateTime(item.expires_at, i18n.language, info.time_zone)}
                    </li>
                  ))}
                </ul>
              </Section>
              <Section
                title={t("qualifications_expiring")}
                count={info.qualifications_expiring.length}
              >
                <ul>
                  {info.qualifications_expiring.map((item) => (
                    <li key={`${item.user_id}:${item.topic_id}`}>
                      <Link to={`/people/${item.user_id}`}>
                        {i18n.language === "de" ? item.label_de : item.label_en}
                      </Link>
                      <p>
                        {dateTime(
                          item.valid_until,
                          i18n.language,
                          info.time_zone,
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </Section>
              <Section title={t("preparation")} count={info.preparation.length}>
                <ul>
                  {info.preparation.map((item) => (
                    <li key={item.run_id}>
                      <Link to={`/courses/${item.run_id}/workspace`}>
                        {t("openCourse")}
                      </Link>
                      <p>
                        {t("progress", {
                          done: item.complete,
                          total: item.total,
                        })}
                      </p>
                      <progress
                        value={item.complete}
                        max={item.total || 1}
                        aria-label={t("progress", {
                          done: item.complete,
                          total: item.total,
                        })}
                      />
                    </li>
                  ))}
                </ul>
              </Section>
              <Section title={t("quality")} count={info.quality.length}>
                <ul>
                  {info.quality.map((item) => (
                    <li key={item.run_id}>
                      <Link to={`/courses/${item.run_id}/workspace`}>
                        {t("openCourse")}
                      </Link>
                      <p>{t("responses", { count: item.responses })}</p>
                      <p>
                        {item.average_rating === null
                          ? t("suppressed")
                          : t("rating", {
                              value: new Intl.NumberFormat(i18n.language, {
                                maximumFractionDigits: 2,
                              }).format(item.average_rating),
                            })}
                      </p>
                    </li>
                  ))}
                </ul>
              </Section>
            </div>
          </>
        )
      )}
      {canFinance && (
        <section className="panel" aria-label={t("forecast")}>
          <h2>{t("forecast")}</h2>
          <p>{t("forecastHelp")}</p>
          <form
            className="finance-scenario"
            onSubmit={(event) => {
              event.preventDefault();
              const value = Number(draftProbability);
              if (Number.isFinite(value) && value >= 0 && value <= 100)
                setProbability(value / 100);
            }}
          >
            <Field id="pipeline-probability" label={t("probability")}>
              <input
                id="pipeline-probability"
                type="number"
                required
                min="0"
                max="100"
                step="1"
                value={draftProbability}
                onChange={(event) => setDraftProbability(event.target.value)}
              />
            </Field>
            <Button type="submit">{t("calculate")}</Button>
          </form>
          {forecast.isPending ? (
            <Loading />
          ) : forecast.isError ? (
            <ErrorState retry={() => void forecast.refetch()} />
          ) : (
            <>
              <p>{t("paymentsHelp")}</p>
              {/* The wide table must remain keyboard-scrollable on mobile.
                  A named group avoids duplicating the surrounding region. */}
              <div
                className="finance-table-scroll"
                role="group"
                aria-label={t("forecast")}
                tabIndex={0}
              >
                <table className="finance-table">
                  <caption>
                    {t("forecast")} ·{" "}
                    {new Intl.NumberFormat(i18n.language, {
                      style: "percent",
                    }).format(forecast.data.pipeline_probability)}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{t("month")}</th>
                      <th scope="col">{t("currency")}</th>
                      <th scope="col">{t("acceptedCost")}</th>
                      {forecast.data.gross_authorized && (
                        <>
                          <th scope="col">{t("knownGross")}</th>
                          <th scope="col">{t("knownMargin")}</th>
                        </>
                      )}
                      <th scope="col">{t("pipelineCost")}</th>
                      {forecast.data.gross_authorized && (
                        <th scope="col">{t("pipelineGross")}</th>
                      )}
                      <th scope="col">{t("payments")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecast.data.months.map((item) => (
                      <tr key={`${item.month}:${item.currency}`}>
                        <th scope="row">{item.month}</th>
                        <td>{item.currency}</td>
                        <td>
                          {money(
                            item.accepted_lecturer_cost,
                            item.currency,
                            i18n.language,
                          )}
                        </td>
                        {forecast.data.gross_authorized && (
                          <>
                            <td>
                              {item.accepted_gross_known === null
                                ? t("unknown")
                                : money(
                                    item.accepted_gross_known,
                                    item.currency,
                                    i18n.language,
                                  )}
                              {Boolean(item.unknown_gross_claims) && (
                                <p>
                                  {t("unknownGross", {
                                    count: item.unknown_gross_claims!,
                                  })}
                                </p>
                              )}
                            </td>
                            <td>
                              {item.accepted_margin_known === null
                                ? t("unknown")
                                : money(
                                    item.accepted_margin_known,
                                    item.currency,
                                    i18n.language,
                                  )}
                            </td>
                          </>
                        )}
                        <td>
                          {item.pipeline_lecturer_cost_known === null
                            ? t("unknown")
                            : money(
                                item.pipeline_lecturer_cost_known,
                                item.currency,
                                i18n.language,
                              )}
                          {item.pipeline_cost_unknown_positions > 0 && (
                            <p>
                              {t("unknownPipelineCost", {
                                count: item.pipeline_cost_unknown_positions,
                              })}
                            </p>
                          )}
                        </td>
                        {forecast.data.gross_authorized && (
                          <td>
                            {item.pipeline_gross_known === null
                              ? t("unknown")
                              : money(
                                  item.pipeline_gross_known,
                                  item.currency,
                                  i18n.language,
                                )}
                          </td>
                        )}
                        <td>
                          {money(
                            item.lecturer_invoice_payments,
                            item.currency,
                            i18n.language,
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!forecast.data.months.length && <p>{t("noItems")}</p>}
            </>
          )}
        </section>
      )}
    </>
  );
}
