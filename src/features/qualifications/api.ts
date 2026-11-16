import { queryOptions } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const evidence = z.object({
  id: uuid,
  version_id: uuid,
  document_id: uuid,
  name: z.string(),
  sha256: hash,
  created_at: instant,
});
const reviewSchema = z.object({
  user_id: uuid,
  topic_id: uuid,
  version: z.number().int().nonnegative(),
  verified: z.boolean(),
  valid_until: instant.nullable(),
  evidence: evidence.nullable(),
});
const certificate = z.object({
  version_id: uuid,
  document_id: uuid,
  name: z.string(),
  sha256: hash,
  version: z.number().int().positive(),
  created_at: instant,
});
const event = z.object({
  id: uuid,
  action: z.enum(["bind", "withdraw", "deselect", "attest"]),
  version: z.number().int().positive(),
  evidence_id: uuid.nullable(),
  verified: z.boolean().nullable(),
  valid_until: instant.nullable(),
  basis: z.enum(["management_attestation", "document_evidence"]).nullable(),
  created_at: instant,
  actor_name: z.string().nullable(),
});
const cursorSchema = z.object({ at: instant, id: uuid });
const page = <T extends z.ZodType>(item: T) =>
  z
    .object({
      items: z.array(item),
      has_more: z.boolean(),
      next_cursor: cursorSchema.nullable(),
    })
    .refine((value) => value.has_more === (value.next_cursor !== null));
export type Cursor = z.infer<typeof cursorSchema>;
export type Certificate = z.infer<typeof certificate>;
export const qualificationKey = (actor: string, user: string, topic: string) =>
  ["qualification", actor, user, topic] as const;
export function qualificationReviewQuery(
  actor: string,
  user: string,
  topic: string,
) {
  return queryOptions({
    queryKey: [...qualificationKey(actor, user, topic), "review"],
    queryFn: async () => {
      const { data, error } = await db().rpc("qualification_review", {
        p_user_id: user,
        p_topic_id: topic,
      });
      if (error) throw error;
      return reviewSchema.parse(data);
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
}
export function certificatesQuery(
  actor: string,
  search: string,
  cursor: Cursor | null,
) {
  return queryOptions({
    queryKey: ["qualification-certificates", actor, search, cursor],
    queryFn: async () => {
      const { data, error } = await db().rpc("own_qualification_certificates", {
        p_search: search,
        p_before_at: cursor?.at ?? null,
        p_before_id: cursor?.id ?? null,
        p_limit: 20,
      });
      if (error) throw error;
      return page(certificate).parse(data);
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
}
export function qualificationHistoryQuery(
  actor: string,
  user: string,
  topic: string,
  cursor: Cursor | null,
) {
  return queryOptions({
    queryKey: [...qualificationKey(actor, user, topic), "history", cursor],
    queryFn: async () => {
      const { data, error } = await db().rpc("qualification_history", {
        p_user_id: user,
        p_topic_id: topic,
        p_before_at: cursor?.at ?? null,
        p_before_id: cursor?.id ?? null,
        p_limit: 20,
      });
      if (error) throw error;
      return page(event).parse(data);
    },
    retry: false,
    refetchOnWindowFocus: false,
  });
}
export async function saveEvidence(
  topic: string,
  version: string | null,
  expected: number,
  request: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("save_qualification_evidence", {
    p_topic_id: topic,
    p_version_id: version,
    p_expected_version: expected,
    p_request_id: request,
  });
  if (error) throw error;
  return reviewSchema.parse(data);
}
export async function attestEvidence(
  user: string,
  topic: string,
  evidenceId: string,
  until: string | null,
  expected: number,
  request: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("attest_qualification", {
    p_user_id: user,
    p_topic_id: topic,
    p_verified: true,
    p_valid_until: until,
    p_evidence_id: evidenceId,
    p_expected_version: expected,
    p_request_id: request,
  });
  if (error) throw error;
  return reviewSchema.parse(data);
}
export function qualificationDenied(error: unknown) {
  return (
    (error as { code?: string })?.code === "42501" ||
    (error instanceof Error && error.message === "access_denied")
  );
}
