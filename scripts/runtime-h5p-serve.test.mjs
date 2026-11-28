import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { once } from "node:events";
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const suffix = "launch.h5p-content.example.net";
const host = "d0000000-0000-4000-8000-000000000000." + suffix;
const sample = "console.log('fixture');";
const largeSize = 32 * 1024 * 1024;

/** Run the actual content origin with isolated public static test assets and a private memory probe. */
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "luminovia-h5p-serve-"));
  let child;
  let exited;
  t.after(async () => {
    if (child) {
      child.kill();
      await exited;
    }
    await rm(root, { recursive: true, force: true });
  });
  await copyFile(
    new URL("../deploy/lms-content/h5p/serve.mjs", import.meta.url),
    join(root, "serve.mjs"),
  );
  await mkdir(join(root, "player"));
  await mkdir(join(root, "libraries"));
  await writeFile(join(root, "libraries", "sample.js"), sample);
  const asset = join(root, "libraries", "large.js");
  await writeFile(asset, "");
  await truncate(asset, largeSize);
  await writeFile(
    join(root, "memory-probe.mjs"),
    'process.on("message", () => process.send(process.memoryUsage().arrayBuffers));\n',
  );
  child = fork(join(root, "serve.mjs"), {
    execArgv: ["--import", join(root, "memory-probe.mjs")],
    env: {
      LUMINOVIA_H5P_PORT: "0",
      LUMINOVIA_H5P_PORTAL_ORIGIN: "https://portal.example.net",
      LUMINOVIA_H5P_CONTENT_HOST_SUFFIX: suffix,
    },
    stdio: ["ignore", "pipe", "inherit", "ipc"],
  });
  exited = once(child, "exit");
  const port = await Promise.race([
    once(child.stdout, "data").then(([text]) =>
      Number(text.toString().match(/port (\d+)/)?.[1]),
    ),
    exited.then(() => {
      throw new Error("H5P origin exited before listening");
    }),
  ]);
  assert.ok(port);
  async function memory() {
    const reply = once(child, "message");
    child.send("measure");
    return (await reply)[0];
  }
  return { port, memory };
}

function request(port, path, hostname = host) {
  return new Promise((resolve, reject) => {
    get(
      { hostname: "127.0.0.1", port, path, headers: { host: hostname } },
      resolve,
    ).once("error", reject);
  });
}

test(
  "static responses preserve bytes, content length and isolated-origin headers",
  { timeout: 10000 },
  async (t) => {
    const { port } = await fixture(t);
    const response = await request(port, "/h5p/libraries/sample.js");
    assert.equal(response.statusCode, 200);
    assert.equal(
      response.headers["content-length"],
      String(Buffer.byteLength(sample)),
    );
    assert.equal(
      response.headers["content-type"],
      "text/javascript; charset=utf-8",
    );
    assert.equal(response.headers["cache-control"], "no-store");
    assert.match(
      response.headers["content-security-policy"],
      /frame-ancestors 'self' https:\/\/portal\.example\.net/,
    );
    const parts = [];
    for await (const part of response) parts.push(part);
    assert.equal(Buffer.concat(parts).toString(), sample);
    for (const [path, hostname] of [
      ["/h5p/libraries/missing.js", host],
      ["/h5p/libraries/sample.js", suffix],
    ]) {
      const denied = await request(port, path, hostname);
      assert.equal(denied.statusCode, 404);
      denied.resume();
    }
  },
);

test(
  "slow static downloads keep only bounded chunks buffered",
  { timeout: 10000 },
  async (t) => {
    const { port, memory } = await fixture(t);
    const initial = await memory();
    const response = await request(port, "/h5p/libraries/large.js");
    t.after(() => response.destroy());
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-length"], String(largeSize));
    // Leave the body unread while checking the server, so TCP backpressure
    // keeps a full-file write pending but a streaming write stays bounded.
    const buffered = (await memory()) - initial;
    t.diagnostic(
      `ArrayBuffer increase while the 32 MiB response was paused: ${buffered} bytes`,
    );
    assert.ok(
      buffered < 4 * 1024 * 1024,
      `server allocated ${buffered} bytes for an unread 32 MiB response`,
    );
    response.destroy();
    const next = await request(port, "/h5p/libraries/sample.js");
    assert.equal(next.statusCode, 200);
    next.resume();
  },
);
