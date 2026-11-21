import { internalInstallationBrand } from "../../lib/installation-brand";
import { isDocumentedRequest, portalOpenApi } from "./contract";
import { Explorer } from "./explorer";

export function ApiExplorer() {
  return (
    <Explorer
      brand={internalInstallationBrand}
      createDocument={portalExplorerDocument}
      checkRequest={(request, backend) =>
        isDocumentedRequest(request.url, request.method, backend)
      }
    />
  );
}

function portalExplorerDocument(backend: string) {
  return portalOpenApi(backend, false, internalInstallationBrand);
}
