import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import SwaggerUI from "swagger-ui-react";
import "swagger-ui-react/swagger-ui.css";
import { Button } from "../../components/ui/button";
import { PageHeading } from "../../components/common";
import { db } from "../../lib/supabase";
import { useAuth } from "../auth/auth-context";
import { portalOpenApi } from "./contract";
import { authorizeExplorerRequest } from "./requests";

export function ApiExplorer() {
  const { i18n } = useTranslation();
  const { session } = useAuth();
  const de = i18n.language.startsWith("de");
  const [authorized, setAuthorized] = useState(false);
  const backend = useMemo(
    () =>
      new URL(
        import.meta.env.VITE_SUPABASE_URL,
        window.location.origin,
      ).href.replace(/\/+$/, ""),
    [],
  );
  const spec = useMemo(() => {
    const document = portalOpenApi(backend);
    return { ...document, security: [], components: {} };
  }, [backend]);

  return (
    <>
      <PageHeading
        title={de ? "API-Dokumentation" : "API documentation"}
        description={
          de
            ? "Durchsuche die dokumentierten Schnittstellen und führe Anfragen mit deinem aktuellen Konto aus."
            : "Search the documented operations and send requests with your current account."
        }
      />
      <div className="button-row">
        <Button
          type="button"
          aria-pressed={authorized}
          onClick={() => setAuthorized(!authorized)}
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
        className="panel"
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
            authorized ? ["get", "post", "patch", "put", "delete"] : []
          }
          showMutatedRequest={false}
          persistAuthorization={false}
          requestInterceptor={async (request) => {
            if (!authorized || !session)
              throw new Error("api_session_required");
            return authorizeExplorerRequest(
              request,
              backend,
              import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              session.user.id,
              async () => (await db().auth.getSession()).data.session,
            );
          }}
        />
      </section>
    </>
  );
}
