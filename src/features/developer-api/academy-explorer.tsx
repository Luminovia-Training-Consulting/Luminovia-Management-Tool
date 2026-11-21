import { useAcademyBrand } from "../branding/academy-branding";
import { Explorer } from "./explorer";
import { isAcademyExplorerRequest } from "./request-boundary";
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
      checkRequest={(request, backend) =>
        isAcademyExplorerRequest(request, backend, academyCatalogue.paths)
      }
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
