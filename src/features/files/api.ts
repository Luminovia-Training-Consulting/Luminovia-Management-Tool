/**
 * Authentifizierter Dateitransfer, konkrete Dokumentversionen und statusabhängige Metadatenqueries. Nur eine bestätigte saubere Serverantwort beendet den Upload; private Bytes werden mit no-store geladen und bleiben außerhalb des PWA-Caches.
 */
import { db } from "../../lib/supabase";
import { requireOnline } from "../../lib/online";
import { queryOptions } from "@tanstack/react-query";
/** Berechtigte Dokumentmetadaten einschließlich Scope, Scanstatus und konkreter aktueller Versions-ID. */
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
/** Beantragter Dateikontext und optionale Retry-/Ersetzungsreferenzen; alle Beziehungen werden serverseitig geprüft. */
export interface UploadContext {
  scope: PortalDocument["scope"];
  roomId?: string;
  jobId?: string;
  kind?: string;
  ownerId?: string;
  replaceId?: string;
  clientId?: string;
}
/** Dateiauswahlhilfe des Browsers; MIME, Magic Bytes, Größe und Scan werden unabhängig davon auf dem Server geprüft. */
export const acceptedFiles =
  ".pdf,.png,.jpg,.jpeg,.webp,.txt,.docx,.xlsx,.pptx";
/** Frühe Browsergrenze von 100 MiB; verbindliche Uploadlimits gelten zusätzlich am Gateway. */
export const maximumFileSize = 100 * 1024 * 1024;
/** Prüft den Browser-Onlinestatus und liest das aktuelle native Access-Token für das Dateigateway. */
async function authHeaders() {
  requireOnline();
  const { data, error } = await db().auth.getSession();
  if (error || !data.session) throw new Error("authentication_required");
  return {
    Authorization: `Bearer ${data.session.access_token}`,
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
}
/** Authentifiziertes Dateigateway desselben konfigurierten Supabase-Backends statt einer öffentlichen Storage-URL. */
const endpoint = () =>
  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/files`;
/** Überträgt Bytes mit Fortschritt bis 95 Prozent und meldet 100 Prozent erst nach bestätigter sauberer Serverantwort. */
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
    // Der Netzwerktransfer umfasst den serverseitigen Scan nicht. Deshalb wird
    // der übertragene Anteil vor der bestätigten clean-Antwort auf 95 Prozent begrenzt.
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress?.(Math.min(95, Math.round((e.loaded / e.total) * 95)));
    };
    xhr.onerror = () => reject(new Error("upload_failed"));
    xhr.ontimeout = () => reject(new Error("upload_failed"));
    xhr.onload = () => {
      try {
        const result = JSON.parse(xhr.responseText);
        // Weder HTTP 2xx allein noch ein vorhandener Dokumentdatensatz ist
        // Scanfreigabe: nur der explizite saubere Status darf den Upload abschließen.
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
/** Lädt aktuelle oder ausdrücklich gewählte Versionsbytes über eine erneut autorisierte no-store-Anfrage. */
export async function downloadDocument(
  id: string,
  versionId?: string,
): Promise<Blob> {
  // Die gewählte Versions-ID verhindert, dass Austausch zwischen Liste und
  // Download einen alten Dateinamen mit neuen Bytes kombiniert.
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
/** Erzeugt aus bestätigten Dateibytes einen temporären Browserdownload und gibt die Objekt-URL wieder frei. */
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

/** Erkennt verweigerten Metadatenzugriff, um weitere automatische Abrufe dieses Queryzustands zu stoppen. */
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
/** Schwacher, querylebensdauergebundener Zeitmarker für Scanpolling; enthält keine zweite Kopie privater Dokumente. */
const scanWindows = new WeakMap<
  object,
  { signature: string; started: number }
>();
/** Fragt ausstehende Scans höchstens zwei Minuten schnell ab und kehrt danach zum langsamen Metadatenrhythmus zurück. */
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
/** Lädt die berechtigten documents-Datensätze über den nativen Client und propagiert Lese-/Rechtefehler. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
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
/** Lädt die berechtigten documents-Datensätze über den nativen Client und propagiert Lese-/Rechtefehler. Der Cache ist an den jeweiligen Akteur beziehungsweise die abgefragte Person gebunden. */
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
