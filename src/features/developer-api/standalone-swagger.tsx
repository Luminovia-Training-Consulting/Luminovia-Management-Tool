import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { SwaggerView } from "./swagger-view";

const openApiUrl = "/api/openapi.json";
const readOnly = [] as const;

async function loadSpecification(signal: AbortSignal): Promise<object> {
  const response = await fetch(openApiUrl, { signal, credentials: "omit" });
  if (!response.ok) throw new Error("OpenAPI document unavailable");
  const spec = await response.json();
  if (typeof spec?.openapi !== "string" || !spec.paths)
    throw new Error("Invalid OpenAPI document");
  return spec;
}

export function StandaloneSwagger() {
  const { i18n } = useTranslation();
  const de = i18n.language.startsWith("de");
  const spec = useQuery({
    queryKey: ["standalone-openapi"],
    queryFn: ({ signal }) => loadSpecification(signal),
    retry: false,
  });

  return (
    <main style={{ background: "#fff", color: "#3b4151", minHeight: "100dvh" }}>
      <nav className="swagger-ui" aria-label="Swagger UI">
        <div className="wrapper">
          <a href={openApiUrl} download>
            OpenAPI JSON
          </a>
          {" · "}
          <Link to="/api/docs">
            {de ? "Interaktiver API-Explorer" : "Interactive API explorer"}
          </Link>
        </div>
      </nav>
      {spec.isPending && (
        <p role="status">
          {de
            ? "API-Dokumentation wird geladen …"
            : "Loading API documentation …"}
        </p>
      )}
      {spec.isError && (
        <p role="alert">
          {de
            ? "Die OpenAPI-Datei konnte nicht geladen werden."
            : "The OpenAPI document could not be loaded."}
        </p>
      )}
      {spec.data && (
        <SwaggerView
          spec={spec.data}
          filter
          supportedSubmitMethods={readOnly}
          requestInterceptor={async () => {
            throw new Error("api_requests_disabled");
          }}
        />
      )}
    </main>
  );
}
