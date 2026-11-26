/** Exercise the shipped isolated player in real Chromium using the official H5P examples. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, request } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "@zip.js/zip.js";
import { chromium } from "playwright";

const archiveDirectory = process.env.LUMINOVIA_H5P_BUILD_ARCHIVE_DIRECTORY;
if (!archiveDirectory)
  throw new Error(
    "Set the directory with the four pinned upstream H5P release archives.",
  );
const scratch = await mkdtemp(join(tmpdir(), "luminovia-h5p-browser-"));
const portalHost = "portal.luminovia.test";
const suffix = "launch.content.test";
const sampleNames = [
  "H5P.TrueFalse",
  "H5P.MultiChoice",
  "H5P.SingleChoiceSet",
  "H5P.QuestionSet",
];
const certPath = join(scratch, "local.crt");
const keyPath = join(scratch, "local.key");

const listen = async (server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
};
const close = (server) => new Promise((done) => server.close(done));

let proxy;
let player;
let browser;
try {
  execFileSync(
    "openssl",
    [
      "req",
      "-newkey",
      "rsa:2048",
      "-x509",
      "-nodes",
      "-days",
      "1",
      "-subj",
      "/CN=" + portalHost,
      "-addext",
      "subjectAltName=DNS:" + portalHost + ",DNS:*." + suffix,
      "-keyout",
      keyPath,
      "-out",
      certPath,
    ],
    { stdio: "ignore" },
  );
  const bytesByType = new Map();
  for (const name of sampleNames) {
    const archive = new ZipReader(
      new Uint8ArrayReader(
        await readFile(join(archiveDirectory, name + ".h5p")),
      ),
    );
    const files = [];
    try {
      for (const entry of await archive.getEntries()) {
        if (
          !entry.directory &&
          (entry.filename === "h5p.json" ||
            entry.filename === "content/content.json" ||
            /^content\/.+\.(?:png|jpe?g|gif|webp|mp3|mp4|vtt)$/i.test(
              entry.filename,
            ))
        ) {
          files.push({
            path: entry.filename,
            bytes: [
              ...(await entry.getData(new Uint8ArrayWriter(), {
                checkSignature: true,
              })),
            ],
          });
        }
      }
    } finally {
      await archive.close();
    }
    bytesByType.set(name, files);
  }

  const allocation = createServer();
  const playerPort = await listen(allocation);
  await close(allocation);
  proxy = createHttpsServer({
    cert: await readFile(certPath),
    key: await readFile(keyPath),
  });
  const testPort = await listen(proxy);
  const portalOrigin = "https://" + portalHost + ":" + testPort;
  player = spawn(
    process.execPath,
    [
      new URL("../deploy/lms-content/h5p/dist/serve.mjs", import.meta.url)
        .pathname,
    ],
    {
      env: {
        ...process.env,
        LUMINOVIA_H5P_PORT: String(playerPort),
        LUMINOVIA_H5P_PORTAL_ORIGIN: portalOrigin,
        LUMINOVIA_H5P_CONTENT_HOST_SUFFIX: suffix,
      },
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  await Promise.race([
    once(player.stdout, "data"),
    once(player, "exit").then(() => {
      throw new Error("The isolated player failed to start");
    }),
  ]);

  proxy.on("request", (incoming, outgoing) => {
    const [host] = incoming.headers.host.split(":");
    const url = new URL(incoming.url, portalOrigin);
    if (host !== portalHost) {
      const forwarded = request(
        {
          host: "127.0.0.1",
          port: playerPort,
          path: incoming.url,
          method: incoming.method,
          headers: {
            host,
            ...(incoming.headers.range
              ? { range: incoming.headers.range }
              : {}),
          },
        },
        (reply) => {
          outgoing.writeHead(reply.statusCode, reply.headers);
          reply.pipe(outgoing);
        },
      );
      forwarded.on("error", () => outgoing.writeHead(502).end());
      forwarded.end();
      return;
    }
    const name = url.searchParams.get("type");
    const files = bytesByType.get(name);
    if (files && url.searchParams.has("assets")) {
      outgoing.writeHead(200, { "Content-Type": "application/json" });
      outgoing.end(JSON.stringify(files));
      return;
    }
    if (!files) {
      outgoing.writeHead(404).end();
      return;
    }
    const session = randomUUID();
    const origin = "https://" + session + "." + suffix + ":" + testPort;
    outgoing.writeHead(200, { "Content-Type": "text/html;charset=utf-8" });
    outgoing.end(`<!doctype html><html lang="en"><title>Fictional course H5P launch</title>
      <script>
        addEventListener("message", (event) => {
          const frame = document.querySelector("iframe");
          if (event.origin !== ${JSON.stringify(origin)} ||
              event.source !== frame.contentWindow ||
              event.data?.session !== ${JSON.stringify(session)}) return;
          if (event.data.type === "h5p-ready") {
            fetch(location.pathname + location.search + "&assets=1")
              .then((response) => response.json())
              .then((assets) => {
                const files = assets.map(({path,bytes}) => ({path,bytes:Uint8Array.from(bytes).buffer}));
                frame.contentWindow.postMessage({type:"h5p-open",session:${JSON.stringify(session)},files},
                  ${JSON.stringify(origin)}, files.map(({bytes}) => bytes));
              });
          } else window.h5pEvents.push(event.data);
        });
        window.h5pEvents = [];
      </script>
      <iframe title="Isolated activity" sandbox="allow-scripts allow-same-origin"
        style="width:100%;height:35rem" src="${origin}/h5p/?session=${session}"></iframe>
    </html>`);
  });
  browser = await chromium.launch({
    args: [
      "--no-proxy-server",
      "--host-resolver-rules=MAP " +
        portalHost +
        " 127.0.0.1, MAP *." +
        suffix +
        " 127.0.0.1",
      "--ignore-certificate-errors",
    ],
  });
  for (const viewport of [
    { width: 1280, height: 800 },
    { width: 375, height: 750 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const warnings = [];
    page.on("pageerror", (error) => warnings.push(error.message));
    page.on("console", (entry) => {
      if (entry.type() === "error") warnings.push(entry.text());
    });
    page.on("response", (response) => {
      if (response.status() >= 400)
        warnings.push(response.status() + " " + response.url());
    });
    try {
      for (const name of sampleNames) {
        await page.goto(portalOrigin + "/?type=" + name);
        await page.waitForFunction(
          () =>
            globalThis.h5pEvents?.some(({ type }) =>
              ["h5p-started", "h5p-error"].includes(type),
            ),
          undefined,
          { timeout: 10000 },
        );
        const events = await page.evaluate(() => globalThis.h5pEvents);
        assert.equal(
          events[0].type,
          "h5p-started",
          name + " could not initialise",
        );
        const content = page.frameLocator("iframe");
        if (name === "H5P.TrueFalse") {
          await content
            .getByText("Oslo is the capital of Norway.", { exact: true })
            .waitFor();
          const image = content.getByRole("img", {
            name: "The Oslo Opera House",
          });
          await image.waitFor();
          assert.equal(
            await image.evaluate(
              (node) => node.complete && node.naturalWidth > 0,
            ),
            true,
          );
          await content.getByText("Yes", { exact: true }).click();
          await content.getByRole("button", { name: "Check" }).click();
          await page.waitForFunction(() =>
            globalThis.h5pEvents?.some(
              ({ type, score }) => type === "h5p-progress" && score === 1,
            ),
          );
        } else {
          await content.locator(".h5p-content").waitFor();
        }
        console.log(`PASS ${name} in actual Chromium at ${viewport.width}px.`);
      }
    } catch (error) {
      console.error(warnings);
      throw error;
    } finally {
      await context.close();
    }
  }
} finally {
  await browser?.close();
  if (player) {
    player.kill();
    if (player.exitCode === null)
      await Promise.race([once(player, "exit"), setTimeout(2000)]);
  }
  if (proxy) await close(proxy);
  await rm(scratch, { recursive: true, force: true });
}
