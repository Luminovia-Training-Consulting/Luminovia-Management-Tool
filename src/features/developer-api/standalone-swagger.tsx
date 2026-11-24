import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ApiNavigation } from "./api-navigation";
import { ApiCatalogue, type ApiDocument } from "./api-catalogue";
import { Preferences } from "../../components/preferences";
import { PageHeading } from "../../components/common";
import { Button } from "../../components/ui/button";
import { portalInternalEdition } from "../../lib/installation-brand";
import "./explorer.css";

const openApiUrl = "/api/openapi.json";
const readOnly = [] as const;

async function loadSpecification(signal: AbortSignal): Promise<ApiDocument> {
  const response = await fetch(openApiUrl, { signal, credentials: "omit" });
  if (!response.ok) throw new Error("OpenAPI document unavailable");
  const spec = await response.json();
  if (
    typeof spec?.openapi !== "string" ||
    !spec.paths ||
    typeof spec.paths !== "object"
  )
    throw new Error("Invalid OpenAPI document");
  return spec;
}

export function StandaloneSwagger() {
  const { i18n } = useTranslation();
  const de = i18n.language.startsWith("de");
  const spec = useQuery({
    queryKey: ["standalone-openapi"],
    queryFn: ({ signal }) => loadSpecification(signal),
    gcTime: 0,
    retry: false,
  });

  return (
    <div className="standalone-swagger">
      <div className="standalone-swagger-content">
        <PageHeading
          title="Swagger UI"
          description={
            de
              ? "API-Referenz. Anfragen kannst du im interaktiven API-Explorer ausführen."
              : "API reference. Use the interactive API explorer to run requests."
          }
          action={<Preferences />}
        />
        <ApiNavigation />
        <div className="api-doc-actions">
          {!portalInternalEdition && (
            <>
              <Button asChild variant="secondary">
                <a href="/api/workflows.json" download>
                  {de ? "Geschäftsabläufe (JSON)" : "Business workflows (JSON)"}
                </a>
              </Button>
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
          <Button asChild variant="secondary">
            <Link to="/">{de ? "Zum Portal" : "Back to portal"}</Link>
          </Button>
        </div>
        {spec.isPending && (
          <p role="status">
            {de
              ? "API-Dokumentation wird geladen …"
              : "Loading API documentation …"}
          </p>
        )}
        {spec.isError && (
          <>
            <p role="alert">
              {de
                ? "Die OpenAPI-Datei konnte nicht geladen werden."
                : "The OpenAPI document could not be loaded."}
            </p>
            <Button variant="secondary" onClick={() => void spec.refetch()}>
              {de ? "Erneut versuchen" : "Try again"}
            </Button>
          </>
        )}
        {spec.data && (
          <ApiCatalogue
            document={spec.data}
            supportedSubmitMethods={readOnly}
            requestInterceptor={async () => {
              throw new Error("api_requests_disabled");
            }}
          />
        )}
      </div>
    </div>
  );
}
