/** Course preparation derives status from scoped server records; the browser edits requirements and receipts, never an authoritative readiness percentage. Actor-scoped memory queries validate server projections; online mutations carry reviewed versions and retry identities. */
import { type QueryClient, queryOptions } from "@tanstack/react-query";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";

import {
  readinessListSchema,
  readinessReceiptSchema,
  type SettingsInput,
  type TaskInput,
} from "./schema";
export type {
  CourseReadiness,
  ReadinessTask,
  ReadinessSettings,
} from "./schema";

export const readinessQuery = (actor: string, run?: string) =>
  queryOptions({
    queryKey: ["readiness", actor, run ?? "overview"],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_readiness", { p_course_run_id: run ?? null })
        .abortSignal(signal);
      if (error) throw error;
      return readinessListSchema.parse(data);
    },
    staleTime: 10000,
    refetchInterval: 30000,
    retry: false,
  });

async function result(request: PromiseLike<{ data: unknown; error: unknown }>) {
  const { data, error } = await request;
  if (error) throw error;
  return readinessReceiptSchema.parse(data);
}

/** Submit the reviewed policy version; conflicts require a deliberate reload rather than overwriting current settings. */
export function saveReadinessSettings(
  run: string,
  values: SettingsInput,
  version: number,
  request: string,
) {
  requireOnline();
  return result(
    db().rpc("save_readiness_settings", {
      p_course_run_id: run,
      p_payload: values,
      p_expected_version: version,
      p_request_id: request,
    }),
  );
}

/** Bind managerial confirmation to the current server schedule fingerprint, not a browser list of sessions. */
export function confirmCourseSessions(
  run: string,
  version: number,
  request: string,
) {
  requireOnline();
  return result(
    db().rpc("confirm_course_sessions", {
      p_course_run_id: run,
      p_expected_version: version,
      p_request_id: request,
    }),
  );
}

/** Create or version an assigned task with an actor-bound retry key; the server validates responsibility. */
export function saveReadinessTask(
  run: string,
  task: string | null,
  values: TaskInput,
  version: number,
  request: string,
) {
  requireOnline();
  return result(
    db().rpc("save_readiness_task", {
      p_course_run_id: run,
      p_task_id: task,
      p_payload: values,
      p_expected_version: version,
      p_request_id: request,
    }),
  );
}

/** Record or revoke task completion through the authorised assignee/management transition. */
export function completeReadinessTask(
  task: string,
  completed: boolean,
  version: number,
  request: string,
) {
  requireOnline();
  return result(
    db().rpc("complete_readiness_task", {
      p_task_id: task,
      p_completed: completed,
      p_expected_version: version,
      p_request_id: request,
    }),
  );
}

/** Record the current actor acknowledging an exact authored instruction version. */
export function acknowledgeCourseInstructions(
  run: string,
  version: number,
  request: string,
) {
  requireOnline();
  return result(
    db().rpc("acknowledge_course_instructions", {
      p_course_run_id: run,
      p_instruction_version: version,
      p_request_id: request,
    }),
  );
}

/** Re-fetch derived readiness and associated course state after confirmed operations. */
export async function refreshReadiness(client: QueryClient) {
  await client.invalidateQueries({ queryKey: ["readiness"] });
}

/** Only an HTTPS URL without embedded credentials is rendered as an external link. */
/** Permit only safe HTTPS meeting links; authored text can never become an executable or credential-bearing destination. */
export function meetingHref(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
