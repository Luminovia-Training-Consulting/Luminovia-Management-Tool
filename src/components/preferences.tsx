/** Shared visual preferences stay synchronized across header, settings and browser tabs. */
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  readPreference,
  reportUiPreferenceChange,
  writePreference,
} from "../lib/preferences";
import { installationBrand } from "../lib/installation-brand";
import type { UiPreferencesPatch } from "../lib/ui-preferences-api";
import type { AccountLanguage } from "../lib/account-languages";
import { LanguageOptions } from "./language-options";

const themeChanged = "luminovia-theme-changed";

function readTheme() {
  const saved = readPreference("theme");
  return saved && ["light", "dark", "system"].includes(saved)
    ? saved
    : installationBrand.defaultTheme;
}

/** A single stored value drives every control and the actual document theme. */
export function Preferences({
  onSave,
}: {
  onSave?: (patch: UiPreferencesPatch) => Promise<unknown>;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [theme, setTheme] = useState(readTheme);
  const [saveFailed, setSaveFailed] = useState(false);
  const saveSeq = useRef(0);
  const save = (patch: UiPreferencesPatch) => {
    if (!onSave) return;
    const seq = ++saveSeq.current;
    setSaveFailed(false);
    void onSave(patch).catch(() => {
      if (saveSeq.current === seq) setSaveFailed(true);
    });
  };
  useEffect(() => {
    const changed = (event: Event) => {
      const value = event instanceof CustomEvent ? event.detail : readTheme();
      if (["light", "dark", "system"].includes(value)) setTheme(value);
    };
    window.addEventListener(themeChanged, changed);
    window.addEventListener("storage", changed);
    return () => {
      window.removeEventListener(themeChanged, changed);
      window.removeEventListener("storage", changed);
    };
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    writePreference("theme", theme);
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return (
    <div className="preferences">
      <label className="sr-only" htmlFor={`${id}-language`}>
        {t("language")}
      </label>
      <select
        id={`${id}-language`}
        aria-label={t("language")}
        value={i18n.language}
        onChange={(e) => {
          const language = e.target.value as AccountLanguage;
          reportUiPreferenceChange("language");
          void i18n.changeLanguage(language);
          save({ language });
        }}
      >
        <LanguageOptions compact />
      </select>
      <label className="sr-only" htmlFor={`${id}-theme`}>
        {t("theme")}
      </label>
      <select
        id={`${id}-theme`}
        aria-label={t("theme")}
        value={theme}
        onChange={(e) => {
          reportUiPreferenceChange("theme");
          writePreference("theme", e.target.value);
          window.dispatchEvent(
            new CustomEvent(themeChanged, { detail: e.target.value }),
          );
          save({ theme: e.target.value as "system" | "light" | "dark" });
        }}
      >
        <option value="system">◐ {t("system")}</option>
        <option value="light">☀ {t("light")}</option>
        <option value="dark">☾ {t("dark")}</option>
      </select>
      {saveFailed && <span role="alert">{t("uiPreferenceNotSaved")}</span>}
    </div>
  );
}
