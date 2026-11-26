/** Synthetic tool round trip with a process-local disposable RSA key. */
import assert from "node:assert/strict";
import {
  type AuthorizedLaunch,
  createLtiHandler,
  importSigningKey,
} from "./handler.ts";

const place = "aa9dcaa1-bb23-4083-bbbe-0c273165869a";
const subject = "84853446-2226-4fe3-81bb-921a0e4a7aa1";
const useContext = "c445ec08-e1be-47e1-8308-c8fa94965ba7";
const proof = "74ab2f52-593c-440e-8f17-89a5d32a36e0";
const origin = "https://portal.example.invalid";
const issuer = origin + "/lti";
const worker = "https://backend.example.invalid/functions/v1/learning-lti";
const tool = "https://tool.example.invalid";
const login = "1".repeat(64);
const message = "2".repeat(64);
const registration: AuthorizedLaunch = {
  id: place,
  subject,
  client_id: "synthetic-client",
  context_id: useContext,
  target_uri: tool + "/activity/abc",
  redirect_uri: tool + "/lti/receive",
  role: "Learner",
};

const algorithm = {
  name: "RSASSA-PKCS1-v1_5",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};
const keypair = await crypto.subtle.generateKey(algorithm, true, [
  "sign",
  "verify",
]);
const jwk = await crypto.subtle.exportKey("jwk", keypair.privateKey);
const signing = await importSigningKey(
  issuer,
  JSON.stringify({ ...jwk, kid: "fixture" }),
);

/** The fixture models one consumed authoritative launch and a fixed live browser principal. */
function fixture() {
  let consumed = false;
  return createLtiHandler({
    origins: [origin],
    signing,
    principal: (credential) =>
      Promise.resolve(
        credential !== "Bearer synthetic-session" ? null : {
          prepare: (id, browser) =>
            Promise.resolve(
              id !== place || browser !== proof ? null : {
                ...registration,
                login_uri: tool + "/lti/login?tool_option=retained",
                login_hint: login,
                message_hint: message,
              },
            ),
          consume: (facts, browser) => {
            if (
              consumed || browser !== proof ||
              facts.redirect_uri !== registration.redirect_uri ||
              facts.client_id !== registration.client_id ||
              facts.login_hint !== login ||
              facts.lti_message_hint !== message
            ) return Promise.resolve(null);
            consumed = true;
            return Promise.resolve(registration);
          },
        },
      ),
  });
}

/** Use the same edge envelope as the authenticated browser. */
function request(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Request {
  return new Request(worker, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer synthetic-session",
      origin,
      ...headers,
    },
    body: JSON.stringify({ ...body, proof: body.proof ?? proof }),
  });
}

const authorize = {
  action: "authorize",
  scope: "openid",
  response_type: "id_token",
  response_mode: "form_post",
  prompt: "none",
  client_id: registration.client_id,
  redirect_uri: registration.redirect_uri,
  login_hint: login,
  lti_message_hint: message,
  state: "synthetic-csrf-state",
  nonce: "synthetic-unique-nonce",
};
const decoded = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (character) => character.charCodeAt(0),
  );

Deno.test("synthetic LTI resource launch verifies the published key, exact nonce and minimal scoped claims", async () => {
  const handler = fixture();
  const jwksResponse = await handler(new Request(worker + "/jwks"));
  assert.equal(jwksResponse.status, 200);
  const { keys } = await jwksResponse.json();
  assert.deepEqual(Object.keys(keys[0]).sort(), [
    "alg",
    "e",
    "kid",
    "kty",
    "n",
    "use",
  ]);
  const verify = await crypto.subtle.importKey(
    "jwk",
    keys[0],
    { name: algorithm.name, hash: algorithm.hash },
    false,
    ["verify"],
  );

  const began = await handler(
    request({ action: "prepare", registration: place }),
  );
  assert.equal(began.status, 200);
  const bootstrap = new URL((await began.json()).redirect);
  assert.equal(bootstrap.origin, tool);
  assert.equal(bootstrap.searchParams.get("tool_option"), "retained");
  assert.equal(bootstrap.searchParams.get("iss"), issuer);
  assert.equal(bootstrap.searchParams.get("lti_deployment_id"), place);
  assert.equal(bootstrap.searchParams.get("login_hint"), login);
  assert.equal(bootstrap.searchParams.get("lti_message_hint"), message);
  assert.equal(
    bootstrap.searchParams.get("target_link_uri"),
    registration.target_uri,
  );
  assert.ok(!bootstrap.href.includes(proof));

  const response = await handler(request(authorize));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.state, authorize.state);
  assert.equal(result.redirect, registration.redirect_uri);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const [header, data, signature] = result.id_token.split(".");
  assert.ok(
    await crypto.subtle.verify(
      algorithm.name,
      verify,
      decoded(signature),
      new TextEncoder().encode(header + "." + data),
    ),
  );
  const claims = JSON.parse(new TextDecoder().decode(decoded(data)));
  assert.equal(claims.iss, issuer);
  assert.equal(claims.aud, registration.client_id);
  assert.equal(claims.sub, subject);
  assert.equal(claims.nonce, authorize.nonce);
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp - claims.iat === 120);
  const ns = "https://purl.imsglobal.org/spec/lti/claim/";
  assert.equal(claims[ns + "message_type"], "LtiResourceLinkRequest");
  assert.equal(claims[ns + "version"], "1.3.0");
  assert.equal(claims[ns + "deployment_id"], place);
  assert.equal(claims[ns + "target_link_uri"], registration.target_uri);
  assert.deepEqual(claims[ns + "resource_link"], { id: place });
  assert.equal(claims[ns + "context"].id, useContext);
  assert.deepEqual(claims[ns + "roles"], [
    "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner",
  ]);
  assert.ok(!Object.hasOwn(claims, "name") && !Object.hasOwn(claims, "email"));
  assert.equal((await handler(request(authorize))).status, 403);
});

Deno.test("the HTTP boundary rejects wrong origin, session, request mode, redirect and browser proof", async () => {
  const handler = fixture();
  assert.equal(
    (await handler(request({ ...authorize, state: "X".repeat(9000) }))).status,
    413,
  );
  assert.equal(
    (await handler(
      request(authorize, { origin: "https://unrelated.example.invalid" }),
    )).status,
    403,
  );
  assert.equal(
    (await handler(
      request(authorize, { authorization: "Bearer other-session" }),
    )).status,
    401,
  );
  assert.equal(
    (await handler(request({ ...authorize, prompt: "login" }))).status,
    400,
  );
  assert.equal(
    (await handler(request({ ...authorize, state: "" }))).status,
    400,
  );
  assert.equal(
    (await handler(
      request({ ...authorize, redirect_uri: tool + "/unexpected" }),
    )).status,
    403,
  );
  assert.equal(
    (await handler(request({ ...authorize, proof: place }))).status,
    403,
  );
  assert.equal((await handler(request(authorize))).status, 200);
});

Deno.test("a launch fails closed without an explicitly configured signing key", async () => {
  const disabled = createLtiHandler({
    origins: [origin],
    signing: null,
    principal: () => Promise.resolve(null),
  });
  assert.equal((await disabled(new Request(worker + "/jwks"))).status, 503);
  assert.equal((await disabled(request(authorize))).status, 503);
  await assert.rejects(
    importSigningKey("http://insecure.example.invalid", JSON.stringify(jwk)),
  );
});
