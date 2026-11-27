/** Read operating indicators and acknowledge current exceptions in the Control Center. */
import { lazy, Suspense, useEffect, useId, useState } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { dateTime, formatUtcDate, money } from "../../lib/dates";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import { financePeriodSchema, type FinancePeriod } from "./finance-api";
import {
  trainingControlSchema,
  type TrainingIssue,
} from "./training-control-schema";
import "./training-control-i18n";

const TrainingEscalation = lazy(() => import("./training-escalation"));
const metrics = [
  "upcoming",
  "active",
  "unstaffed",
  "partly_staffed",
  "attention",
] as const;

export default function TrainingControl({
  actor,
  period,
}: {
  actor: string;
  period: FinancePeriod;
}) {
  const { t, i18n } = useTranslation("trainingControl");
  const cache = useQueryClient();
  const online = useOnline();
  const filterId = useId();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [organisation, setOrganisation] = useState("");
  const [topic, setTopic] = useState("");
  const [selectedIssue, setSelectedIssue] = useState<TrainingIssue>();
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const reportKey = ["training-control", actor, period.from, period.until];
  const queryKey = [...reportKey, organisation, topic];
  const report = useQuery({
    queryKey,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      financePeriodSchema.parse(period);
      const { data, error } = await db()
        .rpc("training_control_center", {
          p_from: period.from,
          p_until: period.until,
          p_organisation_id: organisation || null,
          p_topic_id: topic || null,
        })
        .abortSignal(signal);
      if (error) throw error;
      return trainingControlSchema.parse(data);
    },
  });
  const acknowledge = useMutation({
    mutationFn: async (issue: TrainingIssue) => {
      requireOnline();
      const { error } = await db().rpc("acknowledge_training_issue", {
        p_run_id: issue.run_id,
        p_issue: issue.code,
        p_fingerprint: issue.fingerprint,
        p_acknowledged: !issue.acknowledged,
      });
      if (error) throw error;
    },
    onSuccess: () => cache.invalidateQueries({ queryKey: reportKey }),
  });
  if (report.isPending) return <Loading />;
  if (report.isError) return <ErrorState retry={() => void report.refetch()} />;
  const {
    operations,
    receivables,
    capacity,
    filters,
    time_zone: zone,
  } = report.data;
  const language = i18n.language;
  const number = new Intl.NumberFormat(language, { maximumFractionDigits: 1 });
  const issues =
    operations?.issues.filter(
      (issue) =>
        showAcknowledged ||
        !issue.acknowledged ||
        Boolean(issue.escalation && issue.escalation.state !== "done"),
    ) ?? [];
  return (
    <div className="training-control-content">
      {(filters.organisations.length > 0 ||
        filters.topics.length > 0 ||
        organisation ||
        topic) && (
        <div className="form-row">
          {(filters.organisations.length > 0 || organisation) && (
            <Field id={`${filterId}-company`} label={t("organisation")}>
              <select
                id={`${filterId}-company`}
                value={organisation}
                onChange={(event) => setOrganisation(event.currentTarget.value)}
              >
                <option value="">{t("allOrganisations")}</option>
                {organisation &&
                  !filters.organisations.some(
                    (item) => item.id === organisation,
                  ) && (
                    <option value={organisation}>{t("outsidePeriod")}</option>
                  )}
                {filters.organisations.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {(filters.topics.length > 0 || topic) && (
            <Field id={`${filterId}-topic`} label={t("topic")}>
              <select
                id={`${filterId}-topic`}
                value={topic}
                onChange={(event) => setTopic(event.currentTarget.value)}
              >
                <option value="">{t("allTopics")}</option>
                {topic && !filters.topics.some((item) => item.id === topic) && (
                  <option value={topic}>{t("outsidePeriod")}</option>
                )}
                {filters.topics.map((item) => (
                  <option key={item.id} value={item.id}>
                    {language.startsWith("de") ? item.label_de : item.label_en}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      )}
      {report.isPlaceholderData ? (
        <Loading />
      ) : (
        <>
          {operations && (
            <>
              <p className="muted">{t("coverageHelp")}</p>
              <dl className="training-control-metrics">
                {metrics.map((key) => (
                  <div key={key}>
                    <dt>{t(key)}</dt>
                    <dd>{number.format(operations[key])}</dd>
                  </div>
                ))}
                <div>
                  <dt>{t("assignedHours")}</dt>
                  <dd>{number.format(operations.assigned_minutes / 60)}</dd>
                </div>
                <div>
                  <dt>{t("unassignedHours")}</dt>
                  <dd>{number.format(operations.unassigned_minutes / 60)}</dd>
                </div>
              </dl>
              <section aria-label={t("upcomingIssues")}>
                <h3>{t("upcomingIssues")}</h3>
                {!!operations.issues.length && (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={showAcknowledged}
                      onChange={(event) =>
                        setShowAcknowledged(event.currentTarget.checked)
                      }
                    />
                    {t("showAcknowledged")}
                  </label>
                )}
                {acknowledge.isError && (
                  <Notice kind="error">{t("saveFailed")}</Notice>
                )}
                {issues.length ? (
                  <ul className="training-control-list">
                    {issues.map((issue) => (
                      <li key={`${issue.run_id}:${issue.code}`}>
                        <div>
                          <Link
                            to={
                              issue.code === "staffing"
                                ? `/courses?run=${issue.run_id}`
                                : `/readiness/${issue.run_id}`
                            }
                          >
                            {issue.title}
                          </Link>
                          <p>
                            {t(issue.code)} ·{" "}
                            {dateTime(issue.starts_at, language, zone)}
                          </p>
                          {issue.escalation && (
                            <p>
                              <Link
                                to={`/workbench?task=${issue.escalation.id}`}
                              >
                                {t("escalationTask")}
                              </Link>
                              {" · "}
                              {issue.escalation.assignee}
                              {" · "}
                              {t(issue.escalation.state)}
                              {issue.escalation.due_at &&
                                ` · ${dateTime(issue.escalation.due_at, language, zone)}`}
                              {issue.escalation.state !== "done" &&
                                issue.escalation.due_at &&
                                Date.parse(issue.escalation.due_at) < now &&
                                ` · ${t("escalationOverdue")}`}
                            </p>
                          )}
                        </div>
                        <div className="form-actions">
                          {!issue.escalation && (
                            <Button
                              size="sm"
                              type="button"
                              variant="secondary"
                              disabled={!online}
                              aria-label={t("escalateIssue", {
                                title: issue.title,
                                code: t(issue.code),
                              })}
                              onClick={() => setSelectedIssue(issue)}
                            >
                              {t("escalate")}
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="secondary"
                            type="button"
                            disabled={!online || acknowledge.isPending}
                            aria-label={t(
                              issue.acknowledged
                                ? "undoIssue"
                                : "acknowledgeIssue",
                              {
                                title: issue.title,
                                code: t(issue.code),
                              },
                            )}
                            onClick={() => acknowledge.mutate(issue)}
                          >
                            {t(issue.acknowledged ? "undo" : "acknowledge")}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>{t("noIssues")}</p>
                )}
              </section>
            </>
          )}
          {capacity && (
            <section aria-label={t("sharedCapacity")}>
              <h3>{t("sharedCapacity")}</h3>
              <p className="muted">{t("capacityHelp")}</p>
              {capacity.weeks.length ? (
                <dl className="training-control-metrics">
                  {capacity.weeks.map(({ week, people, free_minutes }) => (
                    <div key={week}>
                      <dt>
                        {t("weeklyCapacity", {
                          day: formatUtcDate(week, language),
                        })}
                      </dt>
                      <dd>
                        {t("capacityValue", {
                          hours: number.format(free_minutes / 60),
                          people: number.format(people),
                        })}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p>{t("noAvailability")}</p>
              )}
              {!!capacity.absences.length && (
                <>
                  <h4>{t("absences")}</h4>
                  <ul className="training-control-list">
                    {capacity.absences.map((absence) => (
                      <li key={absence.id}>
                        <strong>{absence.name}</strong>
                        <span>
                          {dateTime(absence.starts_at, language, zone)} –{" "}
                          {dateTime(absence.ends_at, language, zone)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}
          {receivables && (
            <section aria-label={t("receivables")}>
              <h3>{t("receivables")}</h3>
              <p className="muted">{t("receivablesHelp")}</p>
              {receivables.currencies.map((row) => (
                <dl
                  className="training-control-metrics"
                  key={row.currency}
                  aria-label={row.currency}
                >
                  {(["invoiced", "received", "outstanding"] as const).map(
                    (key) => (
                      <div key={key}>
                        <dt>{t(key)}</dt>
                        <dd>{money(row[key], row.currency, language)}</dd>
                      </div>
                    ),
                  )}
                </dl>
              ))}
              <h4>{t("overdue")}</h4>
              {receivables.overdue.length ? (
                <ul className="training-control-list">
                  {receivables.overdue.map((invoice) => (
                    <li key={invoice.id}>
                      <div>
                        <Link
                          to={`/finance/accounting?customerInvoice=${invoice.id}`}
                        >
                          {invoice.number}
                        </Link>
                        <p>
                          {invoice.organisation} ·{" "}
                          {formatUtcDate(invoice.due_on, language)}
                        </p>
                      </div>
                      <strong>
                        {money(
                          invoice.outstanding_total,
                          invoice.currency,
                          language,
                        )}
                      </strong>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>{t("noOverdue")}</p>
              )}
            </section>
          )}
        </>
      )}
      {selectedIssue && (
        <Suspense fallback={<Loading />}>
          <TrainingEscalation
            actor={actor}
            issue={selectedIssue}
            period={period}
            zone={zone}
            organisation={organisation}
            topic={topic}
            close={() => setSelectedIssue(undefined)}
            refresh={() =>
              void cache.invalidateQueries({ queryKey: reportKey })
            }
          />
        </Suspense>
      )}
    </div>
  );
}
