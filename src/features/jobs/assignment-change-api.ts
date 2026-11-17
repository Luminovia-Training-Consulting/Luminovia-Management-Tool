/** Formal schedule/location amendments use actor-scoped database projections and explicit server-confirmed transitions. */
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { refreshJobState } from "./lifecycle-api";

const uuid = z.string().uuid();
const session = z.object({ starts_at: z.string(), ends_at: z.string() });
const request = z.object({
  id: uuid,
  job_id: uuid,
  reason: z.string(),
  original_location: z.string(),
  proposed_location: z.string(),
  original_sessions: z.array(session),
  proposed_sessions: z.array(session),
  status: z.enum([
    "awaiting_response",
    "accepted",
    "rejected",
    "applied",
    "superseded",
  ]),
  created_at: z.string(),
  resolved_at: z.string().nullable(),
  can_decide: z.boolean(),
  can_apply: z.boolean(),
  responses: z.array(
    z.object({
      claim_id: uuid,
      lecturer_id: uuid,
      decision: z.enum(["accepted", "rejected"]).nullable(),
      responded_at: z.string().nullable(),
    }),
  ),
});
/** Read only requests visible to this actor; the database filters every affected lecturer/manager row. */
export const assignmentChangesQuery = (actor: string, job: string) =>
  queryOptions({
    queryKey: ["assignment-changes", actor, job],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("assignment_change_request", { p_id: null, p_job: job })
        .abortSignal(signal);
      if (error) throw error;
      return z.array(request).parse(data);
    },
    staleTime: 10000,
    retry: false,
  });

/** Submit the full replacement schedule with a stable retry key; accepted terms stay unchanged until apply succeeds. */
export async function proposeAssignmentChange(input: {
  job: string;
  reason: string;
  location: string;
  sessions: z.infer<typeof session>[];
  requestId: string;
}) {
  requireOnline();
  const { data, error } = await db().rpc("propose_assignment_change", {
    p_job: input.job,
    p_reason: input.reason,
    p_location: input.location,
    p_sessions: input.sessions,
    p_request: input.requestId,
  });
  if (error) throw error;
  return uuid.parse(data);
}

/** Record one affected lecturer's explicit, irrevocable acceptance or rejection. */
export async function respondAssignmentChange(id: string, accept: boolean) {
  requireOnline();
  const { data, error } = await db().rpc("respond_assignment_change", {
    p_id: id,
    p_accept: accept,
  });
  if (error) throw error;
  return z.enum(["accepted", "rejected"]).parse(data);
}

/** Apply only after approval; the transaction rechecks the current assignment and availability. */
export async function applyAssignmentChange(id: string) {
  requireOnline();
  const { data, error } = await db().rpc("apply_assignment_change", {
    p_id: id,
  });
  if (error) throw error;
  return z.literal("applied").parse(data);
}

/** Close a stale pending or accepted request while retaining its comparison and history. */
export async function withdrawAssignmentChange(id: string) {
  requireOnline();
  const { data, error } = await db().rpc("withdraw_assignment_change", {
    p_id: id,
  });
  if (error) throw error;
  return z.literal("superseded").parse(data);
}

/** Revalidate the affected assignment detail and adjacent lifecycle surfaces after a committed action. */
export async function refreshAssignmentChanges(
  client: QueryClient,
  actor: string,
  job: string,
) {
  await Promise.all([
    refreshJobState(client),
    client.invalidateQueries({ queryKey: ["assignment-changes", actor, job] }),
  ]);
}
