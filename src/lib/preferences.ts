type Preference = "language" | "theme";

/** Visual preferences are best-effort local state. Storage denial or a full
 * quota must not prevent boot, language changes or theme controls from working.
 * Authentication storage stays under the Supabase client's separate contract. */
export function readPreference(name: Preference) {
  try {
    return localStorage.getItem(`luminovia.${name}`);
  } catch {
    return null;
  }
}

export function writePreference(name: Preference, value: string) {
  try {
    localStorage.setItem(`luminovia.${name}`, value);
  } catch {
    // Keep the current interface state; do not loop or reset an active form.
  }
}
