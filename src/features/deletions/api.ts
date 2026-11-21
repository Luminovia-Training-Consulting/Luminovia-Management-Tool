/** Caller-scoped permanent-deletion HTTP boundary; no privileged credentials or table names. */
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { accountRequest } from "../accounts/api";
import { requireOnline } from "../../lib/online";

export const deletionAccessSchema = z.object({
  can_admin: z.boolean(),
  kinds: z.array(z.string()),
});
export const deletionTargetSchema = z.object({
  id: z.string(),
  kind: z.string(),
  label: z.string(),
  owner_label: z.string().nullable(),
  can_delete: z.boolean(),
});
export type DeletionTarget = z.infer<typeof deletionTargetSchema>;
export const deletionResourcesSchema = z.object({
  items: z.array(deletionTargetSchema),
  next_cursor: z.string().nullable(),
});
export const deletionPreviewSchema = z.object({
  plan_id: z.string(),
  kind: z.string(),
  id: z.string(),
  label: z.string(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  blockers: z.array(
    z.object({
      code: z.string(),
      kind: z.string(),
      count: z.number().int().nonnegative(),
    }),
  ),
  can_confirm: z.boolean(),
  expires_at: z.string().datetime({ offset: true }),
});
export type DeletionPreview = z.infer<typeof deletionPreviewSchema>;
export const deletionOperationSchema = z.object({
  operation_id: z.string(),
  status: z.enum(["pending", "failed", "completed"]),
  kind: z.string(),
  id: z.string(),
});
export type DeletionOperation = z.infer<typeof deletionOperationSchema>;
export type DeletionAttempt = { plan: DeletionPreview; request: string };
export const deletionAttemptsQuery = (actor: string) =>
  queryOptions({
    queryKey: ["deletions", "attempts", actor],
    queryFn: async (): Promise<DeletionAttempt[]> => [],
    initialData: [] as DeletionAttempt[],
    enabled: false,
  });

/** Recover incomplete server operations after reload; private receipts are never persisted on disk. */
export const deletionReceiptsQuery = (actor: string) =>
  queryOptions({
    queryKey: ["deletions", "receipts", actor],
    queryFn: async ({ signal }): Promise<DeletionOperation[]> =>
      (
        await read(
          "deletions/operations",
          z.object({ items: z.array(deletionOperationSchema) }),
          signal,
        )
      ).items,
    initialData: [] as DeletionOperation[],
    refetchInterval: 30_000,
    staleTime: 0,
    retry: false,
  });

/** React Query cancels publication even when the Edge SDK cannot abort the HTTP transport. */
async function read<T>(
  path: string,
  schema: z.ZodType<T>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const result = schema.parse(await accountRequest(path));
  signal.throwIfAborted();
  return result;
}

export const deletionAccessQuery = (actor: string) =>
  queryOptions({
    queryKey: ["deletions", "access", actor],
    queryFn: ({ signal }) =>
      read("deletions/access", deletionAccessSchema, signal),
    staleTime: 0,
    refetchInterval: 15_000,
    retry: false,
  });
export const deletionResourcesQuery = (
  actor: string,
  kind: string,
  q: string,
  cursor: string | null,
) =>
  queryOptions({
    queryKey: ["deletions", "resources", actor, kind, q, cursor],
    queryFn: ({ signal }) =>
      read(
        `deletions/resources?${new URLSearchParams({ kind, q, ...(cursor === null ? {} : { cursor }), limit: "25" })}`,
        deletionResourcesSchema,
        signal,
      ),
    retry: false,
  });
export const deletionPreviewQuery = (actor: string, kind: string, id: string) =>
  queryOptions({
    queryKey: ["deletions", "preview", actor, kind, id],
    queryFn: async ({ signal }) => {
      requireOnline();
      signal.throwIfAborted();
      const result = deletionPreviewSchema.parse(
        await accountRequest("deletions/preview", "POST", { kind, id }),
      );
      signal.throwIfAborted();
      if (result.kind !== kind || result.id !== id)
        throw new Error("preview_target_mismatch");
      return result;
    },
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

/** A retry of an uncertain confirmation retains the exact plan and request identity. */
export async function confirmDeletion(plan: DeletionPreview, request: string) {
  requireOnline();
  const result = deletionOperationSchema.parse(
    await accountRequest("deletions/confirm", "POST", {
      plan_id: plan.plan_id,
      request_id: request,
      confirmation: "DELETE",
    }),
  );
  if (result.kind !== plan.kind || result.id !== plan.id)
    throw new Error("operation_target_mismatch");
  return result;
}

export async function resumeDeletion(operation: DeletionOperation) {
  requireOnline();
  const result = deletionOperationSchema.parse(
    await accountRequest(
      `deletions/operations/${encodeURIComponent(operation.operation_id)}`,
      "POST",
      {},
    ),
  );
  if (
    result.operation_id !== operation.operation_id ||
    result.kind !== operation.kind ||
    result.id !== operation.id
  )
    throw new Error("operation_target_mismatch");
  return result;
}

/** Prevent older in-flight reads from resurrecting metadata after confirmed completion. */
export async function refreshAfterDeletion(client: QueryClient) {
  await client.cancelQueries({
    predicate: (query) => query.queryKey[0] !== "deletions",
  });
  await client.cancelQueries({ queryKey: ["deletions", "resources"] });
  await client.invalidateQueries({
    predicate: (query) =>
      query.queryKey[0] !== "deletions" || query.queryKey[1] === "resources",
  });
}

export function deletionDenied(error: unknown) {
  return (
    error instanceof Error &&
    ["permission_required", "authentication_required"].includes(error.message)
  );
}
