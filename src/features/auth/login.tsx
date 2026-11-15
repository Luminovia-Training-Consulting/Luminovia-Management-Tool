import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { db, isConfigured } from "../../lib/supabase";
import { useAuth } from "./auth-context";
import { Button } from "../../components/ui/button";
import { Field, Loading, Notice } from "../../components/common";
import { useOnline } from "../../lib/online";
const schema = z.object({ email: z.email(), password: z.string().min(1) });
export function Login() {
  const { t } = useTranslation();
  const { session, loading } = useAuth();
  const online = useOnline();
  const [recover, setRecover] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  if (loading) return <Loading />;
  if (session) return <Navigate to="/" replace />;
  async function submit(values: z.infer<typeof schema>) {
    setMessage("");
    setFailed(false);
    if (!online) return;
    const { error } = await db().auth.signInWithPassword(values);
    if (error) {
      setFailed(true);
      setMessage(t("loginFailed"));
    }
  }
  async function recovery() {
    setMessage("");
    setFailed(false);
    const email = (document.getElementById("email") as HTMLInputElement).value;
    if (!z.email().safeParse(email).success) {
      setFailed(true);
      setMessage(t("validation"));
      return;
    }
    const { error } = await db().auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback`,
    });
    setFailed(Boolean(error));
    setMessage(t(error ? "error" : "recoverSent"));
  }
  return (
    <div className="login-layout">
      <section className="login-story">
        <img
          className="brand-full"
          src="/brand/luminovia-logo-full.webp"
          alt="Luminovia Training & Consulting"
        />
        <div>
          <span className="eyebrow">LUMINOVIA PORTAL</span>
          <h1>{t("safeLogin")}</h1>
          <p>{t("loginStory")}</p>
        </div>
        <div className="login-illustration" aria-hidden="true">
          <div className="arc arc-one" />
          <div className="arc arc-two" />
          <div className="arc arc-three" />
          <span>{t("tagline")}</span>
        </div>
        <p className="login-foot">IT · AI · BUSINESS</p>
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
            <form onSubmit={handleSubmit(submit)} noValidate>
              <Field
                id="email"
                label={t("email")}
                error={Boolean(errors.email)}
              >
                <input
                  id="email"
                  type="email"
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
                <Notice kind={failed ? "error" : "success"}>{message}</Notice>
              )}
              {recover ? (
                <Button
                  type="button"
                  onClick={() => void recovery()}
                  disabled={!online}
                >
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
        </div>
      </section>
    </div>
  );
}
