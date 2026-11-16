/**
 * Ein gemeinsamer Browserclient mit öffentlicher URL und Publishable-Key. Fehlende Konfiguration bleibt als expliziter Zustand sichtbar; serverseitige Secret-/Service-Role-Schlüssel gehören niemals in dieses Modul.
 */
import { createClient } from "@supabase/supabase-js";
/** Öffentliche Backendadresse aus der beim Build geprüften Browserkonfiguration. */
const url = import.meta.env.VITE_SUPABASE_URL;
/** Öffentlicher Publishable-Key; private Service-/Secret-Schlüssel sind hier ausdrücklich unzulässig. */
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
/** Unterscheidet echte Browserkonfiguration von einem nicht verbundenen Anwendungsstart. */
export const isConfigured = Boolean(url && key);
/** Ein nativer Client mit PKCE, Sessionpersistenz und Tokenrefresh für den gesamten Browserbaum. */
export const supabase = isConfigured
  ? createClient(url, key, {
      auth: {
        flowType: "pkce",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
/** Liefert den gemeinsamen Browserclient oder schlägt bei fehlender Konfiguration ausdrücklich fehl. */
export function db() {
  if (!supabase) throw new Error("backend_not_configured");
  return supabase;
}
