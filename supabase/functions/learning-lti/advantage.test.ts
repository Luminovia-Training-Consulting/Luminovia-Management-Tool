/** Exercise the tool's real signed assertion and the worker's HTTP service boundary. */
import assert from "node:assert/strict";
import { createLtiAdvantage } from "./advantage.ts";
import { createLtiHandler } from "./handler.ts";

const base =
  "https://platform.example.invalid/backend/functions/v1/learning-lti";
const deployment = "12356789-3bf6-4fff-8af4-ad93b10d0781";
const context = "d6017e13-7a13-4063-b0a6-73d2ede93ccd";
const nrpsScope =
  "https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly";
const deploymentClaim =
  "https://purl.imsglobal.org/spec/lti/claim/deployment_id";
const role = "http://purl.imsglobal.org/vocab/lis/v2/membership#Learner";
const token = "ab".repeat(32);
const client = "fictional-tool";
const utf8 = new TextEncoder();
const encode = (input: Uint8Array) =>
  btoa(String.fromCharCode(...input)).replaceAll("+", "-").replaceAll("/", "_")
    .replace(/=+$/, "");

const pair = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    hash: "SHA-256",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
  },
  true,
  ["sign", "verify"],
);
const toolPublicKey = {
  ...await crypto.subtle.exportKey("jwk", pair.publicKey),
  kid: "fictional-tool-key",
};
const members = [
  {
    user_id: "98ae5fa7-682e-4a25-9b3c-d5111471e8c4",
    status: "Active" as const,
    roles: [role],
  },
  {
    user_id: "a64eb647-0c38-4712-afe7-e81870b666ea",
    status: "Active" as const,
    roles: [role],
  },
];

async function sign(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = [
    { alg: "RS256", typ: "JWT", kid: toolPublicKey.kid },
    {
      iss: client,
      sub: client,
      aud: [base + "/token"],
      iat: now,
      exp: now + 240,
      jti: crypto.randomUUID(),
      [deploymentClaim]: deployment,
      ...overrides,
    },
  ].map((object) => encode(utf8.encode(JSON.stringify(object)))).join(".");
  return jwt + "." + encode(
    new Uint8Array(
      await crypto.subtle.sign(
        pair.privateKey.algorithm,
        pair.privateKey,
        utf8.encode(jwt),
      ),
    ),
  );
}

function fixture() {
  const assertions = new Set<string>();
  const advantage = createLtiAdvantage(base, {
    registration: (id, placement) =>
      Promise.resolve(
        id === client && placement === deployment
          ? { id: deployment, version: 4, key: toolPublicKey }
          : null,
      ),
    issueToken: ({ id, version }, assertion, expiry, scopes) => {
      assert.equal(id, deployment);
      assert.equal(version, 4);
      assert.deepEqual(scopes, [nrpsScope]);
      assert.ok(Date.parse(expiry) > Date.now());
      if (assertions.has(assertion)) return Promise.resolve(null);
      assertions.add(assertion);
      return Promise.resolve(token);
    },
    memberships: (id, credential, scopeRole, after, limit) => {
      assert.ok(scopeRole === null || scopeRole === "Learner");
      if (id !== deployment || credential !== token) {
        return Promise.resolve(null);
      }
      return Promise.resolve({
        context_id: context,
        members: members.filter(({ user_id }) =>
          after === null || user_id > after
        ).slice(0, limit + 1),
      });
    },
  });
  return {
    advantage,
    handler: createLtiHandler({
      signing: null,
      origins: [],
      advantage,
      principal: () => {
        throw new Error("Tool service should not load a portal user session");
      },
    }),
  };
}

function tokenRequest(assertion: string, scope = nrpsScope) {
  return new Request(base.replace("/backend/", "/") + "/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: assertion,
      scope,
    }),
  });
}

Deno.test("a signed tool assertion obtains a scoped token and a paged roster", async () => {
  const { advantage, handler } = fixture();
  assert.deepEqual(advantage.claims({ id: deployment }), {});
  const claims = advantage.claims({ id: deployment, nrps_enabled: true });
  const roster =
    claims["https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice"]!;
  assert.deepEqual(roster.service_versions, ["2.0"]);
  assert.equal(
    roster.context_memberships_url,
    base + "/memberships/" + deployment,
  );
  const assertion = await sign();
  const issued = await handler(tokenRequest(assertion));
  assert.equal(issued.status, 200);
  assert.equal(issued.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await issued.json(), {
    token_type: "Bearer",
    access_token: token,
    expires_in: 300,
    scope: nrpsScope,
  });
  assert.equal(
    (await (await handler(tokenRequest(assertion))).json()).error,
    "invalid_client",
  );
  const pageRequest = (url: string) =>
    new Request(url.replace("/backend/", "/"), {
      headers: { authorization: "Bearer " + token },
    });
  const granted = await handler(pageRequest(
    roster.context_memberships_url + "?limit=1&rlid=" + deployment +
      "&role=Learner",
  ));
  assert.equal(granted.status, 200);
  assert.equal(
    granted.headers.get("Content-Type"),
    "application/vnd.ims.lti-nrps.v2.membershipcontainer+json",
  );
  const scopedMember = (member: typeof members[number]) => ({
    ...member,
    message: [{
      "https://purl.imsglobal.org/spec/lti/claim/message_type":
        "LtiResourceLinkRequest",
    }],
  });
  const page = await granted.json();
  assert.equal(page.context.id, context);
  assert.deepEqual(page.members, [scopedMember(members[0])]);
  const next = granted.headers.get("Link")?.match(/^<([^>]+)>; rel="next"$/)
    ?.[1];
  assert.ok(next);
  assert.equal(new URL(next).searchParams.get("after"), members[0].user_id);
  assert.equal(new URL(next).searchParams.get("rlid"), deployment);
  const nextPage = await handler(pageRequest(next));
  assert.equal(nextPage.status, 200);
  assert.deepEqual((await nextPage.json()).members, [scopedMember(members[1])]);
  assert.equal(nextPage.headers.get("Link"), null);
});

Deno.test("wrong audience, undelegated scope, invalid assertion and other resource are denied", async () => {
  const { handler } = fixture();
  const wrongAudience = await handler(
    tokenRequest(await sign({ aud: "https://unrelated.example.invalid" })),
  );
  assert.equal((await wrongAudience.json()).error, "invalid_client");
  const wrongScope = await handler(
    tokenRequest(await sign(), "https://unrelated.example.invalid/scope"),
  );
  assert.equal((await wrongScope.json()).error, "invalid_scope");
  const [header, payload] = (await sign()).split(".");
  const invalid = await handler(
    tokenRequest(`${header}.${payload}.aW52YWxpZA`),
  );
  assert.equal((await invalid.json()).error, "invalid_client");

  const url = base.replace("/backend/", "/") + "/memberships/" + deployment;
  const noToken = await handler(new Request(url));
  assert.equal(noToken.status, 401);
  assert.equal(noToken.headers.get("WWW-Authenticate"), "Bearer");
  assert.equal(
    (await handler(
      new Request(url + "?rlid=" + context, {
        headers: { authorization: "Bearer " + token },
      }),
    )).status,
    403,
  );
  assert.equal(
    (await handler(new Request(url, { method: "POST" }))).status,
    403,
  );
});
