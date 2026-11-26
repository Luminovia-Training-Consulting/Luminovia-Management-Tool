/** Bind LTI launch HTTP handling to the caller's live Supabase Auth session. */
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { createLtiAdvantage } from "./advantage.ts";
import { createLtiHandler, importSigningKey } from "./handler.ts";

const endpoint = Deno.env.get("SUPABASE_URL") ?? "";
const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const origins = (Deno.env.get("PORTAL_ALLOWED_ORIGINS") ?? "")
  .split(",").map((origin) => origin.trim()).filter(Boolean);
const signing = await importSigningKey(
  Deno.env.get("LTI_PLATFORM_ISSUER") ?? "",
  Deno.env.get("LTI_PLATFORM_RSA_PRIVATE_JWK") ?? "",
).catch(() => null);

const serviceUrl = Deno.env.get("LTI_PLATFORM_SERVICE_URL");
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const service = signing && serviceUrl && serviceKey
  ? createClient(endpoint, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  : null;
const advantage = service && serviceUrl
  ? createLtiAdvantage(serviceUrl, {
    registration: async (client, deployment) => {
      const result = await service.rpc("lti_service_registration", {
        p_client_id: client,
        p_deployment: deployment,
      });
      return result.error ? null : result.data;
    },
    issueToken: async (registration, assertionId, assertionExpiry, scopes) => {
      const result = await service.rpc("lti_issue_service_token", {
        p_deployment: registration.id,
        p_version: registration.version,
        p_assertion_id: assertionId,
        p_assertion_expiry: assertionExpiry,
        p_scopes: scopes,
      });
      return result.error ? null : result.data;
    },
    memberships: async (deployment, token, role, after, limit) => {
      const result = await service.rpc("lti_course_memberships", {
        p_deployment: deployment,
        p_token: token,
        p_role: role,
        p_after: after,
        p_limit: limit,
      });
      return result.error ? null : result.data;
    },
  })
  : undefined;

Deno.serve(createLtiHandler({
  origins,
  signing,
  advantage,
  principal: async (authorization) => {
    const client = createClient(endpoint, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    if ((await client.auth.getUser(authorization.slice(7))).error) return null;
    return {
      prepare: async (id, proof) => {
        const result = await client.rpc("prepare_lti_launch", {
          p_registration_id: id,
          p_browser_proof: proof,
        });
        return result.error ? null : result.data;
      },
      consume: async (request, proof) => {
        const result = await client.rpc("consume_lti_launch", {
          p_login_hint: request.login_hint,
          p_message_hint: request.lti_message_hint,
          p_browser_proof: proof,
          p_client_id: request.client_id,
          p_redirect_uri: request.redirect_uri,
          p_nonce: request.nonce,
          p_state: request.state,
        });
        return result.error ? null : result.data;
      },
    };
  },
}));
