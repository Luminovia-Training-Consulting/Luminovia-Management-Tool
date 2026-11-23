import { Component, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { Notice, PageHeading } from "../../components/common";
import { Button } from "../../components/ui/button";

/** Keep a failed Swagger import or render inside the API page. */
class SwaggerErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function SwaggerRoute({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const german = i18n.language.startsWith("de");
  const { pathname } = useLocation();
  const reference = pathname === "/api/swagger";

  return (
    <SwaggerErrorBoundary
      key={pathname}
      fallback={
        <section className="panel">
          <PageHeading
            title={german ? "API-Dokumentation" : "API documentation"}
          />
          <Notice kind="error">
            {german
              ? "Die API-Dokumentation konnte nicht geladen werden."
              : "The API documentation could not be loaded."}
          </Notice>
          <div className="page-actions">
            {/* A document reload clears the failed lazy import from the browser's module map. */}
            <Button onClick={() => window.location.reload()}>
              {german ? "Seite neu laden" : "Reload page"}
            </Button>
            <Button asChild variant="secondary">
              <a href="/api/openapi.json" download>
                OpenAPI JSON
              </a>
            </Button>
            <Button asChild variant="secondary">
              <Link to={reference ? "/api/docs" : "/api/swagger"}>
                {reference
                  ? german
                    ? "Interaktiver API-Explorer"
                    : "Interactive API explorer"
                  : "Swagger UI"}
              </Link>
            </Button>
            <Button asChild variant="secondary">
              <Link to="/">{german ? "Zum Portal" : "Back to portal"}</Link>
            </Button>
          </div>
        </section>
      }
    >
      {children}
    </SwaggerErrorBoundary>
  );
}
