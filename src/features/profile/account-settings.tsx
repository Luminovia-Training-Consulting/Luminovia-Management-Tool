import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Field, Notice } from "../../components/common";

/** Change only the authenticated actor's email through Supabase Auth. */
export function AccountSettings({
  email,
  separateProfile = true,
}: {
  email: string;
  separateProfile?: boolean;
}) {
  const { t } = useTranslation();
  const online = useOnline();
  const [nextEmail, setNextEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    "pending" | "saved" | "error" | "invalid" | null
  >(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !online) return;
    const value = nextEmail.trim();
    if (
      !z.email().max(254).safeParse(value).success ||
      value.toLowerCase() === email.toLowerCase()
    ) {
      setResult("invalid");
      return;
    }
    setResult(null);
    setBusy(true);
    try {
      const { data, error } = await db().auth.updateUser({ email: value });
      if (error || !data.user) setResult("error");
      else {
        setResult(
          data.user.email?.toLowerCase() === value.toLowerCase()
            ? "saved"
            : "pending",
        );
        setNextEmail("");
      }
    } catch {
      setResult("error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>{t("accountSettings")}</h2>
      <p>
        {t("currentEmail")}: {email}
      </p>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <Field
          id="account-email"
          label={t("newEmail")}
          error={result === "invalid"}
        >
          <input
            id="account-email"
            type="email"
            autoComplete="email"
            value={nextEmail}
            onChange={(event) => {
              setNextEmail(event.target.value);
              setResult(null);
            }}
            aria-invalid={result === "invalid"}
          />
        </Field>
        <Button disabled={!online || busy}>{t("changeEmail")}</Button>
        {result && (
          <Notice
            kind={
              result === "error" || result === "invalid" ? "error" : "success"
            }
          >
            {t(
              result === "pending"
                ? "emailChangePending"
                : result === "saved"
                  ? "emailChangeSaved"
                  : result === "invalid"
                    ? "emailChangeInvalid"
                    : "error",
            )}
          </Notice>
        )}
      </form>
      <p>
        <Link className="text-link" to="/auth/password">
          {t("setPassword")}
        </Link>
      </p>
      {separateProfile && <p>{t("accountNameHelp")}</p>}
    </section>
  );
}
