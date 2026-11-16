/**
 * Best-effort-Ablage ausschließlich für Sprache und Farbschema. Blockierter Browserstorage darf die aktive Oberfläche nicht abbrechen; Auth-Sessionablage folgt ihrem eigenen Supabase-SDK-Vertrag.
 */
/** Ausschließlich nicht sensible UI-Präferenzen, keine Auth- oder Fachdatenspeicherung. */
type Preference = "language" | "theme";

/** Visual preferences are best-effort local state. Storage denial or a full
 * quota must not prevent boot, language changes or theme controls from working.
 * Authentication storage stays under the Supabase client's separate contract. */
/** Liest eine nicht sensible UI-Präferenz und verwendet bei gesperrtem Storage den normalen Fallback. */
export function readPreference(name: Preference) {
  try {
    return localStorage.getItem(`luminovia.${name}`);
  } catch {
    return null;
  }
}

/** Speichert die UI-Auswahl best effort, ohne aktive Formulare bei Storagefehlern zurückzusetzen. */
export function writePreference(name: Preference, value: string) {
  try {
    localStorage.setItem(`luminovia.${name}`, value);
  } catch {
    // Keep the current interface state; do not loop or reset an active form.
  }
}
