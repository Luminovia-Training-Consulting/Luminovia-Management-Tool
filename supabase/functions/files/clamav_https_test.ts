/**
 * Injizierte HTTPS-Scannerantworten prüfen Fristen, Redirectverbot, Größen und Signaturalter. Testwerte enthalten keine echten Gatewaygeheimnisse; Timeoutfälle behalten die reale Abbruchlogik.
 */
import { type HttpsScannerConfig, scan } from "./clamav.ts";

const bytes = new TextEncoder().encode("Fictional scan input");
const config = {
  url: "https://scanner.example.invalid/scan",
  token: "test_".padEnd(64, "a"),
};
// Erzeugt einen zur Testlaufzeit frischen fiktiven ClamAV-Signaturzeitstempel.
const freshVersion = () => "ClamAV 1.4.3/12345/" + new Date().toUTCString();
// Erzeugt die kontrollierte JSON-Scannerantwort für die folgenden Protokollfälle.
const response = (value: unknown) => Response.json(value);
// Lässt eine konkrete Fixturebedingung als echten Testfehler scheitern; es gibt keinen stillen Erfolgsersatz.
function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
// Verlangt die tatsächliche Ablehnung des übergebenen Vorgangs und prüft gegebenenfalls den stabilen Fehlergrund.
async function rejects(work: () => Promise<unknown>, expected?: string) {
  try {
    await work();
  } catch (error) {
    assert(error instanceof Error);
    if (expected) {
      assert(error.message === expected, "unexpected rejection category");
    }
    assert(!error.message.includes(config.token), "secret leaked");
    assert(!error.message.includes("Fictional scan input"), "payload leaked");
    return;
  }
  throw new Error("expected rejection");
}
// Injiziert ausschließlich die vorgegebene Scannerantwort und behält die echte Adaptervalidierung bei.
const fetchWith = (value: Response) =>
  (() => Promise.resolve(value)) as typeof fetch;

Deno.test("private TCP scanning also rejects empty or over-limit bytes before any connection", async () => {
  for (const body of [new Uint8Array(), new Uint8Array(100 * 1024 * 1024 + 1)]) {
    await rejects(() => scan(body, "must-not-connect.invalid"), "scanner_size");
  }
});

Deno.test("HTTPS scanner sends authenticated raw bytes without redirect or ambient credentials and preserves both verdicts", async () => {
  for (const clean of [true, false]) {
    const version = freshVersion();
    let calls = 0;
    const fetcher: typeof fetch = async (input, init) => {
      calls++;
      assert(String(input) === config.url);
      assert(init?.method === "POST");
      assert(init.redirect === "error");
      assert(init.credentials === "omit");
      assert(init.cache === "no-store");
      assert(init.referrerPolicy === "no-referrer");
      assert(init.signal instanceof AbortSignal);
      const headers = new Headers(init.headers);
      assert(headers.get("authorization") === "Bearer " + config.token);
      assert(headers.get("content-type") === "application/octet-stream");
      const sent = new Uint8Array(await new Response(init.body).arrayBuffer());
      assert(
        sent.length === bytes.length &&
          sent.every((byte, i) => byte === bytes[i]),
      );
      return response({ clean, version });
    };
    const verdict = await scan(
      bytes,
      "must-not-connect.invalid",
      3310,
      config,
      { fetcher },
    );
    assert(
      verdict.clean === clean && verdict.version === version && calls === 1,
    );
  }
});

Deno.test("any partial, empty, insecure or ambiguous HTTPS configuration fails closed before network", async () => {
  const invalid: HttpsScannerConfig[] = [
    { url: config.url },
    { token: config.token },
    { url: "" },
    { token: "" },
    { ...config, url: "http://scanner.example.invalid/scan" },
    { ...config, url: "https://user:password@scanner.example.invalid/scan" },
    { ...config, url: config.url + "?token=secret" },
    { ...config, url: config.url + "#fragment" },
    { ...config, url: config.url + "/" },
    { ...config, url: "https://scanner.example.invalid/other" },
    { ...config, url: " " + config.url },
    { ...config, token: "short" },
    { ...config, token: config.token + "\n" },
    { ...config, token: "a".repeat(129) },
    { ...config, token: "b".repeat(42) },
  ];
  let called = false;
  const fetcher: typeof fetch = () => {
    called = true;
    throw new Error("unexpected fetch");
  };
  for (const invalidConfig of invalid) {
    await rejects(
      () =>
        scan(bytes, "must-not-connect.invalid", 3310, invalidConfig, {
          fetcher,
        }),
      "scanner_https_configuration",
    );
  }
  assert(!called);
});

Deno.test("HTTPS request rejects empty and oversized input before sending but accepts the exact one hundred MiB limit", async () => {
  let calls = 0;
  const fetcher: typeof fetch = () => {
    calls++;
    return Promise.resolve(response({ clean: true, version: freshVersion() }));
  };
  for (const body of [new Uint8Array(), new Uint8Array(100 * 1024 * 1024 + 1)]) {
    await rejects(
      () => scan(body, "", 3310, config, { fetcher }),
      "scanner_size",
    );
  }
  assert(calls === 0);
  assert(
    (await scan(new Uint8Array(100 * 1024 * 1024), "", 3310, config, {
      fetcher,
    })).clean,
  );
  assert(Number(calls) === 1);
});

Deno.test("HTTPS never accepts redirects, non-success statuses or non-JSON responses", async () => {
  const rejected = [
    new Response(null, {
      status: 302,
      headers: { location: "https://other.invalid/scan" },
    }),
    response({ error: "unauthorized" }),
    new Response("unavailable", { status: 503 }),
    new Response(JSON.stringify({ clean: true, version: freshVersion() }), {
      headers: { "content-type": "text/plain" },
    }),
    new Response(null, { status: 204 }),
  ];
  for (const result of rejected) {
    await rejects(
      () => scan(bytes, "", 3310, config, { fetcher: fetchWith(result) }),
      "scanner_unavailable",
    );
  }
});

Deno.test("HTTPS verdict validates boolean, ClamAV protocol and fresh signature timestamp", async () => {
  for (
    const value of [
      null,
      [],
      "clean",
      { clean: "true", version: freshVersion() },
      { clean: true },
      { clean: true, version: "DifferentScanner/current" },
      { clean: true, version: "ClamAV missing-date" },
      {
        clean: true,
        version: "ClamAV 1.4.3/12345/" +
          new Date(Date.now() - 15 * 86400000).toUTCString(),
      },
      {
        clean: true,
        version: "ClamAV 1.4.3/12345/" +
          new Date(Date.now() + 2 * 86400000).toUTCString(),
      },
      { clean: true, version: freshVersion() + "\n" },
    ]
  ) {
    await rejects(
      () =>
        scan(bytes, "", 3310, config, { fetcher: fetchWith(response(value)) }),
      "scanner_unavailable",
    );
  }
  for (
    const malformed of ["not json", '{"clean":true', new Uint8Array([0xff])]
  ) {
    await rejects(() =>
      scan(bytes, "", 3310, config, {
        fetcher: fetchWith(
          new Response(malformed, {
            headers: { "content-type": "application/json" },
          }),
        ),
      }), "scanner_unavailable");
  }
});

Deno.test("HTTPS response cap rejects both declared and streamed oversize responses", async () => {
  const declared = new Response("{}", {
    headers: { "content-type": "application/json", "content-length": "4097" },
  });
  await rejects(
    () => scan(bytes, "", 3310, config, { fetcher: fetchWith(declared) }),
    "scanner_unavailable",
  );
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(4097));
    },
    cancel() {
      cancelled = true;
    },
  });
  const streamed = new Response(stream, {
    headers: { "content-type": "application/json" },
  });
  await rejects(
    () => scan(bytes, "", 3310, config, { fetcher: fetchWith(streamed) }),
    "scanner_unavailable",
  );
  assert(cancelled, "oversized response stream was not cancelled");
});

Deno.test("HTTPS whole-operation deadline covers waiting for headers and a stalled response body", async () => {
  let fetchAborted = false;
  const hangingFetch: typeof fetch = (_url, init) => {
    init?.signal?.addEventListener("abort", () => {
      fetchAborted = true;
    }, { once: true });
    return new Promise<Response>(() => {});
  };
  await rejects(
    () =>
      scan(bytes, "", 3310, config, { fetcher: hangingFetch, timeoutMs: 15 }),
    "scanner_unavailable",
  );
  assert(fetchAborted);
  let bodyCancelled = false;
  const body = new ReadableStream<Uint8Array>({
    cancel() {
      bodyCancelled = true;
    },
  });
  await rejects(() =>
    scan(bytes, "", 3310, config, {
      fetcher: fetchWith(
        new Response(body, { headers: { "content-type": "application/json" } }),
      ),
      timeoutMs: 15,
    }), "scanner_unavailable");
  assert(bodyCancelled);
});

Deno.test("HTTPS transport errors are redacted and never become clean or a TCP retry", async () => {
  const fetcher: typeof fetch = () => {
    throw new Error(config.url + " " + config.token + " Fictional scan input");
  };
  await rejects(
    () => scan(bytes, "must-not-connect.invalid", 3310, config, { fetcher }),
    "scanner_unavailable",
  );
});
