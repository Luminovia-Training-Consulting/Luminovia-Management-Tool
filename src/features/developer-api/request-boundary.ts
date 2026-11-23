import {
  isPortalHttpAliasRequest,
  portalHttpAliasPrefix,
} from "./portal-http-contract.ts";

/** Swagger request fields used by the exact-backend session boundary. */
export type ExplorerRequest = {
  url: string;
  method: string;
  headers?: Record<string, string>;
  credentials?: "omit" | "same-origin" | "include";
  redirect?: "error" | "follow" | "manual";
};

type CurrentSession = () => Promise<{
  user: { id: string };
  access_token: string;
} | null>;

/** Apply a live session only after the caller approves the destination. */
export async function authorizeDocumentedRequest(
  request: ExplorerRequest,
  publishableKey: string,
  actor: string,
  currentSession: CurrentSession,
  permitted: boolean,
  canonicalUrl?: string,
): Promise<ExplorerRequest> {
  if (!permitted) throw new Error("api_request_destination_denied");
  const session = await currentSession();
  if (!session?.access_token || session.user.id !== actor)
    throw new Error("api_session_required");
  const headers = Object.fromEntries(
    Object.entries(request.headers ?? {}).filter(
      ([key]) =>
        ![
          "apikey",
          "authorization",
          "cookie",
          "accept-profile",
          "content-profile",
          "x-http-method-override",
          "x-http-method",
          "x-method-override",
        ].includes(key.toLowerCase()),
    ),
  );
  return {
    ...request,
    ...(canonicalUrl && { url: canonicalUrl }),
    headers: {
      ...headers,
      apikey: publishableKey,
      Authorization: `Bearer ${session.access_token}`,
    },
    credentials: "omit",
    redirect: "error",
  };
}

export function isAcademyExplorerRequest(
  request: ExplorerRequest,
  backend: string,
  operations: Record<string, object>,
) {
  const base = URL.parse(backend);
  const target = URL.parse(request.url, backend.replace(/\/+$/, "") + "/");
  if (
    !base ||
    !target ||
    target.origin !== base.origin ||
    target.username ||
    target.password ||
    target.hash ||
    !target.pathname.startsWith(base.pathname.replace(/\/$/, "") + "/")
  ) {
    return false;
  }
  const method = request.method.toLowerCase();
  const path = target.pathname.slice(base.pathname.replace(/\/$/, "").length);
  if (path.startsWith(portalHttpAliasPrefix))
    return isPortalHttpAliasRequest(target, path, method, operations);
  if (target.search || (method !== "get" && method !== "post")) return false;
  return (
    Object.hasOwn(operations, path) && Object.hasOwn(operations[path], method)
  );
}
