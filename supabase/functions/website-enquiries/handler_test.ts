/** Edge request-boundary regressions with a controlled RPC double and no real mail/site writes. */
import assert from "node:assert/strict";
import { z } from "npm:zod@4.6.7";
import { createWebsiteEnquiryHandler } from "./handler.ts";
const submission = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const token = "fictional-isolated-integration-token-for-tests-only";
const payload = {
  submission_id: submission,
  company_name: "Fictional Academy",
  contact_name: "Fictional Contact",
  email: "contact@example.invalid",
  phone: "",
  topic: "Fictional Linux training",
  message: "A fictional request, without real customer data.",
  preferred_dates: "Next fictional month",
  duration: "2 days",
  delivery_type: "online",
  time_zone: "Europe/Berlin",
  locale: "en",
  privacy_notice_version: "fictional-privacy-v1",
  consent: true,
  website: "",
};
/** Track whether invalid requests reached persistence; credentials here are fictional only. */
function fixture(overrides = {}) {
  const calls: unknown[] = [];
  const handler = createWebsiteEnquiryHandler(
    {
      enabled: true,
      integrationToken: token,
      websiteOrigin: "https://website.example.invalid",
      privacyNoticeVersion: "fictional-privacy-v1",
      ...overrides,
    },
    {
      receive: async (...args) => {
        calls.push(args);
        return { data: id, error: null };
      },
    },
  );
  const request = (
    body: unknown = payload,
    headers: Record<string, string> = {},
    method = "POST",
  ) =>
    new Request("http://127.0.0.1/functions/v1/website-enquiries", {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Luminovia-Integration-Token": token,
        ...headers,
      },
      body: method === "POST" ? JSON.stringify(body) : undefined,
    });
  return { handler, request, calls };
}
Deno.test(
  "Integration is disabled by default and missing/weak configuration cannot reach the database",
  async () => {
    for (const config of [
      { enabled: false },
      { integrationToken: "" },
      { integrationToken: "weak" },
      { websiteOrigin: "*" },
      { websiteOrigin: "https://website.example.invalid/path" },
      { privacyNoticeVersion: "" },
    ]) {
      const f = fixture(config);
      assert.equal((await f.handler(f.request())).status, 503);
      assert.equal(f.calls.length, 0);
    }
  },
);
Deno.test(
  "Public key, forged Origin and spoofed IP headers do not replace the integration credential",
  async () => {
    const f = fixture();
    assert.equal(
      (
        await f.handler(
          f.request(payload, {
            "X-Luminovia-Integration-Token": "",
            Origin: "https://website.example.invalid",
            "X-Forwarded-For": "127.0.0.1",
          }),
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await f.handler(
          f.request(payload, { Origin: "https://attacker.example.invalid" }),
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.handler(
          f.request(payload, { "X-Luminovia-Integration-Token": token + "x" }),
        )
      ).status,
      401,
    );
    assert.equal(f.calls.length, 0);
  },
);
Deno.test(
  "Valid S2S request receives its own receipt with no internal customer data or CORS grant",
  async () => {
    const f = fixture();
    const response = await f.handler(f.request());
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {
      received: true,
      receipt: submission,
    });
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.match(response.headers.get("cache-control")!, /no-store/);
    assert.equal(f.calls.length, 1);
    assert.equal(JSON.stringify(f.calls).includes(token), false);
  },
);
Deno.test(
  "Malformed data, unknown properties, honeypot, absent consent and invalid time zones reject",
  async () => {
    for (const body of [
      { ...payload, company_name: "" },
      { ...payload, email: "x\r\nBcc: a@b.invalid" },
      { ...payload, email: 'bad"@example.invalid' },
      { ...payload, email: "first..last@example.invalid" },
      { ...payload, email: ".first@example.invalid" },
      { ...payload, consent: false },
      { ...payload, privacy_notice_version: "unreviewed-notice" },
      { ...payload, time_zone: "not/a-zone" },
      { ...payload, website: "spam" },
      { ...payload, role: "admin" },
      { ...payload, message: [] },
      [],
    ]) {
      const f = fixture();
      assert.equal((await f.handler(f.request(body))).status, 400);
      assert.equal(f.calls.length, 0);
    }
  },
);
Deno.test(
  "Acknowledged email addresses satisfy the exact installed frontend consumer validator",
  async () => {
    for (const email of [
      "first.last+training@example.invalid",
      "o'brien@example.invalid",
      "member_name-2@example.invalid",
      "CAPITAL@EXAMPLE.INVALID",
    ]) {
      const f = fixture();
      assert.equal(
        (await f.handler(f.request({ ...payload, email }))).status,
        202,
      );
      const recorded = (
        f.calls[0] as [unknown, unknown, Record<string, unknown>]
      )[2];
      assert.equal(z.email().safeParse(recorded.email).success, true);
    }
  },
);
Deno.test(
  "Bounded streaming size, invalid JSON, content type and read methods fail before delivery",
  async () => {
    const f = fixture();
    assert.equal((await f.handler(f.request(payload, {}, "GET"))).status, 405);
    assert.equal(
      (await f.handler(f.request(payload, {}, "OPTIONS"))).status,
      405,
    );
    assert.equal(
      (await f.handler(f.request(payload, { "Content-Type": "text/plain" })))
        .status,
      415,
    );
    assert.equal(
      (await f.handler(f.request({ ...payload, message: "x".repeat(25000) })))
        .status,
      413,
    );
    assert.equal(
      (
        await f.handler(
          new Request("http://127.0.0.1", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Luminovia-Integration-Token": token,
            },
            body: "{",
          }),
        )
      ).status,
      400,
    );
    assert.equal(f.calls.length, 0);
  },
);
Deno.test(
  "Rate limits, changed retries and database errors return safe failures without details",
  async () => {
    for (const [error, status] of [
      [{ code: "54000" }, 429],
      [{ code: "22023", message: "Website enquiry retry conflict" }, 409],
      [{ code: "22023", message: "private details" }, 400],
      [{ code: "XX000", message: "server secret" }, 503],
    ] as const) {
      const f = fixture();
      const handler = createWebsiteEnquiryHandler(
        {
          enabled: true,
          integrationToken: token,
          websiteOrigin: "https://website.example.invalid",
          privacyNoticeVersion: "fictional-privacy-v1",
        },
        { receive: async () => ({ data: null, error }) },
      );
      const response = await handler(f.request());
      assert.equal(response.status, status);
      assert.equal((await response.text()).includes("secret"), false);
    }
  },
);
Deno.test(
  "Receipt waits for actual database acknowledgement and thrown transport errors do not look successful",
  async () => {
    const f = fixture();
    let finish!: (value: { data: string; error: null }) => void;
    const pending = new Promise<{ data: string; error: null }>((resolve) => {
      finish = resolve;
    });
    let delivered = false;
    const handler = createWebsiteEnquiryHandler(
      {
        enabled: true,
        integrationToken: token,
        websiteOrigin: "https://website.example.invalid",
        privacyNoticeVersion: "fictional-privacy-v1",
      },
      { receive: () => pending },
    );
    const response = handler(f.request()).then((result) => {
      delivered = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(delivered, false);
    finish({ data: id, error: null });
    assert.equal((await response).status, 202);
    const failed = createWebsiteEnquiryHandler(
      {
        enabled: true,
        integrationToken: token,
        websiteOrigin: "https://website.example.invalid",
        privacyNoticeVersion: "fictional-privacy-v1",
      },
      {
        receive: async () => {
          throw Error("private network detail");
        },
      },
    );
    assert.equal((await failed(f.request())).status, 503);
  },
);
