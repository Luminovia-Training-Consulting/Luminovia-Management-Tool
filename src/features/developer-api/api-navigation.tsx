import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";
import { SectionLink } from "../../components/section-card";

export function ApiNavigation({ children }: { children?: ReactNode }) {
  const { i18n } = useTranslation();
  const de = i18n.language.startsWith("de");
  const { pathname } = useLocation();
  const documentation = de ? "API-Dokumentation" : "API documentation";
  return (
    <nav className="section-navigation" aria-label={documentation}>
      {children}
      <SectionLink
        to="/api/docs"
        title={documentation}
        description={
          de
            ? "Schnittstellen durchsuchen und mit deinem Konto testen."
            : "Browse endpoints and try requests with your account."
        }
        aria-current={pathname === "/api/docs" ? "page" : undefined}
      />
      <SectionLink
        to="/api/swagger"
        title="Swagger UI"
        description={
          de
            ? "API-Referenz mit Parametern und Antworten ansehen."
            : "View the API reference, parameters and responses."
        }
        aria-current={pathname === "/api/swagger" ? "page" : undefined}
      />
      <SectionLink
        to="/api/openapi.json"
        title="OpenAPI JSON"
        description={
          de
            ? "Die Spezifikation für deine Werkzeuge herunterladen."
            : "Download the specification for your tools."
        }
        reloadDocument
        download
      />
    </nav>
  );
}
