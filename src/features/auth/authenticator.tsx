import { type FormEvent, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  ErrorState,
  Field,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { Preferences } from "../../components/preferences";
import { Button } from "../../components/ui/button";
import { installationBrand } from "../../lib/installation-brand";
import { useOnline } from "../../lib/online";
import { db } from "../../lib/supabase";
import { SignOutButton } from "./sign-out-button";
import "./authenticator.css";

export const authenticatorRequired = "PT412";

type Enrollment = { id: string; secret: string; qr: string };

function AuthenticatorForm({
  actor,
  gate,
  onVerified,
}: {
  actor: string;
  gate: boolean;
  onVerified: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const formId = useId();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [selection, setSelection] = useState("");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<"setup" | "verify" | null>(null);
  const factors = useQuery({
    queryKey: ["authenticator-factors", actor],
    enabled: online,
    retry: false,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await db().auth.mfa.listFactors();
      if (error) throw error;
      return data;
    },
  });

  async function connect() {
    if (!online || pending || !factors.data || factors.data.totp.length) return;
    setPending(true);
    setFailure(null);
    try {
      const mfa = db().auth.mfa;
      // A cancelled setup has no recoverable secret. Discard only unverified
      // copies of this portal's authenticator before opening a fresh pairing.
      const friendlyName = t("authenticatorDeviceName", { lng: "en" });
      for (const factor of factors.data.all) {
        if (
          factor.factor_type !== "totp" ||
          factor.status !== "unverified" ||
          factor.friendly_name !== friendlyName
        )
          continue;
        const { error } = await mfa.unenroll({ factorId: factor.id });
        if (error) throw error;
      }
      const { data, error } = await mfa.enroll({
        factorType: "totp",
        issuer: installationBrand.name,
        friendlyName,
      });
      if (error) throw error;
      setEnrollment({
        id: data.id,
        secret: data.totp.secret,
        qr: data.totp.qr_code,
      });
    } catch {
      setFailure("setup");
      await factors.refetch();
    } finally {
      setPending(false);
    }
  }

  const verified = factors.data?.totp ?? [];
  const factorId =
    enrollment?.id ??
    (verified.some((factor) => factor.id === selection)
      ? selection
      : verified[0]?.id);

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!online || pending || !factorId || !/^\d{6}$/.test(code)) return;
    setPending(true);
    setFailure(null);
    try {
      const { error } = await db().auth.mfa.challengeAndVerify({
        factorId,
        code,
      });
      if (error) throw error;
      setCode("");
      setEnrollment(null);
      await onVerified();
      if (!gate) await factors.refetch();
    } catch {
      setFailure("verify");
    } finally {
      setPending(false);
    }
  }

  if (!online) return <Notice>{t("authenticatorOnline")}</Notice>;
  if (factors.isPending) return <Loading />;
  if (factors.isError)
    return <ErrorState retry={() => void factors.refetch()} />;
  if (!gate && verified.length)
    return <Notice kind="success">{t("authenticatorConnected")}</Notice>;

  const needsEnrollment = !verified.length;
  return (
    <>
      {gate && (
        <PageHeading
          title={t(
            needsEnrollment
              ? "authenticatorSetup"
              : "authenticatorVerifySignIn",
          )}
          description={
            needsEnrollment ? undefined : t("authenticatorVerifyHint")
          }
        />
      )}
      <div className={gate ? "panel" : undefined}>
        {!enrollment && needsEnrollment && (
          <>
            <p>{t("authenticatorSetupHint")}</p>
            <Button disabled={pending} onClick={() => void connect()}>
              {t("authenticatorConnect")}
            </Button>
          </>
        )}
        {enrollment && (
          <>
            <p>{t("authenticatorScan")}</p>
            {enrollment.qr.startsWith("data:image/svg+xml;") && (
              <img
                className="authenticator-qr"
                src={enrollment.qr}
                width={168}
                height={168}
                alt={t("authenticatorQr")}
              />
            )}
            <details>
              <summary>{t("authenticatorManualKey")}</summary>
              <code className="authenticator-key">{enrollment.secret}</code>
            </details>
          </>
        )}
        {factorId && (
          <form onSubmit={(event) => void verify(event)}>
            {!enrollment && verified.length > 1 && (
              <Field id={`${formId}-device`} label={t("authenticatorDevice")}>
                <select
                  value={factorId}
                  disabled={pending}
                  onChange={(event) => {
                    setSelection(event.target.value);
                    setCode("");
                  }}
                >
                  {verified.map((factor, index) => (
                    <option key={factor.id} value={factor.id}>
                      {factor.friendly_name ||
                        t("authenticatorDeviceNumber", { count: index + 1 })}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            <Field id={`${formId}-code`} label={t("authenticatorCode")}>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                disabled={pending}
                aria-describedby={
                  failure === "verify" ? `${formId}-failure` : undefined
                }
                onChange={(event) =>
                  setCode(event.target.value.replace(/\D/g, ""))
                }
              />
            </Field>
            {failure === "verify" && (
              <p id={`${formId}-failure`} className="error" role="alert">
                {t("authenticatorCodeFailed")}
              </p>
            )}
            <Button type="submit" disabled={pending || !/^\d{6}$/.test(code)}>
              {t("authenticatorConfirm")}
            </Button>
          </form>
        )}
        {failure === "setup" && (
          <Notice kind="error">{t("authenticatorSetupFailed")}</Notice>
        )}
      </div>
    </>
  );
}

export function AuthenticatorGate({
  actor,
  onVerified,
}: {
  actor: string;
  onVerified: () => Promise<unknown>;
}) {
  return (
    <main className="password-setup">
      <div className="password-setup-actions">
        <Preferences />
        <SignOutButton variant="secondary" />
      </div>
      <div className="narrow">
        <AuthenticatorForm actor={actor} gate onVerified={onVerified} />
      </div>
    </main>
  );
}

export function AuthenticatorSettings({ actor }: { actor: string }) {
  const { t } = useTranslation();
  const online = useOnline();
  const cache = useQueryClient();
  const available = useQuery({
    queryKey: ["authenticator-settings-available", actor],
    enabled: Boolean(actor) && online,
    retry: false,
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const { data, error } = await db().rpc(
        "authenticator_settings_available",
      );
      if (error) throw error;
      return data === true;
    },
  });
  if (!online || !available.isFetchedAfterMount || available.data !== true)
    return null;
  return (
    <section className="panel">
      <h2>{t("authenticatorSettings")}</h2>
      <AuthenticatorForm
        actor={actor}
        gate={false}
        onVerified={() =>
          cache.invalidateQueries({ queryKey: ["permissions", actor] })
        }
      />
    </section>
  );
}
