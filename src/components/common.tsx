/**
 * Geteilte, übersetzte Lade-, Fehler-, Hinweis- und Formularbausteine. Die Feldkomponente verknüpft native Controls mit Labels und Beschreibungen, ohne Formularhandler oder Refs zu ersetzen.
 */
import {
  Children,
  cloneElement,
  isValidElement,
  type AriaAttributes,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, ArrowRight, LoaderCircle } from "lucide-react";
import { Button } from "./ui/button";
import { Link } from "react-router-dom";
/** Meldet einen übersetzten Ladezustand als höfliche Statusänderung für assistive Technik. */
export function Loading() {
  const { t } = useTranslation();
  return (
    <div className="state" role="status">
      <LoaderCircle className="spin" />
      {t("loading")}
    </div>
  );
}
/** Zeigt einen Fehler als Alert und ergänzt nur dann einen Wiederholungsbutton, wenn der Aufrufer eine Aktion liefert. */
export function ErrorState({ retry }: { retry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="state error" role="alert">
      <AlertCircle />
      <p>{t("error")}</p>
      {retry && (
        <Button variant="secondary" onClick={retry}>
          {t("retry")}
        </Button>
      )}
    </div>
  );
}
/** Nur die nativen ID-/ARIA-Attribute, die Field beim zugänglichen Verknüpfen ergänzen darf. */
type FieldControlProps = Pick<
  AriaAttributes,
  "aria-describedby" | "aria-invalid"
> & { id?: string };
/** Verbindet genau ein natives Eingabefeld mit Label, Hinweis und Validierungsfehler und erhält vorhandene Handler/Refs. */
export function Field({
  id,
  label,
  error,
  children,
  hint,
}: {
  id: string;
  label: string;
  error?: boolean;
  children: ReactNode;
  hint?: string;
}) {
  const { t } = useTranslation();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  // A Field labels one native control. Preserve external descriptions and all form
  // handlers/refs, while owning the validation state and generated descriptions.
  const items = Children.toArray(children);
  const controlIndex = items.findIndex(
    (child) =>
      isValidElement<FieldControlProps>(child) &&
      typeof child.type === "string" &&
      ["input", "select", "textarea"].includes(child.type),
  );
  const controls = items.map((child, index) => {
    if (index !== controlIndex || !isValidElement<FieldControlProps>(child))
      return child;
    const descriptions = new Set(
      (child.props["aria-describedby"] ?? "")
        .split(/\s+/)
        .filter((value) => value && value !== hintId && value !== errorId),
    );
    if (hint) descriptions.add(hintId);
    if (error) descriptions.add(errorId);
    return cloneElement(child, {
      id,
      "aria-describedby": descriptions.size
        ? [...descriptions].join(" ")
        : undefined,
      "aria-invalid": error ? true : undefined,
    });
  });
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {controls}
      {hint && <small id={hintId}>{hint}</small>}
      {error && (
        <small id={errorId} className="error" role="alert">
          {t("validation")}
        </small>
      )}
    </div>
  );
}
/** Setzt eine konsistente Seitenüberschrift mit optionaler Beschreibung und fachlicher Aktion. */
export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
/** Rendert einen internen Routerlink mit gemeinsamem visuellen Richtungshinweis. */
export function TextLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link className="text-link" to={to}>
      {children}
      <ArrowRight size={16} />
    </Link>
  );
}
/** Verwendet für Fehler eine Alert-Rolle und für bestätigte Ergebnisse eine Status-Rolle. */
export function Notice({
  children,
  kind = "success",
}: {
  children: ReactNode;
  kind?: "success" | "error";
}) {
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      className={`notice ${kind}`}
    >
      {children}
    </div>
  );
}
