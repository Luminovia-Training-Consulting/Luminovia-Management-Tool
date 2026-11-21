/** Swagger request fields used by the exact-backend session boundary. */
export type ExplorerRequest = {
  url: string;
  method: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  redirect?: RequestRedirect;
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
