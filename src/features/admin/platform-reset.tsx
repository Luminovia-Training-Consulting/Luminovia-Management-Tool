import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/ui/button";
import { profileQuery, userRolesQuery } from "../../lib/queries";
import { useAuth } from "../auth/auth-context";
import { useSignOut } from "../auth/sign-out-state";

const local = () => import.meta.env.DEV;
const hostedOrigin = "https://cms.luminovia.org";

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
    "Der Browser-Reset ist auf dieser Installation gerade nicht verfügbar.",
    "Browser reset is currently unavailable on this installation.",
  ],
  hostedScope: [
    "Der Reset löscht die aktiven Daten dieser CMS-Installation einschließlich Konten, Dateien, Kursen und Nachrichten. Dein Konto wird mit derselben E-Mail-Adresse als neuer Owner angelegt. Das Portal startet danach neu. Verschlüsselte Sicherungen bleiben erhalten.",
    "Reset deletes this CMS installation’s active data, including accounts, files, courses and messages. Your email address is used to create the new owner account. The portal restarts afterwards. Encrypted backups are retained.",
  ],
  localUnavailable: [
    "Der Browser-Reset ist nur im eigenen lokalen Portal verfügbar. Starte die Installation mit ./portal start.",
    "Browser reset is available in the owned local portal. Start the installation with ./portal start.",
  ],
  confirm: ["Zur Bestätigung DELETE eingeben", "Type DELETE to confirm"],
  hostedConfirm: [
    "Zur Bestätigung RESET CONFIRM eingeben",
    "Type RESET CONFIRM to confirm",
  ],
  password: ["Aktuelles Passwort", "Current password"],
  replacement: [
    "Neues Owner-Passwort (mindestens 16 Zeichen)",
    "New owner password (at least 16 characters)",
  ],
  repeat: ["Neues Passwort wiederholen", "Repeat the new password"],
  action: [
    "Alle Daten dieser Installation löschen",
    "Delete all data in this installation",
  ],
  accepted: [
    "Der Reset wurde angefordert. Das lokale Portal wird gestoppt. Prüfe im Terminal mit ./portal status, ob die Löschung abgeschlossen ist.",
    "Reset requested. The local portal is shutting down. Check ./portal status in your terminal to confirm deletion.",
  ],
  complete: [
    "Der Reset ist abgeschlossen. Melde dich mit deiner E-Mail-Adresse und dem neuen Owner-Passwort an.",
    "Reset is complete. Sign in with your email address and the new owner password.",
  ],
  working: [
    "Der Server prüft die Sicherung und führt den Reset aus. Lass diese Seite geöffnet.",
    "The server is checking the backup and running the reset. Keep this page open.",
  ],
  hostedFailed: [
    "Der Reset wurde nicht als abgeschlossen bestätigt. Lass den Serverstatus prüfen, bevor du es erneut versuchst.",
    "Reset completion could not be confirmed. Check the server status before trying again.",
  ],
  backupRequired: [
    "Für den Reset fehlt eine aktuelle, vollständige verschlüsselte Sicherung.",
    "Reset requires a recent, complete encrypted backup.",
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
  const [newPassword, setNewPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();
  const [result, setResult] = useState<
    "failed" | "hostedFailed" | "invalid" | "backupRequired"
  >();
  const isLocal = local();
  const endpoint = isLocal ? "/__portal/local-reset" : "/__portal/hosted-reset";
  const phrase = isLocal ? "DELETE" : "RESET CONFIRM";
  const target = useQuery({
    queryKey: ["platform-reset-target", endpoint],
    retry: false,
    queryFn: async () => {
      const response = await fetch(endpoint, { cache: "no-store" });
      if (
        !response.ok ||
        !response.headers.get("content-type")?.startsWith("application/json")
      )
        return null;
      const data = await response.json();
      if (!isLocal) return data.instance === hostedOrigin ? hostedOrigin : null;
      return typeof data.project === "string" ? (data.project as string) : null;
    },
  });
  const canSubmit =
    !!target.data &&
    confirmation === phrase &&
    !!password &&
    (isLocal ||
      (Array.from(newPassword).length >= 16 &&
        newPassword !== password &&
        newPassword === repeat));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || pending) return;
    setPending(true);
    setResult(undefined);
    const body = JSON.stringify({
      confirmation,
      password,
      ...(!isLocal && { newPassword }),
    });
    setPassword("");
    setNewPassword("");
    setRepeat("");
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
      if (!isLocal) {
        const data = await response.json();
        if (response.status === 412 && data.status === "backup_required") {
          setResult("backupRequired");
          return;
        }
        if (response.status !== 200 || data.status !== "complete")
          throw new Error();
        navigate("/reset-status", {
          replace: true,
          state: { hostedResetComplete: true },
        });
        return;
      }
      if (response.status !== 202) throw new Error();
      const data = await response.json();
      if (typeof data.receipt !== "string") throw new Error();
      navigate(`/reset-status#${encodeURIComponent(data.receipt)}`, {
        replace: true,
      });
    } catch {
      setResult(isLocal ? "failed" : "hostedFailed");
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
            <p>{t(isLocal ? "scope" : "hostedScope")}</p>
            {target.data && (
              <p>
                {t("target")} <code>{target.data}</code>
              </p>
            )}
            <div className="grid max-w-md gap-4">
              {/* This confirmation is not a username in the password form. */}
              <label className="grid gap-1.5" htmlFor="reset-confirmation">
                {t(isLocal ? "confirm" : "hostedConfirm")}
                <input
                  id="reset-confirmation"
                  name="reset-confirmation"
                  className="input"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  disabled={pending}
                  value={confirmation}
                  onChange={(event) =>
                    setConfirmation(event.currentTarget.value)
                  }
                />
              </label>
              <form className="grid gap-4" onSubmit={submit}>
                <label className="grid gap-1.5" htmlFor="reset-password">
                  {t("password")}
                  <input
                    id="reset-password"
                    name="reset-current-password"
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    required
                    disabled={pending}
                    maxLength={1024}
                    value={password}
                    onChange={(event) => setPassword(event.currentTarget.value)}
                  />
                </label>
                {!isLocal && (
                  <>
                    <label
                      className="grid gap-1.5"
                      htmlFor="reset-owner-password"
                    >
                      {t("replacement")}
                      <input
                        id="reset-owner-password"
                        className="input"
                        type="password"
                        autoComplete="new-password"
                        required
                        maxLength={1024}
                        disabled={pending}
                        value={newPassword}
                        onChange={(event) =>
                          setNewPassword(event.currentTarget.value)
                        }
                      />
                    </label>
                    <label
                      className="grid gap-1.5"
                      htmlFor="reset-repeat-password"
                    >
                      {t("repeat")}
                      <input
                        id="reset-repeat-password"
                        className="input"
                        type="password"
                        autoComplete="new-password"
                        required
                        maxLength={1024}
                        disabled={pending}
                        value={repeat}
                        onChange={(event) =>
                          setRepeat(event.currentTarget.value)
                        }
                      />
                    </label>
                  </>
                )}
                {pending && !isLocal && <p role="status">{t("working")}</p>}
                {result && <p role="alert">{t(result)}</p>}
                <Button
                  className="max-w-full justify-self-start whitespace-normal"
                  type="submit"
                  variant="danger"
                  disabled={!canSubmit || pending}
                >
                  {t("action")}
                </Button>
              </form>
            </div>
          </>
        ) : isLocal ? (
          <p>{t("localUnavailable")}</p>
        ) : (
          <p>{t("hosted")}</p>
        )}
      </section>
    </div>
  );
}

/** Report only the result confirmed by the corresponding reset endpoint. */
export function PlatformResetStatus() {
  const location = useLocation();
  const receipt = location.hash.slice(1);
  const { i18n, t } = useTranslation();
  const language = i18n.language.startsWith("de") ? 0 : 1;
  const navigate = useNavigate();
  const { pending, failed, signOut } = useSignOut(() =>
    navigate("/login", { replace: true }),
  );
  const complete = !local() && location.state?.hostedResetComplete === true;
  const valid =
    local() && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(receipt);

  if (!valid && !complete) return <Navigate to="/login" replace />;
  return (
    <main className="mx-auto max-w-lg p-4">
      <section className="card stack">
        <h1>{copy.title[language]}</h1>
        <p role="status">
          {copy[complete ? "complete" : "accepted"][language]}
        </p>
        {complete && (
          <Button
            type="button"
            disabled={pending}
            onClick={() => void signOut()}
          >
            {t("logout")}
          </Button>
        )}
        {failed && <p role="alert">{t("signOutFailed")}</p>}
      </section>
    </main>
  );
}
