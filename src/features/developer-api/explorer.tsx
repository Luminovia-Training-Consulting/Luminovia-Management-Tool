import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import "./explorer.css";
import { Button } from "../../components/ui/button";
import { PageHeading } from "../../components/common";
import {
  installationBrand,
  internalInstallationBrand,
  type InstallationBrand,
} from "../../lib/installation-brand";
import { db } from "../../lib/supabase";
import { useAuth } from "../auth/auth-context";
import { portalOpenApi } from "./contract";
import { authorizeExplorerRequest } from "./requests";

export function ApiExplorer() {
  return <Explorer brand={internalInstallationBrand} />;
}

/** Installed academy API operations, with session credentials confined to local RPCs. */
export function AcademyApiExplorer() {
  return <Explorer brand={installationBrand} />;
}

function Explorer({ brand }: { brand: InstallationBrand }) {
  const { session } = useAuth();
  const actor = session?.user.id;
  return (
    <ExplorerSession brand={brand} actor={actor} key={actor ?? "signed-out"} />
  );
}

function ExplorerSession({
  brand,
  actor,
}: {
  brand: InstallationBrand;
  actor?: string;
}) {
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
  const spec = useMemo(() => {
    const document = portalOpenApi(backend, false, brand);
    return { ...document, security: [], components: {} };
  }, [backend, brand]);

  return (
    <>
      <PageHeading
        title={de ? "API-Dokumentation" : "API documentation"}
        description={
          academy
            ? de
              ? "Führe dokumentierte LMS-Datenbankanfragen mit deinem Konto aus. Der JSON-Download enthält zusätzlich die Datei- und Kontoschnittstellen."
              : "Run documented LMS database requests with your account. The JSON download also includes file and account operations."
            : de
              ? "Durchsuche die dokumentierten Schnittstellen und führe Anfragen mit deinem aktuellen Konto aus."
              : "Search the documented operations and send requests with your current account."
        }
      />
      <div className="button-row">
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
          <a href="/api/openapi.json" download>
            OpenAPI JSON
          </a>
        </Button>
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
      <section
        className={academy ? "panel academy-api-explorer" : "panel"}
        style={{
          colorScheme: "light",
          background: "white",
          color: "#172b4b",
          overflowWrap: "anywhere",
        }}
      >
        {/* Remount when disabling requests so responses do not linger in the viewer. */}
        <SwaggerUI
          key={String(authorized)}
          spec={spec}
          filter
          queryConfigEnabled={false}
          requestSnippetsEnabled={false}
          supportedSubmitMethods={
            authorized
              ? academy
                ? ["get", "post"]
                : ["get", "post", "patch", "put", "delete"]
              : []
          }
          showMutatedRequest={false}
          persistAuthorization={false}
          requestInterceptor={async (request) => {
            if (!approval || !actor || permit.current !== approval)
              throw new Error("api_session_required");
            const permitted = await authorizeExplorerRequest(
              request,
              backend,
              import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              actor,
              async () => (await db().auth.getSession()).data.session,
              brand,
            );
            if (permit.current !== approval) throw new Error("api_session_required");
            return permitted;
          }}
        />
      </section>
    </>
  );
}
