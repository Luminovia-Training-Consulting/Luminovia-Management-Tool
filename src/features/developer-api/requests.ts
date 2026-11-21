import type { InstallationBrand } from "../../lib/installation-brand";
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
  brand?: InstallationBrand,
): Promise<ExplorerRequest> {
  if (!isDocumentedRequest(request.url, request.method, backend, brand)) {
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
          "x-http-method-override",
          "x-http-method",
          "x-method-override",
        ].includes(key.toLowerCase()),
    ),
  );
  return {
    ...request,
    ...(brand &&
      brand.edition !== "internal" && {
        url: new URL(request.url, backend.replace(/\/+$/, "") + "/").href,
      }),
    headers: {
      ...headers,
      apikey: publishableKey,
      Authorization: `Bearer ${session.access_token}`,
    },
    credentials: "omit",
    redirect: "error",
  };
}
