/**
 * Shared language/theme controls for public and private pages. Only visual preferences persist;
 * system-colour listeners follow the selected theme and are removed when it changes or unmounts.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { readPreference, writePreference } from "../lib/preferences";
/** Apply language/theme choices; follow system colours and persist visual settings best-effort. */
export function Preferences() {
  const { t, i18n } = useTranslation();
  const [theme, setTheme] = useState(() => {
    const saved = readPreference("theme");
    return saved && ["light", "dark", "system"].includes(saved)
      ? saved
      : "system";
  });
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
      <label className="sr-only" htmlFor="language">
        {t("language")}
      </label>
      <select
        id="language"
        aria-label={t("language")}
        value={i18n.language}
        onChange={(e) => void i18n.changeLanguage(e.target.value)}
      >
        <option value="de">DE</option>
        <option value="en">EN</option>
      </select>
      <label className="sr-only" htmlFor="theme">
        {t("theme")}
      </label>
      <select
        id="theme"
        aria-label={t("theme")}
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
      >
        <option value="system">◐ {t("system")}</option>
        <option value="light">☀ {t("light")}</option>
        <option value="dark">☾ {t("dark")}</option>
      </select>
    </div>
  );
}
