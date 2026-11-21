import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation, useOutletContext } from "react-router-dom";
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
import {
  readPreference,
  uiLocalChangeEvent,
  writePreference,
} from "../../lib/preferences";
import type { UiPreferencesPatch } from "../../lib/ui-preferences-schema";
import { useAuth } from "../auth/auth-context";
import { AuthenticatorSettings } from "../auth/authenticator";
import { DeliverySettings } from "../notifications/delivery-settings";
import {
  academyPersonalSettingsQuery,
  saveAcademyAppearance,
  saveAcademyUsername,
} from "./academy-personal-settings-api";
import {
  usernamePattern,
  type AcademyAppearancePatch,
  type AcademyPersonalSettings,
} from "./academy-personal-settings-schema";

type Access = "active" | "grace";

function browserAppearance(language: string) {
  const theme = readPreference("theme");
  return {
    language: language.startsWith("de") ? ("de" as const) : ("en" as const),
    theme:
      theme === "light" || theme === "dark" || theme === "system"
        ? theme
        : installationBrand.defaultTheme,
  };
}

/** Serialize appearance saves across header and settings for the same session. */
function useSaveAppearance(actor: string) {
  const cache = useQueryClient();
  const { i18n } = useTranslation();
  const key = academyPersonalSettingsQuery(actor).queryKey;
  const mutation = useMutation({
    scope: { id: key.join(":") },
    mutationFn: async ({
      patch,
      visible,
    }: {
      patch: AcademyAppearancePatch;
      visible: ReturnType<typeof browserAppearance>;
    }) => {
      const current = cache.getQueryData<AcademyPersonalSettings>(key);
      return saveAcademyAppearance(
        actor,
        current?.appearance.version ? patch : { ...visible, ...patch },
      );
    },
    onSuccess: (appearance) =>
      cache.setQueryData<AcademyPersonalSettings>(
        key,
        (current) => current && { ...current, appearance },
      ),
  });

  return ({ language, theme }: UiPreferencesPatch) =>
    mutation.mutateAsync({
      patch: { ...(language ? { language } : {}), ...(theme ? { theme } : {}) },
      visible: browserAppearance(i18n.language),
    });
}

/** Restore an actor's saved appearance once without overruling a change made while loading. */
export function AcademyAppearancePreferences({
  actor,
  access,
}: {
  actor: string;
  access: Access;
}) {
  const { i18n } = useTranslation();
  const { pathname } = useLocation();
  const online = useOnline();
  const query = useQuery({
    ...academyPersonalSettingsQuery(actor),
    enabled: online,
  });
  const save = useSaveAppearance(actor);
  const hydration = useRef({ changed: false, ready: false });

  useEffect(() => {
    hydration.current = { changed: false, ready: false };
    const changed = () => {
      hydration.current.changed = true;
    };
    window.addEventListener(uiLocalChangeEvent, changed);
    return () => window.removeEventListener(uiLocalChangeEvent, changed);
  }, [actor]);
  const appearance = query.data?.appearance;
  useEffect(() => {
    if (!appearance || hydration.current.ready) return;
    hydration.current.ready = true;
    if (hydration.current.changed || !appearance.version) return;
    void i18n.changeLanguage(appearance.language);
    writePreference("theme", appearance.theme);
    window.dispatchEvent(
      new CustomEvent("luminovia-theme-changed", { detail: appearance.theme }),
    );
  }, [appearance, i18n]);

  const onSave = access === "active" && online ? save : undefined;
  // Keep the shared theme listener mounted while the settings page owns the controls.
  return (
    <div hidden={pathname.replace(/\/$/, "") === "/settings"}>
      <Preferences onSave={onSave} />
    </div>
  );
}

function errorCode(error: unknown) {
  return error && typeof error === "object" && "code" in error
    ? error.code
    : null;
}

export function AcademyPersonalSettingsPage() {
  const { session } = useAuth();
  const { t, i18n } = useTranslation();
  const access = useOutletContext<Access>();
  const online = useOnline();
  const actor = session?.user.id ?? "";
  const request = academyPersonalSettingsQuery(actor);
  const query = useQuery({ ...request, enabled: Boolean(actor && online) });
  const cache = useQueryClient();
  const saveAppearance = useSaveAppearance(actor);
  const [draft, setDraft] = useState<{ value: string; version: number } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<
    "saved" | "invalid" | "unavailable" | "stale" | "error" | null
  >(null);
  const word = (de: string, en: string) =>
    i18n.language.startsWith("de") ? de : en;

  if (!online)
    return (
      <Notice>
        {word(
          "Verbinde dich mit dem Internet, um deine Einstellungen zu öffnen.",
          "Connect to the internet to open your settings.",
        )}
      </Notice>
    );
  if (query.isPending) return <Loading />;
  if (query.isError || !query.data)
    return <ErrorState retry={() => void query.refetch()} />;

  const { username, appearance } = query.data;
  const writable = access === "active";
  const display = appearance.version
    ? appearance
    : browserAppearance(i18n.language);
  const value = draft?.value ?? username.username ?? "";
  const message =
    result &&
    {
      saved: t("usernameSaved"),
      invalid: t("usernameInvalid"),
      unavailable: t("usernameUnavailable"),
      stale: word(
        "Der Benutzername wurde geändert. Prüfe den aktuellen Stand und versuche es erneut.",
        "The username changed. Review its current value before trying again.",
      ),
      error: t("error"),
    }[result];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!writable || !draft || busy) return;
    const normalized = draft.value.trim().toLowerCase();
    if (normalized && !usernamePattern.test(normalized)) {
      setResult("invalid");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const current = await saveAcademyUsername(
        actor,
        normalized || null,
        draft.version,
      );
      cache.setQueryData<AcademyPersonalSettings>(
        request.queryKey,
        (previous) => previous && { ...previous, username: current },
      );
      setDraft(null);
      setResult("saved");
    } catch (error) {
      const code = errorCode(error);
      if (code === "PT409" || code === "40001") {
        const refreshed = await query.refetch();
        if (refreshed.isSuccess) setDraft(null);
        setResult("stale");
      } else {
        setResult(
          code === "23505"
            ? "unavailable"
            : code === "22023"
              ? "invalid"
              : "error",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeading title={word("Meine Einstellungen", "My settings")} />
      {!writable && (
        <Notice>
          {word(
            "Deine Einstellungen sind derzeit nur lesbar.",
            "Your settings are currently read-only.",
          )}
        </Notice>
      )}
      <section className="panel">
        <h2>{t("accountSettings")}</h2>
        {writable ? (
          <form onSubmit={(event) => void submit(event)}>
            <Field
              id="academy-personal-username"
              label={t("username")}
              hint={t("usernameHelp")}
              error={result === "invalid" || result === "unavailable"}
            >
              <input
                autoComplete="username"
                value={value}
                maxLength={64}
                disabled={busy}
                onChange={(event) => {
                  setDraft({
                    value: event.target.value,
                    version: draft?.version ?? username.version,
                  });
                  setResult(null);
                }}
              />
            </Field>
            <Button type="submit" disabled={!draft || busy}>
              {t("usernameSave")}
            </Button>
            {message && (
              <Notice kind={result === "saved" ? "success" : "error"}>
                {message}
              </Notice>
            )}
          </form>
        ) : (
          <p>
            {t("username")} ·{" "}
            {username.username ?? word("Nicht festgelegt", "Unset")}
          </p>
        )}
      </section>
      {writable && <AuthenticatorSettings actor={actor} />}
      {writable && <DeliverySettings actor={actor} />}
      <section className="panel">
        <h2>{word("Sprache und Design", "Language and appearance")}</h2>
        {writable ? (
          <Preferences onSave={saveAppearance} />
        ) : (
          <dl>
            <dt>{t("language")}</dt>
            <dd>
              {display.language === "de"
                ? word("Deutsch", "German")
                : word("Englisch", "English")}
            </dd>
            <dt>{t("theme")}</dt>
            <dd>{t(display.theme)}</dd>
          </dl>
        )}
      </section>
    </>
  );
}
