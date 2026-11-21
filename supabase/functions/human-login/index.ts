import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { createHumanLoginHandler } from "./handler.ts";

const url = Deno.env.get("SUPABASE_URL") ?? "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const service = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "", {
  auth: { persistSession: false, autoRefreshToken: false },
});
const allowedOrigins = (Deno.env.get("PORTAL_ALLOWED_ORIGINS") ?? "")
  .split(",").map((item) => item.trim()).filter(Boolean);

Deno.serve(createHumanLoginHandler({
  reserve: async (hash) => {
    const result = await service.rpc("reserve_login_attempt", { p_identifier_hash: hash });
    if (result.error) throw new Error("rate_unavailable");
    return result.data === true;
  },
  resolveUsername: async (username) => {
    const result = await service.rpc("login_email_for_alias", { p_username: username });
    if (result.error) throw new Error("alias_unavailable");
    return typeof result.data === "string" ? result.data : null;
  },
  signIn: async (email, password) => {
    const client = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await client.auth.signInWithPassword({ email, password });
    const session = result.data.session;
    return result.error || !session ? null : {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      user_id: session.user.id,
    };
  },
  active: async (userId) => {
    const result = await service.from("profiles").select("active").eq("id", userId).single();
    return !result.error && result.data?.active === true;
  },
}, allowedOrigins));
