import { assertEquals, assertMatch } from "jsr:@std/assert@1.0.15";
import {
  createHumanRecoveryHandler,
  type RecoveryDependencies,
} from "./handler.ts";

const origin = "https://portal.example.invalid";
const challenge = "A".repeat(43);
const body = {
  username: "course.lead",
  code_challenge: challenge,
  code_challenge_method: "s256",
  redirect_to: `${origin}/auth/callback`,
};
function request(value: unknown = body, from = origin) {
  return new Request("https://backend.example.invalid/human-recovery", {
    method: "POST",
    headers: {
      Origin: from,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(value),
  });
}
function deps(
  overrides: Partial<RecoveryDependencies> = {},
): RecoveryDependencies {
  return {
    waitUntil: () => undefined,
    reserve: async () => true,
    resolveUsername: async () => "lead@example.invalid",
    sendRecovery: async () => {},
    ...overrides,
  };
}

Deno.test("verified alias forwards the unchanged SDK challenge to native Auth", async () => {
  const sent: unknown[] = [];
  let reserved = "";
  const settled: Promise<void>[] = [];
  const handler = createHumanRecoveryHandler(
    deps({
      waitUntil: (task) => settled.push(task),
      reserve: async (hash) => {
        reserved = hash;
        return true;
      },
      sendRecovery: async (...args) => {
        sent.push(args);
      },
    }),
    [origin],
  );
  const response = await handler(request());
  assertEquals(response.status, 202);
  assertEquals(await response.json(), {});
  await Promise.all(settled);
  assertEquals(sent, [[
    "lead@example.invalid",
    challenge,
    `${origin}/auth/callback`,
  ]]);
  assertMatch(reserved, /^[a-f0-9]{64}$/);
  const ordinary = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("course.lead"),
  );
  const ordinaryHash = [...new Uint8Array(ordinary)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  assertEquals(reserved === ordinaryHash, false);
});
Deno.test("unknown, throttled and failed mail share one public response", async () => {
  const outcomes = await Promise.all([
    createHumanRecoveryHandler(deps({ resolveUsername: async () => null }), [
      origin,
    ])(request()),
    createHumanRecoveryHandler(deps({ reserve: async () => false }), [origin])(
      request(),
    ),
    createHumanRecoveryHandler(
      deps({
        sendRecovery: async () => {
          throw Error("mail");
        },
      }),
      [origin],
    )(request()),
  ]);
  for (const response of outcomes) {
    assertEquals(response.status, 202);
    assertEquals(await response.json(), {});
  }
});
Deno.test("origin, exact redirect and PKCE method are enforced before alias lookup", async () => {
  let called = 0;
  const handler = createHumanRecoveryHandler(
    deps({
      reserve: async () => {
        called++;
        return true;
      },
    }),
    [origin],
  );
  assertEquals(
    (await handler(request(body, "https://evil.example.invalid"))).status,
    403,
  );
  assertEquals(
    (await handler(
      request({ ...body, redirect_to: `${origin}/auth/callback?next=evil` }),
    )).status,
    400,
  );
  assertEquals(
    (await handler(request({ ...body, code_challenge_method: "plain" })))
      .status,
    400,
  );
  assertEquals(
    (await handler(request({ ...body, username: "lead@example.invalid" })))
      .status,
    400,
  );
  assertEquals(
    (await handler(request({ ...body, username: "ü".repeat(600) }))).status,
    400,
  );
  assertEquals(called, 0);
});

Deno.test("public response never waits for the existence or delivery decision", async () => {
  let release!: (value: string | null) => void;
  const settled: Promise<void>[] = [];
  const handler = createHumanRecoveryHandler(
    deps({
      resolveUsername: () =>
        new Promise((resolve) => {
          release = resolve;
        }),
      waitUntil: (task) => settled.push(task),
    }),
    [origin],
  );
  const response = await handler(request());
  assertEquals(response.status, 202);
  assertEquals(settled.length, 1);
  for (let index = 0; !release && index < 10; index++) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  release(null);
  await Promise.all(settled);
});
