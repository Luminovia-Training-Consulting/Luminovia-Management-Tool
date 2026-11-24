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
  signIn: async (email, password) => {
    const client = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await client.auth.signInWithPassword({ email, password });
    if (result.error?.status === 429) return "rate_limited";
    if (result.error && (!result.error.status || result.error.status >= 500))
      throw new Error("auth_unavailable");
    const session = result.data.session;
    return result.error || !session ? null : {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      user_id: session.user.id,
    };
  },
  active: async (userId) => {
    const result = await service.rpc("human_login_profile_active", { p_user_id: userId });
    if (result.error) throw new Error("profile_check_unavailable");
    return result.data === true;
  },
}, allowedOrigins));
