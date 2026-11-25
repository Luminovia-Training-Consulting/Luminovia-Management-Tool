/** Neutral route recovery for missing pages and pages outside the current account's access. */
import { Compass, LifeBuoy } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";
import { Button } from "./ui/button";
import "./page-not-found.css";

/** Keep the URL intact and offer only known-safe destinations, never details about the target. */
export function PageNotFound({ standalone = false }: { standalone?: boolean }) {
  const { t } = useTranslation();
  const { key } = useLocation();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [key]);

  const Container = standalone ? "main" : "div";
  return (
    <Container className="not-found-page">
      <div className="panel not-found-card">
        <span className="not-found-marker" aria-hidden="true">
          <Compass size={23} /> 404
        </span>
        <h1 ref={heading} tabIndex={-1}>
          {t("notFound")}
        </h1>
        <p>{t("notFoundDescription")}</p>
        <div className="not-found-actions">
          <Button asChild>
            <Link to="/">{t("goHome")}</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link to="/help?topic=troubleshooting">
              <LifeBuoy aria-hidden="true" /> {t("notFoundHelp")}
            </Link>
          </Button>
        </div>
      </div>
    </Container>
  );
}
