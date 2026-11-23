/**
 * Human password sign-in and recovery requests. Validation/online notices support the UI; only
 * Supabase Auth can establish a session. Public help provides guidance without sign-in.
 */
import { portalInternalEdition } from "../../lib/installation-brand";
import { AcademyBrandImage } from "../branding/academy-logo-image";
import { useAcademyBrand } from "../branding/academy-branding";
import { type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Link, Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { db, isConfigured } from "../../lib/supabase";
import { useAuth } from "./auth-context";
import { Button } from "../../components/ui/button";
import { Field, Loading, Notice } from "../../components/common";
import { useOnline } from "../../lib/online";
import { previewLoginEmail } from "./preview-login";
import { signInHuman } from "./human-login-api";

/** Validate form input locally; the server independently enforces permissions, references and business-state constraints. */
const schema = z.object({
  email: z.string().trim().min(3).max(254),
  password: z.string().min(1),
});

/** Use native sign-in and recovery requests with separate form states. */
export function Login({ footer }: { footer?: ReactNode } = {}) {
  const brand = useAcademyBrand();
  const { t } = useTranslation();
  const { session, loading } = useAuth();
  const online = useOnline();
  const [recover, setRecover] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const {
    register,
    getValues,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
  });
  if (loading) return <Loading />;
  if (session) return <Navigate to="/" replace />;

  async function submit(values: z.infer<typeof schema>) {
    setMessage("");
    setFailed(false);
    if (!online) return;
    try {
      const email = previewLoginEmail(
        values.email,
        window.location.origin,
        import.meta.env.VITE_SUPABASE_URL,
      );
      await signInHuman(email, values.password);
      return;
    } catch {
      // Transport/storage failures may reject instead of returning an Auth error.
    }
    setFailed(true);
    setMessage("loginFailed");
  }

  async function recovery() {
    if (!online || recovering) return;
    setMessage("");
    setFailed(false);
    const identifier = getValues("email").trim().toLowerCase();
    const valid = identifier.includes("@")
      ? z.email().safeParse(identifier).success
      : /^[a-z][a-z0-9._-]{1,30}[a-z0-9]$/.test(identifier);
    if (!valid) {
      setFailed(true);
      setMessage("validation");
      return;
    }
    setRecovering(true);
    try {
      const { error } = await db().auth.resetPasswordForEmail(identifier, {
        redirectTo: `${window.location.origin}/auth/callback`,
      });
      setFailed(Boolean(error));
      setMessage(error ? "error" : "recoverSent");
    } catch {
      setFailed(true);
      setMessage("error");
    } finally {
      setRecovering(false);
    }
  }

  return (
    <div className="login-layout">
      <section className="login-story">
        {portalInternalEdition ? (
          <img
            className="brand-full"
            src={brand.logo}
            alt="Luminovia Training & Consulting"
          />
        ) : (
          <AcademyBrandImage
            className="brand-full academy-logo-preview"
            fallback={brand.logo}
            alt=""
          />
        )}
        <div>
          {portalInternalEdition && (
            <span className="eyebrow">{brand.name}</span>
          )}
          <h1>{portalInternalEdition ? t("safeLogin") : brand.name}</h1>
          {portalInternalEdition && <p>{t("loginStory")}</p>}
        </div>
        <div className="login-illustration" aria-hidden="true">
          <div className="arc arc-one" />
          <div className="arc arc-two" />
          <div className="arc arc-three" />
          {portalInternalEdition && <span>{t("tagline")}</span>}
        </div>
        {portalInternalEdition && (
          <p className="login-foot">IT · AI · BUSINESS</p>
        )}
      </section>
      <section className="login-panel">
        <div className="login-card">
          <ShieldCheck size={30} className="blue" />
          <h2>{t(recover ? "forgot" : "login")}</h2>
          <p>{t("invitationOnly")}</p>
          {!isConfigured ? (
            <Notice kind="error">
              <strong>{t("notConfigured")}</strong>
              <p>{t("setupHint")}</p>
            </Notice>
          ) : (
            <form
              onSubmit={
                recover
                  ? (event) => {
                      event.preventDefault();
                      void recovery();
                    }
                  : handleSubmit(submit)
              }
              noValidate
            >
              <Field
                id="email"
                label={t("usernameOrEmail")}
                error={Boolean(errors.email)}
              >
                <input
                  id="email"
                  type="text"
                  autoComplete="username"
                  {...register("email")}
                  aria-invalid={Boolean(errors.email)}
                />
              </Field>
              {!recover && (
                <Field
                  id="password"
                  label={t("password")}
                  error={Boolean(errors.password)}
                >
                  <input
                    id="password"
                    type="password"
                    autoComplete="current-password"
                    {...register("password")}
                    aria-invalid={Boolean(errors.password)}
                  />
                </Field>
              )}
              {message && (
                <Notice kind={failed ? "error" : "success"}>
                  {t(message)}
                </Notice>
              )}
              {recover ? (
                <Button type="submit" disabled={!online || recovering}>
                  {t("recover")}
                  <ArrowRight size={18} />
                </Button>
              ) : (
                <Button type="submit" disabled={isSubmitting || !online}>
                  {t(isSubmitting ? "loading" : "login")}
                  <ArrowRight size={18} />
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                disabled={recovering || isSubmitting}
                onClick={() => {
                  setRecover(!recover);
                  setMessage("");
                }}
              >
                {t(recover ? "back" : "forgot")}
              </Button>
            </form>
          )}
          <p className="fine-print">{t("invitationNote")}</p>
          <div className="login-learning-links">
            <Link to="/help">{t("helpGuides")}</Link>
          </div>
          {footer}
        </div>
      </section>
    </div>
  );
}
