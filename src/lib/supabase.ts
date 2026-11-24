/**
 * One shared browser client using a public URL/publishable key. Expose missing configuration
 * explicitly; server secret/service-role keys never belong in this module.
 */
import { createClient } from "@supabase/supabase-js";

/** Public backend address from the browser configuration validated at build time. */
const url = import.meta.env.VITE_SUPABASE_URL;
/** Public publishable key; service/secret keys are explicitly forbidden here. */
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
/** Distinguish configured browser startup from a deliberately unconnected application. */
export const isConfigured = Boolean(url && key);
/** One native client using PKCE, session persistence and token refresh across the browser tree. */
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

/** Return the shared browser client or fail explicitly when configuration is missing. */
export function db() {
  if (!supabase) throw new Error("backend_not_configured");
  return supabase;
}
