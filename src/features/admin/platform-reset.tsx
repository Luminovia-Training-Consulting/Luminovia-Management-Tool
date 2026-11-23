import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { profileQuery, userRolesQuery } from "../../lib/queries";
import { useAuth } from "../auth/auth-context";

const endpoint = "/__portal/local-reset";

const copy = {
  title: ["Plattform zurücksetzen", "Reset platform"],
  irreversible: ["Dauerhafte Datenlöschung", "Permanent data deletion"],
  denied: [
    "Diese Seite ist nur für aktive Administratoren und Owner.",
    "This page is for active administrators and owners only.",
  ],
  scope: [
    "Der Reset löscht Datenbankinhalte, Konten, Sitzungen, LMS-Kurse, Nachrichten, hochgeladene Dateien und lokale E-Mails dieser Installation. Danach bleibt das lokale Portal gestoppt.",
    "Reset deletes this installation's database contents, accounts, sessions, LMS courses, messages, uploads and local email. The local portal stays stopped.",
  ],
  hosted: [
    "Für den veröffentlichten CMS-Server ist der Reset eine Host-Operation. Starte die Zielprüfung im Server-Terminal. Der anschließende interaktive Reset prüft die Sicherung, dein Admin-Konto und das aktuelle Passwort und legt einen neuen Owner an.",
    "Resetting the hosted CMS requires host access. Start by checking the target in the server terminal. The interactive reset then checks the backup, your administrator account and current password, and creates a new owner.",
  ],
  localUnavailable: [
    "Der Browser-Reset ist nur im eigenen lokalen Portal verfügbar. Starte die Installation mit ./portal start.",
    "Browser reset is available in the owned local portal. Start the installation with ./portal start.",
  ],
  confirm: ["Zur Bestätigung DELETE eingeben", "Type DELETE to confirm"],
  password: ["Aktuelles Passwort", "Current password"],
  action: [
    "Alle Daten dieser Installation löschen",
    "Delete all data in this installation",
  ],
  accepted: [
    "Der Reset wurde angefordert. Das lokale Portal wird gestoppt. Prüfe im Terminal mit ./portal status, ob die Löschung abgeschlossen ist.",
    "Reset requested. The local portal is shutting down. Check ./portal status in your terminal to confirm deletion.",
  ],
  failed: [
    "Der Reset konnte nicht bestätigt werden. Prüfe vor einem erneuten Versuch lokal den Portalstatus mit ./portal status.",
    "The reset could not be confirmed. Check the local portal status using ./portal status before trying again.",
  ],
  invalid: [
    "Bestätigung abgelehnt. Prüfe dein aktuelles Passwort.",
    "Confirmation denied. Check your current password.",
  ],
  target: ["Zielinstallation", "Target installation"],
  checking: [
    "Zielinstallation wird geprüft …",
    "Checking the target installation…",
  ],
} as const;

export function PlatformResetPage() {
  const { session } = useAuth();
  const actor = session!.user.id;
  const roles = useQuery(userRolesQuery(actor));
  const profile = useQuery(profileQuery(actor));
  const { i18n } = useTranslation();
  const language = i18n.language.startsWith("de") ? 0 : 1;
  const t = (key: keyof typeof copy) => copy[key][language];
  const authorized =
    profile.data?.active &&
    roles.data?.some((role) => role === "admin" || role === "owner");

  if (profile.isPending || roles.isPending)
    return <p role="status">{t("checking")}</p>;
  if (!authorized) return <p role="alert">{t("denied")}</p>;

  return (
    <PlatformResetForm
      key={actor}
      token={session!.access_token}
      language={language}
    />
  );
}

function PlatformResetForm({
  token,
  language,
}: {
  token: string;
  language: 0 | 1;
}) {
  const { t: common } = useTranslation();
  const t = (key: keyof typeof copy) => copy[key][language];
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();
  const [result, setResult] = useState<"failed" | "invalid">();
  const target = useQuery({
    queryKey: ["local-platform-reset-target"],
    enabled: import.meta.env.DEV,
    retry: false,
    queryFn: async () => {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (
        !response.ok ||
        !response.headers.get("content-type")?.startsWith("application/json")
      )
        return null;
      const data = await response.json();
      return typeof data.project === "string" ? (data.project as string) : null;
    },
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target.data || confirmation !== "DELETE" || !password || pending)
      return;
    setPending(true);
    setResult(undefined);
    const body = JSON.stringify({ confirmation, password });
    setPassword("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body,
      });
      if (response.status === 400 || response.status === 403) {
        setResult("invalid");
        return;
      }
      if (response.status !== 202) throw new Error();
      const data = await response.json();
      if (typeof data.receipt !== "string") throw new Error();
      navigate(`/reset-status#${encodeURIComponent(data.receipt)}`, {
        replace: true,
      });
    } catch {
      setResult("failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="stack">
      <h1>{common("fullPlatformReset")}</h1>
      <section className="panel stack" aria-labelledby="platform-reset-title">
        <h2 id="platform-reset-title">{t("title")}</h2>
        <p className="notice error">{t("irreversible")}</p>
        {target.isLoading ? (
          <p role="status">{t("checking")}</p>
        ) : target.data ? (
          <>
            <p>{t("scope")}</p>
            {target.data && (
              <p>
                {t("target")} <code>{target.data}</code>
              </p>
            )}
            <form className="stack max-w-md" onSubmit={submit}>
              <label className="stack" htmlFor="reset-confirmation">
                {t("confirm")}
                <input
                  id="reset-confirmation"
                  className="input"
                  autoComplete="off"
                  spellCheck={false}
                  value={confirmation}
                  onChange={(event) =>
                    setConfirmation(event.currentTarget.value)
                  }
                />
              </label>
              <label className="stack" htmlFor="reset-password">
                {t("password")}
                <input
                  id="reset-password"
                  className="input"
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={1024}
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                />
              </label>
              {result && <p role="alert">{t(result)}</p>}
              <Button
                className="self-start"
                type="submit"
                variant="danger"
                disabled={confirmation !== "DELETE" || !password || pending}
              >
                {t("action")}
              </Button>
            </form>
          </>
        ) : import.meta.env.DEV ? (
          <p>{t("localUnavailable")}</p>
        ) : (
          <>
            <p>{t("hosted")}</p>
            <code className="break-words">./portal reset-live --plan</code>
            <code className="break-words">./portal reset-live --apply</code>
          </>
        )}
      </section>
    </div>
  );
}

/** The browser confirms the request before the local web server shuts down. */
export function PlatformResetStatus() {
  const receipt = useLocation().hash.slice(1);
  const { i18n } = useTranslation();
  const language = i18n.language.startsWith("de") ? 0 : 1;
  const valid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(receipt);

  if (!valid) return <Navigate to="/login" replace />;
  return (
    <main className="mx-auto max-w-lg p-4">
      <section className="card stack">
        <h1>{copy.title[language]}</h1>
        <p role="status">{copy.accepted[language]}</p>
      </section>
    </main>
  );
}
