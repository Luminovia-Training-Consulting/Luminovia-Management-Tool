import { useAcademyBrand } from "../branding/academy-branding";
import { Explorer } from "./explorer";
import type { ExplorerRequest } from "./request-boundary";
import type { InstallationBrand } from "../../lib/installation-brand";

declare const __PORTAL_ACADEMY_EXPLORER__: ReturnType<
  typeof import("./academy-contract").academyExplorerOpenApi
>;
const academyCatalogue = __PORTAL_ACADEMY_EXPLORER__;

/** Build only the Academy catalogue into the dedicated interactive explorer. */
export function AcademyApiExplorer() {
  return (
    <Explorer
      brand={useAcademyBrand()}
      createDocument={academyDocument}
      checkRequest={isAcademyExplorerRequest}
    />
  );
}

function academyDocument(backend: string, brand: InstallationBrand) {
  return {
    ...academyCatalogue,
    info: { ...academyCatalogue.info, title: `${brand.name} API` },
    servers: [{ url: backend }],
    "x-portal-installation": {
      ...academyCatalogue["x-portal-installation"],
      installation_id: brand.installationId,
      edition: brand.edition,
    },
  };
}

function isAcademyExplorerRequest(request: ExplorerRequest, backend: string) {
  const base = URL.parse(backend);
  const target = URL.parse(request.url, backend + "/");
  if (
    !base ||
    !target ||
    target.origin !== base.origin ||
    target.username ||
    target.password ||
    target.hash ||
    target.search ||
    !target.pathname.startsWith(base.pathname.replace(/\/$/, "") + "/")
  ) {
    return false;
  }
  const method = request.method.toLowerCase();
  if (method !== "get" && method !== "post") return false;
  const path = target.pathname.slice(base.pathname.replace(/\/$/, "").length);
  const operations = academyCatalogue.paths;
  return (
    Object.hasOwn(operations, path) && Object.hasOwn(operations[path], method)
  );
}
