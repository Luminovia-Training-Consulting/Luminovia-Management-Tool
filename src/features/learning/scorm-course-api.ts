/** Actor-scoped cache keys and commands for scanned SCORM package versions. */
import { requireOnline } from "../../lib/online";
import { db } from "../../lib/supabase";

export const courseScormKey = (actor: string, course: string) =>
  ["course-scorm-packages", actor, course] as const;

/** Send immutable package identity and an action-specific payload through PostgreSQL. */
export async function changeCourseScormPackage(
  course: string,
  version: string,
  action: "publish" | "withdraw" | "complete",
  payload: Record<string, unknown>,
) {
  requireOnline();
  const { data, error } = await db().rpc("course_scorm_action", {
    p_run_id: course,
    p_version_id: version,
    p_action: action,
    p_payload: payload,
  });
  if (error || data !== true) throw error ?? new Error("scorm_action_failed");
}
