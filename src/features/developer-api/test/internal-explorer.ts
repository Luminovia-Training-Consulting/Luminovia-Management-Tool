/** Exercise the same generated path map and request boundary as the internal browser. */
import { internalInstallationBrand } from "../../../lib/installation-brand";
import { internalExplorerDocument } from "../contract";
import { isInternalExplorerRequest } from "../request-boundary";

const document = internalExplorerDocument("/", internalInstallationBrand);

export function isDocumentedRequest(
  url: string,
  method: string,
  backend: string,
) {
  return isInternalExplorerRequest({ url, method }, backend, document.paths);
}
