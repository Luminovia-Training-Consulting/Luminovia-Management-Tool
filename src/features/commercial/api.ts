/**
 * Contract/finance queries and local export preparation for authorized records. Scope parameters
 * request a projection rather than granting access; keep original currencies separate and
 * protect CSV cells against formula execution.
 */
import type { CurrencyCode } from "../../lib/currencies.ts";
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import {
  financePendingInvoiceExceptionsSchema,
  invoiceExceptionOptionsSchema,
  myInvoiceExceptionsSchema,
} from "./invoice-exception-schema";
import {
  invoiceSeriesOptionsSchema,
  invoiceSeriesRecordsSchema,
} from "./invoice-series-schema";
import { invoiceSeriesCorrectionsSchema } from "./invoice-series-correction-schema";
import type {
  CommercialAccess,
  CommercialPerson,
  ContractRecord,
  EarningRecord,
  InvoicePayment,
  InvoiceRecord,
  InvoiceReviewCandidate,
  InvoiceReviewCase,
} from "./types";

/** Shared actor-scoped commercial query prefixes for targeted invalidation. */
export const commercialKeys = {
  access: (actor: string) => ["commercial-access", actor] as const,
  contracts: (actor: string) => ["contracts", actor] as const,
  finance: (actor: string) => ["finance", actor] as const,
};
/** Read the commercial_access server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const commercialAccessQuery = (actor: string) =>
  queryOptions({
    queryKey: commercialKeys.access(actor),
    queryFn: async () => {
      const { data, error } = await db().rpc("commercial_access");
      if (error) throw error;
      return data as CommercialAccess;
    },
    staleTime: 1000,
  });
/** Read the commercial_people server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const commercialPeopleQuery = (actor: string) =>
  queryOptions({
    queryKey: ["commercial-people", actor],
    queryFn: async () => {
      const { data, error } = await db().rpc("commercial_people");
      if (error) throw error;
      return (data ?? []) as CommercialPerson[];
    },
  });
/** Check one target against the same server-authorized directory without transferring its other rows. */
export const commercialPersonEligibleQuery = (
  actor: string,
  personId: string,
) =>
  queryOptions({
    queryKey: ["commercial-people", actor, personId],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("commercial_people")
        .select("id")
        .eq("id", personId)
        .abortSignal(signal)
        .maybeSingle<{ id: string }>();
      if (error) throw error;
      return data?.id === personId;
    },
  });
/** Read the contract_records server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const contractsQuery = (
  actor: string,
  all: boolean,
  lecturer?: string,
) =>
  queryOptions({
    queryKey: [...commercialKeys.contracts(actor), all, lecturer ?? null],
    queryFn: async ({ signal }) => {
      const request = db().rpc("contract_records", {
        p_all: all,
      });
      // The RPC still verifies the requested access. The filter limits this view's response.
      const { data, error } = await (lecturer
        ? request.eq("user_id", lecturer).abortSignal(signal)
        : request);
      if (error) throw error;
      return (data ?? []) as ContractRecord[];
    },
  });
/** Read the finance_earnings server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const earningsQuery = (actor: string, all: boolean) =>
  queryOptions({
    queryKey: [...commercialKeys.finance(actor), "earnings", all],
    queryFn: async () => {
      const { data, error } = await db().rpc("finance_earnings", {
        p_all: all,
      });
      if (error) throw error;
      return (data ?? []) as EarningRecord[];
    },
  });
/** Read only the caller's cancelled/partial accepted blocks that require a finance review. */
export const invoiceReviewCandidatesQuery = (actor: string) =>
  queryOptions({
    queryKey: [...commercialKeys.finance(actor), "invoice-review-candidates"],
    queryFn: async () => {
      const { data, error } = await db().rpc("my_invoice_review_candidates");
      if (error) throw error;
      return (data ?? []) as InvoiceReviewCandidate[];
    },
  });
/** Read pending invoice-review cases only for current finance administrators. */
export const invoiceReviewCasesQuery = (actor: string) =>
  queryOptions({
    queryKey: [...commercialKeys.finance(actor), "invoice-review-cases"],
    queryFn: async () => {
      const { data, error } = await db().rpc("invoice_review_cases");
      if (error) throw error;
      return (data ?? []) as InvoiceReviewCase[];
    },
  });

export const invoiceExceptionOptionsQuery = (actor: string, request: string) =>
  queryOptions({
    queryKey: [...commercialKeys.finance(actor), "exception-options", request],
    queryFn: async () => {
      const { data, error } = await db().rpc("invoice_exception_options", {
        p_request_id: request,
      });
      if (error) throw error;
      return invoiceExceptionOptionsSchema.parse(data);
    },
    retry: false,
  });

export const myInvoiceExceptionsQuery = (actor: string) =>
  queryOptions({
    queryKey: [...commercialKeys.finance(actor), "my-exceptions"],
    queryFn: async () => {
      const { data, error } = await db().rpc("my_invoice_exceptions");
      if (error) throw error;
      return myInvoiceExceptionsSchema.parse(data);
    },
    retry: false,
  });
export const financePendingInvoiceExceptionsQuery = (actor: string) =>
  queryOptions({
    queryKey: [...commercialKeys.finance(actor), "pending-finance-approvals"],
    queryFn: async () => {
      const { data, error } = await db().rpc(
        "finance_pending_invoice_exceptions",
      );
      if (error) throw error;
      return financePendingInvoiceExceptionsSchema.parse(data);
    },
    retry: false,
  });
/** Read all scoped invoices in stable pages before exposing them to search or export. */
export const invoicesQuery = (actor: string, all: boolean) =>
  queryOptions({
    queryKey: [...commercialKeys.finance(actor), "invoices", all],
    queryFn: async ({ signal }) => {
      const size = 250;
      const invoices: InvoiceRecord[] = [];
      let cursor: InvoiceRecord | undefined;
      for (;;) {
        const { data, error } = await db()
          .rpc("invoice_records", {
            p_all: all,
            p_page_limit: size,
            p_before_at: cursor?.created_at ?? null,
            p_before_id: cursor?.id ?? null,
          })
          .abortSignal(signal);
        if (error) throw error;
        const page = (data ?? []) as InvoiceRecord[];
        invoices.push(...page);
        if (page.length < size) return invoices;
        cursor = page.at(-1);
      }
    },
  });
/** Read the invoice_payments server projection, propagate RPC errors and scope cached data to the actor and requested resource. */
export const paymentsQuery = (actor: string, invoice: string) =>
  queryOptions({
    queryKey: [...commercialKeys.finance(actor), "payments", invoice],
    queryFn: async () => {
      const { data, error } = await db().rpc("invoice_payments", {
        p_invoice_id: invoice,
      });
      if (error) throw error;
      return (data ?? []) as InvoicePayment[];
    },
  });

export { csvCell, csvText, downloadCsv } from "../../lib/csv";

type EarningAmounts = Record<EarningRecord["stage"], number>;

const emptyEarningAmounts: EarningAmounts = {
  expected: 0,
  review: 0,
  completed: 0,
  invoiced: 0,
  paid: 0,
};

function earningAmountsFromCents({
  expected,
  review,
  completed,
  invoiced,
  paid,
}: EarningAmounts): EarningAmounts {
  return {
    expected: expected / 100,
    review: review / 100,
    completed: completed / 100,
    invoiced: invoiced / 100,
    paid: paid / 100,
  };
}

/** Sum fee states in integer cents per original currency, without mixing currencies. */
export function groupedEarnings(rows: EarningRecord[]) {
  const groups = new Map<CurrencyCode, EarningAmounts>();
  for (const row of rows) {
    const group = groups.get(row.currency) ?? { ...emptyEarningAmounts };
    group[row.stage] += Math.round(Number(row.total_amount) * 100);
    groups.set(row.currency, group);
  }
  return [...groups].map(([currency, group]) => ({
    currency,
    ...earningAmountsFromCents(group),
  }));
}

export type InvoiceDueState =
  "early" | "half_term" | "due_soon" | "overdue" | "paid" | "inactive";

/** Parse a stored calendar date without applying a browser locale or timezone offset. */
function dateOrdinal(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const ordinal = Date.UTC(year, month - 1, day);
  return new Date(ordinal).toISOString().slice(0, 10) === value
    ? ordinal / 86400000
    : null;
}

/** Classify the due term at the supplied local calendar day; partial balances remain unpaid. */
export function invoiceDueState(
  invoice: Pick<
    InvoiceRecord,
    "issued_on" | "due_on" | "status" | "total_amount" | "paid_amount"
  >,
  today: string,
): InvoiceDueState {
  if (invoice.status === "cancelled" || invoice.status === "rejected")
    return "inactive";
  const totalCents = Math.max(
    0,
    Math.round(Number(invoice.total_amount) * 100),
  );
  const paidCents = Math.max(0, Math.round(Number(invoice.paid_amount) * 100));
  if (invoice.status === "paid" || (totalCents > 0 && paidCents >= totalCents))
    return "paid";
  const issueOrdinal = dateOrdinal(invoice.issued_on),
    dueOrdinal = dateOrdinal(invoice.due_on),
    todayOrdinal = dateOrdinal(today);
  if (issueOrdinal === null || dueOrdinal === null || todayOrdinal === null)
    return "inactive";
  if (todayOrdinal > dueOrdinal) return "overdue";
  if (dueOrdinal - todayOrdinal <= 7) return "due_soon";
  const termDays = dueOrdinal - issueOrdinal,
    elapsedDays = todayOrdinal - issueOrdinal;
  return termDays > 0 && elapsedDays * 2 >= termDays ? "half_term" : "early";
}

/** Order actionable overdue/due-soon invoices before later, paid or inactive records. */
export function invoicesDueFirst(rows: InvoiceRecord[], today: string) {
  const priority: Record<InvoiceDueState, number> = {
    overdue: 0,
    due_soon: 1,
    half_term: 2,
    early: 3,
    paid: 4,
    inactive: 5,
  };
  return rows
    .map((invoice, index) => ({
      invoice,
      index,
      state: invoiceDueState(invoice, today),
    }))
    .sort(
      (left, right) =>
        priority[left.state] - priority[right.state] ||
        left.invoice.due_on.localeCompare(right.invoice.due_on) ||
        left.index - right.index,
    )
    .map(({ invoice }) => invoice);
}

export type MonthlyEarningsTrend = EarningAmounts & {
  currency: CurrencyCode;
  month: string;
};

/** Aggregate the authorized earnings projection into IANA-zone month buckets without combining currencies. */
export function monthlyEarningsTrend(
  rows: EarningRecord[],
  zone: string,
): MonthlyEarningsTrend[] {
  const formatter = new Intl.DateTimeFormat("en", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
  });
  const groups = new Map<string, MonthlyEarningsTrend>();
  for (const row of rows) {
    const timestamp = Date.parse(row.ends_at || row.starts_at);
    if (!Number.isFinite(timestamp)) continue;
    const parts = formatter.formatToParts(new Date(timestamp)),
      year = parts.find((part) => part.type === "year")?.value,
      month = parts.find((part) => part.type === "month")?.value;
    if (!year || !month) continue;
    const monthKey = `${year}-${month}`,
      key = `${row.currency}:${monthKey}`;
    const group = groups.get(key) ?? {
      currency: row.currency,
      month: monthKey,
      ...emptyEarningAmounts,
    };
    group[row.stage] += Math.round(Number(row.total_amount) * 100);
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort(
      (left, right) =>
        left.currency.localeCompare(right.currency) ||
        left.month.localeCompare(right.month),
    )
    .map(({ currency, month, ...group }) => ({
      currency,
      month,
      ...earningAmountsFromCents(group),
    }));
}

/** Aggregate company invoice volumes by issue month while retaining received payments separately. */
export type MonthlyInvoiceTrend = {
  currency: CurrencyCode;
  month: string;
  invoiced: number;
  paid: number;
  outstanding: number;
};

export function monthlyInvoiceTrend(
  rows: InvoiceRecord[],
): MonthlyInvoiceTrend[] {
  const groups = new Map<string, MonthlyInvoiceTrend>();
  for (const row of rows) {
    if (dateOrdinal(row.issued_on) === null) continue;
    const month = row.issued_on.slice(0, 7),
      key = `${row.currency}:${month}`;
    const group = groups.get(key) ?? {
      currency: row.currency,
      month,
      invoiced: 0,
      paid: 0,
      outstanding: 0,
    };
    const paidCents = Math.max(
        0,
        Math.round((Number(row.paid_amount) || 0) * 100),
      ),
      totalCents = Math.max(
        0,
        Math.round((Number(row.total_amount) || 0) * 100),
      ),
      active = row.status !== "rejected" && row.status !== "cancelled";
    group.paid += paidCents;
    if (active) {
      group.invoiced += totalCents;
      group.outstanding += Math.max(0, totalCents - paidCents);
    }
    groups.set(key, group);
  }
  return [...groups.values()]
    .sort(
      (left, right) =>
        left.currency.localeCompare(right.currency) ||
        left.month.localeCompare(right.month),
    )
    .map(({ currency, month, invoiced, paid, outstanding }) => ({
      currency,
      month,
      invoiced: invoiced / 100,
      paid: paid / 100,
      outstanding: outstanding / 100,
    }));
}

/** Normalize unique comma-separated labels; reject oversized or control-character input. */
export function parseInvoiceLabels(value: string) {
  const labels = [
    ...new Set(
      value
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  ];
  if (
    labels.length > 10 ||
    labels.some(
      (label) =>
        label.length > 50 ||
        Array.from(label).some(
          (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
        ),
    )
  )
    throw new Error("labels_invalid");
  return labels;
}

export const invoiceSeriesRecordsQuery = (actor: string, all: boolean) =>
  queryOptions({
    queryKey: [...commercialKeys.finance(actor), "invoice-series", all],
    queryFn: async () => {
      const { data, error } = await db().rpc("invoice_series_records", {
        p_all: all,
      });
      if (error) throw error;
      return invoiceSeriesRecordsSchema.parse(data);
    },
    retry: false,
  });

export const invoiceSeriesOptionsQuery = (actor: string, claimId: string) =>
  queryOptions({
    queryKey: [
      ...commercialKeys.finance(actor),
      "invoice-series-options",
      claimId,
    ],
    queryFn: async () => {
      const { data, error } = await db().rpc("invoice_series_options", {
        p_claim_id: claimId,
      });
      if (error) throw error;
      return invoiceSeriesOptionsSchema.parse(data);
    },
    retry: false,
  });

export const invoiceSeriesCorrectionsQuery = (
  actor: string,
  claimId: string | null,
  all: boolean,
) =>
  queryOptions({
    queryKey: [
      ...commercialKeys.finance(actor),
      "invoice-series-corrections",
      claimId,
      all,
    ],
    queryFn: async () => {
      const { data, error } = await db().rpc("invoice_series_corrections", {
        p_claim_id: claimId,
        p_all: all,
      });
      if (error) throw error;
      return invoiceSeriesCorrectionsSchema.parse(data);
    },
    retry: false,
  });
