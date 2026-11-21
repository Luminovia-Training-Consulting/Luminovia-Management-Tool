import { assertEquals } from "jsr:@std/assert@1.0.15";
import { createCompanyIntegrationHandler } from "./handler.ts";

const secret = "f".repeat(64);
const id = "00000000-0000-4000-8000-000000000001";
const base = "http://localhost/functions/v1/company-integration";
const auth = { authorization: `Bearer lvi_${id}_${secret}` };

Deno.test("company integration validates query and forwards only the digest", async () => {
  const handler = createCompanyIntegrationHandler((input) => {
    assertEquals(input, {
      p_id: id,
      p_secret_hash:
        "df0790f236013511e91fa4532fb7761f62320a51a3868dabf4a13fe5f53e3263",
      p_limit: 50,
      p_after: id,
    });
    return Promise.resolve({ status: "ok", items: [], next_cursor: null });
  });
  const response = await handler(
    new Request(`${base}?limit=50&after=${id}`, { headers: auth }),
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(await response.json(), { items: [], next_cursor: null });
});

Deno.test("company integration rejects alternate endpoints, browser requests and malformed credentials", async () => {
  const handler = createCompanyIntegrationHandler(() => {
    throw new Error("must not dispatch");
  });
  assertEquals(
    (await handler(new Request(base + "/other", { headers: auth }))).status,
    404,
  );
  assertEquals(
    (await handler(new Request(base, { method: "POST", headers: auth })))
      .status,
    405,
  );
  assertEquals(
    (await handler(
      new Request(base, {
        headers: { ...auth, origin: "https://example.invalid" },
      }),
    )).status,
    403,
  );
  assertEquals(
    (await handler(
      new Request(base, {
        headers: { authorization: "Bearer fictional-native-jwt" },
      }),
    )).status,
    401,
  );
  for (
    const query of [
      "limit=00",
      "limit=51",
      "limit=1&limit=2",
      "after=bad",
      "organisation=invalid",
    ]
  ) {
    assertEquals(
      (await handler(new Request(`${base}?${query}`, { headers: auth })))
        .status,
      400,
    );
  }
});

Deno.test("company integration maps expiry, throttling and outages without storing credentials", async () => {
  for (const status of ["denied", "rate_limited", "outage"] as const) {
    const handler = createCompanyIntegrationHandler(() => {
      if (status === "outage") throw new Error(secret);
      return Promise.resolve({ status });
    });
    const response = await handler(new Request(base, { headers: auth }));
    assertEquals(
      response.status,
      { denied: 401, rate_limited: 429, outage: 503 }[status],
    );
    assertEquals(
      response.headers.get("retry-after"),
      status === "rate_limited" ? "60" : null,
    );
    assertEquals((await response.text()).includes(secret), false);
  }
});
