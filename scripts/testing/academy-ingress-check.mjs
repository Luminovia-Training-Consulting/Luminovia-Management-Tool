/** Exercise staged files and the signed API allowance behind private local TLS. */
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";

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
const root = await mkdtemp(join(tmpdir(), "academy-ingress-test-"));
const template = await readFile(
  new URL("../../deploy/hostinger/Caddyfile", import.meta.url),
  "utf8",
);
const { files } = JSON.parse(await readFile(manifestFile, "utf8"));
const upstream = createServer((request, response) => {
  response.end(
    JSON.stringify({
      path: request.url,
      referer: request.headers.referer ?? null,
    }),
  );
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
  assert.ok(
    allowance > 0 && allowance <= 1000,
    "Use a staging licence with at most 1,000 requests per minute",
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

  const headersFile = join(root, "headers");
  const request = async (route, status) => {
    const { stdout } = await exec(
      "curl",
      [
        "--silent",
        "--show-error",
        "--noproxy",
        "*",
        "--http1.1",
        "--cacert",
        join(root, "caddy/pki/authorities/local/root.crt"),
        "--resolve",
        hostname + ":" + localPort + ":127.0.0.1",
        "-H",
        "Referer: https://private.example.invalid/",
        "-D",
        headersFile,
        "https://" + hostname + ":" + localPort + route,
      ],
      { timeout: 3000, encoding: "buffer", maxBuffer: 20 * 1024 * 1024 },
    );
    const headers = (await readFile(headersFile, "utf8")).toLowerCase();
    assert.match(headers, new RegExp("^http/1.1 " + status + " "));
    assert.match(headers, /content-security-policy:/);
    return { bytes: stdout, headers };
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
    const { bytes, headers } = await request("/" + relative, 200);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      sha256,
      relative,
    );
    if (/^(assets\/|workbox-)/.test(relative))
      assert.match(
        headers,
        /cache-control: public, max-age=31536000, immutable/,
      );
    if (["index.html", "manifest.webmanifest", "sw.js"].includes(relative))
      assert.match(headers, /cache-control: no-cache, no-store/);
  }
  for (const route of [
    "/.env",
    "/supabase/private",
    "/private/secret",
    "/backend/auth/v1/admin/users",
    "/backend/internal",
  ])
    await request(route, 404);
  const { bytes, headers } = await request("/backend/auth/v1/settings", 200);
  assert.deepEqual(JSON.parse(bytes), {
    path: "/auth/v1/settings",
    referer: null,
  });
  assert.match(headers, /cache-control: no-store, private/);

  for (let consumed = 1; consumed < allowance; consumed++)
    await request("/backend/rest/v1/", 200);
  assert.match(
    (await request("/backend/rest/v1/", 429)).headers,
    /retry-after: 60/,
  );
  assert.deepEqual((await request("/", 200)).bytes, shell);

  const marker = join(browser, "maintenance.enabled");
  await writeFile(marker, "integration test", { flag: "wx", mode: 0o600 });
  try {
    assert.match(
      (await request("/backend/rest/v1/", 503)).headers,
      /retry-after: 60/,
    );
    assert.deepEqual((await request("/", 200)).bytes, shell);
  } finally {
    await rm(marker);
  }
  console.log(
    `Verified ${files.length} staged files and the ${allowance}-request burst allowance through local TLS.`,
  );
} finally {
  caddy?.kill();
  envoy?.kill();
  await exited;
  await envoyExited;
  upstream.close();
  await rm(root, { recursive: true, force: true });
}
