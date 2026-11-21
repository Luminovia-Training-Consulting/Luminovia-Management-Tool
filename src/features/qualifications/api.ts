import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import {
  qualificationCertificatePage,
  qualificationHistoryPage,
  qualificationReviewSchema,
  type Cursor,
} from "./schema";

export type { Certificate, Cursor } from "./schema";

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
      return qualificationReviewSchema.parse(data);
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
      return qualificationCertificatePage.parse(data);
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
      return qualificationHistoryPage.parse(data);
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
  return qualificationReviewSchema.parse(data);
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
  return qualificationReviewSchema.parse(data);
}

export function qualificationDenied(error: unknown) {
  return (
    (error as { code?: string })?.code === "42501" ||
    (error instanceof Error && error.message === "access_denied")
  );
}
