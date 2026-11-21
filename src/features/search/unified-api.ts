/** Authenticated search contract: scoped caches, abortable reads and opaque cursors. */
import { infiniteQueryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";

/** The finite server allowlist also supplies the bilingual category selector. */
export const searchKinds = [
  "jobs",
  "files",
  "wiki",
  "forum",
  "chats",
  "people",
  "courses",
  "clients",
  "contracts",
  "finance",
] as const;
const cursorSchema = z.object({
  kind: z.enum(searchKinds),
  title: z.string(),
  id: z.string().uuid(),
});
// Links stay inside the portal, including after browser backslash normalisation.
const resultSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(searchKinds),
  title: z.string(),
  detail: z.string(),
  url: z
    .string()
    .refine(
      (value) =>
        value.startsWith("/") &&
        !value.startsWith("//") &&
        !value.includes("\\") &&
        [...value].every(
          (char) => char.charCodeAt(0) > 32 && char.charCodeAt(0) !== 127,
        ),
    ),
});
export const unifiedSearchPageSchema = z
  .object({
    items: z.array(resultSchema),
    has_more: z.boolean(),
    next_cursor: cursorSchema.nullable(),
  })
  .refine((page) => !page.has_more || page.next_cursor !== null);
type Cursor = z.infer<typeof cursorSchema>;
/** Authority comes from Auth, while actor only separates browser cache entries. */
export const unifiedSearchQuery = (
  actor: string,
  query: string,
  kind: string,
) =>
  infiniteQueryOptions({
    queryKey: ["unified-search", actor, query, kind],
    enabled: query.length >= 2,
    initialPageParam: null as Cursor | null,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await db()
        .rpc("unified_search", {
          p_query: query,
          p_kind: kind,
          p_after_kind: pageParam?.kind ?? null,
          p_after_title: pageParam?.title ?? null,
          p_after_id: pageParam?.id ?? null,
          p_limit: 40,
        })
        .abortSignal(signal);
      if (error) throw error;
      return unifiedSearchPageSchema.parse(data);
    },
    getNextPageParam: (page) =>
      page.has_more ? (page.next_cursor ?? undefined) : undefined,
    staleTime: 0,
  });
