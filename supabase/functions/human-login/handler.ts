import { boundedJson } from "../_shared/bounded-body.ts";

/** Credential exchange: only Supabase Auth verifies passwords and issues sessions. */
export interface LoginDependencies {
  reserve: (hash: string) => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user_id: string;
  } | null>;
  active: (userId: string) => Promise<boolean>;
}

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const failure = { error: "invalid_credentials" };

/** No email/UUID lookup endpoint exists; invalid credentials share one generic failure. */
export function createHumanLoginHandler(
  deps: LoginDependencies,
  allowedOrigins: readonly string[],
) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get("Origin");
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, private",
      "Pragma": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Vary": "Origin",
    };
    if (origin && allowedOrigins.includes(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Headers"] = "authorization,apikey,content-type,x-client-info";
      headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    }
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers });
    if (origin && !allowedOrigins.includes(origin)) return json(403, failure);
    if (request.method === "OPTIONS")
      return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return json(405, { error: "method_not_allowed" });
    if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json")
      return json(415, { error: "json_required" });
    let body: unknown;
    try { body = await boundedJson(request, 1024); }
    catch { return json(400, { error: "invalid_request" }); }
    if (!body || typeof body !== "object" || Array.isArray(body)) return json(400, { error: "invalid_request" });
    const input = body as Record<string, unknown>;
    if (Object.keys(input).some((key) => !["identifier", "password"].includes(key)) ||
      typeof input.identifier !== "string" || typeof input.password !== "string" ||
      input.password.length < 1 || input.password.length > 128 ||
      /[\x00-\x1f\x7f]/.test(input.password)) return json(400, { error: "invalid_request" });
    const identifier = input.identifier.trim().toLowerCase();
    if (identifier.length > 254 ||
      !emailPattern.test(identifier))
      return json(401, failure);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identifier));
    const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    try {
      if (!await deps.reserve(hash)) return json(429, { error: "rate_limited" });
      const session = await deps.signIn(identifier, input.password);
      if (!session || !uuid.test(session.user_id) || !await deps.active(session.user_id))
        return json(401, failure);
      return json(200, {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
        expires_in: session.expires_in,
        token_type: "bearer",
      });
    } catch {
      return json(503, { error: "login_unavailable" });
    }
  };
}
