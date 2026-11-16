import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
/** Exact fictional owners in the canonical random QA database only. */
export function cleanupWorkbenchUsers(ids: string[]) {
  if (
    process.env.PORTAL_TEST_MODE !== "1" ||
    ids.length < 1 ||
    !ids.every((id) =>
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id),
    )
  )
    throw new Error("Owned workbench test users required");
  const project = /^project_id\s*=\s*"(luminovia-portal-test-[a-f0-9]+)"/m.exec(
    readFileSync("supabase/config.toml", "utf8"),
  )?.[1];
  if (!project) throw new Error("Canonical disposable project required");
  const owners = ids.map((id) => `'${id}'`).join(",");
  const sql = `delete from private.work_task_history where task_id in(select id from private.work_tasks where creator_id in(${owners}));delete from private.work_template_runs where user_id in(${owners});delete from private.work_tasks where creator_id in(${owners});delete from private.work_task_templates where creator_id in(${owners});`;
  try {
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        `supabase_db_${project}`,
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-X",
        "-qAt",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      { input: sql, stdio: ["pipe", "pipe", "pipe"], timeout: 20000 },
    );
  } catch {
    throw new Error("Owned workbench fixture cleanup failed");
  }
}
