/** Exercise staged files and the signed API allowance behind private local TLS. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { request as requestHttps } from "node:https";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { connect as connectTls } from "node:tls";
import { promisify } from "node:util";
import { academyOpenApi } from "../../src/features/developer-api/academy-contract.ts";
import { serveAcademyPwaAsset } from "../../supabase/functions/files/academy-pwa-assets.ts";

const exec = promisify(execFile);
const [binary, browser, manifestFile, origin, localPort, envoyBinary] =
  process.argv.slice(2);
assert.equal(
  process.argv.length,
  8,
  "Expected CADDY BROWSER_DIR MANIFEST ORIGIN LOCAL_TLS_PORT ENVOY",
);
const hostname = new URL(origin).hostname;
assert.match(hostname, /^[a-z0-9.-]+$/);
assert.match(localPort, /^[1-9][0-9]{3,4}$/);
assert.ok(Number(localPort) > 1024 && Number(localPort) <= 65525);
const caddyfile = await readFile(
  new URL("../../deploy/hostinger/Caddyfile", import.meta.url),
  "utf8",
);
// Retain only the global options and the dedicated listener in this loopback fixture.
const endOfListener = caddyfile.indexOf("\n# Legacy public entry points");
assert.ok(
  endOfListener > 0,
  "Dedicated Caddy listener missing from the template",
);
const template = caddyfile.slice(0, endOfListener);
const { edition, files, installationId, name } = JSON.parse(
  await readFile(manifestFile, "utf8"),
);
assert.ok(edition === "customer-managed" || edition === "customer-self-hosted");
const root = await mkdtemp(join(tmpdir(), "academy-ingress-test-"));
const allowedApi = [
  "/auth/v1/settings",
  "/rest/v1/rpc/installation_capabilities",
  "/functions/v1/accounts/v1/academy/users",
  "/functions/v1/accounts/v1/academy/company-invitations",
  "/functions/v1/company-integration?limit=2",
  "/functions/v1/company-integration/enrolments",
  "/functions/v1/company-integration/participation",
  "/functions/v1/portal-api/v1/course_workspace?input=%7B%7D",
  "/functions/v1/course-documents",
  "/functions/v1/files?mode=academy-material",
  "/functions/v1/files?mode=course-submission",
  "/functions/v1/files?mode=exam-submission",
  "/functions/v1/files?mode=academy-student-exam",
  "/functions/v1/files?mode=academy-course-chat",
  "/functions/v1/files?mode=academy-attendance",
  "/functions/v1/files?mode=academy-answer-key",
  "/functions/v1/files?mode=academy-logo&expected_version=0",
  "/functions/v1/files?mode=academy-pwa-icon&expected_version=0",
  "/functions/v1/human-login",
  "/functions/v1/human-recovery",
  "/functions/v1/mail-admin",
];
const blockedApi = [
  "/rest/v1/",
  "/rest/v1/jobs",
  "/rest/v1/invoices",
  "/rest/v1/contracts",
  "/functions/v1/accounts/v1/me",
  "/functions/v1/accounts/openapi.json",
  "/functions/v1/calendar-feed",
  "/functions/v1/portal-api",
  "/functions/v1/portal-api/v1/Course_Workspace",
  "/functions/v1/portal-api/v1/course_workspace/extra",
  "/functions/v1/invite-lecturer",
  "/functions/v1/website-enquiries",
  "/functions/v1/files",
  "/functions/v1/files?mode=invoice",
  "/functions/v1/files/extra",
  "/storage/v1/object/public/portal-documents/fixture.pdf",
];
const invitationRetry =
  "/functions/v1/accounts/v1/academy/invitations/4f252e76-30c0-4890-9b44-351c754ca240/retry";
const apiMethodProbes = [
  [invitationRetry, "POST", 200],
  [invitationRetry, "OPTIONS", 200],
  [invitationRetry, "GET", 404],
  [invitationRetry + "/extra", "POST", 404],
  [invitationRetry.replace("4f252e76", "invalid"), "POST", 404],
  ["/functions/v1/portal-api/v1/save_course_exam_schedule", "PUT", 200],
  ["/functions/v1/portal-api/v1/remove_course_exam_pdf", "DELETE", 200],
  ["/functions/v1/portal-api/v1/course_workspace", "OPTIONS", 200],
  ["/functions/v1/portal-api/v1/course_workspace", "POST", 404],
  ["/functions/v1/portal-api/v1/mark_notifications", "PATCH", 200],
];
const pwaRequests = 10;
let publishedVersion = null;
const fixtureIcon = await readFile(join(browser, "current/icons/icon-512.png"));
const upstream = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, "http://127.0.0.1");
  if (requestUrl.pathname === "/functions/v1/files") {
    const asset = await serveAcademyPwaAsset(
      request.method,
      requestUrl.searchParams,
      {
        manifest: async () =>
          publishedVersion && {
            version: publishedVersion,
            name,
            short_name: "Example",
            theme_color: "#102857",
          },
        image: async (_variant, version) =>
          publishedVersion && (version === null || version === publishedVersion)
            ? fixtureIcon.toString("base64")
            : null,
      },
    );
    if (asset) {
      response.writeHead(asset.status, Object.fromEntries(asset.headers));
      response.end(Buffer.from(await asset.arrayBuffer()));
      return;
    }
  }
  response.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(
    JSON.stringify({
      path: allowedApi.find((path) => path === request.url) ?? null,
      refererForwarded: request.headers.referer !== undefined,
    }),
  );
});
upstream.on("upgrade", (request, socket) => {
  const key = request.headers["sec-websocket-key"];
  if (request.url !== "/realtime/v1/websocket" || typeof key !== "string") {
    socket.destroy();
    return;
  }
  const accept = createHash("sha1")
    .update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
    .digest("base64");
  socket.write(
    `HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.setTimeout(3500, () => socket.end());
});
const listening = once(upstream, "listening");
upstream.listen(0, "127.0.0.1");
await listening;

let caddy;
let exited;
let envoy;
let envoyExited;
try {
  const envoyPort = Number(localPort) + 10;
  const policy = await readFile(join(browser, "api-ingress.yml"), "utf8");
  const allowance = Number(/max_tokens: (\d+)/.exec(policy)?.[1]);
  const minimumAllowance =
    allowedApi.length +
    blockedApi.length +
    apiMethodProbes.length +
    1 +
    pwaRequests;
  assert.ok(
    allowance >= minimumAllowance && allowance <= 1000,
    `Use a staging licence with ${minimumAllowance}–1,000 requests per minute`,
  );
  const envoyConfig = join(root, "envoy.yml");
  await writeFile(
    envoyConfig,
    policy
      .replace(
        "address: 0.0.0.0, port_value: 8001",
        "address: 127.0.0.1, port_value: " + envoyPort,
      )
      .replace(
        "address: api-gw, port_value: 8000",
        "address: 127.0.0.1, port_value: " + upstream.address().port,
      ),
    { mode: 0o600 },
  );
  await exec(resolve(envoyBinary), ["--mode", "validate", "-c", envoyConfig]);
  envoy = spawn(
    resolve(envoyBinary),
    ["-c", envoyConfig, "--concurrency", "1"],
    { stdio: "ignore" },
  );
  envoyExited = once(envoy, "close");

  const path = join(root, "Caddyfile");
  const config = template
    .replaceAll("{$PORTAL_DOMAIN}", hostname)
    .replace(
      "admin off",
      "admin off\n\tskip_install_trust\n\tauto_https disable_redirects",
    )
    .replace(
      hostname + " {",
      `https://${hostname}:${localPort} {\n\ttls internal\n\tbind 127.0.0.1`,
    )
    .replaceAll("/srv", resolve(browser))
    .replaceAll("{$PORTAL_API_UPSTREAM:api:8000}", "127.0.0.1:" + envoyPort);
  await writeFile(path, config, { mode: 0o600 });
  const env = {
    PATH: process.env.PATH,
    XDG_DATA_HOME: root,
    XDG_CONFIG_HOME: root,
    PORTAL_CADDY_ALIAS_PROFILE: "academy_no_aliases",
    PORTAL_CADDY_PWA_PROFILE: "academy_runtime_pwa",
    PORTAL_CADDY_ERROR_PROFILE: "academy_pwa_errors",
  };
  await exec(
    resolve(binary),
    ["validate", "--adapter", "caddyfile", "--config", path],
    { env },
  );
  caddy = spawn(
    resolve(binary),
    ["run", "--adapter", "caddyfile", "--config", path],
    { env, stdio: "ignore" },
  );
  exited = once(caddy, "close");

  const trustRoot = join(root, "caddy/pki/authorities/local/root.crt");
  let ca;
  const request = async (route, status, method = "GET") => {
    ca ??= await readFile(trustRoot);
    // The manifest can choose a file path within the fixture, never its TLS peer.
    const received = await new Promise((resolve, reject) => {
      const probe = requestHttps(
        {
          hostname: "127.0.0.1",
          port: Number(localPort),
          servername: hostname,
          headers: {
            Host: `${hostname}:${localPort}`,
            Referer: "https://private.example.invalid/",
          },
          path: route,
          method,
          ca,
          signal: AbortSignal.timeout(3000),
          agent: false,
        },
        resolve,
      );
      probe.on("error", reject);
      probe.end();
    });
    const chunks = [];
    let size = 0;
    for await (const chunk of received) {
      size += chunk.length;
      assert.ok(size <= 20 * 1024 * 1024, "Fixture response exceeds 20 MiB");
      chunks.push(chunk);
    }
    assert.equal(received.httpVersion, "1.1");
    assert.equal(received.statusCode, status, route);
    assert.ok(received.headers["content-security-policy"]);
    return { bytes: Buffer.concat(chunks, size), headers: received.headers };
  };

  for (let attempt = 0; ; attempt++) {
    try {
      await request("/", 200);
      break;
    } catch (error) {
      if (attempt === 30 || caddy.exitCode !== null) throw error;
      await setTimeout(200);
    }
  }
  const shell = await readFile(join(browser, "current/index.html"));
  for (const route of [
    "/",
    "/auth/password",
    "/courses",
    "/settings",
    "/api/explorer",
  ])
    assert.deepEqual((await request(route, 200)).bytes, shell);
  for (const { path: entry, sha256 } of files) {
    const relative = entry.replace(/^browser\//, "");
    assert.match(relative, /^(?:[a-z0-9][\w.-]*\/)*[a-z0-9][\w.-]*$/i);
    const path =
      "/" +
      relative +
      (["manifest.webmanifest", "icons/apple-touch-icon.png"].includes(relative)
        ? "?package=1"
        : "");
    const { bytes, headers } = await request(path, 200);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      sha256,
      relative,
    );
    if (/^(assets\/|workbox-)/.test(relative))
      assert.match(
        headers["cache-control"] ?? "",
        /public, max-age=31536000, immutable/,
      );
    if (["index.html", "manifest.webmanifest", "sw.js"].includes(relative))
      assert.match(headers["cache-control"] ?? "", /no-cache, no-store/);
  }
  for (const route of [
    "/.env",
    "/supabase/private",
    "/private/secret",
    "/backend/auth/v1/admin/users",
    "/backend/internal",
  ])
    await request(route, 404);
  for (const path of blockedApi) {
    const { bytes } = await request("/backend" + path, 404);
    assert.equal(bytes.length, 0);
  }
  for (const path of allowedApi) {
    const { bytes, headers } = await request("/backend" + path, 200);
    assert.deepEqual(JSON.parse(bytes), { path, refererForwarded: false });
    assert.equal(headers["content-type"], "application/json; charset=utf-8");
    assert.ok(
      headers["x-content-type-options"]?.split(", ").includes("nosniff"),
    );
    assert.match(headers["cache-control"] ?? "", /no-store, private/);
  }
  for (const [path, method, status] of apiMethodProbes)
    await request("/backend" + path, status, method);
  const staticManifest = await readFile(
    join(browser, "current/manifest.webmanifest"),
  );
  const staticApple = await readFile(
    join(browser, "current/icons/apple-touch-icon.png"),
  );
  assert.deepEqual(
    (await request("/manifest.webmanifest", 200)).bytes,
    staticManifest,
  );
  assert.deepEqual(
    (await request("/icons/apple-touch-icon.png", 200)).bytes,
    staticApple,
  );
  publishedVersion = 7;
  const runtime = await request("/manifest.webmanifest", 200);
  assert.match(runtime.headers["cache-control"], /no-store/);
  const manifest = JSON.parse(runtime.bytes);
  assert.equal(manifest.id, "/");
  assert.equal(manifest.icons.length, 3);
  assert.equal(manifest.icons[2].purpose, "maskable");
  for (const icon of manifest.icons) {
    assert.match(icon.src, /version=7$/);
    assert.deepEqual((await request(icon.src, 200)).bytes, fixtureIcon);
  }
  assert.deepEqual(
    (await request("/icons/apple-touch-icon.png", 200)).bytes,
    fixtureIcon,
  );
  publishedVersion = 8;
  await request(manifest.icons[0].src, 404);
  const updated = JSON.parse(
    (await request("/manifest.webmanifest", 200)).bytes,
  );
  assert.match(updated.icons[0].src, /version=8$/);
  publishedVersion = null;
  assert.deepEqual(
    (await request("/manifest.webmanifest", 200)).bytes,
    staticManifest,
  );

  const socket = connectTls({
    host: "127.0.0.1",
    port: Number(localPort),
    servername: hostname,
    ca,
  });
  socket.setTimeout(3000, () =>
    socket.destroy(new Error("WebSocket handshake timed out")),
  );
  try {
    await once(socket, "secureConnect");
    socket.write(
      [
        "GET /backend/realtime/v1/websocket HTTP/1.1",
        "Host: " + hostname,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "",
        "",
      ].join("\r\n"),
    );
    let response = "";
    for await (const chunk of socket) {
      response += chunk.toString("ascii");
      if (response.includes("\r\n\r\n")) break;
    }
    assert.match(response, /^HTTP\/1\.1 101 /);
    assert.match(response, /upgrade: websocket/i);
    assert.match(
      response,
      /sec-websocket-accept: s3pPLMBiTxaQ9kYGzzhZRbK\+xOo=/i,
    );
  } finally {
    socket.destroy();
  }

  const capabilityPath = "/rest/v1/rpc/installation_capabilities";
  const restProbe = "/backend" + capabilityPath;
  const contract = academyOpenApi(origin + "/backend", {
    edition,
    installationId,
    name,
  }).paths[capabilityPath].get.responses;
  const checkIngressError = async (status) => {
    const { bytes, headers } = await request(restProbe, status);
    const declared = contract[status];
    const mediaType = headers["content-type"]?.split(";", 1)[0];
    assert.equal(mediaType, "text/plain");
    assert.equal(
      bytes.toString("utf8"),
      declared.content[mediaType].schema.const,
    );
    assert.equal(
      Number(headers["retry-after"]),
      declared.headers["Retry-After"].example,
    );
    assert.match(headers["cache-control"] ?? "", /no-store, private/);
  };
  for (let consumed = minimumAllowance; consumed < allowance; consumed++)
    await request(restProbe, 200);
  await checkIngressError(429);
  assert.deepEqual((await request("/", 200)).bytes, shell);

  const marker = join(browser, "maintenance.enabled");
  await writeFile(marker, "integration test", { flag: "wx", mode: 0o600 });
  try {
    await checkIngressError(503);
    assert.deepEqual((await request("/", 200)).bytes, shell);
  } finally {
    await rm(marker);
  }
  envoy.kill();
  await envoyExited;
  for (const [path, expected] of [
    ["/manifest.webmanifest", staticManifest],
    ["/icons/apple-touch-icon.png", staticApple],
  ]) {
    const { bytes, headers } = await request(path, 200);
    assert.deepEqual(bytes, expected);
    assert.match(headers["cache-control"], /no-store/);
    assert.equal(headers["x-content-type-options"], "nosniff");
  }
  await request(restProbe, 502);
  console.log(
    `Verified ${files.length} staged files, dedicated API routes and the ${allowance}-request burst allowance through local TLS.`,
  );
} finally {
  caddy?.kill();
  envoy?.kill();
  await exited;
  await envoyExited;
  upstream.close();
  await rm(root, { recursive: true, force: true });
}
