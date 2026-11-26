/** Test the real provider signature and course-review redirect with fictional content. */
import assert from "node:assert/strict";
import { createLtiDeepLink } from "./deep-link.ts";
import { createLtiHandler, importSigningKey } from "./handler.ts";

const portal = "https://portal.example.invalid";
const returnBase = `${portal}/backend/functions/v1/learning-lti`;
const edgeBase = `${portal}/functions/v1/learning-lti`;
const issuer = portal + "/lti";
const client = "learn-by-example-lti";
const place = "9fd005da-8c5f-4f15-9f89-6dd06139ac2e";
const ticket = "fbd367f9-c23e-4663-8dea-4767e0c41a5d";
const browserProof = "a7c1304a-4130-4c09-b694-fb538cb2deea";
const target = "https://tool.example.invalid/select";
const redirect = "https://tool.example.invalid/authorize";
const data = "a".repeat(64);
const loginHint = "b".repeat(64);
const messageHint = "c".repeat(64);
const lti = "https://purl.imsglobal.org/spec/lti/claim/";
const dl = "https://purl.imsglobal.org/spec/lti-dl/claim/";
const rsa = {
  name: "RSASSA-PKCS1-v1_5",
  hash: "SHA-256",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
};
const tool = await crypto.subtle.generateKey(rsa, true, ["sign", "verify"]);
const platform = await crypto.subtle.generateKey(rsa, true, ["sign", "verify"]);
const toolKey = {
  ...await crypto.subtle.exportKey("jwk", tool.publicKey),
  kid: "fictional-tool",
};
const privateKey = {
  ...await crypto.subtle.exportKey("jwk", platform.privateKey),
  kid: "fictional-platform",
};
const signing = await importSigningKey(issuer, JSON.stringify(privateKey));
const utf8 = new TextEncoder();
const decode = (value: string) =>
  Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/")),
    (ch) => ch.charCodeAt(0),
  );
const encode = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_")
    .replace(/=+$/, "");
const example = {
  type: "ltiResourceLink",
  title: "Fictional activity",
  url: "https://tool.example.invalid/content/2",
  custom: { unit: "2" },
};

async function responseToken(changes: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = [
    { alg: "RS256", typ: "JWT", kid: toolKey.kid },
    {
      iss: client,
      aud: issuer,
      iat: now,
      exp: now + 120,
      [lti + "deployment_id"]: place,
      [lti + "version"]: "1.3.0",
      [lti + "message_type"]: "LtiDeepLinkingResponse",
      [dl + "data"]: data,
      [dl + "content_items"]: [example],
      ...changes,
    },
  ].map((value) => encode(utf8.encode(JSON.stringify(value)))).join(".");
  return jwt + "." +
    encode(
      new Uint8Array(
        await crypto.subtle.sign(
          tool.privateKey.algorithm,
          tool.privateKey,
          utf8.encode(jwt),
        ),
      ),
    );
}

function fixture(origin = portal, resource?: string, agsEnabled = false) {
  const staged: unknown[] = [];
  const deepLink = createLtiDeepLink(returnBase, issuer, [portal], {
    registration: (clientId, deployment) =>
      Promise.resolve(
        clientId === client && deployment === place
          ? { id: place, version: 3, key: toolKey }
          : null,
      ),
    receive: (registration, challenge, item) => {
      assert.equal(registration.id, place);
      assert.equal(registration.version, 3);
      if (staged.length || challenge !== data) return Promise.resolve(null);
      staged.push(item);
      return Promise.resolve({ id: ticket, origin });
    },
  });
  return {
    staged,
    handler: createLtiHandler({
      origins: [portal],
      signing,
      deepLink,
      principal: () =>
        Promise.resolve({
          prepare: (id, proof, selection) => {
            assert.equal(id, place);
            assert.equal(proof, browserProof);
            assert.equal(
              selection?.portalOrigin,
              resource ? undefined : portal,
            );
            assert.equal(selection?.resource, resource);
            return Promise.resolve({
              id: place,
              client_id: client,
              login_uri: "https://tool.example.invalid/login",
              target_uri: target,
              login_hint: loginHint,
              message_hint: messageHint,
            });
          },
          consume: () =>
            Promise.resolve({
              id: place,
              client_id: client,
              target_uri: target,
              redirect_uri: redirect,
              context_id: place,
              subject: browserProof,
              role: "Instructor",
              ags_enabled: agsEnabled,
              ...(resource
                ? { resource_link_id: resource, resource_custom: { unit: "2" } }
                : {
                  deep_link_data: data,
                }),
            }),
        }),
    }),
  };
}

function browserRequest(input: Record<string, unknown>) {
  return new Request(edgeBase, {
    method: "POST",
    headers: {
      origin: portal,
      authorization: "Bearer fictional-session",
      "content-type": "application/json",
    },
    body: JSON.stringify({ proof: browserProof, ...input }),
  });
}

function callback(credential: string) {
  return new Request(edgeBase + "/deep-link-return", {
    method: "POST",
    body: new URLSearchParams({ JWT: credential }),
  });
}

const authorize = {
  action: "authorize",
  scope: "openid",
  response_type: "id_token",
  response_mode: "form_post",
  prompt: "none",
  client_id: client,
  redirect_uri: redirect,
  login_hint: loginHint,
  lti_message_hint: messageHint,
  nonce: "fictional-nonce",
  state: "fictional-state",
};

async function launchClaims(response: Response) {
  assert.equal(response.status, 200);
  const [header, payload, signature] = (await response.json()).id_token.split(
    ".",
  );
  assert.ok(
    await crypto.subtle.verify(
      platform.publicKey.algorithm,
      platform.publicKey,
      decode(signature),
      utf8.encode(header + "." + payload),
    ),
  );
  return JSON.parse(new TextDecoder().decode(decode(payload)));
}

Deno.test("the signing boundary publishes the picker claim and a signed response becomes a private review", async () => {
  const { handler, staged } = fixture();
  const open = await handler(
    browserRequest({ action: "prepare", registration: place, mode: "select" }),
  );
  assert.equal(
    new URL((await open.json()).redirect).searchParams.get("target_link_uri"),
    target,
  );
  const claims = await launchClaims(await handler(browserRequest(authorize)));
  assert.equal(claims[lti + "message_type"], "LtiDeepLinkingRequest");
  assert.equal(claims[lti + "deployment_id"], place);
  assert.equal(claims[lti + "resource_link"], undefined);
  const settings = claims[dl + "deep_linking_settings"];
  assert.equal(settings.data, data);
  assert.equal(settings.deep_link_return_url, returnBase + "/deep-link-return");
  assert.deepEqual(settings.accept_types, ["ltiResourceLink"]);
  assert.equal(settings.auto_create, false);
  assert.equal(settings.accept_multiple, false);
  assert.equal(settings.accept_lineitem, false);
  const signed = await responseToken();
  const review = await handler(callback(signed));
  assert.equal(review.status, 303);
  assert.equal(
    review.headers.get("Location"),
    portal + "/lti/selection#" + ticket,
  );
  assert.equal(review.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(staged, [{
    title: example.title,
    url: example.url,
    custom: example.custom,
  }]);
  assert.equal((await handler(callback(signed))).status, 403);
});

Deno.test("cancellation is valid and malformed selections never stage a course link", async () => {
  const { handler, staged } = fixture();
  const wrongIssuer = await handler(
    callback(await responseToken({ aud: "https://foreign.example.invalid" })),
  );
  assert.equal(wrongIssuer.status, 403);
  const wrongData = await handler(
    callback(await responseToken({ [dl + "data"]: "d".repeat(64) })),
  );
  assert.equal(wrongData.status, 403);
  const html = await handler(
    callback(
      await responseToken({
        [dl + "content_items"]: [{ type: "html", html: "fictional" }],
      }),
    ),
  );
  assert.equal(html.status, 400);
  assert.deepEqual(staged, []);
  const cancelled = await handler(
    callback(await responseToken({ [dl + "content_items"]: [] })),
  );
  assert.equal(cancelled.status, 303);
  assert.deepEqual(staged, [null]);
  const misplaced = fixture("https://foreign.example.invalid");
  assert.equal(
    (await misplaced.handler(callback(await responseToken()))).status,
    403,
  );
});

Deno.test("a published placement emits a resource link ID independent of the deployment", async () => {
  const { handler } = fixture(portal, ticket);
  const selected = await handler(
    browserRequest({
      action: "prepare",
      registration: place,
      resource: ticket,
    }),
  );
  assert.equal(selected.status, 200);
  const claims = await launchClaims(await handler(browserRequest(authorize)));
  assert.equal(claims[lti + "message_type"], "LtiResourceLinkRequest");
  assert.equal(claims[lti + "deployment_id"], place);
  assert.deepEqual(claims[lti + "resource_link"], { id: ticket });
  assert.deepEqual(claims[lti + "custom"], { unit: "2" });
});

Deno.test("a grading-enabled picker advertises declarative AGS metadata and validates it", async () => {
  const { handler, staged } = fixture(portal, undefined, true);
  const claims = await launchClaims(await handler(browserRequest(authorize)));
  assert.equal(claims[dl + "deep_linking_settings"].accept_lineitem, true);
  const invalid = await handler(callback(
    await responseToken({
      [dl + "content_items"]: [{
        ...example,
        lineItem: { scoreMaximum: "20" },
      }],
    }),
  ));
  assert.equal(invalid.status, 400);
  assert.deepEqual(staged, []);
  const lineItem = {
    label: "Fictional assignment",
    scoreMaximum: 12.5,
    resourceId: "worksheet",
    tag: "practice",
  };
  const review = await handler(callback(
    await responseToken({
      [dl + "content_items"]: [{ ...example, lineItem }],
    }),
  ));
  assert.equal(review.status, 303);
  assert.deepEqual(JSON.parse(JSON.stringify(staged)), [{
    title: example.title,
    url: example.url,
    custom: example.custom,
    lineItem,
  }]);
});
