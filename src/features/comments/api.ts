/**
 * Resource-specific comments for jobs and course templates. Server context permissions, versions
 * and timestamp/ID cursors govern changes; merge overlapping pages without duplicates.
 */
import { isDatabasePermissionDenied } from "../../lib/database-errors";
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { throwPagedReadError } from "../../lib/paged-read";
import { db } from "../../lib/supabase";

/** The two explicitly supported comment resource types. */
export type CommentResource = "job" | "template";

/** Current server-checked write/moderation capabilities for one resource. */
export interface CommentContext {
  can_post: boolean;
  can_moderate: boolean;
}

/** Comment projection with version, withdrawal and explicitly disclosed moderation state. */
export interface ResourceComment {
  id: string;
  author_id: string;
  author_name: string;
  body: string;
  version: number;
  hidden: boolean;
  withdrawn: boolean;
  moderation_reason: string;
  created_at: string;
  updated_at: string;
  mine: boolean;
}

/** Stable history cursor when comments share creation timestamps. */
export interface CommentCursor {
  at: string;
  id: string;
}

/** Resource/actor-scoped cache keys for context permissions and comment history. */
export const commentKeys = {
  context: (actor: string, kind: CommentResource, id: string) =>
    ["comment-context", actor, kind, id] as const,
  list: (actor: string, kind: CommentResource, id: string) =>
    ["resource-comments", actor, kind, id] as const,
};

/** Load current permissions for this resource and do not automatically retry access denial. */
export const commentContextQuery = (
  actor: string,
  kind: CommentResource,
  id: string,
) =>
  queryOptions({
    queryKey: commentKeys.context(actor, kind, id),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("comment_context", { p_kind: kind, p_id: id })
        .abortSignal(signal);
      signal.throwIfAborted();
      if (error) throw error;
      return data as CommentContext;
    },
    retry: (count, error) => !isDatabasePermissionDenied(error) && count < 2,
    refetchInterval: 15000,
  });
/** Read 40-comment pages using timestamp/ID cursors; stop automatic retries after access revocation. */
export const resourceCommentsQuery = (
  actor: string,
  kind: CommentResource,
  id: string,
) =>
  infiniteQueryOptions({
    queryKey: commentKeys.list(actor, kind, id),
    initialPageParam: null as CommentCursor | null,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error, status } = await db()
        .rpc("resource_comments", {
          p_kind: kind,
          p_id: id,
          p_before_at: pageParam?.at ?? null,
          p_before_id: pageParam?.id ?? null,
          p_limit: 40,
        })
        .abortSignal(signal);
      signal.throwIfAborted();
      if (error) throwPagedReadError(error, status);
      return data as ResourceComment[];
    },
    // Timestamp plus ID stays stable when creation times coincide. Only a full page
    // can have a continuation; the caller merges any overlap.
    getNextPageParam: (page): CommentCursor | undefined => {
      const last = page.at(-1);
      return page.length === 40 && last
        ? { at: last.created_at, id: last.id }
        : undefined;
    },
    retry: (count, error) => !isDatabasePermissionDenied(error) && count < 2,
    refetchInterval: 15000,
  });

/** Map known version, rate and permission failures to existing UI keys. */
export function commentError(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? error.code
      : "";
  return code === "40001"
    ? "conflict"
    : code === "54000"
      ? "rateLimit"
      : code === "42501"
        ? "denied"
        : "error";
}
