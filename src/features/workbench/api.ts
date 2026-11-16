// Workbench RPC DTOs are validated here; database capabilities and CAS versions
// remain authoritative. Actor identifiers scope caches, never permissions.
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { validZone } from "../../lib/dates";

const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
export const taskSchema = z.object({
  id: uuid,
  creator_id: uuid,
  assignee_id: uuid,
  assignee_name: z.string(),
  title: z.string(),
  description: z.string(),
  scope: z.enum(["private", "operations"]),
  state: z.enum(["open", "doing", "done", "cancelled"]),
  due_at: instant.nullable(),
  time_zone: z.string().refine(validZone),
  source_room_id: uuid.nullable(),
  source_message_id: uuid.nullable(),
  version: z.number().int().positive(),
  created_at: instant,
  updated_at: instant,
});
export type WorkTask = z.infer<typeof taskSchema>;
// Direct links fetch a fresh authorized task even when it is beyond list pages.
export const workTaskDetailQuery = (actor: string, id: string | null) =>
  queryOptions({
    queryKey: ["work-task-detail", actor, id],
    enabled: Boolean(id),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("work_task_detail", { p_id: id })
        .abortSignal(signal);
      if (error) throw error;
      return taskSchema.nullable().parse(data);
    },
    staleTime: 0,
  });
export const templateSchema = z.object({
  id: uuid,
  title: z.string(),
  shared: z.boolean(),
  archived: z.boolean(),
  items: z.array(
    z.object({ title: z.string(), days: z.number().int().min(0).max(365) }),
  ),
  version: z.number().int().positive(),
  can_edit: z.boolean(),
});
export type WorkTemplate = z.infer<typeof templateSchema>;
const tasksPageSchema = z.object({
  can_manage: z.boolean(),
  items: z.array(taskSchema),
  templates: z.array(templateSchema),
  assignees: z.array(z.object({ id: uuid, name: z.string() })),
});
interface Cursor {
  at: string;
  id: string;
}
export const workKeys = (actor: string) => ["work-tasks", actor];
export const tasksQuery = (actor: string, state: string) =>
  infiniteQueryOptions({
    queryKey: [...workKeys(actor), state],
    initialPageParam: null as Cursor | null,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await db()
        .rpc("work_tasks", {
          p_before_at: pageParam?.at ?? null,
          p_before_id: pageParam?.id ?? null,
          p_limit: 50,
          p_state: state,
        })
        .abortSignal(signal);
      if (error) throw error;
      return tasksPageSchema.parse(data);
    },
    getNextPageParam: (page): Cursor | undefined => {
      const last = page.items.at(-1);
      return page.items.length === 50 && last
        ? { at: last.created_at, id: last.id }
        : undefined;
    },
    staleTime: 15000,
  });
export async function saveTask(
  id: string | null,
  payload: Record<string, unknown>,
  version: number,
  clientId: string | null,
) {
  requireOnline();
  const { data, error } = await db().rpc("save_work_task", {
    p_id: id,
    p_payload: payload,
    p_expected_version: version,
    p_client_id: clientId,
  });
  if (error) throw error;
  return taskSchema.parse(data);
}
/** Apply all selected exact versions atomically; the server rejects stale sets. */
export async function bulkTaskState(
  items: { id: string; version: number }[],
  state: WorkTask["state"],
) {
  requireOnline();
  const { data, error } = await db().rpc("bulk_work_task_state", {
    p_items: items,
    p_state: state,
  });
  if (error) throw error;
  return z.number().int().nonnegative().parse(data);
}
export const taskHistoryQuery = (actor: string, task: string | null) =>
  queryOptions({
    queryKey: ["work-task-history", actor, task],
    enabled: Boolean(task),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("work_task_history", { p_id: task })
        .abortSignal(signal);
      if (error) throw error;
      return z
        .array(
          z.object({
            id: z.number(),
            at: instant,
            before: taskSchema.nullable(),
            after: taskSchema,
          }),
        )
        .parse(data);
    },
    staleTime: 0,
  });
export async function saveTemplate(
  id: string | null,
  payload: Record<string, unknown>,
  version: number,
) {
  requireOnline();
  const { data, error } = await db().rpc("save_work_template", {
    p_id: id,
    p_payload: payload,
    p_expected_version: version,
  });
  if (error) throw error;
  return z
    .object({ id: uuid, version: z.number().int().positive() })
    .parse(data);
}
/** Keep clientId stable until confirmed so an uncertain retry creates no duplicates. */
export async function applyTemplate(
  id: string,
  version: number,
  clientId: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("apply_work_template", {
    p_id: id,
    p_expected_version: version,
    p_client_id: clientId,
  });
  if (error) throw error;
  return z.array(uuid).parse(data);
}
export const favouritesQuery = (actor: string, search: string) =>
  queryOptions({
    queryKey: ["favourites", actor, search],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("my_favourites", { p_search: search })
        .abortSignal(signal);
      if (error) throw error;
      return z
        .object({
          items: z.array(
            z.object({
              kind: z.enum(["topic", "organisation"]),
              id: uuid,
              label: z.string(),
              created_at: instant,
            }),
          ),
          organisations: z.array(z.object({ id: uuid, label: z.string() })),
        })
        .parse(data);
    },
    staleTime: 15000,
  });
export async function setFavourite(
  kind: "topic" | "organisation",
  id: string,
  enabled: boolean,
) {
  requireOnline();
  const { data, error } = await db().rpc("set_favourite", {
    p_kind: kind,
    p_id: id,
    p_enabled: enabled,
  });
  if (error) throw error;
  return z.boolean().parse(data);
}
export const recommendationsQuery = (actor: string) =>
  queryOptions({
    queryKey: ["job-recommendations", actor],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("recommended_jobs")
        .abortSignal(signal);
      if (error) throw error;
      return z
        .array(
          z.object({
            id: uuid,
            title: z.string(),
            customer: z.string(),
            starts_at: instant,
            time_zone: z.string().refine(validZone),
            topic_matches: z.number().int(),
            favourite_topic: z.boolean(),
            favourite_customer: z.boolean(),
          }),
        )
        .parse(data);
    },
    staleTime: 15000,
  });
