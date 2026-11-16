/**
 * Starts owned short-lived Caddy fixtures and checks actual HTTP boundaries.
 * The delivered proxy configuration controls the maintenance fence, frontend and API checks.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { assertLocalDocker, cleanEnvironment, root } from "./runtime-lib.mjs";

// Real Caddy routing regression, entirely separate from app/database containers.
// The only config change replaces the HTTPS listener with local HTTP; route
// adaptation, path handling, response headers and logging are the actual file.
const caddyImage =
  "caddy:2-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0";
const nodeImage =
  "node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5";
const id = randomBytes(8).toString("hex");
const network = `portal-caddy-check-${id}`;
const caddy = `${network}-web`;
const api = `${network}-api`;
const label = "org.luminovia.caddy-check";
const directory = mkdtempSync(join(tmpdir(), "luminovia-caddy-check-"));
const env = cleanEnvironment();
let passed = 0;
let failure;
const cleanupFailures = [];
/** Runs only the temporary proxy fixture's explicit argument list and preserves failure status. */
function docker(args) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    env,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 180000,
    maxBuffer: 4 * 1024 * 1024,
  }).trim();
}
/** Writes configuration and response files inside the owned temporary proxy-fixture directory. */
function file(name, value) {
  const path = join(directory, name);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, value, { mode: 0o644 });
}
/** Counts and reports a case only after all of its assertions have completed successfully. */
function check(name, run) {
  return Promise.resolve()
    .then(run)
    .then(() => {
      passed++;
      console.log(`PASS ${name}`);
    });
}

try {
  await assertLocalDocker();
  const source = readFileSync(join(root, "deploy/hostinger/Caddyfile"), "utf8");
  assert.equal(source.split("{$PORTAL_DOMAIN} {").length, 2);
  file("Caddyfile", source.replace("{$PORTAL_DOMAIN} {", "http://:8080 {"));
  file(
    "site/releases/first/index.html",
    "<!doctype html><title>Fictional portal shell</title>",
  );
  file(
    "site/assets/fictional-a1b2c3.js",
    "console.log('fictional public asset');",
  );
  file("site/releases/first/sw.js", "// fictional service worker");
  file(
    "site/releases/first/manifest.webmanifest",
    '{"name":"Fictional portal"}',
  );
  symlinkSync("releases/first", join(directory, "site/current"));
  for (const name of [
    ".env.local",
    ".git/config",
    "supabase/config.toml",
    "deploy/probe",
    "private/probe",
  ]) {
    file(
      `site/releases/first/${name}`,
      "FICTIONAL_PRIVATE_FIXTURE_MUST_NEVER_BE_SERVED",
    );
  }
  file("templates/invite.html", "<p>Fictional invitation template</p>");
  file("templates/recovery.html", "<p>Fictional recovery template</p>");
  file("templates/unapproved.html", "UNAPPROVED_TEMPLATE_MUST_NEVER_BE_SERVED");
  file(
    "api.mjs",
    `import {createServer} from 'node:http';
createServer(async(req,res)=>{if(req.url.startsWith('/functions/v1/calendar-feed?')||req.url.startsWith('/auth/v1/recover?')){req.socket.destroy();return;}let body='';for await(const chunk of req)body+=chunk;res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'public, max-age=3600'});res.end(JSON.stringify({method:req.method,path:req.url,body}));}).listen(8000,'0.0.0.0');\n`,
  );
  docker(["network", "create", "--label", `${label}=${id}`, network]);
  docker([
    "run",
    "-d",
    "--name",
    api,
    "--label",
    `${label}=${id}`,
    "--network",
    network,
    "--network-alias",
    "api",
    "--read-only",
    "--user",
    "1000:1000",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "--mount",
    `type=bind,src=${join(directory, "api.mjs")},dst=/app/api.mjs,readonly`,
    nodeImage,
    "node",
    "/app/api.mjs",
  ]);
  docker([
    "run",
    "-d",
    "--name",
    caddy,
    "--label",
    `${label}=${id}`,
    "--network",
    network,
    "-p",
    "127.0.0.1::8080",
    "-e",
    "PORTAL_DOMAIN=portal.test",
    "--mount",
    `type=bind,src=${join(directory, "Caddyfile")},dst=/etc/caddy/Caddyfile,readonly`,
    "--mount",
    `type=bind,src=${join(directory, "site")},dst=/srv,readonly`,
    "--mount",
    `type=bind,src=${join(directory, "templates")},dst=/mail-templates,readonly`,
    caddyImage,
  ]);
  const binding = docker(["port", caddy, "8080/tcp"]);
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  const base = `http://${binding}`;
  /** Sends actual HTTP requests to the owned loopback proxy with a controlled Host header and no automatic redirects. */
  const request = (path, options = {}) =>
    fetch(base + path, {
      ...options,
      headers: { Host: "portal.test", ...options.headers },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
  let ready = false;
  for (let n = 0; n < 60; n++) {
    try {
      const response = await request("/backend/rest/v1/readiness");
      if (response.status === 200) {
        ready = true;
        break;
      }
      // A stable 404 is itself the route-ordering failure; avoid a long poll.
      if (response.status === 404 && n > 2) break;
    } catch {
      /* The owned test listener is still starting. */
    }
    await delay(100);
  }
  assert(ready, "Caddy must proxy the allowed backend before its 404 fallback");

  await check(
    "allowed APIs strip exactly one backend prefix and preserve method/body/query",
    async () => {
      for (const path of [
        "auth/v1/token",
        "rest/v1/rpc/check",
        "realtime/v1/websocket",
        "storage/v1/object/test",
        "functions/v1/files",
      ]) {
        const response = await request(`/backend/${path}?fictional=one`, {
          method: "POST",
          body: "fictional-payload",
        });
        assert.equal(response.status, 200, path);
        const body = await response.text();
        assert.match(
          response.headers.get("content-type") ?? "",
          /application\/json/,
          `API must return JSON: ${path}; headers=${JSON.stringify([...response.headers])}; body=${body}`,
        );
        assert.deepEqual(JSON.parse(body), {
          method: "POST",
          path: `/${path}?fictional=one`,
          body: "fictional-payload",
        });
      }
    },
  );
  await check(
    "backend replies cannot override private no-store with upstream public caching",
    async () => {
      const response = await request("/backend/rest/v1/probe");
      assert.equal(response.headers.get("cache-control"), "no-store, private");
    },
  );
  await check(
    "Studio and management routes stay outside the public API allowlist",
    async () => {
      for (const path of [
        "admin",
        "pg",
        "api/platform",
        "rest/v1evil/probe",
        "functions/v1evil/probe",
      ]) {
        const response = await request(`/backend/${path}`);
        assert.equal(response.status, 404, path);
        assert(
          !String(await response.text()).includes("Fictional portal shell"),
          path,
        );
      }
    },
  );
  await check(
    "only invitation and recovery mail templates are public and never cached",
    async () => {
      for (const [name, text] of [
        ["invite", "invitation"],
        ["recovery", "recovery"],
      ]) {
        const response = await request(`/mail-templates/${name}.html`);
        assert.equal(response.status, 200, name);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert((await response.text()).includes(`Fictional ${text} template`));
      }
      assert.equal(
        (await request("/mail-templates/unapproved.html")).status,
        404,
      );
    },
  );
  await check("SPA deep links fall back to an uncached shell", async () => {
    const response = await request("/jobs/fictional-id");
    assert.equal(response.status, 200);
    assert((await response.text()).includes("Fictional portal shell"));
    assert.equal(
      response.headers.get("cache-control"),
      "no-cache, no-store, must-revalidate",
    );
  });
  await check(
    "service worker/manifest update metadata stay uncached and hashed assets immutable",
    async () => {
      for (const path of ["/sw.js", "/manifest.webmanifest"]) {
        const response = await request(path);
        assert.equal(response.status, 200);
        assert.equal(
          response.headers.get("cache-control"),
          "no-cache, no-store, must-revalidate",
        );
      }
      assert.equal(
        (await request("/assets/fictional-a1b2c3.js")).headers.get(
          "cache-control",
        ),
        "public, max-age=31536000, immutable",
      );
    },
  );
  await check(
    "private/config paths remain denied even when real files exist",
    async () => {
      for (const path of [
        "/.env.local",
        "/%2eenv.local",
        "/.git/config",
        "/supabase/config.toml",
        "/deploy/probe",
        "/private/probe",
      ]) {
        const response = await request(path);
        assert.equal(response.status, 404, path);
        assert(
          !String(await response.text()).includes("FICTIONAL_PRIVATE_FIXTURE"),
        );
      }
    },
  );
  await check(
    "auth query strings are absent from Caddy access logs and security headers present",
    async () => {
      const marker = "FICTIONAL_AUTH_LOG_SENTINEL";
      const response = await request(`/auth/callback?token_hash=${marker}`);
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      assert.equal(response.headers.get("x-frame-options"), "DENY");
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert(
        response.headers
          .get("content-security-policy")
          ?.includes("connect-src 'self' wss://portal.test"),
      );
      await delay(100);
      const logs = spawnSync("docker", ["logs", caddy], {
        encoding: "utf8",
        env,
        timeout: 10000,
      });
      assert.equal(logs.status, 0);
      assert(!(logs.stdout + logs.stderr).includes(marker));
      const adapted = JSON.parse(
        docker([
          "exec",
          caddy,
          "caddy",
          "adapt",
          "--config",
          "/etc/caddy/Caddyfile",
          "--adapter",
          "caddyfile",
        ]),
      );
      assert(
        Object.values(adapted.apps.http.servers).every(
          (server) => !server.logs,
        ),
      );
    },
  );
  await check(
    "upstream transport errors retain diagnostics but strip calendar and recovery query credentials",
    async () => {
      const markers = [
        "FICTIONAL_CALENDAR_ERROR_SENTINEL",
        "FICTIONAL_RECOVERY_ERROR_SENTINEL",
      ];
      const paths = [
        `/backend/functions/v1/calendar-feed?token=${markers[0]}&arbitrary_private_key=${markers[0]}`,
        `/backend/auth/v1/recover?token_hash=${markers[1]}&code=${markers[1]}`,
      ];
      for (const path of paths) {
        const response = await request(path, {
          headers: {
            Referer: `https://portal.test/return?token=${markers[0]}`,
          },
        });
        assert.equal(response.status, 502);
        await response.text();
      }
      await delay(100);
      const result = spawnSync("docker", ["logs", caddy], {
        encoding: "utf8",
        env,
        timeout: 10000,
      });
      assert.equal(result.status, 0);
      const text = result.stdout + result.stderr;
      for (const marker of markers)
        assert(
          !text.includes(marker),
          "Error logs must not retain capability or recovery query values",
        );
      const records = text
        .split("\n")
        .flatMap((line) => {
          try {
            return [JSON.parse(line)];
          } catch {
            return [];
          }
        })
        .filter((record) => record.logger?.startsWith("http.log.error"));
      assert(
        records.length >= 2,
        "Transport error diagnostics remain available",
      );
      for (const record of records) {
        assert.equal(record.status, 502);
        assert.equal(typeof record.msg, "string");
        assert(!record.request.uri.includes("?"));
        assert(!("Referer" in (record.request.headers ?? {})));
      }
    },
  );
  await check(
    "owner-only maintenance marker blocks backend writes while preserving the frontend",
    async () => {
      const marker = join(directory, "site/maintenance.enabled");
      writeFileSync(marker, "fictional update window", {
        mode: 0o600,
        flag: "wx",
      });
      assert.equal(statSync(marker).mode & 0o777, 0o600);
      const response = await request("/backend/rest/v1/rpc/check", {
        method: "POST",
        body: "must-not-reach-api",
      });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("retry-after"), "60");
      assert.equal(response.headers.get("cache-control"), "no-store, private");
      assert.equal((await request("/")).status, 200);
      rmSync(marker);
      assert.equal((await request("/backend/rest/v1/probe")).status, 200);
    },
  );
  await check(
    "release promotion is atomic inside the mounted parent and old assets remain",
    async () => {
      file(
        "site/releases/second/index.html",
        "<!doctype html><title>Second fictional release</title>",
      );
      symlinkSync("releases/second", join(directory, "site/current.next"));
      renameSync(
        join(directory, "site/current.next"),
        join(directory, "site/current"),
      );
      assert(
        (await (await request("/")).text()).includes(
          "Second fictional release",
        ),
      );
      assert(
        (await (await request("/assets/fictional-a1b2c3.js")).text()).includes(
          "fictional public asset",
        ),
      );
      assert.equal((await request("/assets/missing-old-chunk.js")).status, 404);
      symlinkSync("releases/first", join(directory, "site/current.previous"));
      renameSync(
        join(directory, "site/current.previous"),
        join(directory, "site/current"),
      );
      assert(
        (await (await request("/")).text()).includes("Fictional portal shell"),
      );
    },
  );
} catch (error) {
  failure = error;
} finally {
  for (const name of [caddy, api]) {
    try {
      const owner = docker([
        "inspect",
        "--format",
        `{{index .Config.Labels "${label}"}}`,
        name,
      ]);
      assert.equal(owner, id, "Refusing to remove an unowned test container");
      docker(["rm", "-f", name]);
    } catch (error) {
      if (!String(error.stderr ?? "").includes("No such object"))
        cleanupFailures.push(error);
    }
  }
  try {
    const owner = docker([
      "network",
      "inspect",
      "--format",
      `{{index .Labels "${label}"}}`,
      network,
    ]);
    assert.equal(owner, id, "Refusing to remove an unowned test network");
    docker(["network", "rm", network]);
  } catch (error) {
    if (!String(error.stderr ?? "").includes("not found"))
      cleanupFailures.push(error);
  }
  rmSync(directory, { recursive: true, force: true });
}
if (failure || cleanupFailures.length)
  throw new AggregateError(
    [failure, ...cleanupFailures].filter(Boolean),
    "Caddy check or owned cleanup failed",
  );
console.log(
  `${passed} Caddy HTTP checks passed; owned containers/network removed.`,
);
