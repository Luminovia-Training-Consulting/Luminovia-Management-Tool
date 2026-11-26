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
import { useForm } from "react-hook-form";
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

type OpportunityForm = z.infer<typeof opportunityFormSchema>;

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
              : t("crmOpportunityStageChanged", {
                  from: t(`crmStage.${event.from_stage}`),
                  to: t(`crmStage.${event.to_stage}`),
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
          {page === 0 && search.trim() === "" && stageFilter === "all"
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
