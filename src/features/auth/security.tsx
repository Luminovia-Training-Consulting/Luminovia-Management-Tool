/**
 * TOTP-Einrichtung, Challenge und Faktorverwaltung für die aktuelle Session. QR-Code und Verifikationszustand bleiben lokal; neue privilegierte Rechte werden nach erfolgreicher MFA erneut vom Backend gelesen.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { permissionsQuery } from "../../lib/queries";
import { useAuth } from "./auth-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { db } from "../../lib/supabase";
import { Button } from "../../components/ui/button";
import { Field, Loading, Notice, PageHeading } from "../../components/common";
import { useOnline } from "../../lib/online";
/** Verwaltet TOTP-Enrollment und Challenges, ohne einen ungeprüften Faktor als bestätigte MFA auszugeben. */
export function Security() {
  const { t } = useTranslation();
  const online = useOnline();
  const client = useQueryClient();
  const { session } = useAuth();
  const permissions = useQuery(permissionsQuery(session!.user.id));
  const [factor, setFactor] = useState("");
  const [qr, setQr] = useState("");
  const [code, setCode] = useState("");
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const { data, error } =
          await db().auth.mfa.getAuthenticatorAssuranceLevel();
        if (error) throw error;
        if (data.currentLevel === "aal2") {
          if (current) setReady(true);
          return;
        }
        const factors = await db().auth.mfa.listFactors();
        if (factors.error) throw factors.error;
        if (current) {
          setFactor(
            factors.data.totp.find((f) => f.status === "verified")?.id ?? "",
          );
        }
      } catch {
        if (current) setFailed(true);
      } finally {
        if (current) setChecking(false);
      }
    })();
    // Do not let an older initial read overwrite a newly enrolled factor or a
    // remounted actor. Enrolment stays unavailable until this read has settled.
    return () => {
      current = false;
    };
  }, []);
  async function enroll() {
    if (!online || busy || checking) return;
    setBusy(true);
    setFailed(false);
    try {
      const existing = await db().auth.mfa.listFactors();
      if (existing.error) throw existing.error;
      for (const f of existing.data.all.filter(
        (f) => f.status === "unverified",
      )) {
        const removed = await db().auth.mfa.unenroll({ factorId: f.id });
        if (removed.error) throw removed.error;
      }
      const { data, error } = await db().auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Luminovia Portal",
      });
      if (error) throw error;
      setFactor(data.id);
      setQr(data.totp.qr_code);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    if (!online || busy || checking || !factor || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    setFailed(false);
    try {
      const { error } = await db().auth.mfa.challengeAndVerify({
        factorId: factor,
        code,
      });
      if (error) throw error;
      setReady(true);
      setQr("");
      setCode("");
      await client.invalidateQueries();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="narrow">
      <PageHeading title={t("security")} description={t("mfaHint")} />
      <section className="panel security-panel">
        <ShieldCheck size={36} className="blue" />
        <h2>{t("mfaTitle")}</h2>
        {checking ? (
          <Loading />
        ) : ready ? (
          <Notice>{t("mfaReady")}</Notice>
        ) : (
          <>
            {!factor && (
              <Button onClick={() => void enroll()} disabled={busy || !online}>
                {t("mfaEnroll")}
              </Button>
            )}
            {qr && (
              <>
                <p>{t("mfaScan")}</p>
                <img className="mfa-qr" src={qr} alt={t("mfaScan")} />
              </>
            )}
            {factor && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void verify();
                }}
              >
                <Field id="mfa-code" label={t("mfaCode")}>
                  <input
                    id="mfa-code"
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    required
                  />
                </Field>
                <Button disabled={busy || !online || code.length !== 6}>
                  {t("mfaVerify")}
                </Button>
              </form>
            )}
          </>
        )}
        {permissions.data?.includes("jobs.manage") && (
          <Button asChild>
            <Link to="/admin">{t("admin")}</Link>
          </Button>
        )}
        {failed && <Notice kind="error">{t("error")}</Notice>}
      </section>
    </div>
  );
}
