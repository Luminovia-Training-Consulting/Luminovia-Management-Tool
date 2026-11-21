import { assertEquals } from "jsr:@std/assert@1.0.15";
import { createCompanyIntegrationHandler } from "./handler.ts";

Deno.test(
  "scoped operations validate inputs before dispatch and keep explicit receipts",
  async () => {
    const id = "9c0c48a1-8bde-41d4-835a-f66a4cfbe378";
    const participant = "LV-1111-2222-3333-4444-5555";
    const base =
      "https://academy.example.invalid/functions/v1/company-integration";
    const headers = {
      Authorization: "Bearer lvi_" + id + "_" + "a".repeat(64),
      "Content-Type": "application/json",
    };
    let calls = 0;
    const handle = createCompanyIntegrationHandler(
      () => Promise.reject(new Error("Index should not run")),
      async (input) => {
        calls++;
        assertEquals(input.p_id, id);
        assertEquals(input.p_course_id, id);
        if (input.p_action === "report") {
          assertEquals(input.p_participant_id, null);
          return {
            status: "ok",
            course_id: id,
            session_count: 3,
            enrolled_count: 5,
            completed_count: 2,
          };
        }
        assertEquals(input.p_participant_id, participant);
        return { status: "ok", course_id: id, participant_id: participant };
      },
    );
    const duplicated = await handle(
      new Request(
        base + "/participation?course_id=" + id + "&course_id=" + id,
        { headers },
      ),
    );
    assertEquals(duplicated.status, 400);
    const extra = await handle(
      new Request(base + "/enrolments", {
        method: "POST",
        headers,
        body: JSON.stringify({
          course_id: id,
          participant_id: participant,
          status: "completed",
        }),
      }),
    );
    assertEquals(extra.status, 400);
    assertEquals(calls, 0);
    const report = await handle(
      new Request(base + "/participation?course_id=" + id, { headers }),
    );
    assertEquals(await report.json(), {
      course_id: id,
      session_count: 3,
      enrolled_count: 5,
      completed_count: 2,
    });
    const enrol = await handle(
      new Request(base + "/enrolments", {
        method: "POST",
        headers,
        body: JSON.stringify({ course_id: id, participant_id: participant }),
      }),
    );
    assertEquals(await enrol.json(), {
      course_id: id,
      participant_id: participant,
      status: "enrolled",
    });
    assertEquals(enrol.headers.get("cache-control"), "no-store");
  },
);

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
