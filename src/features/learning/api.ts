import type { H5pAttribution } from "./h5p-import-schema";
/** Permission-scoped course DTOs and online mutation/download boundaries for the learning workspace. */
import { queryOptions, useQuery } from "@tanstack/react-query";
import { saveBlob } from "../../lib/blob-download";
import { db } from "../../lib/supabase";
import { requireOnline, useOnline } from "../../lib/online";
import type { WorkspaceAttendanceHistory } from "./attendance-schema";
import type { CompletionPinnedPolicy } from "./course-completion-policy-schema";
import type { CourseCurriculum } from "./course-authoring-schema";
import {
  gradebookPageSize,
  type CourseGradebook,
  type CourseGradebookExportRow,
  type CourseGradebookHistory,
} from "./course-gradebook-schema";

export interface CourseOverview {
  id: string;
  title: string;
  description: string;
  syllabus: string;
  time_zone: string;
  venue: string;
  delivery_type: string;
  lms_enabled: boolean;
  starts_at: string | null;
  ends_at: string | null;
  participant: boolean;
  organisation_name?: string | null;
  next_start_at?: string | null;
}

export interface CourseSession {
  id: string;
  starts_at: string;
  ends_at: string;
  attendance: string | null;
  minutes: number | null;
  version: number;
  can_check_in: boolean;
  can_verify: boolean;
}

export interface PreparationItem {
  id: string;
  label: string;
  done: boolean;
  client_visible: boolean;
  version: number;
}

export interface CourseResource {
  id: string;
  name: string;
  version_id: string;
  version: number;
  sha256: string;
  category: string;
  audience: string;
  acknowledged: boolean;
  ownership_kind: "staff" | "company" | "lecturer";
  can_remove: boolean;
}

export interface QuizQuestion {
  prompt: string;
  options: string[];
  correct?: number;
  source?: { question_id: string; revision: number };
  h5p_attribution?: H5pAttribution;
}

export interface CourseWorkspace {
  id: string;
  title: string;
  description: string;
  syllabus: string;
  time_zone: string;
  venue: string;
  delivery_type: string;
  ended: boolean;
  lms_enabled: boolean;
  exams: {
    required: boolean;
    version: number | null;
    can_edit: boolean;
    documents: {
      id: string;
      name: string;
      version_id: string;
      version: number;
      audience: "students" | "exam_staff";
      can_remove?: boolean;
    }[];
  };
  access: {
    manager: boolean;
    teacher: boolean;
    learner: boolean;
    client: boolean;
    staff: boolean;
    lms_enabled: boolean;
  };
  settings_version: number;
  learner_status?: "enrolled" | "completed" | null;
  meeting_link?: {
    url: string | null;
    version: number;
    can_edit: boolean;
  } | null;
  contact: { name: string; email: string; phone: string } | null;
  selected_contact_id?: string | null;
  contact_options: { id: string; name: string }[];
  sessions: CourseSession[];
  preparation: PreparationItem[];
  resources: CourseResource[];
  share_options: { id: string; name: string; version: number }[];
  questions: {
    id: string;
    body: string;
    answer: string;
    version: number;
    mine: boolean;
  }[];
  notebook: { body: string; version: number } | null;
  feedback: { rating: number; comment: string; version: number } | null;
  feedback_summary: {
    count: number;
    average: number | null;
    comments: string[] | null;
  } | null;
  quiz: {
    version: number;
    published: boolean;
    pass_percent: number;
    max_attempts: number;
    questions: QuizQuestion[];
    attempts: number;
    passed: boolean;
    last_score: number | null;
    pool?: { draw_count: number; request_id: string | null } | null;
    draft?: {
      request_id: string;
      revision: number;
      answers: (number | null)[];
    } | null;
  } | null;
  completion: { id: string; created_at: string } | null;
  roster: {
    user_id: string;
    name: string;
    status: string;
    completion_id: string | null;
    sessions: {
      session_id: string;
      state: string | null;
      minutes: number | null;
      version: number;
    }[];
  }[];
  attendance_history: WorkspaceAttendanceHistory;
  repeat_request: {
    id: string;
    sessions: { starts_at: string; ends_at: string }[];
  } | null;
}

export interface CourseContentStudio {
  can_edit: boolean;
  published_version: number;
  published_content: CourseCurriculum;
  published_at: string | null;
  draft_version: number;
  draft_base_version: number;
  draft_content: CourseCurriculum | null;
  review?: {
    state: "requested" | "approved" | "returned" | "scheduled" | "blocked";
    publish_at: string | null;
  } | null;
  versions: { version: number; published_at: string; module_count: number }[];
}

export const courseMaterialLibraryKey = (actor: string) =>
  ["course-material-library", actor] as const;

export const courseWorkspaceKey = (actor: string, run: string) =>
  ["course-workspace", actor, run] as const;
export const courseContentStudioKey = (actor: string, run: string) =>
  ["course-content-studio", actor, run] as const;
export const courseGradebookKey = (
  actor: string,
  run: string,
  offset: number,
) => ["course-gradebook", actor, run, offset] as const;
/** Own current memberships determine this hub; its actor key prevents cache reuse across accounts. */
export const courseHubQuery = (actor: string) =>
  queryOptions({
    queryKey: ["course-workspaces", actor],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("my_course_workspaces")
        .abortSignal(signal);
      if (error) throw error;
      return data as CourseOverview[];
    },
    staleTime: 15000,
  });
/** Requests one currently authorized course and aborts reads when navigation changes. */
export const courseWorkspaceQuery = (actor: string, run: string) =>
  queryOptions({
    queryKey: courseWorkspaceKey(actor, run),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_workspace", { p_run_id: run })
        .abortSignal(signal);
      if (error) throw error;
      return data as CourseWorkspace;
    },
    staleTime: 15000,
    retry: false,
  });
/** Current course grades are permission-projected and paginated by the server. */
export const courseGradebookQuery = (
  actor: string,
  run: string,
  offset: number,
) =>
  queryOptions({
    queryKey: courseGradebookKey(actor, run, offset),
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("course_gradebook", {
          p_run_id: run,
          p_offset: offset,
          p_limit: gradebookPageSize,
        })
        .abortSignal(signal);
      if (error) throw error;
      return data as CourseGradebook;
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
export const courseGradebookHistoryKey = (actor: string, run: string) =>
  ["course-gradebook-history", actor, run] as const;

/** Load one revision page using the server cursor and the current role projection. */
export async function fetchCourseGradebookHistory(
  run: string,
  learner: string | null,
  before: number | null,
  signal: AbortSignal,
) {
  requireOnline();
  const { data, error } = await db()
    .rpc("course_gradebook_history", {
      p_run_id: run,
      p_user_id: learner,
      p_before_revision: before,
      p_limit: gradebookPageSize,
    })
    .abortSignal(signal);
  if (error) throw error;
  return data as CourseGradebookHistory;
}

/** Request a single database snapshot of published quiz grades for staff CSV. */
export async function fetchCourseGradebookExport(run: string) {
  requireOnline();
  const { data, error } = await db().rpc("course_gradebook_export", {
    p_run_id: run,
  });
  if (error) throw error;
  return data as CourseGradebookExportRow[];
}

/** Currently explainable inputs to the shared certificate issuance rules. */
export interface CourseCompletionStatus {
  enrolment_completed: boolean;
  session_count: number;
  ended_count: number;
  verified_count: number;
  ends_at: string | null;
  quiz_version: number | null;
  quiz_passed: boolean;
  reverify_required: boolean;
  rule_version: number;
  policy?: CompletionPinnedPolicy;
  state: "pending" | "ready" | "issued";
}
export const courseCompletionStatusKey = (actor: string, run: string) =>
  ["course-completion-status", actor, run] as const;

/** Staff pass one current enrolment. The learner scope defaults to the actor. */
export const courseCompletionStatusQuery = (
  actor: string,
  run: string,
  learner: string | null,
) =>
  queryOptions({
    queryKey: [...courseCompletionStatusKey(actor, run), learner],
    queryFn: async ({ signal }) => {
      requireOnline();
      const { data, error } = await db()
        .rpc("course_completion_status", {
          p_run_id: run,
          p_user_id: learner,
        })
        .abortSignal(signal);
      if (error) throw error;
      return data as CourseCompletionStatus;
    },
    gcTime: 0,
    retry: false,
  });

/** Fetch authoritative evidence only while the caller's learning section is open. */
export function useCourseCompletionStatus(
  course: CourseWorkspace,
  actor: string,
  learner: string | null,
  active: boolean,
) {
  const online = useOnline();
  return useQuery({
    ...courseCompletionStatusQuery(actor, course.id, learner),
    enabled: active && online,
  });
}

/** Recheck only the caller-scoped Premium link state for a selected base course row. */
export const courseWorkspaceEntitlementQuery = (
  actor: string,
  courseRunId: string,
) =>
  queryOptions({
    queryKey: ["course-workspace-entitlement", actor, courseRunId],
    queryFn: async () => {
      const { data, error } = await db().rpc("course_workspace_entitlement", {
        p_run_id: courseRunId,
      });
      if (error) throw error;
      return data as { lms_enabled: boolean };
    },
    staleTime: 0,
  });

/** Course authors see the current draft and revision history; participants receive only their pinned publication. */
export const courseContentStudioQuery = (actor: string, run: string) =>
  queryOptions({
    queryKey: courseContentStudioKey(actor, run),
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .rpc("course_content_studio", { p_run_id: run })
        .abortSignal(signal);
      if (error) throw error;
      return data as CourseContentStudio;
    },
    staleTime: 10000,
    refetchInterval: ({ state }) =>
      state.data?.review?.state === "scheduled" ? 15000 : false,
    retry: false,
  });

export type CourseContentAction =
  | "save_draft"
  | "publish"
  | "restore"
  | "migrate"
  | "request_review"
  | "approve_review"
  | "return_review"
  | "cancel_review"
  | "schedule_publish";

/** Draft and publication writes are server-validated and return the newly authoritative studio state. */
export async function courseContentAction(
  run: string,
  action: CourseContentAction,
  payload: Record<string, unknown>,
) {
  requireOnline();
  const { data, error } = await db().rpc("course_content_action", {
    p_run_id: run,
    p_action: action,
    p_payload: payload,
  });
  if (error) throw error;
  return data as CourseContentStudio;
}

/** All attendance, quiz and checklist mutations await the database; no optimistic confirmation. */
export async function courseAction(
  run: string,
  action: string,
  payload: Record<string, unknown>,
  version = 0,
  academy = false,
) {
  requireOnline();
  const { data, error } = await db().rpc(
    academy ? "academy_learning_action" : "course_workspace_action",
    {
      p_run_id: run,
      p_action: action,
      p_payload: payload,
      p_expected_version: version,
    },
  );
  if (error) throw error;
  return data as {
    id: string | null;
    saved?: boolean;
    score?: number;
    passed?: boolean;
  };
}

/** Publish the exact scan-confirmed version through the dedicated teaching permission. */
export async function shareAcademyCourseMaterial(
  run: string,
  version: string,
  audience: string,
  category: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("academy_course_material_action", {
    p_run_id: run,
    p_action: "resource_share",
    p_id: version,
    p_audience: audience,
    p_category: category,
  });
  if (error || !data?.id) throw error ?? new Error("unconfirmed");
  return data as { id: string };
}

/** Only the current author can withdraw their exact course share. */
export async function removeAcademyCourseMaterial(run: string, id: string) {
  requireOnline();
  const { data, error } = await db().rpc("academy_course_material_action", {
    p_run_id: run,
    p_action: "resource_remove",
    p_id: id,
  });
  if (error || data?.id !== id) throw error ?? new Error("unconfirmed");
  return data as { id: string };
}

/** Requests a fresh future booking; it copies the authorized brief, never an allocation or learner record. */
export async function repeatCourse(
  request: string,
  sessions: { starts_at: string; ends_at: string }[],
  key: string,
) {
  requireOnline();
  const { data, error } = await db().rpc("repeat_client_request", {
    p_request_id: request,
    p_sessions: sessions,
    p_client_id: key,
  });
  if (error) throw error;
  return data as string;
}

export type PortalDocumentRequest =
  | {
      kind: "resource" | "exam" | "wiki_resource" | "completion";
      id: string;
    }
  | { kind: "assignment_confirmation"; id: string; locale?: "de" | "en" }
  | { kind: "attendance_evidence"; id: string }
  | { kind: "participant_submission"; id: string; version_id: string }
  | {
      kind: "portfolio_evidence";
      id: string;
      version_id: string;
      revision: number;
      shared: boolean;
    }
  | {
      kind: "attendance" | "attendance_session";
      id: string;
      format?: "pdf" | "csv";
    }
  | { kind: "request_resource"; id: string; request_id: string }
  | {
      kind: "course_chat_attachment";
      id: string;
      version_id: string;
      organisation_id?: string;
      reason?: string;
    }
  | {
      kind: "retained_course_file";
      organisation_id: string;
      run_id: string;
      id: string;
      version_id: string;
      file_kind: "exam" | "material";
      reason: string;
    }
  | { kind: "qualification_passport"; locale: "de" | "en" }
  | { kind: "earnings_statement"; from: string; until: string; all?: boolean };

/** Fetch protected exact bytes and verify the same account is still signed in. */
export async function readPortalDocument(
  request: PortalDocumentRequest,
  signal?: AbortSignal,
  actor?: string,
) {
  requireOnline();
  const client = db();
  const before = (await client.auth.getSession()).data.session;
  if (!before) throw new Error("authentication_required");
  if (actor && before.user.id !== actor) throw new Error("account_changed");
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/course-documents`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${before.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      cache: "no-store",
      signal,
    },
  );
  if (!response.ok) {
    const failure = await response.json().catch(() => null);
    throw new Error(
      failure?.error === "unsupported_glyph"
        ? "unsupported_glyph"
        : "course_document_unavailable",
    );
  }
  const blob = await response.blob();
  const after = (await client.auth.getSession()).data.session;
  if (signal?.aborted || after?.user.id !== before.user.id)
    throw new Error("account_changed");
  return blob;
}

/** Downloads protected exact facts or bytes with a filename chosen by the caller. */
export async function downloadPortalDocument(
  request: PortalDocumentRequest,
  name: string,
  signal?: AbortSignal,
) {
  saveBlob(
    await readPortalDocument(request, signal),
    name.replace(/[\\/]/g, "-").slice(0, 160),
  );
}

/** Adapts course document kinds to the common protected download boundary. */
export async function downloadCourseDocument(
  kind: "resource" | "exam" | "attendance" | "completion",
  id: string,
  name: string,
  signal?: AbortSignal,
) {
  return await downloadPortalDocument({ kind, id }, name, signal);
}
