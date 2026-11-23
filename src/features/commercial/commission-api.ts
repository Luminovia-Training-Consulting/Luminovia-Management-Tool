/**
 * Private gross/platform/net projections and cent-exact display helpers. Legacy net-only offers
 * keep unknown gross values as null; a local preview never replaces an accepted server snapshot.
 */
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";

/** Server-derived capabilities for gross-price management, client memberships and course requests. */
export interface CommissionAccess {
  can_manage_gross: boolean;
  can_manage_own_course_pricing?: boolean;
  can_manage_client_memberships: boolean;
  can_request: boolean;
  regular_lecturer_percent?: number | null;
  senior_lecturer_percent?: number | null;
  policy_version?: number;
  policy_configured?: boolean;
}

/** Client-portal organization permitted for the current actor. */
export interface ClientOrganisation {
  id: string;
  name: string;
}

/** Client-request projection with original prices, sessions and actual publication/allocation state. */
export interface ClientRequest {
  id: string;
  organisation_id: string;
  organisation_name: string;
  title: string;
  description: string;
  delivery_type: "online" | "onsite";
  location: string;
  time_zone: string;
  gross_amount: number;
  gross_total_amount: number;
  currency: "EUR" | "AUD";
  rate_unit: string;
  sessions: { starts_at: string; ends_at: string }[];
  topic_ids: string[];
  status: "submitted" | "published" | "assigned" | "cancelled";
  job_id: string | null;
  assigned_lecturer_id: string | null;
  assigned_lecturer_name: string | null;
  assigned_lecturers?: { id: string; display_name: string }[];
  created_at: string;
}

/** Price/claim projection with explicitly nullable historical gross values. */
export interface CommissionRecord {
  job_id: string;
  claim_id: string | null;
  organisation_id: string | null;
  organisation_name: string;
  title: string;
  status: string;
  pricing_model: "commission" | "legacy_net";
  currency: "EUR" | "AUD";
  gross_amount: number | null;
  gross_total_amount: number | null;
  platform_percent: number | null;
  platform_total_amount: number | null;
  lecturer_net_amount: number;
  lecturer_net_total_amount: number;
  lecturer_id: string | null;
  lecturer_name: string | null;
  accepted_at: string | null;
  capacity?: number;
}

/** Organization/currency summary of confirmed client projections. */
export interface ClientSpend {
  organisation_id: string;
  organisation_name: string;
  currency: "EUR" | "AUD";
  request_count: number;
  published_count: number;
  assigned_count: number;
  gross_total_amount: number;
  gross_assigned_amount: number;
  teachers: { id: string; display_name: string }[];
}

/** Historical accepted customer-fee totals; the server deliberately omits internal shares. */
export interface CompanyMonthlySpending {
  organisation_id: string;
  organisation_name: string;
  time_zone: string;
  currency: "EUR" | "AUD";
  month_start: string;
  gross_amount: number;
  claim_count: number;
}

/** Separate cache scopes for access, organizations, requests, revenue and client spending. */
export const commissionKeys = {
  access: (actor: string) => ["commission-access", actor] as const,
  organisations: (actor: string) => ["client-organisations", actor] as const,
  requests: (actor: string) => ["client-requests", actor] as const,
  report: (actor: string) => ["commission-report", actor] as const,
  spend: (actor: string) => ["client-spend", actor] as const,
  monthlySpending: (actor: string, organisation: string | null) =>
    ["company-monthly-spending", actor, organisation] as const,
};
/** Read the commission_access server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const commissionAccessQuery = (actor: string) =>
  queryOptions({
    queryKey: commissionKeys.access(actor),
    queryFn: async () => {
      const { data, error } = await db().rpc("commission_access");
      if (error) throw error;
      return data as CommissionAccess;
    },
    staleTime: 1000,
  });
/** Read the policy captured for this offer; later global policy edits do not reprice it. */
export const offerPolicyQuery = (actor: string, job: string) =>
  queryOptions({
    queryKey: ["commission-offer-policy", actor, job],
    queryFn: async () => {
      const { data, error } = await db().rpc("commission_offer_policy", {
        p_job_id: job,
      });
      if (error) throw error;
      return data as
        | (Pick<
            CommissionAccess,
            | "regular_lecturer_percent"
            | "senior_lecturer_percent"
            | "policy_version"
          > & {
            platform_percent_override?: number | null;
            gross_amount?: number;
            gross_total_amount?: number;
          })
        | null;
    },
  });
/** Read the client_organisations server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const clientOrganisationsQuery = (actor: string) =>
  queryOptions({
    queryKey: commissionKeys.organisations(actor),
    queryFn: async () => {
      const { data, error } = await db().rpc("client_organisations");
      if (error) throw error;
      return (data ?? []) as ClientOrganisation[];
    },
  });
/** Read the client_requests server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const clientRequestsQuery = (
  actor: string,
  organisation: string | null = null,
) =>
  queryOptions({
    queryKey: [...commissionKeys.requests(actor), organisation],
    queryFn: async () => {
      const { data, error } = await db().rpc("client_requests", {
        p_organisation_id: organisation,
      });
      if (error) throw error;
      return (data ?? []) as ClientRequest[];
    },
    refetchInterval: 10000,
  });
/** Read the commission_report server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const commissionReportQuery = (
  actor: string,
  organisation: string | null = null,
) =>
  queryOptions({
    queryKey: [...commissionKeys.report(actor), organisation],
    queryFn: async () => {
      const { data, error } = await db().rpc("commission_report", {
        p_organisation_id: organisation,
      });
      if (error) throw error;
      return (data ?? []) as CommissionRecord[];
    },
  });
/** Read the client_spend_summary server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const clientSpendQuery = (actor: string) =>
  queryOptions({
    queryKey: commissionKeys.spend(actor),
    queryFn: async () => {
      const { data, error } = await db().rpc("client_spend_summary");
      if (error) throw error;
      return (data ?? []) as ClientSpend[];
    },
  });

/** Accepted ledger snapshots only, filtered again by current company membership in PostgreSQL. */
export async function readCompanyMonthlySpending(organisation: string | null) {
  const { data, error } = await db().rpc("company_monthly_accepted_spending", {
    p_organisation_id: organisation,
  });
  if (error) throw error;
  return (data ?? []) as CompanyMonthlySpending[];
}

/** Cache the existing spending projection separately for each actor and company filter. */
export const companyMonthlySpendingQuery = (
  actor: string,
  organisation: string | null,
) =>
  queryOptions({
    queryKey: commissionKeys.monthlySpending(actor, organisation),
    queryFn: () => readCompanyMonthlySpending(organisation),
    staleTime: 15000,
    refetchInterval: 15000,
  });

/** Empty restores the captured role and individual pricing workflow. */
export function parseCourseCommission(value: string): number | null {
  if (value === "") return null;
  const percent = Number(value);
  return /^\d+(?:\.\d{1,2})?$/.test(value) && percent <= 100 ? percent : NaN;
}

/** Match the server quote: round the lecturer share first, then subtract from gross. */
export function splitFee(gross: number, lecturerPercent: number) {
  // Integer cents and percentage basis points prevent divergent remainders
  // between the two shares of a display-only preview.
  const cents = Math.round(gross * 100);
  const bps = Math.round(lecturerPercent * 100);
  if (
    !Number.isSafeInteger(cents) ||
    gross < 0 ||
    bps < 0 ||
    bps > 10000 ||
    !Number.isFinite(bps) ||
    lecturerPercent < 0 ||
    lecturerPercent > 100
  )
    throw new Error("invalid_price");
  const lecturer = Number((BigInt(cents) * BigInt(bps) + 5000n) / 10_000n);
  return {
    gross: cents / 100,
    platform: (cents - lecturer) / 100,
    lecturer: lecturer / 100,
  };
}

/** Count offers once per job/capacity and accepted claims individually; count unknown gross values separately. */
export function revenueTotals(rows: CommissionRecord[]) {
  const quotedJobs = new Set<string>();
  const groups = new Map<
    string,
    {
      currency: "EUR" | "AUD";
      offered: number;
      accepted: number;
      lecturer: number;
      platform: number;
      count: number;
      unknown: number;
    }
  >();
  for (const row of rows) {
    const group = groups.get(row.currency) ?? {
      currency: row.currency,
      offered: 0,
      accepted: 0,
      lecturer: 0,
      platform: 0,
      count: 0,
      unknown: 0,
    };
    if (
      (row.status !== "archived" || row.claim_id) &&
      row.gross_total_amount !== null &&
      !quotedJobs.has(row.job_id)
    ) {
      // The quote is per lecturer position; repeated accepted-claim rows must
      // not multiply a course budget a second time.
      group.offered +=
        Math.round(Number(row.gross_total_amount) * 100) * (row.capacity ?? 1);
      quotedJobs.add(row.job_id);
    }
    if (row.claim_id) {
      group.lecturer += Math.round(Number(row.lecturer_net_total_amount) * 100);
      group.count++;
      // Bei alten reinen Nettoangeboten existiert keine belegte Bruttohistorie.
      // Missing values stay unknown instead of being reverse-calculated.
      if (row.gross_total_amount === null || row.platform_total_amount === null)
        group.unknown++;
      else {
        group.accepted += Math.round(Number(row.gross_total_amount) * 100);
        group.platform += Math.round(Number(row.platform_total_amount) * 100);
      }
    }
    groups.set(row.currency, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    offered: group.offered / 100,
    accepted: group.accepted / 100,
    lecturer: group.lecturer / 100,
    platform: group.platform / 100,
  }));
}
