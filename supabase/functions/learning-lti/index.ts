/** Bind LTI launch HTTP handling to the caller's live Supabase Auth session. */
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { createLtiAdvantage } from "./advantage.ts";
import { createLtiDeepLink } from "./deep-link.ts";
import type { ToolRegistration } from "./tool-jwt.ts";
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
const registrationFor = async (
  client: string,
  deployment: string | null,
): Promise<ToolRegistration | null> => {
  const result = await service?.rpc("lti_service_registration", {
    p_client_id: client,
    p_deployment: deployment,
  });
  return result?.error ? null : result?.data ?? null;
};
const advantage = service && serviceUrl
  ? createLtiAdvantage(serviceUrl, {
    ags: async (deployment, token, action, item, input) => {
      const result = await service.rpc("lti_ags_service", {
        p_deployment: deployment,
        p_token: token,
        p_action: action,
        p_item: item,
        p_input: input,
      });
      return { data: result.data, code: result.error?.code };
    },
    registration: registrationFor,
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
    memberships: async (
      deployment,
      token,
      role,
      after,
      limit,
      resourceLink,
    ) => {
      const result = await service.rpc("lti_resource_memberships", {
        p_deployment: deployment,
        p_token: token,
        p_role: role,
        p_after: after,
        p_limit: limit,
        p_link: resourceLink,
      });
      return result.error ? null : result.data ?? false;
    },
  })
  : undefined;

const deepLink = service && serviceUrl && signing
  ? createLtiDeepLink(serviceUrl, signing.issuer, origins, {
    registration: registrationFor,
    receive: async (registration, data, item) => {
      const result = await service.rpc("receive_lti_deep_link", {
        p_deployment: registration.id,
        p_version: registration.version,
        p_data: data,
        p_item: item,
      });
      return result.error ? null : result.data;
    },
  })
  : undefined;

Deno.serve(createLtiHandler({
  origins,
  signing,
  advantage,
  deepLink,
  principal: async (authorization) => {
    const client = createClient(endpoint, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: authorization } },
    });
    if ((await client.auth.getUser(authorization.slice(7))).error) return null;
    return {
      prepare: async (id, proof, placement) => {
        const args = { p_registration_id: id, p_browser_proof: proof };
        const result = placement?.portalOrigin || placement?.resource
          ? await client.rpc("prepare_lti_placement", {
            ...args,
            p_resource_link_id: placement.resource ?? null,
            p_portal_origin: placement.portalOrigin ?? null,
          })
          : await client.rpc("prepare_lti_launch", args);
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
