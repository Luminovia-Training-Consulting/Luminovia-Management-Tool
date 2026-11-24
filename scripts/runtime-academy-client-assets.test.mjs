/** Run generated Academy clients over a local HTTP transport with fictional keys. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { academyOpenApi } from "../src/features/developer-api/academy-contract.ts";
import { academyClientAssets } from "./academy-client-assets.mjs";

const run = promisify(execFile);
const identities = [
  ["customer-self-hosted", "4f252e76-30c0-4890-9b44-351c754ca240"],
  ["customer-managed", "c23c5015-398f-4d6a-9dd2-f7bb1d8b27ca"],
];
const apiKey = "sb_publishable_fictional";
const accountToken =
  "eyJhbGciOiJub25lIn0." +
  Buffer.from(JSON.stringify({ role: "authenticated" })).toString("base64url") +
  ".fictional";
const integrationKey = "lvi_" + identities[0][1] + "_" + "a".repeat(64);

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "academy-generated-client-"));
  const received = [];
  const server = createServer(async (request, response) => {
    const body = [];
    for await (const chunk of request) body.push(chunk);
    received.push({
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: Buffer.concat(body),
    });
    response.setHeader("Content-Type", "application/json");
    if (request.url.startsWith("/backend/functions/v1/company-integration")) {
      response
        .writeHead(429, { "Retry-After": "60" })
        .end('{"error":"rate_limited"}');
    } else if (request.url.endsWith("/human-login")) {
      response.writeHead(302, { Location: "/never-follow" }).end();
    } else {
      response.end('{"ok":true}');
    }
  });
  t.after(async () => {
    await new Promise((done) => server.close(done));
    await rm(directory, { force: true, recursive: true });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    directory,
    received,
    base: `http://127.0.0.1:${server.address().port}/backend`,
  };
}

test("generated Academy clients bind installation, scope credentials and expose actual HTTP outcomes", async (t) => {
  const { directory, received, base } = await fixture(t);
  for (const [edition, installationId] of identities) {
    const document = academyOpenApi(base, {
      edition,
      installationId,
      name: "Fictional Academy",
    });
    const assets = academyClientAssets(document);
    assert.deepEqual([...academyClientAssets(document)], [...assets]);
    const tsPath = join(directory, edition + ".ts");
    const pythonPath = join(directory, edition + ".py");
    await Promise.all([
      writeFile(tsPath, assets.get("api/client.ts")),
      writeFile(pythonPath, assets.get("api/client.py")),
    ]);
    const sdk = await import(pathToFileURL(tsPath).href);
    assert.deepEqual(sdk.installation, {
      baseUrl: base,
      edition,
      installationId,
      openApiVersion: document.info.version,
    });
    assert.ok(sdk.operations.humanLogin);
    assert.deepEqual(sdk.operations.native_admin_audit_events.credentials, [
      "apiKey",
      "bearerAuth",
    ]);
    assert.equal(sdk.operations.native_claim_job, undefined);
    assert.deepEqual(
      sdk.operations.integrationCourseIndex.statuses.sort(),
      Object.keys(
        document.paths["/functions/v1/company-integration"].get.responses,
      ).sort(),
    );
    assert.throws(
      () =>
        sdk.request("readAcademyInstallationCapabilities", {
          credentials: { apiKey: "sb_secret_fictional" },
        }),
      /publishable/,
    );
    assert.throws(
      () =>
        sdk.request("integrationCourseIndex", {
          query: { other: "not documented" },
        }),
      /Undocumented query parameter/,
    );

    const invitationId = identities[0][1];
    const invitationPath =
      "/backend/functions/v1/accounts/v1/academy/invitations/" +
      invitationId +
      "/retry";
    const requestsBeforeInvalidPath = received.length;
    for (const path of [
      undefined,
      { id: "not-a-uuid" },
      { id: invitationId, extra: invitationId },
    ])
      assert.throws(
        () => sdk.request("retryAcademyInvitationDelivery", { path }),
        /path parameter/,
      );
    assert.equal(received.length, requestsBeforeInvalidPath);
    const credentials = { apiKey, accessToken: accountToken };
    const responseForRetry = await sdk.request(
      "retryAcademyInvitationDelivery",
      {
        credentials,
        path: { id: invitationId },
        body: { request_id: invitationId, email: "fictional@example.invalid" },
      },
    );
    assert.equal(responseForRetry.status, 200);
    assert.equal(received.at(-1).url, invitationPath);
    assert.equal(received.at(-1).method, "POST");
    await run("python3", [
      "-I",
      "-c",
      `
import runpy, sys
request = runpy.run_path(sys.argv[1])["request"]
for path in (None, {"id": "not-a-uuid"}, {"id": sys.argv[2], "extra": sys.argv[2]}):
    try:
        request("retryAcademyInvitationDelivery", path_params=path)
    except ValueError as problem:
        assert "path parameter" in str(problem)
    else:
        raise AssertionError("Invalid path parameters were accepted")
response = request("retryAcademyInvitationDelivery", api_key="sb_publishable_fictional",
                   access_token=sys.argv[3], path_params={"id": sys.argv[2]},
                   body={"request_id": sys.argv[2], "email": "fictional@example.invalid"})
assert response.status == 200
`,
      pythonPath,
      invitationId,
      accountToken,
    ]);
    assert.equal(received.at(-1).url, invitationPath);
    assert.equal(received.at(-1).method, "POST");

    const binary = new Blob([Uint8Array.of(1, 2, 3)], { type: "image/png" });
    await sdk.request("uploadAcademyCourseMaterial", {
      credentials: { apiKey, accessToken: accountToken, integrationKey },
      query: { mode: "academy-brand-logo", expected_version: 2 },
      mediaType: "image/png",
      body: binary,
    });
    const upload = received.at(-1);
    assert.equal(upload.method, "POST");
    assert.equal(
      new URL(upload.url, base).searchParams.get("expected_version"),
      "2",
    );
    assert.deepEqual(upload.body, Buffer.from([1, 2, 3]));
    assert.equal(upload.headers.apikey, apiKey);
    assert.equal(upload.headers.authorization, "Bearer " + accountToken);
    assert.equal(upload.headers.origin, new URL(base).origin);
    const response = await sdk.request("integrationCourseIndex", {
      credentials: { apiKey, integrationKey },
      query: { limit: 4, after: "one/two?three&four" },
    });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("Retry-After"), "60");
    assert.deepEqual(await response.json(), { error: "rate_limited" });
    assert.equal(received.at(-1).headers.apikey, undefined);
    assert.equal(
      received.at(-1).headers.authorization,
      "Bearer " + integrationKey,
    );
    assert.equal(
      new URL(received.at(-1).url, base).searchParams.get("after"),
      "one/two?three&four",
    );
    await assert.rejects(
      sdk.request("humanLogin", {
        credentials: { apiKey, accessToken: accountToken, integrationKey },
        body: { identifier: "fictional", password: "not-a-real-password" },
      }),
    );
    assert.equal(received.at(-1).headers.authorization, undefined);
    assert.equal(received.at(-1).headers.apikey, undefined);
    assert.equal(
      received.some(({ url }) => url === "/never-follow"),
      false,
    );

    await run("python3", [
      "-I",
      "-c",
      `
import runpy, sys
module = runpy.run_path(sys.argv[1])
assert module["INSTALLATION"]["edition"] == sys.argv[2]
assert module["INSTALLATION"]["installationId"] == sys.argv[3]
assert module["INSTALLATION"]["openApiVersion"] == sys.argv[4]
request = module["request"]
assert request("readAcademyInstallationCapabilities", api_key="sb_publishable_fictional").json() == {"ok": True}
response = request("integrationCourseIndex", integration_key=sys.argv[5], query={"limit": 4})
assert response.status == 429 and response.headers["Retry-After"] == "60"
assert request("humanLogin", body={"identifier": "fictional", "password": "not-a-real-password"}).status == 302
try:
    request("readAcademyInstallationCapabilities", api_key="sb_secret_fictional")
except ValueError:
    pass
else:
    raise AssertionError("Server secret was allowed")
`,
      pythonPath,
      edition,
      installationId,
      document.info.version,
      integrationKey,
    ]);
    assert.equal(
      received.some(({ url }) => url === "/never-follow"),
      false,
    );
    assert.equal(received.at(-3).headers.apikey, apiKey);
    assert.equal(
      received.at(-2).headers.authorization,
      "Bearer " + integrationKey,
    );
    assert.equal(received.at(-1).headers.authorization, undefined);
    // Compile the delivered TypeScript, rather than only the generator/template.
    await run(
      process.execPath,
      [
        resolve("node_modules/typescript/bin/tsc"),
        "--strict",
        "--skipLibCheck",
        "--target",
        "ES2022",
        "--noEmit",
        tsPath,
      ],
      { cwd: directory },
    );
  }
});

test("an additive contract keeps existing client operations and exposes deprecation metadata", async (t) => {
  const { directory } = await fixture(t);
  const [edition, installationId] = identities[0];
  const api = academyOpenApi("https://example.invalid/backend", {
    edition,
    installationId,
    name: "Fictional Academy",
  });
  const next = structuredClone(api);
  const [major, minor] = api.info.version.split(".").map(Number);
  next.info.version = `${major}.${minor + 1}.0`;
  const read = api.paths["/rest/v1/rpc/installation_capabilities"].get;
  next.paths["/rest/v1/rpc/installation_capabilities_v2"] = {
    get: { ...read, operationId: "readAcademyInstallationCapabilitiesV2" },
  };
  next.paths["/rest/v1/rpc/installation_capabilities"].get.deprecated = true;
  const load = async (document, name) => {
    const path = join(directory, name);
    await writeFile(path, academyClientAssets(document).get("api/client.ts"));
    return import(pathToFileURL(path).href);
  };
  const priorClient = await load(api, "prior.ts");
  const nextClient = await load(next, "next.ts");
  for (const [id, operation] of Object.entries(priorClient.operations))
    assert.deepEqual(nextClient.operations[id], {
      ...operation,
      deprecated: id === read.operationId || operation.deprecated,
    });
  assert.equal(nextClient.installation.openApiVersion, next.info.version);
  assert.notEqual(
    nextClient.installation.openApiVersion,
    priorClient.installation.openApiVersion,
  );
  assert.equal(
    nextClient.operations.readAcademyInstallationCapabilitiesV2.deprecated,
    false,
  );
  assert.throws(
    () =>
      academyClientAssets({
        ...api,
        "x-portal-installation": {
          ...api["x-portal-installation"],
          edition: "internal",
        },
      }),
    /dedicated Academy/,
  );
});

test("rejects path templates without a matching required UUID parameter", () => {
  const [edition, installationId] = identities[0];
  const api = academyOpenApi("https://example.invalid/backend", {
    edition,
    installationId,
    name: "Fictional Academy",
  });
  const path = "/functions/v1/accounts/v1/academy/invitations/{id}/retry";
  const operation = api.paths[path].post;
  for (const parameter of [
    { ...operation.parameters[0], required: false },
    { ...operation.parameters[0], name: "other" },
    { ...operation.parameters[0], schema: { type: "string" } },
  ]) {
    const invalid = structuredClone(api);
    invalid.paths[path].post.parameters = [parameter];
    assert.throws(() => academyClientAssets(invalid), /Unsupported.*operation/);
  }
});
