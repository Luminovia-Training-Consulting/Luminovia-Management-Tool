import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";

export const supportCategories = [
  "technical",
  "account",
  "assignment",
  "scheduling",
  "documents",
  "contract",
  "invoice",
  "general",
  "feature",
] as const;
export const supportStatuses = [
  "open",
  "in_progress",
  "waiting_for_user",
  "resolved",
  "closed",
] as const;
const ticketSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  category: z.enum(supportCategories),
  status: z.enum(supportStatuses),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  version: z.number().int().positive(),
  requester_name: z.string(),
  assigned_name: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  mine: z.boolean(),
});
const ticketDetailSchema = ticketSchema.extend({
  description: z.string(),
  assigned_to: z.uuid().nullable(),
  resolved_at: z.string().nullable(),
  closed_at: z.string().nullable(),
  can_manage: z.boolean(),
  can_reopen: z.boolean(),
  course_run_id: z.uuid().nullable(),
  claim_id: z.uuid().nullable(),
  organisation_id: z.uuid().nullable(),
  messages: z.array(
    z.object({
      id: z.uuid(),
      author_name: z.string(),
      body: z.string(),
      internal: z.boolean(),
      created_at: z.string(),
    }),
  ),
  events: z.array(
    z.object({
      id: z.uuid(),
      actor_name: z.string(),
      action: z.string(),
      reason: z.string(),
      previous_status: z.string().nullable(),
      new_status: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
  attachments: z.array(
    z.object({
      id: z.uuid(),
      document_id: z.uuid(),
      version_id: z.uuid(),
      name: z.string(),
      internal: z.boolean(),
      created_at: z.string(),
    }),
  ),
});
const contextSchema = z.object({
  can_manage: z.boolean(),
  staff: z.array(z.object({ id: z.uuid(), name: z.string() })),
  courses: z.array(z.object({ id: z.uuid(), label: z.string() })),
  claims: z.array(z.object({ id: z.uuid(), label: z.string() })),
  organisations: z.array(z.object({ id: z.uuid(), label: z.string() })),
  report: z.array(
    z.object({
      category: z.enum(supportCategories),
      total: z.number(),
      outstanding: z.number(),
      resolution_hours: z.number().nullable(),
    }),
  ),
});
const pageSchema = z.object({
  items: z.array(ticketSchema),
  has_more: z.boolean(),
  next_cursor: z.object({ at: z.string(), id: z.uuid() }).nullable(),
});
export const newTicketSchema = z.object({
  title: z.string().trim().min(1).max(200),
  category: z.enum(supportCategories),
  description: z.string().trim().min(1).max(12000),
  course_run_id: z.union([z.literal(""), z.uuid()]),
  claim_id: z.union([z.literal(""), z.uuid()]),
  organisation_id: z.union([z.literal(""), z.uuid()]),
});
export type SupportTicket = z.infer<typeof ticketDetailSchema>;
type Cursor = z.infer<typeof pageSchema>["next_cursor"];
type Context = z.infer<typeof contextSchema>;
export type SupportAction =
  | "reply"
  | "internal_note"
  | "status"
  | "assign"
  | "priority"
  | "reopen"
  | "links"
  | "attach";

export const supportContextQuery = (actor: string) =>
  queryOptions({
    queryKey: ["support-context", actor],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("support_context")
        .abortSignal(signal);
      if (error) throw error;
      return contextSchema.parse(data);
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
      return pageSchema.parse(data);
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
      return ticketDetailSchema.parse(data);
    },
    retry: false,
    staleTime: 0,
    refetchInterval: 30000,
  });
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
export function supportError(error: unknown) {
  const code =
    error && typeof error === "object" && "code" in error ? error.code : "";
  return code === "40001"
    ? "conflict"
    : code === "42501"
      ? "denied"
      : code === "54000"
        ? "rateLimit"
        : "error";
}
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
export type SupportContext = Context;
