/** Ticket ownership and current support capability govern replies, internal notes and dedicated scanned attachments; support never grants unrelated private-resource access. Actor-scoped memory queries validate server projections; online mutations carry reviewed versions and retry identities. */
import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";

import {
  newTicketSchema,
  supportContextSchema,
  supportPageSchema,
  supportTicketDetailSchema,
  type Cursor,
  type SupportAction,
  type SupportTicket,
} from "./schema";
export {
  newTicketSchema,
  supportCategories,
  supportStatuses,
  type SupportAction,
  type SupportContext,
  type SupportTicket,
} from "./schema";

export const supportContextQuery = (actor: string) =>
  queryOptions({
    queryKey: ["support-context", actor],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("support_context")
        .abortSignal(signal);
      if (error) throw error;
      return supportContextSchema.parse(data);
    },
    retry: false,
    staleTime: 0,
  });
export const supportTicketsQuery = (
  actor: string,
  search: string,
  status: string,
  cursor: Cursor,
) =>
  queryOptions({
    queryKey: ["support-tickets", actor, search, status, cursor],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("support_tickets", {
          p_search: search,
          p_status: status,
          p_before_at: cursor?.at ?? null,
          p_before_id: cursor?.id ?? null,
          p_limit: 40,
        })
        .abortSignal(signal);
      if (error) throw error;
      return supportPageSchema.parse(data);
    },
    retry: false,
    staleTime: 0,
  });
export const supportTicketQuery = (actor: string, id: string) =>
  queryOptions({
    queryKey: ["support-ticket", actor, id],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("support_ticket", { p_ticket_id: id })
        .abortSignal(signal);
      if (error) throw error;
      return supportTicketDetailSchema.parse(data);
    },
    retry: false,
    staleTime: 0,
    refetchInterval: 30000,
  });

/** Validate bounded authored fields before sending an idempotent online create request. */
export async function createTicket(
  payload: z.infer<typeof newTicketSchema>,
  request: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("create_support_ticket", {
    p_payload: newTicketSchema.parse(payload),
    p_request_id: request,
  });
  if (error) throw error;
  return z.uuid().parse(data);
}

/** Require the reviewed ticket version and request identity for every reply or lifecycle mutation. */
export async function updateTicket(
  ticket: string,
  action: SupportAction,
  payload: Record<string, unknown>,
  version: number,
  request: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("update_support_ticket", {
    p_ticket_id: ticket,
    p_action: action,
    p_payload: payload,
    p_expected_version: version,
    p_request_id: request,
  });
  if (error) throw error;
  return z.uuid().parse(data);
}

/** Map known conflicts to translated guidance without echoing internal server error text. */
export function supportError(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error ? error.code : "";
  return code === "PT409" || code === "40001"
    ? "conflict"
    : code === "42501"
      ? "denied"
      : code === "54000"
        ? "rateLimit"
        : "error";
}

/** Offer ordinary lifecycle choices; the database still validates the actor, current status and reason. */
export function supportNextStatuses(status: SupportTicket["status"]) {
  switch (status) {
    case "open":
      return ["in_progress"] as const;
    case "in_progress":
      return ["waiting_for_user", "resolved"] as const;
    case "waiting_for_user":
      return ["in_progress", "resolved"] as const;
    case "resolved":
      return ["closed"] as const;
    default:
      return [];
  }
}
