/** Typed, actor-partitioned access to the organisation-scoped CRM pipeline RPCs. */
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";

/** Database stage identifiers are stable API values; labels are translated in the UI. */
export const crmStageSchema = z.enum([
  "identified",
  "outreach_qualified",
  "contacted",
  "response_received",
  "qualified_opportunity",
  "meeting_scheduled",
  "negotiation",
  "proposal_submitted",
  "contract_pending",
  "contract_signed",
  "active_customer",
  "lost",
  "dormant",
]);

export type CrmStage = z.infer<typeof crmStageSchema>;

/** Bounded board row returned by the organisation-authorised read RPC. */
const opportunitySchema = z.object({
  id: z.uuid(),
  organisation_id: z.uuid(),
  title: z.string(),
  stage: crmStageSchema,
  estimated_value: z.number().nullable(),
  currency: z.enum(["EUR", "AUD", "CHF", "GBP", "USD"]),
  version: z.number().int().positive(),
  created_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
});

/** Persisted opportunity data, including its compare-and-swap version. */
export type CrmOpportunity = z.infer<typeof opportunitySchema>;

/** Fetch one bounded page plus one sentinel row to determine whether another page exists. */
export const CRM_PAGE_SIZE = 25;
export const CRM_PAGE_LIMIT = CRM_PAGE_SIZE + 1;
export const CRM_MAX_OFFSET = 10_000;

export type CrmOpportunityPage = {
  items: CrmOpportunity[];
  hasNextPage: boolean;
};

/** Immutable version event used by the bounded opportunity history view. */
const opportunityEventSchema = z.object({
  id: z.uuid(),
  opportunity_id: z.uuid(),
  organisation_id: z.uuid(),
  version: z.number().int().positive(),
  event_type: z.enum(["created", "stage_changed"]),
  from_stage: crmStageSchema.nullable(),
  to_stage: crmStageSchema,
  actor_id: z.uuid(),
  request_id: z.uuid(),
  occurred_at: z.iso.datetime({ offset: true }),
});

/** A single committed create or stage transition. */
export type CrmOpportunityEvent = z.infer<typeof opportunityEventSchema>;

/** Read a bounded filtered page; PostgreSQL rechecks authority before applying filters. */
export const crmOpportunitiesQuery = (
  actor: string,
  organisationId: string,
  filters: { page: number; search: string; stage: CrmStage | null },
) =>
  queryOptions({
    queryKey: [
      "crm",
      "opportunities",
      actor,
      organisationId,
      filters.page,
      filters.search.trim(),
      filters.stage,
    ],
    queryFn: async () => {
      const offset = filters.page * CRM_PAGE_SIZE;
      const search = filters.search.trim();
      if (
        !Number.isSafeInteger(filters.page) ||
        filters.page < 0 ||
        offset > CRM_MAX_OFFSET ||
        search.length > 200
      ) {
        throw new RangeError("Invalid CRM page request");
      }
      const { data, error } = await db().rpc(
        "list_crm_opportunity_page",
        {
          p_organisation_id: organisationId,
          p_search: search || null,
          p_stage: filters.stage,
          p_limit: CRM_PAGE_LIMIT,
          p_offset: offset,
        },
        { get: true },
      );
      if (error) throw error;
      const rows = z.array(opportunitySchema).parse(data);
      return {
        items: rows.slice(0, CRM_PAGE_SIZE),
        hasNextPage: rows.length > CRM_PAGE_SIZE,
      } satisfies CrmOpportunityPage;
    },
  });

/** Read only the latest 50 persisted events for the selected organisation and opportunity. */
export const crmOpportunityEventsQuery = (
  actor: string,
  organisationId: string,
  opportunityId: string,
) =>
  queryOptions({
    queryKey: [
      "crm",
      "opportunity-events",
      actor,
      organisationId,
      opportunityId,
    ],
    queryFn: async () => {
      const { data, error } = await db().rpc(
        "list_crm_opportunity_events",
        {
          p_organisation_id: organisationId,
          p_opportunity_id: opportunityId,
          p_limit: 50,
        },
        { get: true },
      );
      if (error) throw error;
      return z.array(opportunityEventSchema).parse(data);
    },
  });

/** Create with a caller-retained request ID so uncertain network retries cannot duplicate a card. */
export async function createCrmOpportunity(input: {
  organisationId: string;
  title: string;
  estimatedValue: string | null;
  currency: CrmOpportunity["currency"];
  requestId: string;
}) {
  requireOnline();
  const { data, error } = await db().rpc("create_crm_opportunity", {
    p_organisation_id: input.organisationId,
    p_title: input.title,
    p_estimated_value: input.estimatedValue,
    p_currency: input.currency,
    p_request_id: input.requestId,
  });
  if (error) throw error;
  return z.uuid().parse(data);
}

/** Submit a stage transition against the version most recently displayed to the actor. */
export async function moveCrmOpportunity(input: {
  organisationId: string;
  opportunityId: string;
  stage: CrmStage;
  expectedVersion: number;
  requestId: string;
}) {
  requireOnline();
  const { error } = await db().rpc("move_crm_opportunity", {
    p_organisation_id: input.organisationId,
    p_opportunity_id: input.opportunityId,
    p_stage: input.stage,
    p_expected_version: input.expectedVersion,
    p_request_id: input.requestId,
  });
  if (error) throw error;
}
