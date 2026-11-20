/**
 * Best-effort persistence for language/theme only. Blocked browser storage must not break the
 * active UI; Auth persistence follows the separate Supabase SDK contract.
 */
/** Non-sensitive UI preferences only, never Auth or business-data storage. */
type Preference = "language" | "theme";
export const uiLocalChangeEvent = "luminovia-ui-local-change";

/**
 * Read a visual preference best-effort; denied/full storage returns null without blocking boot,
 * language changes or theme controls. Auth persistence keeps the Supabase SDK's separate contract.
 */
export function readPreference(name: Preference) {
    try {
        return localStorage.getItem(`luminovia.${name}`);
    } catch {
        return null;
    }
}

/** Persist the UI choice best-effort without resetting active forms on storage failure. */
export function writePreference(name: Preference, value: string) {
    try {
        localStorage.setItem(`luminovia.${name}`, value);
    } catch {
        // Keep the current interface state; do not loop or reset an active form.
    }
}