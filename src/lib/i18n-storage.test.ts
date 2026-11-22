/**
 * Regressions for language initialization when preference storage is missing or blocked. Storage
 * fixtures do not establish Auth persistence.
 */
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.doUnmock("./installation-brand");
  vi.resetModules();
  localStorage.clear();
});

it.each([true, false])(
  "keeps account identifier labels consistent across edition namespaces (internal=%s)",
  async (internal) => {
    vi.doMock("./installation-brand", async (load) => ({
      ...(await load<typeof import("./installation-brand")>()),
      portalInternalEdition: internal,
    }));
    const { default: i18n } = await import("./i18n");
    await import("../features/accounts/i18n");
    await import("../features/people/i18n");
    await import("../features/operations/i18n");
    const rows = [
      ["translation", "luminoviaUserId"],
      ["accounts", "userId"],
      ["people", "publicId"],
      ["operations", "participantUserId"],
    ];
    for (const [ns, key] of rows) {
      expect(i18n.t(key, { lng: "de", ns })).toBe(
        internal ? "Luminovia User ID" : "Benutzer-ID",
      );
      expect(i18n.t(key, { lng: "en", ns })).toBe(
        internal ? "Luminovia User ID" : "User ID",
      );
    }
  },
);

it("initialises the interface when browser preference storage is blocked", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Storage blocked", "SecurityError");
  });
  const loaded = Promise.resolve().then(() => import("./i18n"));
  await expect(loaded).resolves.toBeDefined();
  const { default: i18n } = await loaded;
  expect(i18n.language).toBe("de");
  expect(document.documentElement.lang).toBe("de");
});

it("changes language and document semantics even when preference writes fail", async () => {
  const { default: i18n } = await import("./i18n");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Storage full", "QuotaExceededError");
  });
  await expect(
    Promise.resolve().then(() => i18n.changeLanguage("en")),
  ).resolves.toBeDefined();
  expect(i18n.t("login")).toBe("Sign in");
  expect(document.documentElement.lang).toBe("en");
});
