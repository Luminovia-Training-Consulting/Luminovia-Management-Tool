import type { InstallationBrand } from "../../lib/installation-brand";
import { isDocumentedRequest } from "./contract";

import {
  authorizeDocumentedRequest,
  type ExplorerRequest,
} from "./request-boundary";
export type { ExplorerRequest } from "./request-boundary";

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
  return authorizeDocumentedRequest(
    request,
    publishableKey,
    actor,
    currentSession,
    isDocumentedRequest(request.url, request.method, backend, brand),
    brand && brand.edition !== "internal"
      ? URL.parse(request.url, backend.replace(/\/+$/, "") + "/")?.href
      : undefined,
  );
}
