/** Company-scoped sales pipeline; PostgreSQL remains authoritative for permissions and stage history. */
import { zodResolver } from "@hookform/resolvers/zod";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { History } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { ErrorState, Field, Loading, Notice } from "../../components/common";
import { Button } from "../../components/ui/button";
import { useOnline } from "../../lib/online";
import { permissionsQuery } from "../../lib/queries";
import "../operations/i18n";
import "./styles.css";
import {
  createCrmOpportunity,
  CRM_MAX_OFFSET,
  CRM_PAGE_SIZE,
  crmOpportunitiesQuery,
  crmOpportunityEventsQuery,
  crmStageSchema,
  moveCrmOpportunity,
  updateCrmOpportunityForecast,
  type CrmOpportunity,
  type CrmOpportunityEvent,
  type CrmStage,
} from "./api";

const stages = crmStageSchema.options;
const currencies = ["EUR", "AUD", "CHF", "GBP", "USD"] as const;

/** Validate the form before mutation; PostgreSQL independently validates every value and reference. */
const opportunityFormSchema = z.object({
  title: z.string().trim().min(1).max(200),
  estimatedValue: z
    .string()
    .max(15)
    .regex(/^(?:|(?:0|[1-9]\d{0,11})(?:[.,]\d{1,2})?)$/),
  currency: z.enum(currencies),
});

const opportunityForecastFormSchema = z.object({
  closeProbability: z
    .string()
    .max(6)
    .regex(/^(?:|(?:0|[1-9]\d?)(?:\.\d{1,2})?|100(?:\.0{1,2})?)$/),
  expectedCloseDate: z.union([z.literal(""), z.iso.date()]),
});

type OpportunityForm = z.infer<typeof opportunityFormSchema>;
type OpportunityForecastForm = z.infer<typeof opportunityForecastFormSchema>;

/** Keep identical create retries on the same UUID; edited input receives a fresh key. */
function requestIdFor(
  previous: { fingerprint: string; id: string } | undefined,
  values: OpportunityForm,
) {
  const fingerprint = JSON.stringify(values);
  return previous?.fingerprint === fingerprint
    ? previous
    : { fingerprint, id: crypto.randomUUID() };
}

/** A retry of one stage intent keeps its key until confirmed or rejected as stale. */
function moveRequestIdFor(
  requests: Map<string, { fingerprint: string; id: string }>,
  opportunity: CrmOpportunity,
  stage: CrmStage,
) {
  const fingerprint = `${opportunity.version}:${stage}`;
  const previous = requests.get(opportunity.id);
  if (previous?.fingerprint === fingerprint) return previous.id;
  const next = { fingerprint, id: crypto.randomUUID() };
  requests.set(opportunity.id, next);
  return next.id;
}

/** Exposes the same compare-and-swap conflict in localized UI without leaking backend text. */
function isVersionConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === "40001" ||
    (typeof candidate.message === "string" &&
      candidate.message.includes("crm_opportunity_version_conflict"))
  );
}

function formatCloseProbability(value: number | null, language: string) {
  if (value === null) return "—";
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(value)} %`;
}

function formatCloseDate(value: string | null, language: string) {
  if (value === null) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString(language, {
    dateStyle: "medium",
    timeZone: "UTC",
  });
}

/** Show one immutable activity list, fetching only after its disclosure is opened. */
function OpportunityHistory({
  actor,
  organisationId,
  opportunityId,
}: {
  actor: string;
  organisationId: string;
  opportunityId: string;
}) {
  const { t, i18n } = useTranslation("operations");
  const history = useQuery(
    crmOpportunityEventsQuery(actor, organisationId, opportunityId),
  );
  if (history.isPending) return <Loading />;
  if (history.isError)
    return <ErrorState retry={() => void history.refetch()} />;
  return history.data.length ? (
    <ol className="crm-opportunity-history">
      {history.data.map((event: CrmOpportunityEvent) => (
        <li key={event.id}>
          <strong>
            {event.event_type === "created"
              ? t("crmOpportunityCreated")
              : event.event_type === "stage_changed"
                ? t("crmOpportunityStageChanged", {
                    from: t(`crmStage.${event.from_stage}`),
                    to: t(`crmStage.${event.to_stage}`),
                  })
                : t("crmOpportunityForecastChanged", {
                    fromProbability: formatCloseProbability(
                      event.from_close_probability,
                      i18n.language,
                    ),
                    toProbability: formatCloseProbability(
                      event.to_close_probability,
                      i18n.language,
                    ),
                    fromDate: formatCloseDate(
                      event.from_expected_close_date,
                      i18n.language,
                    ),
                    toDate: formatCloseDate(
                      event.to_expected_close_date,
                      i18n.language,
                    ),
                  })}
          </strong>
          <time dateTime={event.occurred_at}>
            {new Date(event.occurred_at).toLocaleString(
              i18n.language.startsWith("de") ? "de-DE" : "en-GB",
              { dateStyle: "medium", timeStyle: "short" },
            )}
          </time>
        </li>
      ))}
    </ol>
  ) : (
    <p className="muted">{t("crmHistoryEmpty")}</p>
  );
}

/** Save forecast fields as one audited compare-and-swap update. */
function OpportunityForecast({
  actor,
  organisationId,
  opportunity,
  archived,
  online,
}: {
  actor: string;
  organisationId: string;
  opportunity: CrmOpportunity;
  archived: boolean;
  online: boolean;
}) {
  const { t, i18n } = useTranslation("operations");
  const queryClient = useQueryClient();
  const request = useRef<{ fingerprint: string; id: string } | undefined>(
    undefined,
  );
  const form = useForm<OpportunityForecastForm>({
    resolver: zodResolver(opportunityForecastFormSchema),
    defaultValues: {
      closeProbability:
        opportunity.close_probability === null
          ? ""
          : String(opportunity.close_probability),
      expectedCloseDate: opportunity.expected_close_date ?? "",
    },
  });
  const forecast = useMutation({
    mutationFn: (values: OpportunityForecastForm) => {
      const closeProbability =
        values.closeProbability === "" ? null : Number(values.closeProbability);
      const expectedCloseDate = values.expectedCloseDate || null;
      const fingerprint = JSON.stringify([
        opportunity.version,
        closeProbability,
        expectedCloseDate,
      ]);
      if (request.current?.fingerprint !== fingerprint) {
        request.current = { fingerprint, id: crypto.randomUUID() };
      }
      return updateCrmOpportunityForecast({
        organisationId,
        opportunityId: opportunity.id,
        closeProbability,
        expectedCloseDate,
        expectedVersion: opportunity.version,
        requestId: request.current.id,
      });
    },
    onSuccess: async () => {
      request.current = undefined;
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["crm", "opportunities", actor, organisationId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["crm", "opportunity-events", actor, organisationId],
        }),
      ]);
    },
    onError: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["crm", "opportunities", actor, organisationId],
      });
    },
  });

  useEffect(() => {
    form.reset({
      closeProbability:
        opportunity.close_probability === null
          ? ""
          : String(opportunity.close_probability),
      expectedCloseDate: opportunity.expected_close_date ?? "",
    });
  }, [
    form,
    opportunity.close_probability,
    opportunity.expected_close_date,
    opportunity.version,
  ]);

  const values = useWatch({ control: form.control });
  const parsedProbability =
    values.closeProbability === "" ? null : Number(values.closeProbability);
  const parsedDate = values.expectedCloseDate || null;
  const unchanged =
    parsedProbability === opportunity.close_probability &&
    parsedDate === opportunity.expected_close_date;
  const probabilityId = `crm-probability-${opportunity.id}`;
  const dateId = `crm-close-date-${opportunity.id}`;
  const savedForecast = t("crmCurrentForecast", {
    probability: formatCloseProbability(
      opportunity.close_probability,
      i18n.language,
    ),
    date: formatCloseDate(opportunity.expected_close_date, i18n.language),
  });

  if (archived)
    return <p className="crm-forecast-current muted">{savedForecast}</p>;

  return (
    <form
      className="crm-forecast-form"
      noValidate
      onSubmit={form.handleSubmit((values) => forecast.mutate(values))}
    >
      <Field
        id={probabilityId}
        label={t("crmCloseProbabilityLabel")}
        error={Boolean(form.formState.errors.closeProbability)}
      >
        <input
          id={probabilityId}
          type="number"
          min="0"
          max="100"
          step="0.01"
          inputMode="decimal"
          disabled={!online || forecast.isPending || archived}
          {...form.register("closeProbability")}
        />
      </Field>
      <Field
        id={dateId}
        label={t("crmExpectedCloseDateLabel")}
        error={Boolean(form.formState.errors.expectedCloseDate)}
      >
        <input
          id={dateId}
          type="date"
          disabled={!online || forecast.isPending || archived}
          {...form.register("expectedCloseDate")}
        />
      </Field>
      <p className="crm-forecast-help muted">{t("crmForecastHelp")}</p>
      <Button disabled={!online || forecast.isPending || archived || unchanged}>
        {t("crmSaveForecast")}
      </Button>
      {Object.keys(form.formState.errors).length > 0 && (
        <Notice kind="error">{t("crmForecastValidation")}</Notice>
      )}
      {forecast.isError && (
        <Notice kind="error">
          {isVersionConflict(forecast.error)
            ? t("crmStaleOpportunity")
            : t("crmForecastSaveError")}
        </Notice>
      )}
      <p className="crm-forecast-current muted" aria-live="polite">
        {savedForecast}
      </p>
    </form>
  );
}

/** Build the company board only after the live permission query allows its RPC reads. */
export function CompanyOpportunityPipeline({
  actor,
  organisationId,
  archived,
}: {
  actor: string;
  organisationId: string;
  archived: boolean;
}) {
  const { t, i18n } = useTranslation("operations");
  const queryClient = useQueryClient();
  const online = useOnline();
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState<CrmStage | "all">("all");
  const [page, setPage] = useState(0);
  const permissions = useQuery(permissionsQuery(actor));
  const canManage = Boolean(permissions.data?.includes("organisations.manage"));
  const opportunities = useQuery({
    ...crmOpportunitiesQuery(actor, organisationId, {
      page,
      search,
      stage: stageFilter === "all" ? null : stageFilter,
    }),
    enabled: canManage && Boolean(organisationId),
    placeholderData: keepPreviousData,
  });
  const [expandedOpportunity, setExpandedOpportunity] = useState<string>();
  const createRequest = useRef<{ fingerprint: string; id: string } | undefined>(
    undefined,
  );
  const moveRequests = useRef(
    new Map<string, { fingerprint: string; id: string }>(),
  );
  const createForm = useForm<OpportunityForm>({
    resolver: zodResolver(opportunityFormSchema),
    defaultValues: { title: "", estimatedValue: "", currency: "EUR" },
  });
  const create = useMutation({
    mutationFn: (values: OpportunityForm) => {
      createRequest.current = requestIdFor(createRequest.current, values);
      return createCrmOpportunity({
        organisationId,
        title: values.title,
        estimatedValue: values.estimatedValue.replace(",", ".") || null,
        currency: values.currency,
        requestId: createRequest.current.id,
      });
    },
    onSuccess: async () => {
      createRequest.current = undefined;
      createForm.reset();
      setSearch("");
      setStageFilter("all");
      setPage(0);
      await queryClient.invalidateQueries({
        queryKey: ["crm", "opportunities", actor, organisationId],
      });
    },
  });
  const move = useMutation({
    mutationFn: (input: {
      opportunity: CrmOpportunity;
      stage: CrmStage;
      requestId: string;
    }) =>
      moveCrmOpportunity({
        organisationId,
        opportunityId: input.opportunity.id,
        stage: input.stage,
        expectedVersion: input.opportunity.version,
        requestId: input.requestId,
      }),
    onSuccess: async (_result, input) => {
      if (
        moveRequests.current.get(input.opportunity.id)?.id === input.requestId
      )
        moveRequests.current.delete(input.opportunity.id);
      setPage(0);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ["crm", "opportunities", actor, organisationId],
        }),
        queryClient.invalidateQueries({
          queryKey: ["crm", "opportunity-events", actor, organisationId],
        }),
      ]);
    },
    onError: async (error, input) => {
      if (isVersionConflict(error)) {
        if (
          moveRequests.current.get(input.opportunity.id)?.id === input.requestId
        )
          moveRequests.current.delete(input.opportunity.id);
        await queryClient.invalidateQueries({
          queryKey: ["crm", "opportunities", actor, organisationId],
        });
      }
    },
  });

  // Do not leave revoked data available in the client cache after permission refresh.
  useEffect(() => {
    if (permissions.data && !canManage) {
      queryClient.removeQueries({
        queryKey: ["crm", "opportunities", actor, organisationId],
      });
      queryClient.removeQueries({
        queryKey: ["crm", "opportunity-events", actor, organisationId],
      });
    }
  }, [actor, canManage, organisationId, permissions.data, queryClient]);

  if (permissions.isPending) return <Loading />;
  if (permissions.isError)
    return <ErrorState retry={() => void permissions.refetch()} />;
  if (!canManage) return <Notice kind="error">{t("noAccess")}</Notice>;
  if (opportunities.isPending) return <Loading />;
  if (opportunities.isError)
    return <ErrorState retry={() => void opportunities.refetch()} />;

  const language = i18n.language.startsWith("de") ? "de-DE" : "en-GB";
  const valueLabel = (opportunity: CrmOpportunity) =>
    opportunity.estimated_value === null
      ? t("crmValueUnspecified")
      : new Intl.NumberFormat(language, {
          style: "currency",
          currency: opportunity.currency,
        }).format(opportunity.estimated_value);

  return (
    <section
      className="company-detail-group crm-pipeline"
      aria-labelledby={`crm-pipeline-title-${organisationId}`}
      aria-busy={opportunities.isFetching}
    >
      <header className="section-heading">
        <div>
          <h3 id={`crm-pipeline-title-${organisationId}`}>
            {t("crmPipelineTitle")}
          </h3>
          <p className="muted">{t("crmPipelineDescription")}</p>
        </div>
      </header>
      <div className="crm-filter-form">
        <Field id={`crm-search-${organisationId}`} label={t("crmSearchLabel")}>
          <input
            id={`crm-search-${organisationId}`}
            type="search"
            maxLength={200}
            value={search}
            onChange={(event) => {
              setSearch(event.currentTarget.value);
              setPage(0);
            }}
          />
        </Field>
        <Field
          id={`crm-stage-filter-${organisationId}`}
          label={t("crmStageFilterLabel")}
        >
          <select
            id={`crm-stage-filter-${organisationId}`}
            value={stageFilter}
            onChange={(event) => {
              const value = event.currentTarget.value;
              const next =
                value === "all" ? null : crmStageSchema.safeParse(value);
              setStageFilter(
                next === null ? "all" : next.success ? next.data : "all",
              );
              setPage(0);
            }}
          >
            <option value="all">{t("crmAllStages")}</option>
            {stages.map((stage) => (
              <option key={stage} value={stage}>
                {t(`crmStage.${stage}`)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {opportunities.isPlaceholderData && (
        <p className="muted" role="status">
          {t("crmUpdatingResults")}
        </p>
      )}
      {archived ? (
        <Notice>{t("crmArchivedReadOnly")}</Notice>
      ) : (
        <form
          className="crm-opportunity-form"
          noValidate
          onSubmit={createForm.handleSubmit((values) => create.mutate(values))}
        >
          <Field
            id={`crm-title-${organisationId}`}
            label={t("crmOpportunityTitle")}
            error={Boolean(createForm.formState.errors.title)}
          >
            <input
              id={`crm-title-${organisationId}`}
              maxLength={200}
              {...createForm.register("title")}
            />
          </Field>
          <Field
            id={`crm-value-${organisationId}`}
            label={t("crmEstimatedValue")}
            error={Boolean(createForm.formState.errors.estimatedValue)}
          >
            <input
              id={`crm-value-${organisationId}`}
              inputMode="decimal"
              maxLength={15}
              placeholder="0.00"
              {...createForm.register("estimatedValue")}
            />
          </Field>
          <Field id={`crm-currency-${organisationId}`} label={t("crmCurrency")}>
            <select
              id={`crm-currency-${organisationId}`}
              {...createForm.register("currency")}
            >
              {currencies.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </Field>
          <Button disabled={!online || create.isPending || archived}>
            {t("crmCreateOpportunity")}
          </Button>
          {Object.keys(createForm.formState.errors).length > 0 && (
            <Notice kind="error">{t("crmFormValidation")}</Notice>
          )}
          {create.isError && <Notice kind="error">{t("crmSaveError")}</Notice>}
        </form>
      )}
      {move.isError && (
        <Notice kind="error">
          {isVersionConflict(move.error)
            ? t("crmStaleOpportunity")
            : t("crmMoveError")}
        </Notice>
      )}
      {opportunities.data.items.length === 0 && (
        <Notice>
          {page > 0
            ? t("crmNoOpportunitiesOnPage")
            : search.trim() === "" && stageFilter === "all"
              ? t("crmNoOpportunities")
              : t("crmNoMatchingOpportunities")}
        </Notice>
      )}
      <div
        className="crm-pipeline-scroll"
        role="region"
        aria-label={t("crmPipelineTitle")}
        tabIndex={0}
      >
        <div className="crm-pipeline-board">
          {stages.map((stage) => {
            const cards = opportunities.data.items.filter(
              (opportunity: CrmOpportunity) => opportunity.stage === stage,
            );
            return (
              <section
                className="crm-pipeline-lane"
                key={stage}
                aria-labelledby={`crm-stage-${organisationId}-${stage}`}
              >
                <header>
                  <h4 id={`crm-stage-${organisationId}-${stage}`}>
                    {t(`crmStage.${stage}`)}
                  </h4>
                  <span
                    className="badge"
                    aria-label={t("crmOpportunityCountOnPage", {
                      count: cards.length,
                    })}
                  >
                    {cards.length}
                  </span>
                </header>
                <ul>
                  {cards.map((opportunity: CrmOpportunity) => (
                    <li className="crm-opportunity-card" key={opportunity.id}>
                      <h5>{opportunity.title}</h5>
                      <p className="muted">{valueLabel(opportunity)}</p>
                      {!archived && (
                        <Field
                          id={`crm-move-${opportunity.id}`}
                          label={t("crmMoveOpportunity", {
                            title: opportunity.title,
                          })}
                        >
                          <select
                            id={`crm-move-${opportunity.id}`}
                            value={opportunity.stage}
                            disabled={
                              !online ||
                              move.isPending ||
                              opportunities.isPlaceholderData
                            }
                            onChange={(event) => {
                              const next = crmStageSchema.safeParse(
                                event.currentTarget.value,
                              );
                              if (
                                next.success &&
                                next.data !== opportunity.stage
                              )
                                move.mutate({
                                  opportunity,
                                  stage: next.data,
                                  requestId: moveRequestIdFor(
                                    moveRequests.current,
                                    opportunity,
                                    next.data,
                                  ),
                                });
                            }}
                          >
                            {stages.map((option) => (
                              <option key={option} value={option}>
                                {t(`crmStage.${option}`)}
                              </option>
                            ))}
                          </select>
                        </Field>
                      )}
                      <OpportunityForecast
                        actor={actor}
                        organisationId={organisationId}
                        opportunity={opportunity}
                        archived={archived}
                        online={online}
                      />
                      <Button
                        variant="ghost"
                        aria-label={t("crmHistoryToggleFor", {
                          title: opportunity.title,
                        })}
                        aria-expanded={expandedOpportunity === opportunity.id}
                        aria-controls={`crm-history-${opportunity.id}`}
                        onClick={() =>
                          setExpandedOpportunity((current) =>
                            current === opportunity.id
                              ? undefined
                              : opportunity.id,
                          )
                        }
                      >
                        <History size={16} aria-hidden="true" />
                        {t("crmHistoryToggle")}
                      </Button>
                      {expandedOpportunity === opportunity.id && (
                        <div
                          className="crm-opportunity-history-panel"
                          id={`crm-history-${opportunity.id}`}
                        >
                          <OpportunityHistory
                            actor={actor}
                            organisationId={organisationId}
                            opportunityId={opportunity.id}
                          />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
      <nav className="crm-pagination" aria-label={t("crmPaginationLabel")}>
        <Button
          variant="ghost"
          disabled={page === 0}
          onClick={() => setPage((current) => Math.max(0, current - 1))}
        >
          {t("crmPreviousPage")}
        </Button>
        <span aria-live="polite">{t("crmPageNumber", { page: page + 1 })}</span>
        <Button
          variant="ghost"
          disabled={
            !opportunities.data.hasNextPage ||
            page * CRM_PAGE_SIZE >= CRM_MAX_OFFSET ||
            opportunities.isPlaceholderData
          }
          onClick={() => setPage((current) => current + 1)}
        >
          {t("crmNextPage")}
        </Button>
      </nav>
      {opportunities.data.hasNextPage &&
        page * CRM_PAGE_SIZE >= CRM_MAX_OFFSET && (
          <Notice>{t("crmPageLimitReached")}</Notice>
        )}
    </section>
  );
}
