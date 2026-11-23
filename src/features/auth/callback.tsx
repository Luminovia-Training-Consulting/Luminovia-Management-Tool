/**
 * Public return route for invitations and recovery. Process actual Auth state or the invitation
 * token and navigate only after confirmed completion.
 */
import { portalInternalEdition } from "../../lib/installation-brand";
import { AcademyBrandImage } from "../branding/academy-logo-image";
import { useAcademyBrand } from "../branding/academy-branding";
import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { db } from "../../lib/supabase";
import { useAuth } from "./auth-context";
import { useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Loading, Notice } from "../../components/common";

/** Complete the native invitation/recovery callback and leave a retryable state on failure. */
export function AuthCallback() {
  const brand = useAcademyBrand();
  const { t } = useTranslation();
  const { session, loading, error } = useAuth();
  const navigate = useNavigate();
  const online = useOnline();
  const [invite] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const hash = params.get("token_hash");
    const type = params.get("type");
    return (type === "invite" || type === "recovery") &&
      hash &&
      /^[A-Za-z0-9_-]{20,512}$/.test(hash)
      ? { hash, type }
      : null;
  });
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // The one-time token stays in component memory, never in logs or local storage.
  useEffect(() => {
    if (invite) window.history.replaceState(null, "", window.location.pathname);
  }, [invite]);

  async function accept() {
    if (!invite || !online || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const { error } = await db().auth.verifyOtp({
        token_hash: invite.hash,
        type: invite.type,
      });
      if (error) setFailed(true);
      else navigate("/auth/password", { replace: true });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (!invite && loading) return <Loading />;
  if (!invite && session) return <Navigate to="/auth/password" replace />;
  const setup = invite?.type === "recovery";
  const action = setup ? "setPassword" : "acceptInvite";
  return (
    <main className="callback-layout">
      <section className="panel">
        {portalInternalEdition ? (
          <img src={brand.logo} alt="Luminovia Training & Consulting" />
        ) : (
          <AcademyBrandImage
            className="academy-logo-preview"
            fallback={brand.logo}
            alt={brand.name}
          />
        )}
        <h1>{t(action)}</h1>
        <p>
          {t(setup ? "setupWelcome" : "inviteWelcome", {
            name: portalInternalEdition ? "Luminovia" : brand.name,
          })}
        </p>
        {invite ? (
          <Button onClick={() => void accept()} disabled={busy || !online}>
            {t(busy ? "loading" : action)}
          </Button>
        ) : (
          <Notice kind="error">{t("inviteInvalid")}</Notice>
        )}
        {(failed || error) && (
          <Notice kind="error">{t("inviteInvalid")}</Notice>
        )}
      </section>
    </main>
  );
}
