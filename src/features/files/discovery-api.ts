import { infiniteQueryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import type { PortalDocument } from "./api";
const documentSchema = z.object({
  id: z.uuid(),
  owner_id: z.uuid(),
  uploaded_by: z.uuid(),
  scope: z.enum(["personal", "room", "job_before", "job_after"]),
  kind: z.string(),
  room_id: z.uuid().nullable(),
  job_id: z.uuid().nullable(),
  original_name: z.string(),
  mime_type: z.string(),
  size_bytes: z.number().nonnegative(),
  status: z.string(),
  current_version_id: z.uuid().nullable(),
  created_at: z.string().datetime({ offset: true }),
  deleted_at: z.string().datetime({ offset: true }).nullable(),
  personal_tags: z.array(z.string()),
  personal_folder: z.string(),
  personal_version: z.number().int().nonnegative(),
});
const cursorSchema = z.object({
  at: z.string().datetime({ offset: true }),
  id: z.uuid(),
});
const pageSchema = z
  .object({
    items: z.array(documentSchema),
    has_more: z.boolean(),
    next_cursor: cursorSchema.nullable(),
  })
  .refine(
    (page) => page.has_more === Boolean(page.next_cursor),
    "Inconsistent document cursor",
  );
export type DocumentPage = z.infer<typeof pageSchema>;
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
    initialPageParam: null as z.infer<typeof cursorSchema> | null,
    queryFn: async ({ pageParam, signal }) => {
      requireOnline();
      const { data, error } = await db()
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
      if (error) throw error;
      return pageSchema.parse(data);
    },
    getNextPageParam: (page) =>
      page.has_more ? (page.next_cursor ?? undefined) : undefined,
    staleTime: 15000,
    retry: (attempt, error) =>
      !(
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "42501"
      ) &&
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
const organisationSchema = z.object({
  tags: z.array(z.string().trim().min(1).max(60)).max(20),
  folder: z.string().trim().max(80),
  version: z.number().int().positive(),
});
export async function saveDocumentOrganisation(
  file: PortalDocument,
  tags: string[],
  folder: string,
) {
  requireOnline();
  const input = organisationSchema
    .omit({ version: true })
    .parse({ tags, folder });
  const { data, error } = await db().rpc("save_document_organisation", {
    p_document_id: file.id,
    p_payload: input,
    p_expected_version: file.personal_version ?? 0,
  });
  if (error) throw error;
  return organisationSchema.parse(data);
}
