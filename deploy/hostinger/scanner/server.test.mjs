/**
 * Actual local HTTP/TCP cases use a fictional token and injected scan adapter. Exercise limits, deadlines, authentication and errors without loading production credentials.
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { createServer as createTcpServer } from "node:net";
import test from "node:test";
import { createClamavScanner, MAX_BYTES } from "./clamav.mjs";
import { createScannerServer, readToken } from "./server.mjs";

const token = "a".repeat(64); // Fictional unit-test value, never a deployment token.
// Build a fresh fictional clamd version string for the local protocol test.
const version = () => `ClamAV 1.4.3/27820/${new Date().toUTCString()}`;

// Start only the owned local HTTP test server and register its cleanup with the test owner.
async function start(t, options = {}) {
  let calls = 0;
  const scanner = options.scanner ?? {
    version: async () => version(),
    scan: async () => {
      calls++;
      return { clean: true, version: version() };
    },
  };
  const server = createScannerServer({ token, ...options, scanner });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  return { server, url, calls: () => calls };
}

// Send fictional local upload bytes and explicit test headers to the owned server.
function upload(url, body = "fictional lesson", extra = {}) {
  return fetch(`${url}/scan`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      ...extra.headers,
    },
    body,
    ...extra,
  });
}

test("authentication is required before scan, body handling or CORS", async (t) => {
  const instance = await start(t);
  for (const authorization of [undefined, "Bearer wrong", `Basic ${token}`]) {
    const response = await fetch(`${instance.url}/scan`, {
      method: "POST",
      headers: authorization ? { Authorization: authorization } : {},
      body: "private content must never be returned",
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "unauthorized" });
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  }
  assert.equal(instance.calls(), 0);
});

test("only server-originated exact scan and health endpoints are accepted", async (t) => {
  const instance = await start(t);
  const origin = await upload(instance.url, "data", {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      Origin: "https://portal.example.invalid",
    },
  });
  assert.equal(origin.status, 403);
  for (const path of ["/scan?url=https://other.invalid", "/other", "/scan/"]) {
    const response = await fetch(instance.url + path, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 404);
  }
  const response = await fetch(instance.url + "/health", {
    headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ready: true });
  assert.equal(instance.calls(), 0);
});

test("real HTTP upload receives verdict without filenames, cache or CORS", async (t) => {
  const seen = [];
  const instance = await start(t, {
    scanner: {
      version: async () => version(),
      scan: async (bytes) => {
        seen.push(Buffer.from(bytes));
        return { clean: false, version: version(), signature: "not disclosed" };
      },
    },
  });
  const body = Buffer.from([0, 1, 2, 255]);
  const response = await upload(instance.url, body);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  const value = await response.json();
  assert.deepEqual(Object.keys(value).sort(), ["clean", "version"]);
  assert.equal(value.clean, false);
  assert.deepEqual(seen, [body]);
});

test("media type, empty bodies and declared oversize never reach scanner", async (t) => {
  const instance = await start(t);
  const mime = await upload(instance.url, "data", {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
  });
  assert.equal(mime.status, 415);
  const empty = await upload(instance.url, Buffer.alloc(0));
  assert.equal(empty.status, 413);
  const oversize = await new Promise((resolve, reject) => {
    const request = httpRequest(
      instance.url + "/scan",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
          "Content-Length": String(MAX_BYTES + 1),
        },
      },
      resolve,
    );
    request.on("error", reject);
    request.flushHeaders();
  });
  assert.equal(oversize.statusCode, 413);
  oversize.resume();
  assert.equal(instance.calls(), 0);
});

test("chunked upload is bounded even without Content-Length", async (t) => {
  const instance = await start(t);
  const response = await new Promise((resolve, reject) => {
    const request = httpRequest(
      instance.url + "/scan",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
        },
      },
      resolve,
    );
    request.on("error", (error) => {
      if (error.code !== "ECONNRESET" && error.code !== "EPIPE") reject(error);
    });
    // No Content-Length: Node uses chunked transfer encoding.
    request.write(Buffer.alloc(MAX_BYTES));
    request.end(Buffer.from([1]));
  });
  assert.equal(response.statusCode, 413);
  response.resume();
  assert.equal(instance.calls(), 0);
});

test("interrupted shorter-than-declared upload is never scanned", async (t) => {
  const instance = await start(t);
  const request = httpRequest(instance.url + "/scan", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "Content-Length": "100",
    },
  });
  request.on("error", () => {});
  request.write("short");
  await new Promise((resolve) => setTimeout(resolve, 20));
  request.destroy();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(instance.calls(), 0);
  const after = await upload(instance.url);
  assert.equal(after.status, 200);
  assert.equal(instance.calls(), 1);
});

test("slow upload expires and releases slot without scanning", async (t) => {
  const instance = await start(t, { uploadTimeoutMs: 30 });
  const response = await new Promise((resolve, reject) => {
    const request = httpRequest(
      instance.url + "/scan",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/octet-stream",
        },
      },
      resolve,
    );
    request.on("error", (error) => {
      if (error.code !== "ECONNRESET") reject(error);
    });
    request.write("still uploading");
  });
  assert.equal(response.statusCode, 408);
  response.resume();
  assert.equal(instance.calls(), 0);
  const after = await upload(instance.url);
  assert.equal(after.status, 200);
});

test("only one scan runs, operation timeout fails closed and slot remains bounded", async (t) => {
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  let began;
  const started = new Promise((resolve) => {
    began = resolve;
  });
  const instance = await start(t, {
    operationTimeoutMs: 60,
    scanner: {
      version: async () => version(),
      scan: async () => {
        began();
        await waiting;
        return { clean: true, version: version() };
      },
    },
  });
  const first = upload(instance.url);
  await started;
  const concurrent = await upload(instance.url);
  assert.equal(concurrent.status, 503);
  assert.deepEqual(await concurrent.json(), { error: "scanner_busy" });
  assert.equal((await first).status, 503);
  const timedOutButStillRunning = await upload(instance.url);
  assert.deepEqual(await timedOutButStillRunning.json(), {
    error: "scanner_busy",
  });
  release();
});

test("scanner errors and stale/malformed verdicts stay closed without upstream details", async (t) => {
  for (const result of [
    new Error(`sensitive internal error ${token}`),
    { clean: "true", version: version() },
    { clean: true, version: "ClamAV 1.4.3/1/1 Jan 2000" },
  ]) {
    const instance = await start(t, {
      scanner: {
        version: async () => version(),
        scan: async () => {
          if (result instanceof Error) throw result;
          return result;
        },
      },
    });
    const response = await upload(instance.url);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: "scanner_unavailable" });
  }
});

test("request-rate bound stops additional authenticated scans", async (t) => {
  const instance = await start(t, { maxRequestsPerWindow: 1 });
  assert.equal((await upload(instance.url)).status, 200);
  const limited = await upload(instance.url);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.equal(instance.calls(), 1);
});

test("token configuration requires one long secret source", () => {
  for (const environment of [
    {},
    { PORTAL_SCANNER_TOKEN: "short" },
    { PORTAL_SCANNER_TOKEN: "a b".repeat(32) },
    { PORTAL_SCANNER_TOKEN: token, PORTAL_SCANNER_TOKEN_FILE: "/unused" },
  ])
    assert.throws(() => readToken(environment), /scanner_token_configuration/);
  assert.equal(readToken({ PORTAL_SCANNER_TOKEN: token }), token);
});

// Simulate local VERSION/INSTREAM framing to observe partial frames, replies and connection failures.
async function fakeClamd(
  t,
  { reply = "stream: OK\0", signature = version(), silent = false } = {},
) {
  const streams = [];
  const sockets = new Set();
  const server = createTcpServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    let buffer = Buffer.alloc(0);
    let command;
    const chunks = [];
    socket.on("data", (bytes) => {
      buffer = Buffer.concat([buffer, bytes]);
      if (!command) {
        const end = buffer.indexOf(0);
        if (end < 0) return;
        command = buffer.subarray(0, end).toString();
        buffer = buffer.subarray(end + 1);
        if (command === "zVERSION") {
          if (!silent) socket.end(signature + "\0");
          return;
        }
        assert.equal(command, "zINSTREAM");
      }
      if (command !== "zINSTREAM") return;
      while (buffer.length >= 4) {
        const size = buffer.readUInt32BE(0);
        if (buffer.length < 4 + size) return;
        const chunk = buffer.subarray(4, 4 + size);
        buffer = buffer.subarray(4 + size);
        if (size === 0) {
          streams.push(Buffer.concat(chunks));
          socket.end(reply);
          return;
        }
        chunks.push(chunk);
      }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  return { host: "127.0.0.1", port: server.address().port, streams, signature };
}

test("real TCP VERSION/INSTREAM frames preserve all bytes across chunk boundaries", async (t) => {
  const fake = await fakeClamd(t);
  const scanner = createClamavScanner(fake);
  const bytes = Buffer.alloc(150001);
  for (let index = 0; index < bytes.length; index++) bytes[index] = index % 256;
  const result = await scanner.scan(bytes);
  assert.equal(result.clean, true);
  assert.equal(result.version, fake.signature);
  assert.deepEqual(fake.streams, [bytes]);
});

test("real TCP malware verdict is blocked and protocol/limit errors never pass", async (t) => {
  const malware = await fakeClamd(t, {
    reply: "stream: Eicar-Signature FOUND\0",
  });
  assert.equal(
    (await createClamavScanner(malware).scan(Buffer.from("test"))).clean,
    false,
  );
  for (const reply of [
    "stream: INSTREAM size limit exceeded. ERROR\0",
    "OK\0",
    "stream: OK \0",
    "stream: OK\0unexpected",
    "stream: OK", // Truncated, missing protocol terminator.
  ]) {
    const fake = await fakeClamd(t, { reply });
    await assert.rejects(createClamavScanner(fake).scan(Buffer.from("test")));
  }
});

test("real TCP stale/future definitions and silent peers fail before scanning", async (t) => {
  for (const signature of [
    "ClamAV 1.4.3/1/1 Jan 2000",
    `ClamAV 1.4.3/1/${new Date(Date.now() + 2 * 86400000).toUTCString()}`,
    "unrecognised scanner",
  ]) {
    const fake = await fakeClamd(t, { signature });
    await assert.rejects(createClamavScanner(fake).scan(Buffer.from("test")));
    assert.deepEqual(fake.streams, []);
  }
  const silent = await fakeClamd(t, { silent: true });
  await assert.rejects(
    createClamavScanner({ ...silent, versionTimeoutMs: 30 }).scan(
      Buffer.from("test"),
    ),
  );
  assert.deepEqual(silent.streams, []);
});
