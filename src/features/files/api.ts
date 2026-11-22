/**
 * Authenticated file transfer, exact document versions and status-dependent metadata queries.
 * Complete uploads only after a clean server response; fetch private bytes with no-store outside
 * the PWA cache.
 */
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { saveBlob } from "../../lib/blob-download";
import { queryOptions } from "@tanstack/react-query";

import type { PortalDocument } from "./schema";
export type { PortalDocument } from "./schema";

/** Requested file context and optional retry/replacement references; the server validates every relationship. */
export interface UploadContext {
  scope: PortalDocument["scope"];
  roomId?: string;
  jobId?: string;
  kind?: string;
  ownerId?: string;
  replaceId?: string;
  clientId?: string;
  messageOnly?: boolean;
  /** Read scan status through the course reservation projection. */
  courseChat?: boolean;
}

/** Guide the browser file picker; the server independently checks MIME type, magic bytes, size and scanning. */
export const acceptedFiles =
  ".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx,.xlsx,.pptx";
/** Early 100 MiB browser limit; the gateway additionally enforces authoritative upload bounds. */
export const maximumFileSize = 100 * 1024 * 1024;

/** Capture the native session used to authorize a transfer across asynchronous browser work. */
async function requireSession() {
  requireOnline();
  const { data, error } = await db().auth.getSession();
  if (error || !data.session) throw new Error("authentication_required");
  return data.session;
}

/** Send the captured access token with the public API key on gateway requests. */
function authHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
}

/** Use the configured backend's authenticated file gateway rather than a public Storage URL. */
const endpoint = () =>
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/files`;

/** Upload bytes with progress capped at 95%; report 100% only after a confirmed clean server response. */
export async function uploadDocument(
  file: File,
  context: UploadContext,
  onProgress?: (percent: number) => void,
): Promise<PortalDocument> {
  if (file.size < 1 || file.size > maximumFileSize)
    throw new Error("file_size");
  const form = new FormData();
  form.set("file", file);
  form.set("scope", context.scope);
  form.set(
    "kind",
    context.kind ?? (context.scope === "room" ? "chat" : "material"),
  );
  form.set("client_id", context.clientId ?? crypto.randomUUID());
  if (context.roomId) form.set("room_id", context.roomId);
  if (context.messageOnly) form.set("message_only", "true");
  if (context.courseChat) form.set("course_chat", "true");
  if (context.jobId) form.set("job_id", context.jobId);
  if (context.replaceId) form.set("replace_id", context.replaceId);
  if (context.ownerId) form.set("owner_id", context.ownerId);
  return transferUpload(form, endpoint(), onProgress);
}

/** Upload a single exact version through the assigned lecturer's course scope. */
export function uploadAcademyCourseMaterial(
  file: File,
  courseId: string,
  clientId: string,
  onProgress?: (percent: number) => void,
) {
  const form = new FormData();
  form.set("file", file);
  form.set("academy_course_id", courseId);
  form.set("client_id", clientId);
  return transferUpload(
    form,
    endpoint() + "?mode=academy-material",
    onProgress,
  );
}

/** Upload one scanner-bound draft for a dedicated participant channel. */
export function uploadAcademyCourseChatAttachment(
  file: File,
  roomId: string,
  clientId: string,
  onProgress?: (percent: number) => void,
) {
  const form = new FormData();
  form.set("file", file);
  form.set("academy_room_id", roomId);
  form.set("client_id", clientId);
  return transferUpload(
    form,
    endpoint() + "?mode=academy-course-chat",
    onProgress,
  );
}

/** Upload protected attendance evidence for one exact academy session. */
export function uploadAcademyAttendancePdf(
  file: File,
  session: string,
  clientId: string,
) {
  const form = new FormData();
  form.set("file", file);
  form.set("academy_session_id", session);
  form.set("client_id", clientId);
  return transferUpload(form, endpoint() + "?mode=academy-attendance");
}

/** Upload a student paper into its course-only exam reservation. */
export function uploadAcademyStudentExamPdf(
  file: File,
  courseId: string,
  clientId: string,
) {
  return uploadAcademyExamFile(
    file,
    courseId,
    clientId,
    "academy-student-exam",
  );
}

/** Upload an answer key into its distinct staff reservation. */
export function uploadAcademyAnswerKeyPdf(
  file: File,
  courseId: string,
  clientId: string,
) {
  return uploadAcademyExamFile(file, courseId, clientId, "academy-answer-key");
}

function uploadAcademyExamFile(
  file: File,
  courseId: string,
  clientId: string,
  mode: "academy-student-exam" | "academy-answer-key",
) {
  const form = new FormData();
  form.set("file", file);
  form.set("academy_course_id", courseId);
  form.set("client_id", clientId);
  return transferUpload(form, endpoint() + "?mode=" + mode);
}

async function transferUpload(
  form: FormData,
  path: string,
  onProgress?: (percent: number) => void,
): Promise<PortalDocument> {
  const headers = authHeaders((await requireSession()).access_token);
  return await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", path);
    xhr.timeout = 90000;
    for (const [key, value] of Object.entries(headers))
      xhr.setRequestHeader(key, value);
    // Transferred bytes do not include completion of the server-side scan, so cap
    // progress at 95% until the server explicitly returns clean.
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress?.(Math.min(95, Math.round((e.loaded / e.total) * 95)));
    };
    xhr.onerror = () => reject(new Error("upload_failed"));
    xhr.ontimeout = () => reject(new Error("upload_failed"));
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText);
        // Neither HTTP 2xx nor an existing document row alone grants scan clearance.
        // Only the explicit clean status clears the scan requirement and completes the upload.
        if (
          xhr.status >= 200 &&
          xhr.status < 300 &&
          result.document?.status === "clean"
        ) {
          onProgress?.(100);
          resolve(result.document);
        } else reject(new Error(result.error ?? "upload_failed"));
      } catch {
        reject(new Error("upload_failed"));
      }
    };
    xhr.send(form);
  });
}

/** Fetch authenticated gateway bytes with the exact request context and no browser cache. */
async function downloadFile(body: Record<string, unknown>): Promise<Blob> {
  const session = await requireSession();
  const response = await fetch(endpoint(), {
    method: "POST",
    headers: {
      ...authHeaders(session.access_token),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    let code = "download_failed";
    try {
      code = (await response.json()).error ?? code;
    } catch {
      /* safe fallback */
    }
    throw new Error(code);
  }
  const blob = await response.blob();
  const { data, error } = await db().auth.getSession();
  // Server authorization occurs at request time. The active browser account
  // can change while the bytes arrive, even though the old request succeeded.
  if (error || data.session?.user.id !== session.user.id)
    throw new Error("account_changed");
  return blob;
}

/** Download the selected version so replacement cannot silently substitute newer bytes. */
export async function downloadDocument(id: string, versionId?: string | null) {
  return downloadFile({ action: "download", id, version_id: versionId });
}

/** Download through the qualification binding, preserving its separately authorized exact version. */
export async function saveQualificationEvidence(
  evidenceId: string,
  name: string,
) {
  const blob = await downloadFile({
    action: "qualification_evidence_download",
    evidence_id: evidenceId,
  });
  saveBlob(blob, name);
}

/** Download reviewed document bytes, then dispose the temporary browser URL. */
export async function saveDownload(
  id: string,
  name: string,
  versionId?: string | null,
) {
  const blob = await downloadDocument(id, versionId);
  saveBlob(blob, name);
}

/** Recognize metadata access denial so this query state stops automatic refetching. */
function documentAccessDenied(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "42501",
  );
}

// Scan progress is temporary; settled metadata does not need a request for every
// attachment every five seconds. Focus/reconnect and mutation invalidation still
// revalidate immediately, and every byte download keeps its server access check.
/** Weak query-lifetime scan timestamps, without a second cache of private document data. */
const scanWindows = new WeakMap<
  object,
  { signature: string; started: number }
>();

/** Poll pending scans quickly for at most two minutes, then return to the slower metadata interval. */
function documentRefreshInterval(
  query: object,
  files:
    | readonly Pick<PortalDocument, "id" | "status" | "current_version_id">[]
    | undefined,
  error: unknown,
) {
  if (documentAccessDenied(error)) return false;
  const pending = !error
    ? files?.filter((file) => ["quarantined", "scanning"].includes(file.status))
    : undefined;
  if (!pending?.length) {
    scanWindows.delete(query);
    return 60000;
  }
  const signature = JSON.stringify(
    pending
      .map((file) => [file.id, file.status, file.current_version_id] as const)
      .sort((a, b) => a[0].localeCompare(b[0])),
  );
  let window = scanWindows.get(query);
  if (window?.signature !== signature) {
    window = { signature, started: Date.now() };
    scanWindows.set(query, window);
  }
  // An interrupted worker can leave a pending row behind. Bound fast polling
  // to two minutes per observed scan state, then retain the normal slow check.
  // The weak key follows the real query lifecycle, without a second data cache.
  return Date.now() - window.started < 120000 ? 3000 : 60000;
}

/** Read documents through the native client, propagate access/read failures and scope cached data to the actor and requested resource. */
export const documentQuery = (actor: string, id: string) =>
  queryOptions({
    queryKey: ["document", actor, id],
    queryFn: async ({ signal }) => {
      const { data, error } = await db()
        .from("documents")
        .select("*")
        .eq("id", id)
        .abortSignal(signal)
        .maybeSingle();
      if (error) throw error;
      return data as PortalDocument | null;
    },
    staleTime: 15000,
    retry: (attempt, error) => !documentAccessDenied(error) && attempt < 1,
    refetchInterval: (query) =>
      query.state.data === null
        ? false
        : documentRefreshInterval(
            query,
            query.state.data ? [query.state.data] : undefined,
            query.state.error,
          ),
  });
/** Read documents through the native client, propagate access/read failures and scope cached data to the actor and requested resource. */
export const documentsQuery = (
  actor: string,
  owner?: string,
  kind?: string,
  job?: string,
) =>
  queryOptions({
    queryKey: ["documents", actor, owner ?? "", kind ?? "", job ?? ""],
    queryFn: async ({ signal }) => {
      let query = db()
        .from("documents")
        .select("*")
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      if (owner) query = query.eq("owner_id", owner);
      if (kind) query = query.eq("kind", kind);
      if (job) query = query.eq("job_id", job);
      const { data, error } = await query.abortSignal(signal);
      if (error) throw error;
      return data as PortalDocument[];
    },
    retry: (attempt, error) => !documentAccessDenied(error) && attempt < 1,
    refetchInterval: (query) =>
      documentRefreshInterval(query, query.state.data, query.state.error),
  });
