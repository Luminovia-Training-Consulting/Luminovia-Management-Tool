/** Authenticated search contract: scoped caches, abortable reads and opaque cursors. */
import { infiniteQueryOptions } from "@tanstack/react-query";
import { unifiedSearchPageSchema, type SearchCursor } from "./unified-schema";
import { throwPagedReadError } from "../../lib/paged-read";
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
      const { data, error, status } = await db()
        .rpc("unified_search", {
          p_query: query,
          p_kind: kind,
          p_after_kind: pageParam?.kind ?? null,
          p_after_title: pageParam?.title ?? null,
          p_after_id: pageParam?.id ?? null,
          p_limit: 40,
        })
        .abortSignal(signal);
      if (error) throwPagedReadError(error, status);
      const page = unifiedSearchPageSchema.parse(data);
      return {
        ...page,
        items: page.items.map((item) => {
          if (item.kind === "wiki" && item.url.startsWith("/wiki?")) {
            return {
              ...item,
              url: item.url.replace("/wiki?", "/chats/forum?view=articles&"),
            };
          }
          if (item.kind === "forum" && item.url.startsWith("/forum?")) {
            return {
              ...item,
              url: item.url.replace("/forum?", "/chats/forum?"),
            };
          }
          return item;
        }),
      };
    },
    getNextPageParam: (page) =>
      page.has_more ? (page.next_cursor ?? undefined) : undefined,
    staleTime: 0,
  });
