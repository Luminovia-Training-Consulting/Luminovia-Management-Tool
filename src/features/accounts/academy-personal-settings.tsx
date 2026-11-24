import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation, useOutletContext } from "react-router-dom";
import {
  ErrorState,
  Loading,
  Notice,
  PageHeading,
} from "../../components/common";
import { Preferences } from "../../components/preferences";
import { installationBrand } from "../../lib/installation-brand";
import { isAccountLanguage } from "../../lib/account-languages";
import { useOnline } from "../../lib/online";
import {
  readPreference,
  uiLocalChangeEvent,
  writePreference,
  type UiPreferenceField,
} from "../../lib/preferences";
import type { UiPreferencesPatch } from "../../lib/ui-preferences-schema";
import { useAuth } from "../auth/auth-context";
import { AuthenticatorSettings } from "../auth/authenticator";
import { AccountSettings } from "../profile/account-settings";
import { DisplayNameEditor } from "../profile/display-name-editor";
import { DeliverySettings } from "../notifications/delivery-settings";
import {
  academyPersonalSettingsQuery,
  saveAcademyAppearance,
  saveAcademyDisplayName,
} from "./academy-personal-settings-api";
import {
  type AcademyAppearancePatch,
  type AcademyPersonalSettings,
} from "./academy-personal-settings-schema";

type Access = "active" | "grace";

function browserAppearance(language: string) {
  const theme = readPreference("theme");
  return {
    language: isAccountLanguage(language)
      ? language
      : installationBrand.defaultLanguage,
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
        current?.appearance.version
          ? patch
          : { theme: visible.theme, ...patch },
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
  const hydration = useRef({
    changed: new Set<UiPreferenceField>(),
    ready: false,
  });

  useEffect(() => {
    hydration.current = { changed: new Set(), ready: false };
    const changed = (event: Event) => {
      hydration.current.changed.add(
        (event as CustomEvent<UiPreferenceField>).detail,
      );
    };
    window.addEventListener(uiLocalChangeEvent, changed);
    return () => window.removeEventListener(uiLocalChangeEvent, changed);
  }, [actor]);
  const appearance = query.data?.appearance;
  useEffect(() => {
    if (!appearance || hydration.current.ready) return;
    hydration.current.ready = true;
    if (!hydration.current.changed.has("language"))
      void i18n.changeLanguage(appearance.language);
    if (hydration.current.changed.has("theme") || !appearance.version) return;
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

  const { display_name: displayName, appearance } = query.data;
  const writable = access === "active";
  const display = appearance.version
    ? appearance
    : browserAppearance(i18n.language);
  return (
    <>
      <PageHeading title={word("Meine Einstellungen", "My settings")} />
      <div className="section-stack">
        {!writable && (
          <Notice>
            {word(
              "Deine Einstellungen sind derzeit nur lesbar.",
              "Your settings are currently read-only.",
            )}
          </Notice>
        )}
        {writable ? (
          <>
            <DisplayNameEditor
              key={`name:${actor}`}
              initial={displayName}
              save={async (name) => {
                const display_name = await saveAcademyDisplayName(actor, name);
                cache.setQueryData<AcademyPersonalSettings>(
                  request.queryKey,
                  (previous) => previous && { ...previous, display_name },
                );
              }}
            />
            <AccountSettings
              key={`email:${actor}`}
              email={session?.user.email ?? ""}
              separateProfile={false}
            />
          </>
        ) : (
          <section className="panel">
            <p>
              {t("displayName")}: {displayName}
            </p>
            <p>
              {t("currentEmail")}: {session?.user.email}
            </p>
          </section>
        )}
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
      </div>
    </>
  );
}
