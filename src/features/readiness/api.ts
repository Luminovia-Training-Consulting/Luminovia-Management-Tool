import { queryOptions, type QueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";

const instant = z.string().datetime({ offset: true });
const uuid = z.string().uuid();
const localPath = z
  .string()
  .refine(
    (value) =>
      value.startsWith("/") &&
      !value.startsWith("//") &&
      !/[\\\s]/.test(value) &&
      [...value].every(
        (char) => char.charCodeAt(0) > 32 && char.charCodeAt(0) !== 127,
      ),
  );
export const readinessSettingsSchema = z.object({
  version: z.number().int().nonnegative(),
  materials_required: z.boolean(),
  customer_required: z.boolean(),
  contact_required: z.boolean(),
  agreement_required: z.boolean(),
  instructions_required: z.boolean(),
  instructions: z.string(),
  instruction_version: z.number().int().positive(),
  meeting_url: z.string(),
  preparation_deadline: instant.nullable(),
  sessions_confirmed: z.boolean(),
});
export const readinessTaskSchema = z.object({
  id: uuid,
  title: z.string(),
  required: z.boolean(),
  responsible_user_id: uuid,
  responsible_name: z.string(),
  due_at: instant.nullable(),
  completed_at: instant.nullable(),
  version: z.number().int().positive(),
  can_complete: z.boolean(),
});
export const readinessSchema = z.object({
  id: uuid,
  title: z.string(),
  organisation_name: z.string().nullable(),
  time_zone: z.string(),
  delivery_type: z.enum(["online", "onsite"]),
  venue: z.string(),
  meeting_url: z.string(),
  starts_at: instant.nullable(),
  ends_at: instant.nullable(),
  status: z.enum(["ready", "attention_required", "blocked", "completed"]),
  percentage: z.number().min(0).max(100),
  applicable_count: z.number().int().positive(),
  completed_count: z.number().int().nonnegative(),
  can_manage: z.boolean(),
  can_acknowledge: z.boolean(),
  settings: readinessSettingsSchema,
  checks: z.array(
    z.object({
      code: z.enum([
        "lecturer",
        "agreement",
        "qualification",
        "materials",
        "delivery",
        "customer",
        "contact",
        "sessions",
        "instructions",
        "tasks",
      ]),
      applicable: z.boolean(),
      complete: z.boolean(),
      blocking: z.boolean(),
      responsible: z.enum(["management", "lecturer", "assignee"]),
      href: localPath.nullable(),
    }),
  ),
  tasks: z.array(readinessTaskSchema),
  lecturers: z.array(
    z.object({ id: uuid, display_name: z.string(), acknowledged: z.boolean() }),
  ),
  responsible_people: z.array(z.object({ id: uuid, display_name: z.string() })),
  documents: z.array(z.object({ id: uuid, name: z.string(), job_id: uuid })),
  jobs: z.array(z.object({ id: uuid, title: z.string() })),
  as_of: instant,
});
export type CourseReadiness = z.infer<typeof readinessSchema>;
export type ReadinessTask = z.infer<typeof readinessTaskSchema>;
export type ReadinessSettings = z.infer<typeof readinessSettingsSchema>;
export type SettingsInput = Omit<
  ReadinessSettings,
  "version" | "instruction_version" | "sessions_confirmed"
>;
export interface TaskInput {
  title: string;
  responsible_user_id: string;
  required: boolean;
  due_at: string | null;
  archived: boolean;
}

export const readinessQuery = (actor: string, run?: string) =>
  queryOptions({
    queryKey: ["readiness", actor, run ?? "overview"],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_readiness", { p_course_run_id: run ?? null })
        .abortSignal(signal);
      if (error) throw error;
      return z.array(readinessSchema).parse(data);
    },
    staleTime: 10000,
    refetchInterval: 30000,
    retry: false,
  });
async function result(request: PromiseLike<{ data: unknown; error: unknown }>) {
  const { data, error } = await request;
  if (error) throw error;
  return uuid.parse(data);
}
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
export async function refreshReadiness(client: QueryClient) {
  await client.invalidateQueries({ queryKey: ["readiness"] });
}

/** Only an HTTPS URL without embedded credentials is rendered as an external link. */
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
