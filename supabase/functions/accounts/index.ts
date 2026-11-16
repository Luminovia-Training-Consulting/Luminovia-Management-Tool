/**
 * Deno account-API entry point connecting the testable handler to native Auth and caller-scoped RPCs. Keep the service client server-side and limited to reserved invitations.
 */
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { createAccountHandler } from "./handler.ts";
import { accountOpenApi } from "./openapi.ts";
const url = Deno.env.get("SUPABASE_URL") ?? "";
const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const service = createClient(
  url,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  { auth: { persistSession: false, autoRefreshToken: false } },
);
// Create a stateless client per caller JWT so ordinary business operations retain that caller's current database permissions.
const caller = (token: string) =>
  createClient(url, publicKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
const origins = (Deno.env.get("PORTAL_ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const appOrigin = Deno.env.get("PORTAL_APP_ORIGIN") ?? "";
Deno.serve(
  createAccountHandler({
    origins,
    appOrigin,
    openapi: accountOpenApi,
    invitationsEnabled:
      Deno.env.get("PORTAL_INVITES_ENABLED") === "true" &&
      origins.includes(appOrigin),
    authenticate: async (token) => {
      const client = caller(token);
      const user = await client.auth.getUser(token);
      if (user.error || !user.data.user) return false;
      const active = await client.rpc("account_me");
      return !active.error;
    },
    rpc: async (token, name, args) => {
      const result = await caller(token).rpc(name, args);
      return { data: result.data, error: result.error };
    },
    sendInvitation: async (invitation, redirectTo) => {
      const result = await service.auth.admin.inviteUserByEmail(
        invitation.email,
        { redirectTo },
      );
      if (result.error || !result.data.user)
        throw new Error("invitation_unavailable");
      return result.data.user.id;
    },
    completeInvitation: async (id, userId, displayName, success) => {
      const result = await service.rpc("complete_account_invitation", {
        p_invitation_id: id,
        p_user_id: userId,
        p_display_name: displayName,
        p_success: success,
      });
      if (result.error) throw new Error("invitation_unavailable");
    },
  }),
);
