/** Caller-scoped bank reads and active-only authoring commands. */
import { queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import type { BankQuestion } from "./question-bank-schema";

export const questionBankKey = (actor: string, run: string) =>
  ["course-question-bank", actor, run] as const;

/** Never reuse bank content across accounts or course authorization contexts. */
export function questionBankQuery(
  actor: string,
  run: string,
  search: string,
  includeArchived: boolean,
  offset: number,
) {
  return queryOptions({
    queryKey: [...questionBankKey(actor, run), search, includeArchived, offset],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_question_bank", {
          p_run_id: run,
          p_search: search,
          p_include_archived: includeArchived,
          p_offset: offset,
        })
        .abortSignal(signal);
      if (error) throw error;
      return data as { items: BankQuestion[]; has_more: boolean };
    },
    retry: false,
    staleTime: 10000,
  });
}

/** Wait for the authoritative saved revision before clearing an editing form. */
export async function questionBankAction(
  course: string,
  action: "save" | "set_archived" | "configure",
  payload: Record<string, unknown>,
  expectedVersion: number,
) {
  requireOnline();
  const { data, error } = await db().rpc("course_question_bank_action", {
    p_run_id: course,
    p_action: action,
    p_payload: payload,
    p_expected_version: expectedVersion,
  });
  if (error) throw error;
  return data as { id?: string; version: number };
}
