import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { z } from "zod";
import { db } from "../../lib/supabase";
import { useOnline } from "../../lib/online";
import { Button } from "../../components/ui/button";
import { Field, Notice } from "../../components/common";

/** Change only the authenticated actor's email through Supabase Auth. */
export function AccountSettings({ email }: { email: string }) {
  const { t } = useTranslation();
  const online = useOnline();
  const [nextEmail, setNextEmail] = useState("");
  const [username, setUsername] = useState("");
  const [usernameVersion, setUsernameVersion] = useState(0);
  const [usernameBusy, setUsernameBusy] = useState(false);
  const [usernameResult, setUsernameResult] = useState<
    "saved" | "invalid" | "unavailable" | "error" | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    "pending" | "saved" | "error" | "invalid" | null
  >(null);

  useEffect(() => {
    let alive = true;
    void db()
      .rpc("account_username")
      .then(({ data, error }) => {
        if (
          !alive ||
          error ||
          !data ||
          typeof data !== "object" ||
          Array.isArray(data)
        )
          return;
        const account = data as { username?: unknown; version?: unknown };
        setUsername(
          typeof account.username === "string" ? account.username : "",
        );
        setUsernameVersion(
          typeof account.version === "number" ? account.version : 0,
        );
      });
    return () => {
      alive = false;
    };
  }, []);

  async function saveUsername(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (usernameBusy || !online) return;
    const value = username.trim().toLowerCase();
    if (value && !/^[a-z][a-z0-9._-]{1,30}[a-z0-9]$/.test(value)) {
      setUsernameResult("invalid");
      return;
    }
    setUsernameBusy(true);
    setUsernameResult(null);
    try {
      const { data, error } = await db().rpc("save_account_username", {
        p_username: value || null,
        p_expected_version: usernameVersion,
      });
      if (error || !data || typeof data !== "object" || Array.isArray(data)) {
        setUsernameResult(error?.code === "23505" ? "unavailable" : "error");
        return;
      }
      const account = data as { username?: unknown; version?: unknown };
      setUsername(typeof account.username === "string" ? account.username : "");
      setUsernameVersion(
        typeof account.version === "number" ? account.version : usernameVersion,
      );
      setUsernameResult("saved");
    } catch {
      setUsernameResult("error");
    } finally {
      setUsernameBusy(false);
    }
  }

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
      <form onSubmit={(event) => void saveUsername(event)} noValidate>
        <Field
          id="account-username"
          label={t("username")}
          error={
            usernameResult === "invalid" || usernameResult === "unavailable"
          }
        >
          <input
            id="account-username"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(event) => {
              setUsername(event.target.value);
              setUsernameResult(null);
            }}
          />
        </Field>
        <p>{t("usernameHelp")}</p>
        <Button disabled={!online || usernameBusy}>{t("usernameSave")}</Button>
        {usernameResult && (
          <Notice kind={usernameResult === "saved" ? "success" : "error"}>
            {t(
              usernameResult === "saved"
                ? "usernameSaved"
                : usernameResult === "invalid"
                  ? "usernameInvalid"
                  : usernameResult === "unavailable"
                    ? "usernameUnavailable"
                    : "error",
            )}
          </Notice>
        )}
      </form>
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
      <p>{t("accountNameHelp")}</p>
    </section>
  );
}
