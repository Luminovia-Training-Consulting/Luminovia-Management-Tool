import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { createHumanRecoveryHandler } from "./handler.ts";

declare const EdgeRuntime: { waitUntil(task: Promise<void>): void };

const url = Deno.env.get("SUPABASE_URL") ?? "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const service = createClient(
  url,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);
const allowedOrigins = (Deno.env.get("PORTAL_ALLOWED_ORIGINS") ?? "")
  .split(",").map((item) => item.trim()).filter(Boolean);

Deno.serve(createHumanRecoveryHandler({
  waitUntil: (task) => EdgeRuntime.waitUntil(task),
  reserve: async (hash) => {
    const result = await service.rpc("reserve_login_attempt", {
      p_identifier_hash: hash,
    });
    if (result.error) throw new Error("rate_unavailable");
    return result.data === true;
  },
  resolveUsername: async (username) => {
    const result = await service.rpc("login_email_for_alias", {
      p_username: username,
    });
    if (result.error) throw new Error("alias_unavailable");
    return typeof result.data === "string" ? result.data : null;
  },
  sendRecovery: async (email, challenge, redirect) => {
    const endpoint = new URL(`${url.replace(/\/$/, "")}/auth/v1/recover`);
    endpoint.searchParams.set("redirect_to", redirect);
    const response = await fetch(endpoint, {
      method: "POST",
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
      headers: {
        "Content-Type": "application/json",
        apikey: anon,
        Authorization: `Bearer ${anon}`,
      },
      body: JSON.stringify({
        email,
        code_challenge: challenge,
        code_challenge_method: "s256",
      }),
    });
    if (!response.ok) throw new Error("auth_recovery_failed");
  },
}, allowedOrigins));
