import { describe, expect, it } from "vitest";
import { privateMeetingHref } from "./personal-details";
describe("private meeting links", () => {
  it.each([
    "https://meet.example.invalid/room?x=1",
    "https://meet.example.invalid:8443/#ok",
  ])("accepts a safe HTTPS destination %s", (url) => {
    expect(privateMeetingHref(url)).toBe(url);
  });
  it.each([
    "",
    "http://example.invalid",
    "javascript:alert(1)",
    "https://user:pass@example.invalid",
    "https://example.invalid:99999",
    "https://example.invalid:0",
    "https://example.invalid/has space",
    "https://example.invalid/has\\slash",
  ])("rejects unsafe or malformed destination %s", (url) => {
    expect(privateMeetingHref(url)).toBeNull();
  });
});
