import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ApiCatalogue, type ApiDocument } from "./api-catalogue";
import "./explorer.css";
import { Button } from "../../components/ui/button";
import { PageHeading } from "../../components/common";
import type { InstallationBrand } from "../../lib/installation-brand";
import { db } from "../../lib/supabase";
import { useAuth } from "../auth/auth-context";
import {
  authorizeDocumentedRequest,
  type ExplorerRequest,
} from "./request-boundary";

type ExplorerProperties = {
  brand: InstallationBrand;
  createDocument: (backend: string, brand: InstallationBrand) => ApiDocument;
  checkRequest: (
    request: ExplorerRequest,
    backend: string,
    brand: InstallationBrand,
  ) => boolean;
};

const disabledMethods = [] as const;
const academyMethods = ["get", "post", "put", "delete"] as const;
const portalMethods = ["get", "post", "patch", "put", "delete"] as const;

/** The composition root supplies only the current edition's catalogue and request guard. */
export function Explorer(props: ExplorerProperties) {
  const { session } = useAuth();
  const actor = session?.user.id;
  return (
    <ExplorerSession {...props} actor={actor} key={actor ?? "signed-out"} />
  );
}

function ExplorerSession({
  brand,
  createDocument,
  checkRequest,
  actor,
}: ExplorerProperties & { actor?: string }) {
  const { i18n } = useTranslation();
  const de = i18n.language.startsWith("de");
  const academy = brand.edition !== "internal";
  const [approval, setApproval] = useState<number | null>(null);
  const permit = useRef(0);
  const authorized = approval !== null;
  useEffect(
    () => () => {
      permit.current += 1;
    },
    [],
  );
  function toggleRequests() {
    permit.current += 1;
    setApproval(actor && !authorized ? permit.current : null);
  }
  const backend = useMemo(
    () =>
      new URL(
        import.meta.env.VITE_SUPABASE_URL,
        window.location.origin,
      ).href.replace(/\/+$/, ""),
    [],
  );
  const document = useMemo(() => {
    const contract = createDocument(backend, brand);
    return {
      ...contract,
      security: [],
      // Keep schema references resolvable without taking credentials through Swagger.
      components: contract.components?.schemas
        ? { schemas: contract.components.schemas }
        : {},
    };
  }, [backend, brand, createDocument]);

  return (
    <>
      <PageHeading
        title={de ? "API-Dokumentation" : "API documentation"}
        description={
          academy
            ? de
              ? "Führe dokumentierte LMS-Anfragen mit deinem Konto aus. Der JSON-Download enthält zusätzlich die Datei- und Kontoschnittstellen."
              : "Run documented LMS requests with your account. The JSON download also includes file and account operations."
            : de
              ? "Durchsuche die dokumentierten Schnittstellen und führe Anfragen mit deinem aktuellen Konto aus."
              : "Search the documented operations and send requests with your current account."
        }
      />
      <div className="api-doc-actions">
        <Button
          type="button"
          aria-pressed={authorized}
          disabled={!actor}
          onClick={toggleRequests}
        >
          {authorized
            ? de
              ? "Anfragen deaktivieren"
              : "Disable requests"
            : de
              ? "Mit meinem Konto autorisieren"
              : "Authorize with my account"}
        </Button>
        <Button asChild variant="secondary">
          <Link to="/api/swagger">Swagger UI</Link>
        </Button>
        <Button asChild variant="secondary">
          <a href="/api/openapi.json" download>
            OpenAPI JSON
          </a>
        </Button>
        {brand.edition !== "internal" && (
          <>
            <Button asChild variant="secondary">
              <a href="/api/client.ts" download>
                TypeScript
              </a>
            </Button>
            <Button asChild variant="secondary">
              <a href="/api/client.py" download>
                Python
              </a>
            </Button>
          </>
        )}
      </div>
      <p role="status">
        {authorized
          ? de
            ? "Anfragen verwenden deine aktuellen Rechte und können echte Daten ändern."
            : "Requests use your current permissions and can change real data."
          : de
            ? "Anfragen sind deaktiviert."
            : "Requests are disabled."}
      </p>
      <div className="panel">
        <ApiCatalogue
          document={document}
          supportedSubmitMethods={
            authorized
              ? academy
                ? academyMethods
                : portalMethods
              : disabledMethods
          }
          requestInterceptor={async (request) => {
            if (!approval || !actor || permit.current !== approval)
              throw new Error("api_session_required");
            const permitted = await authorizeDocumentedRequest(
              request,
              import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              actor,
              async () => (await db().auth.getSession()).data.session,
              checkRequest(request, backend, brand),
              academy ? URL.parse(request.url, backend + "/")?.href : undefined,
            );
            if (permit.current !== approval)
              throw new Error("api_session_required");
            return permitted;
          }}
        />
      </div>
    </>
  );
}
