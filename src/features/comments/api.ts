/**
 * Resource-specific comments for jobs and course templates. Server context permissions, versions
 * and timestamp/ID cursors govern changes; merge overlapping pages without duplicates.
 */
import {infiniteQueryOptions, queryOptions} from "@tanstack/react-query";
import {db} from "../../lib/supabase";

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

/** Call a comment RPC with the native session and propagate PostgreSQL errors unchanged. */
export async function commentRpc<T>(
    name: string,
    parameters: Record<string, unknown>,
): Promise<T> {
    const {data, error} = await db().rpc(name, parameters);
    if (error) throw error;
    return data as T;
}

/** Load current permissions for this resource and do not automatically retry access denial. */
export const commentContextQuery = (
    actor: string,
    kind: CommentResource,
    id: string,
) =>
    queryOptions({
        queryKey: commentKeys.context(actor, kind, id),
        queryFn: () =>
            commentRpc<CommentContext>("comment_context", {p_kind: kind, p_id: id}),
        retry: (count, error) => !commentDenied(error) && count < 2,
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
        queryFn: ({pageParam}) =>
            commentRpc<ResourceComment[]>("resource_comments", {
                p_kind: kind,
                p_id: id,
                p_before_at: pageParam?.at ?? null,
                p_before_id: pageParam?.id ?? null,
                p_limit: 40,
            }),
        // Timestamp plus ID stays stable when creation times coincide. Only a full page
        // can have a continuation; uniqueComments removes any overlap.
        getNextPageParam: (page): CommentCursor | undefined => {
            const last = page.at(-1);
            return page.length === 40 && last
                ? {at: last.created_at, id: last.id}
                : undefined;
        },
        retry: (count, error) => !commentDenied(error) && count < 2,
        refetchInterval: 15000,
    });

/** Recognize resource access denial independently of the concrete error class. */
export function commentDenied(error: unknown) {
    return (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "42501"
    );
}

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

/** Deduplicate cursor overlap during edit/refetch and order comments stably from newest to oldest. */
export function uniqueComments(pages: ResourceComment[][] | undefined) {
    const result = new Map<string, ResourceComment>();
    for (const row of (pages ?? []).flat())
        if (!result.has(row.id)) result.set(row.id, row);
    return [...result.values()].sort(
        (a, b) =>
            b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
    );
}