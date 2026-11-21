/**
 * Regressions for public build configuration and rejection of private/misclassified keys. Pure
 * configuration checks do not replace native Auth/RLS acceptance.
 */
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
  it("rejects malformed and credential-bearing endpoints without exposing credentials", () => {
    expect(() =>
      validatePublicConfig("not an absolute URL", "sb_publishable_fictional"),
    ).toThrow("absolute");
    const endpoint =
      "https://fictional-user:fictional-password@example.invalid/backend";
    try {
      validatePublicConfig(endpoint, "sb_publishable_fictional");
      expect.fail(
        "Credential-bearing endpoints must fail before building the client.",
      );
    } catch (error) {
      expect(String(error)).toContain("must not contain credentials");
      expect(String(error)).not.toContain("fictional-password");
      expect(String(error)).not.toContain(endpoint);
    }
  });
  it.each(["http://localhost:54321", "http://[::1]:54321"])(
    "permits explicit loopback development at %s",
    (endpoint) => {
      expect(() =>
        validatePublicConfig(endpoint, jwt("anon"), true),
      ).not.toThrow();
    },
  );
  it.each([
    "opaque-fictional-key",
    "header.not-base64.signature",
    jwt("authenticated"),
  ])(
    "rejects malformed or non-anonymous legacy keys without leaking their bytes",
    (key) => {
      try {
        validatePublicConfig("https://example.invalid", key);
        expect.fail("Only public browser credentials are accepted.");
      } catch (error) {
        expect(String(error)).toContain("Only a publishable or legacy anon");
        expect(String(error)).not.toContain(key);
      }
    },
  );
});
