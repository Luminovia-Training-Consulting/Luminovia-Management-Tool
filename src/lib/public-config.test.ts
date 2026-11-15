import { describe, expect, it } from "vitest";
import { validatePublicConfig } from "../../scripts/public-config";
const jwt = (role: string) =>
  `header.${btoa(JSON.stringify({ role })).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_")}.signature`;
describe("browser configuration boundary", () => {
  it("permits public keys and loopback anon keys", () => {
    expect(() =>
      validatePublicConfig(
        "https://test.supabase.co",
        "sb_publishable_example",
      ),
    ).not.toThrow();
    expect(() =>
      validatePublicConfig("http://127.0.0.1:54321", jwt("anon")),
    ).not.toThrow();
  });
  it("rejects modern and legacy service keys without including them in errors", () => {
    for (const key of ["sb_secret_unique_private_value", jwt("service_role")]) {
      expect(() =>
        validatePublicConfig("https://test.supabase.co", key),
      ).toThrow("Server keys are forbidden");
      try {
        validatePublicConfig("https://test.supabase.co", key);
      } catch (error) {
        expect(String(error)).not.toContain(key);
      }
    }
  });
  it("requires TLS for managed environments and complete release configuration", () => {
    expect(() =>
      validatePublicConfig("http://test.supabase.co", "sb_publishable_example"),
    ).toThrow("HTTPS");
    expect(() => validatePublicConfig(undefined, undefined, true)).toThrow(
      "required",
    );
    expect(() => validatePublicConfig(undefined, undefined)).not.toThrow();
  });
});
