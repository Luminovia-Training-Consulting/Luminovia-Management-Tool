/** Rehearse the built public Website and the native Portal intake on a disposable loopback stack. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, createPublicKey, randomBytes } from "node:crypto";
import { once } from "node:events";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { createServer as createHttpsServer } from "node:https";
import { createServer as reservePort } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright";
import { preview } from "vite";
import {
  assertLocalDocker,
  cleanEnvironment,
  command,
  privateWrite,
  root,
} from "./runtime-lib.mjs";
import {
  ensureLoopbackNetwork,
  removeLoopbackNetwork,
  verifyLoopbackBindings,
} from "./runtime-network.mjs";
import { runtimeSnapshotSource } from "./runtime-snapshot.mjs";

const [websitePath, unexpected] = process.argv.slice(2);
assert.ok(
  websitePath && !unexpected,
  "Usage: node scripts/website-enquiry-rehearsal.mjs /path/to/Website",
);
const website = resolve(websitePath);
const websiteCommit = (
  await command("git", ["rev-parse", "HEAD"], { cwd: website, quiet: true })
).trim();
const portalCommit = (
  await command("git", ["rev-parse", "HEAD"], { quiet: true })
).trim();
const sourceModified = async (cwd) =>
  Boolean(
    (
      await command(
        "git",
        ["status", "--porcelain", "--", ".", ":(exclude)node_modules"],
        { cwd, quiet: true },
      )
    ).trim(),
  );
const [portalSourceModified, websiteSourceModified] = await Promise.all([
  sourceModified(root),
  sourceModified(website),
]);
const { createEnquiryRelay } = await import(
  pathToFileURL(join(website, "integrations/portal-enquiry/worker.mjs")).href
);
const dockerHost = await assertLocalDocker();
const env = cleanEnvironment({
  DOCKER_HOST: dockerHost,
  PORTAL_TEST_MODE: "1",
});
delete env.DOCKER_CONTEXT;
const project = "luminovia-portal-test-" + randomBytes(4).toString("hex");
const directory = mkdtempSync(join(tmpdir(), "luminovia-website-enquiry-"));
const cli = join(directory, "node_modules/.bin/supabase");
const cancellation = new AbortController();
const stopEdge = new AbortController();
const interrupt = () =>
  cancellation.abort(new Error("Website enquiry rehearsal interrupted."));
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
const run = (file, args, extra = {}) =>
  command(file, args, {
    cwd: directory,
    env,
    quiet: true,
    signal: cancellation.signal,
    ...extra,
  });

const originOf = (server) => "https://127.0.0.1:" + server.address().port;
const close = (server) => new Promise((done) => server.close(done));
const privacyVersion = "fictional-rehearsal-v1";
const integrationToken = randomBytes(48).toString("base64url");
const challengeSecret = randomBytes(32).toString("base64url");
const workerRoute = "/website-enquiry";
const portalRoute = "/functions/v1/website-enquiries";
const challengeEndpoint =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

async function randomizePorts(source) {
  const used = new Map();
  for (const match of source.matchAll(
    /^(?:port|shadow_port|inspector_port)\s*=\s*(\d+)$|127\.0\.0\.1:(\d+)/gm,
  )) {
    used.set(match[1] ?? match[2], null);
  }
  const reservations = [];
  try {
    for (const port of used.keys()) {
      const socket = reservePort().listen(0, "127.0.0.1");
      reservations.push(socket);
      await once(socket, "listening");
      used.set(port, socket.address().port);
    }
    return source
      .replace(/^project_id\s*=.*$/m, `project_id = "${project}"`)
      .replace(
        /^(port|shadow_port|inspector_port)\s*=\s*(\d+)$/gm,
        (_, key, port) => `${key} = ${used.get(port)}`,
      )
      .replace(
        /127\.0\.0\.1:(\d+)/g,
        (_, port) => "127.0.0.1:" + used.get(port),
      );
  } finally {
    await Promise.all(reservations.map(close));
  }
}

async function waitForIntake(api, key, origin) {
  const deadline = Date.now() + 45_000;
  do {
    try {
      const response = await fetch(api + portalRoute, {
        method: "POST",
        body: "{}",
        headers: {
          Origin: origin,
          "Content-Type": "application/json",
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        signal: AbortSignal.any([
          AbortSignal.timeout(3000),
          cancellation.signal,
        ]),
      });
      const result = await response.json();
      if (
        response.status === 401 &&
        result.error === "integration_authentication_required"
      )
        return;
    } catch {
      cancellation.signal.throwIfAborted();
    }
    await delay(300, undefined, { signal: cancellation.signal });
  } while (Date.now() < deadline);
  throw new Error(
    "The disposable Edge intake did not return its integration credential denial.",
  );
}

let stack, network, edge, relay, browser, site;
const cleanup = [];
try {
  const certFile = join(directory, "localhost.pem");
  const keyFile = join(directory, "localhost-key.pem");
  await run("openssl", [
    "req",
    "-new",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:P-256",
    "-nodes",
    "-subj",
    "/CN=127.0.0.1",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
    "-days",
    "1",
    "-keyout",
    keyFile,
    "-out",
    certFile,
  ]);
  const tls = { key: readFileSync(keyFile), cert: readFileSync(certFile) };
  const localSpki = createHash("sha256")
    .update(createPublicKey(tls.key).export({ type: "spki", format: "der" }))
    .digest("base64");

  const config = await randomizePorts(
    readFileSync(join(root, "supabase/config.toml"), "utf8"),
  );
  const apiPort = /^\[api\][\s\S]*?^port\s*=\s*(\d+)$/m.exec(config)?.[1];
  assert.ok(apiPort, "Disposable Portal API port must be configured.");
  const api = "http://127.0.0.1:" + apiPort;
  mkdirSync(join(directory, "supabase"));
  for (const item of ["migrations", "functions", "templates"]) {
    cpSync(join(root, "supabase", item), join(directory, "supabase", item), {
      recursive: true,
      filter: (path) => runtimeSnapshotSource(path, root),
    });
  }
  symlinkSync(join(root, "node_modules"), join(directory, "node_modules"));
  privateWrite(join(directory, "supabase/config.toml"), config);
  network = await ensureLoopbackNetwork(project);
  stack = true;
  console.log(
    "Starting a fresh loopback Portal for the fictional enquiry rehearsal.",
  );
  await run(cli, [
    "start",
    "--network-id",
    network,
    "--exclude",
    "studio,postgres-meta,edge-runtime,logflare,vector,imgproxy,supavisor",
  ]);
  await verifyLoopbackBindings(project);
  const { API_URL, ANON_KEY, SERVICE_ROLE_KEY } = JSON.parse(
    execFileSync(cli, ["status", "--output", "json"], {
      cwd: directory,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }),
  );
  assert.equal(API_URL, api);

  const attempts = new Map();
  let websiteOrigin, relayOrigin;
  const worker = createEnquiryRelay(async (url, init) => {
    if (String(url) === challengeEndpoint) {
      const { secret, response } = JSON.parse(init.body);
      assert.equal(secret, challengeSecret);
      const [id, proof] = response.split(":");
      return Response.json({
        success: proof === "valid",
        hostname: "127.0.0.1",
        action: "website_enquiry",
        cdata: id,
      });
    }
    assert.equal(String(url), relayOrigin + portalRoute);
    const body = JSON.parse(init.body);
    const state = attempts.get(body.submission_id) ?? {
      hits: 0,
      locale: body.locale,
    };
    state.hits++;
    attempts.set(body.submission_id, state);
    const response = await fetch(api + portalRoute, init);
    // Simulate an unconfirmed first acknowledgement after the real DB committed.
    if (body.locale === "en" && state.hits === 1 && response.status === 202) {
      await response.body?.cancel();
      throw new Error("Fictional dropped acknowledgement.");
    }
    return response;
  });
  relay = createHttpsServer(tls, async (req, res) => {
    try {
      const body = req.method === "POST" ? Readable.toWeb(req) : undefined;
      const request = new Request(new URL(req.url, relayOrigin), {
        method: req.method,
        headers: req.headers,
        ...(body && { body, duplex: "half" }),
      });
      const response = await worker(request, {
        WEBSITE_ORIGIN: websiteOrigin,
        PORTAL_ENQUIRY_URL: relayOrigin + portalRoute,
        PORTAL_CLIENT_KEY: ANON_KEY,
        TURNSTILE_SECRET: challengeSecret,
        PORTAL_INTEGRATION_TOKEN: integrationToken,
        PRIVACY_NOTICE_VERSION: privacyVersion,
      });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500);
      res.end();
    }
  }).listen(0, "127.0.0.1");
  await once(relay, "listening");
  relayOrigin = originOf(relay);

  const build = join(directory, "website");
  await run("npm", ["run", "build", "--", "--outDir", build], {
    cwd: website,
    env: {
      ...env,
      VITE_ENQUIRY_URL: relayOrigin + workerRoute,
      VITE_ENQUIRY_SITE_KEY: "fictional-site-key",
      VITE_ENQUIRY_PRIVACY_VERSION: privacyVersion,
    },
  });
  site = (
    await preview({
      configFile: false,
      root: directory,
      build: { outDir: build },
      preview: { host: "127.0.0.1", port: 0, https: tls },
    })
  ).httpServer;
  websiteOrigin = originOf(site);

  const edgeEnv = join(directory, "edge.env");
  privateWrite(
    edgeEnv,
    [
      "PORTAL_WEBSITE_ENQUIRIES_ENABLED=true",
      "PORTAL_WEBSITE_INTEGRATION_TOKEN=" + integrationToken,
      "PORTAL_WEBSITE_ORIGIN=" + websiteOrigin,
      "PORTAL_WEBSITE_PRIVACY_NOTICE_VERSION=" + privacyVersion,
      "",
    ].join("\n"),
  );
  edge = run(
    cli,
    [
      "functions",
      "serve",
      "website-enquiries",
      "--network-id",
      network,
      "--env-file",
      edgeEnv,
    ],
    {
      signal: AbortSignal.any([cancellation.signal, stopEdge.signal]),
    },
  ).then(
    () => new Error("The owned Edge worker exited early."),
    (error) => error,
  );
  await Promise.race([
    waitForIntake(api, ANON_KEY, websiteOrigin),
    edge.then((error) => {
      throw error;
    }),
  ]);
  await verifyLoopbackBindings(project, { edge: true });

  const make = (key) =>
    createClient(api, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  const service = make(SERVICE_ROLE_KEY);
  async function actor(role) {
    const email = `fictional-${role}-${project}@example.invalid`;
    const password = "A!9a-" + randomBytes(32).toString("base64url");
    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    assert.equal(created.error, null, "Create the fictional " + role);
    const granted = await service
      .from("user_roles")
      .insert({ user_id: created.data.user.id, role });
    assert.equal(granted.error, null, "Assign the fictional " + role);
    const client = make(ANON_KEY);
    const signedIn = await client.auth.signInWithPassword({ email, password });
    assert.equal(
      signedIn.error,
      null,
      "Sign in through the disposable Auth API",
    );
    return client;
  }
  const [manager, peer] = await Promise.all([
    actor("management"),
    actor("lecturer"),
  ]);

  browser = await chromium.launch({
    args: ["--ignore-certificate-errors-spki-list=" + localSpki],
  });
  for (const language of ["de", "en"]) {
    const context = await browser.newContext({
      locale: language === "de" ? "de-DE" : "en-US",
      serviceWorkers: "block",
      viewport:
        language === "de"
          ? { width: 390, height: 844 }
          : { width: 1280, height: 850 },
    });
    // Keep browser and server traffic on the two owned HTTPS listeners. The
    // fictional widget mimics the provider callback without using any real key.
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return [websiteOrigin, relayOrigin].includes(url.origin)
        ? route.continue()
        : route.abort();
    });
    await context.addInitScript((locale) => {
      localStorage.setItem("carina_site_language_v2", locale);
      let challenges = 0;
      globalThis.turnstile = {
        render(_element, options) {
          if (options.action !== "website_enquiry")
            throw new Error("Unexpected challenge action");
          challenges++;
          const proof =
            locale === "en" && challenges === 1 ? "invalid" : "valid";
          queueMicrotask(() => options.callback(options.cData + ":" + proof));
          return challenges;
        },
        remove() {},
      };
    }, language);
    const page = await context.newPage();
    await page.goto(websiteOrigin + "/contact/");
    const form = page.locator("form.people-enquiry-form");
    const topic = `Fictional ${language} training ${project}`;
    await form.locator('[name="company_name"]').fill("Fictional Academy");
    await form.locator('[name="contact_name"]').fill("Fictional Contact");
    await form.locator('[name="email"]').fill("fictional@example.invalid");
    await form.locator('[name="topic"]').fill(topic);
    await form
      .locator('[name="message"]')
      .fill("Fictional course requirements for an isolated rehearsal.");
    await form.locator('[name="consent"]').check();
    const submit = form.getByRole("button", {
      name: language === "de" ? "Anfrage senden" : "Send enquiry",
    });
    const send = async (status) => {
      const pending = page.waitForResponse(
        (response) =>
          response.url() === relayOrigin + workerRoute &&
          response.request().method() === "POST",
      );
      await submit.focus();
      await submit.press("Enter");
      const response = await pending;
      assert.equal(response.status(), status);
      return response.json();
    };
    if (language === "en") {
      assert.equal((await send(400)).error, "challenge_invalid");
      await form.getByRole("alert").waitFor();
      assert.equal(
        attempts.size,
        1,
        "The invalid challenge did not reach the Portal",
      );
      assert.equal((await send(503)).error, "delivery_unavailable");
      await form.getByRole("alert").waitFor();
    }
    const receipt = await send(202);
    assert.equal(receipt.received, true);
    await form
      .getByText(
        language === "de"
          ? "Ihre Anfrage ist eingegangen."
          : "Your enquiry was received.",
      )
      .waitFor();
    assert.deepEqual(attempts.get(receipt.receipt), {
      hits: language === "de" ? 1 : 2,
      locale: language,
    });
    const inbox = await manager.rpc("enquiry_inbox", { p_search: topic });
    assert.equal(inbox.error, null);
    assert.equal(inbox.data.items.length, 1);
    const id = inbox.data.items[0].id;
    const detail = await manager.rpc("enquiry_detail", { p_enquiry_id: id });
    assert.equal(detail.error, null);
    assert.equal(detail.data.payload.topic, topic);
    assert.equal(detail.data.payload.locale, language);
    assert.equal(detail.data.payload.privacy_notice_version, privacyVersion);
    assert.equal(detail.data.payload.consent, true);
    const denied = await peer.rpc("enquiry_detail", { p_enquiry_id: id });
    assert.equal(denied.error?.code, "42501");
    const [managerNotices, peerNotices] = await Promise.all([
      manager.rpc("notification_inbox", {}),
      peer.rpc("notification_inbox", {}),
    ]);
    assert.equal(managerNotices.error, null);
    assert.equal(peerNotices.error, null);
    assert.equal(
      managerNotices.data.items.filter(
        (notice) =>
          notice.kind === "website_enquiry" &&
          notice.href === `/enquiries/${id}`,
      ).length,
      1,
    );
    assert.ok(
      !peerNotices.data.items.some(
        (notice) => notice.kind === "website_enquiry",
      ),
    );

    await context.close();
  }
  assert.equal(attempts.size, 2);
  console.log(
    JSON.stringify({
      portal_commit: portalCommit,
      website_commit: websiteCommit,
      portal_source_modified: portalSourceModified,
      website_source_modified: websiteSourceModified,
      evidence: "isolated-local",
      checks: [
        "de-mobile",
        "en-desktop",
        "keyboard-submit",
        "invalid-challenge",
        "receipt-retry",
        "single-enquiry-per-receipt",
        "manager-inbox",
        "manager-notification",
        "lecturer-denied",
      ],
    }),
  );
} catch (error) {
  cleanup.push(error);
} finally {
  stopEdge.abort();
  if (edge) await edge;
  for (const action of [
    () => browser?.close(),
    () => site && close(site),
    () => relay && close(relay),
    () =>
      stack &&
      run(cli, ["stop", "--project-id", project, "--no-backup"], {
        signal: undefined,
      }),
    () => network && removeLoopbackNetwork(project),
  ]) {
    try {
      await action();
    } catch (error) {
      cleanup.push(error);
    }
  }
  rmSync(directory, { recursive: true, force: true });
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
}
if (cleanup.length)
  throw new AggregateError(cleanup, "Website enquiry rehearsal failed.");
