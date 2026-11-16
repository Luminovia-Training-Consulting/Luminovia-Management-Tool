/**
 * Build boundary for exclusively public Supabase browser configuration.
 * Server secrets must not enter the bundle even when accidentally assigned to a VITE variable.
 */
/** Reject accidental server keys before Vite can put them in a public bundle. */

export function validatePublicConfig(
  url: string | undefined,
  key: string | undefined,
  required = false,
) {
  if (!url && !key && !required) return;
  if (!url || !key)
    throw new Error(
      "Both public Supabase environment variables are required for a release build.",
    );
  let endpoint: URL;
  try {
    endpoint = new URL(url);
  } catch {
    throw new Error("Supabase URL must be an absolute HTTPS or loopback URL.");
  }
  if (endpoint.username || endpoint.password)
    throw new Error("Supabase URL must not contain credentials.");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (
    endpoint.protocol !== "https:" &&
    !(local && endpoint.protocol === "http:")
  )
    throw new Error("Supabase must use HTTPS outside loopback development.");
  if (key.startsWith("sb_publishable_")) return;
  // Local/legacy anon JWTs remain supported; never print the configured key.
  try {
    const segment = key.split(".")[1];
    const data = JSON.parse(
      atob(segment.replace(/-/g, "+").replace(/_/g, "/")),
    ) as { role?: string };
    if (data.role === "anon") return;
  } catch {
    /* Fall through to a deliberately non-sensitive error. */
  }
  throw new Error(
    "Only a publishable or legacy anon Supabase key may be used by the browser. Server keys are forbidden.",
  );
}
