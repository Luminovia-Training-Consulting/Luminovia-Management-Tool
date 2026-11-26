/** Dynamic Registration negotiates a course draft only through the granted tool request. */
import assert from "node:assert/strict";
import { createDynamicRegistration } from "./dynamic-registration.ts";
import { createLtiHandler, importSigningKey } from "./handler.ts";

const origin = "https://fictional-portal.example.invalid";
const provider = "https://fictional-tool.example.invalid";
const base = origin + "/backend/functions/v1/learning-lti";
const hostedEdge = origin + "/functions/v1/learning-lti";
const run = "a97ad232-fb05-42c7-828f-805fbaae17e8";
const deployment = "ef0cbf3e-df45-4470-bf2d-28194376cf0f";
const grant = "b".repeat(64);
const configKey = "https://purl.imsglobal.org/spec/lti-tool-configuration";
const roster =
  "https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly";
const score = "https://purl.imsglobal.org/spec/lti-ags/scope/score";
const algorithm = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
};
const keys = await crypto.subtle.generateKey(algorithm, true, [
  "sign",
  "verify",
]);
const { n, e, kty } = await crypto.subtle.exportKey("jwk", keys.publicKey);
const publicKey = { n, e, kty, kid: "owned-fixture" };
const signing = await importSigningKey(
  origin,
  JSON.stringify({
    ...await crypto.subtle.exportKey("jwk", keys.privateKey),
    kid: "owned-fixture",
  }),
);

const requestBody = {
  application_type: "web",
  response_types: ["id_token", "code"],
  grant_types: ["implicit", "client_credentials"],
  token_endpoint_auth_method: "private_key_jwt",
  initiate_login_uri: provider + "/start",
  redirect_uris: [provider + "/finish", provider + "/other"],
  client_name: "Fictional registered tool",
  jwks_uri: provider + "/jwks",
  scope: roster + " " + score,
  [configKey]: {
    domain: new URL(provider).host,
    target_link_uri: provider + "/launch",
    messages: [{
      type: "LtiDeepLinkingRequest",
      target_link_uri: provider + "/pick",
    }],
    claims: ["sub", "name", "email"],
  },
};

function begin(input: object, author = "fictional-manager") {
  return new Request(hostedEdge, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + author,
      origin,
    },
    body: JSON.stringify({
      action: "register",
      course: run,
      initiation: provider + "/enroll?context=example",
      jwks: provider + "/jwks",
      key: publicKey,
      roster: false,
      grades: true,
      ...input,
    }),
  });
}

function registration(token: string | null, input: object = requestBody) {
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set("authorization", "Bearer " + token);
  return new Request(hostedEdge + "/registration", {
    method: "POST",
    headers,
    body: JSON.stringify(input),
  });
}

function fixture() {
  let authorized = false;
  let consumed = false;
  const dynamicRegistration = createDynamicRegistration(
    base,
    origin,
    [origin],
    (token, tool) => {
      if (
        !authorized || consumed || token !== grant ||
        tool.jwks !== provider + "/jwks"
      ) {
        return Promise.resolve(null);
      }
      assert.deepEqual(tool.scopes, [roster, score]);
      assert.equal(tool.redirect, provider + "/finish");
      assert.equal(tool.picker, provider + "/pick");
      consumed = true;
      return Promise.resolve({
        id: deployment,
        client_id: "fixture-generated-id",
        scopes: [score],
      });
    },
  );
  return createLtiHandler({
    signing,
    origins: [origin],
    dynamicRegistration,
    principal: (bearer) =>
      Promise.resolve(
        bearer === "Bearer fictional-manager"
          ? {
            register: (input) => {
              assert.equal(input.course, run);
              assert.equal(input.roster, false);
              assert.equal(input.grades, true);
              assert.deepEqual(input.key, publicKey);
              authorized = true;
              return Promise.resolve(grant);
            },
            prepare: () => Promise.resolve(null),
            consume: () => Promise.resolve(null),
          }
          : null,
      ),
  });
}

Deno.test("issuer discovery and one-use registration negotiate the reviewed tool deployment", async () => {
  const handler = fixture();
  assert.equal((await handler(registration(null))).status, 401);
  assert.equal((await handler(begin({}, "fictional-learner"))).status, 401);
  assert.equal(
    (await handler(begin({ jwks: "https://other.example.invalid/keyset" })))
      .status,
    403,
  );
  assert.equal(
    (await handler(begin({ key: { ...publicKey, d: "private" } }))).status,
    403,
  );
  const prepared = await handler(begin({}));
  assert.equal(prepared.status, 200);
  const redirect = new URL((await prepared.json()).redirect);
  assert.equal(redirect.origin, provider);
  assert.equal(redirect.searchParams.get("context"), "example");
  assert.equal(redirect.searchParams.get("registration_token"), grant);
  assert.equal(
    redirect.searchParams.get("openid_configuration"),
    base + "/registration/configuration",
  );
  const discovery = await handler(
    new Request(hostedEdge + "/registration/configuration"),
  );
  assert.equal(discovery.status, 200);
  const config = await discovery.json();
  assert.equal(config.issuer, origin);
  assert.equal(config.registration_endpoint, base + "/registration");
  assert.equal(config.authorization_endpoint, origin + "/lti/authorize");
  assert.deepEqual(config.subject_types_supported, ["pairwise"]);
  assert.equal(
    (await handler(
      registration(grant, {
        ...requestBody,
        jwks_uri: provider + "/different",
      }),
    )).status,
    400,
  );
  const accepted = await handler(registration(grant));
  assert.equal(accepted.status, 201);
  const tool = await accepted.json();
  assert.equal(tool.client_id, "fixture-generated-id");
  assert.equal(tool.scope, score);
  assert.deepEqual(tool.redirect_uris, [provider + "/finish"]);
  assert.deepEqual(tool[configKey].claims, ["iss", "sub"]);
  assert.equal(tool[configKey].deployment_id, deployment);
  assert.equal((await handler(registration(grant))).status, 400);
});

Deno.test("discovery remains disabled if its URL is outside the configured issuer", () => {
  assert.equal(
    createDynamicRegistration(
      base,
      origin + "/other-issuer",
      [origin],
      () => Promise.resolve(null),
    ),
    undefined,
  );
});
