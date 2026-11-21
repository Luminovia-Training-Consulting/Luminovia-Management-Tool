import { isDocumentedRequest } from "./contract";

/** Swagger request fields used by the exact-backend session boundary. */
export type ExplorerRequest = {
  url: string;
  method: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  redirect?: RequestRedirect;
};

/** Apply the current caller's session only to a documented operation. */
export async function authorizeExplorerRequest(
  request: ExplorerRequest,
  backend: string,
  publishableKey: string,
  actor: string,
  currentSession: () => Promise<{
    user: { id: string };
    access_token: string;
  } | null>,
): Promise<ExplorerRequest> {
  if (!isDocumentedRequest(request.url, request.method, backend)) {
    throw new Error("api_request_destination_denied");
  }
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
        ].includes(key.toLowerCase()),
    ),
  );
  return {
    ...request,
    headers: {
      ...headers,
      apikey: publishableKey,
      Authorization: `Bearer ${session.access_token}`,
    },
    credentials: "omit",
    redirect: "error",
  };
}
