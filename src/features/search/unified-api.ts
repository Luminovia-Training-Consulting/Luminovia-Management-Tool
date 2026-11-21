/** Authenticated search contract: scoped caches, abortable reads and opaque cursors. */
import { infiniteQueryOptions } from "@tanstack/react-query";
import { unifiedSearchPageSchema, type SearchCursor } from "./unified-schema";
import { db } from "../../lib/supabase";

/** Authority comes from Auth, while actor only separates browser cache entries. */
export const unifiedSearchQuery = (
  actor: string,
  query: string,
  kind: string,
) =>
  infiniteQueryOptions({
    queryKey: ["unified-search", actor, query, kind],
    enabled: query.length >= 2,
    initialPageParam: null as SearchCursor | null,
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
