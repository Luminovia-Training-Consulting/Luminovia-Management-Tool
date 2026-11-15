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
export function Loading() {
  const { t } = useTranslation();
  return (
    <div className="state" role="status">
      <LoaderCircle className="spin" />
      {t("loading")}
    </div>
  );
}
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
type FieldControlProps = Pick<
  AriaAttributes,
  "aria-describedby" | "aria-invalid"
> & { id?: string };
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
