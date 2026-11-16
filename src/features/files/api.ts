/**
 * Authenticated file transfer, exact document versions and status-dependent metadata queries.
 * Complete uploads only after a clean server response; fetch private bytes with no-store outside
 * the PWA cache.
 */
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { queryOptions } from "@tanstack/react-query";
/** Authorized document metadata with scope, scan state and the exact current version ID. */
export interface PortalDocument {
  id: string;
  owner_id: string;
  uploaded_by: string;
  scope: "personal" | "room" | "job_before" | "job_after";
  kind: string;
  room_id: string | null;
  job_id: string | null;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  current_version_id: string;
  created_at: string;
  deleted_at: string | null;
}
/** Requested file context and optional retry/replacement references; the server validates every relationship. */
export interface UploadContext {
  scope: PortalDocument["scope"];
  roomId?: string;
  jobId?: string;
  kind?: string;
  ownerId?: string;
  replaceId?: string;
  clientId?: string;
}
/** Guide the browser file picker; the server independently checks MIME type, magic bytes, size and scanning. */
export const acceptedFiles =
  ".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx,.xlsx,.pptx";
/** Early 100 MiB browser limit; the gateway additionally enforces authoritative upload bounds. */
export const maximumFileSize = 100 * 1024 * 1024;
/** Check browser connectivity and read the current native access token for the file gateway. */
async function authHeaders() {
  requireOnline();
  const { data, error } = await db().auth.getSession();
  if (error || !data.session) throw new Error("authentication_required");
  return {
    Authorization: `Bearer ${data.session.access_token}`,
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
  const headers = await authHeaders();
  const form = new FormData();
  form.set("file", file);
  form.set("scope", context.scope);
  form.set(
    "kind",
    context.kind ?? (context.scope === "room" ? "chat" : "material"),
  );
  form.set("client_id", context.clientId ?? crypto.randomUUID());
  if (context.roomId) form.set("room_id", context.roomId);
  if (context.jobId) form.set("job_id", context.jobId);
  if (context.replaceId) form.set("replace_id", context.replaceId);
  if (context.ownerId) form.set("owner_id", context.ownerId);
  return await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint());
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
/** Download current or explicitly selected version bytes through a reauthorized no-store request. */
export async function downloadDocument(
  id: string,
  versionId?: string,
): Promise<Blob> {
  // The selected version ID prevents a replacement between listing and download
  // from combining an old filename with newer bytes.
  const response = await fetch(endpoint(), {
    method: "POST",
    headers: { ...(await authHeaders()), "Content-Type": "application/json" },
    body: JSON.stringify({ action: "download", id, version_id: versionId }),
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
  return await response.blob();
}
/** Create a temporary browser download from confirmed bytes and release its object URL. */
export async function saveDownload(
  id: string,
  name: string,
  versionId?: string,
) {
  const blob = await downloadDocument(id, versionId);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.rel = "noopener";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      .map((file) => [file.id, file.status, file.current_version_id])
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
