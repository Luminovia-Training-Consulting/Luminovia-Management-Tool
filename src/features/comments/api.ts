/**
 * Ressourcenbezogene Kommentar-API für Aufträge und Kursvorlagen. Kontextrechte, versionierte Änderungen und Zeit/ID-Cursor kommen aus dem Server; überlappende Seiten werden ohne doppelte Kommentare zusammengeführt.
 */
import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";

/** Die zwei ausdrücklich unterstützten Kommentar-Ressourcentypen. */
export type CommentResource = "job" | "template";
/** Aktuell servergeprüfte Schreib-/Moderationsrechte für genau eine Ressource. */
export interface CommentContext {
  can_post: boolean;
  can_moderate: boolean;
}
/** Kommentarprojektion samt Version, Rückzug und offen ausgewiesenem Moderationsstand. */
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
/** Cursor für stabile Kommentarhistorie bei gleichen Erstellungszeiten. */
export interface CommentCursor {
  at: string;
  id: string;
}
/** Ressourcen- und akteursbezogene Schlüssel für Kontextrechte und Kommentarhistorie. */
export const commentKeys = {
  context: (actor: string, kind: CommentResource, id: string) =>
    ["comment-context", actor, kind, id] as const,
  list: (actor: string, kind: CommentResource, id: string) =>
    ["resource-comments", actor, kind, id] as const,
};
/** Ruft eine Kommentar-RPC mit der nativen Session auf und reicht PostgreSQL-Fehler unverändert weiter. */
export async function commentRpc<T>(
  name: string,
  parameters: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await db().rpc(name, parameters);
  if (error) throw error;
  return data as T;
}
/** Lädt die aktuellen Rechte für genau diese Ressource und wiederholt verweigerten Zugriff nicht automatisch. */
export const commentContextQuery = (
  actor: string,
  kind: CommentResource,
  id: string,
) =>
  queryOptions({
    queryKey: commentKeys.context(actor, kind, id),
    queryFn: () =>
      commentRpc<CommentContext>("comment_context", { p_kind: kind, p_id: id }),
    retry: (count, error) => !commentDenied(error) && count < 2,
    refetchInterval: 15000,
  });
/** Lädt Kommentarhistorie in 40er-Seiten mit Zeit/ID-Cursor und beendet automatische Wiederholungen bei Rechteentzug. */
export const resourceCommentsQuery = (
  actor: string,
  kind: CommentResource,
  id: string,
) =>
  infiniteQueryOptions({
    queryKey: commentKeys.list(actor, kind, id),
    initialPageParam: null as CommentCursor | null,
    queryFn: ({ pageParam }) =>
      commentRpc<ResourceComment[]>("resource_comments", {
        p_kind: kind,
        p_id: id,
        p_before_at: pageParam?.at ?? null,
        p_before_id: pageParam?.id ?? null,
        p_limit: 40,
      }),
    // Zeit plus ID bleibt bei gleichem Erstellungszeitpunkt stabil. Nur eine volle
    // Seite kann eine weitere Seite haben; Überlappungen bereinigt uniqueComments.
    getNextPageParam: (page): CommentCursor | undefined => {
      const last = page.at(-1);
      return page.length === 40 && last
        ? { at: last.created_at, id: last.id }
        : undefined;
    },
    retry: (count, error) => !commentDenied(error) && count < 2,
    refetchInterval: 15000,
  });
/** Erkennt verweigerten Ressourcenzugriff unabhängig von der konkreten Error-Klasse. */
export function commentDenied(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "42501"
  );
}
/** Übersetzt bekannte Versions-, Raten- und Rechtefehler in vorhandene UI-Schlüssel. */
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

/** Cursor overlap during an edit/refetch must not show duplicate comments. */
/** Entfernt überlappende Cursorzeilen und ordnet Kommentare stabil vom neuesten zum ältesten Eintrag. */
export function uniqueComments(pages: ResourceComment[][] | undefined) {
  const result = new Map<string, ResourceComment>();
  for (const row of (pages ?? []).flat())
    if (!result.has(row.id)) result.set(row.id, row);
  return [...result.values()].sort(
    (a, b) =>
      b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
  );
}
