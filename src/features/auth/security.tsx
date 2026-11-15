import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { permissionsQuery } from "../../lib/queries";
import { useAuth } from "./auth-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { db } from "../../lib/supabase";
import { Button } from "../../components/ui/button";
import { Field, Notice, PageHeading } from "../../components/common";
import { useOnline } from "../../lib/online";
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
  useEffect(() => {
    void (async () => {
      const { data, error } =
        await db().auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) {
        setFailed(true);
        return;
      }
      setReady(data.currentLevel === "aal2");
      const factors = await db().auth.mfa.listFactors();
      if (factors.error) {
        setFailed(true);
        return;
      }
      setFactor(
        factors.data.totp.find((f) => f.status === "verified")?.id ?? "",
      );
    })();
  }, []);
  async function enroll() {
    setBusy(true);
    setFailed(false);
    const existing = await db().auth.mfa.listFactors();
    if (existing.error) {
      setFailed(true);
      setBusy(false);
      return;
    }
    for (const f of existing.data.all.filter(
      (f) => f.status === "unverified",
    )) {
      const removed = await db().auth.mfa.unenroll({ factorId: f.id });
      if (removed.error) {
        setFailed(true);
        setBusy(false);
        return;
      }
    }
    const { data, error } = await db().auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Luminovia Portal",
    });
    if (error) setFailed(true);
    else {
      setFactor(data.id);
      setQr(data.totp.qr_code);
    }
    setBusy(false);
  }
  async function verify() {
    setBusy(true);
    setFailed(false);
    const { error } = await db().auth.mfa.challengeAndVerify({
      factorId: factor,
      code,
    });
    if (error) setFailed(true);
    else {
      setReady(true);
      setQr("");
      setCode("");
      await client.invalidateQueries();
    }
    setBusy(false);
  }
  return (
    <div className="narrow">
      <PageHeading title={t("security")} description={t("mfaHint")} />
      <section className="panel security-panel">
        <ShieldCheck size={36} className="blue" />
        <h2>{t("mfaTitle")}</h2>
        {ready ? (
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
