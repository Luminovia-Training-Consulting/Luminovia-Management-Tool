import { isDatabasePermissionDenied } from "../../lib/database-errors";
import { infiniteQueryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { throwPagedReadError } from "../../lib/paged-read";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import type { PortalDocument } from "./api";

import {
  documentCursorSchema,
  documentDiscoveryPageSchema,
  documentOrganisationInputSchema,
  documentOrganisationSchema,
  type DocumentPage,
} from "./schema";

export interface DocumentFilters {
  search: string;
  tag: string;
  folder: string | null;
  owner?: string;
  kind?: string;
  job?: string;
}

export const documentDiscoveryQuery = (
  actor: string,
  filters: DocumentFilters,
) =>
  infiniteQueryOptions({
    queryKey: ["documents", actor, "discovery", filters],
    initialPageParam: null as z.infer<typeof documentCursorSchema> | null,
    queryFn: async ({ pageParam, signal }) => {
      requireOnline();
      const { data, error, status } = await db()
        .rpc("document_discovery", {
          p_search: filters.search,
          p_tag: filters.tag,
          p_folder: filters.folder,
          p_owner: filters.owner ?? null,
          p_kind: filters.kind ?? "",
          p_job: filters.job ?? null,
          p_before_at: pageParam?.at ?? null,
          p_before_id: pageParam?.id ?? null,
          p_limit: 40,
        })
        .abortSignal(signal);
      if (error) throwPagedReadError(error, status);
      return documentDiscoveryPageSchema.parse(data);
    },
    getNextPageParam: (page) =>
      page.has_more ? (page.next_cursor ?? undefined) : undefined,
    staleTime: 15000,
    retry: (attempt, error) =>
      !isDatabasePermissionDenied(error) &&
      !(error instanceof z.ZodError) &&
      attempt < 1,
    // Discovery is refreshed on focus/reconnect, explicit refresh or mutations.
    // Do not refetch every loaded history page on a scan/status polling timer.
    refetchInterval: false,
  });

export function discoveredDocuments(
  pages: DocumentPage[] | undefined,
): PortalDocument[] {
  const rows = new Map<string, PortalDocument>();
  for (const page of pages ?? [])
    for (const row of page.items) if (!rows.has(row.id)) rows.set(row.id, row);
  return [...rows.values()];
}

export async function saveDocumentOrganisation(
  file: PortalDocument,
  tags: string[],
  folder: string,
) {
  requireOnline();
  const input = documentOrganisationInputSchema.parse({ tags, folder });
  const { data, error } = await db().rpc("save_document_organisation", {
    p_document_id: file.id,
    p_payload: input,
    p_expected_version: file.personal_version ?? 0,
  });
  if (error) throw error;
  return documentOrganisationSchema.parse(data);
}
