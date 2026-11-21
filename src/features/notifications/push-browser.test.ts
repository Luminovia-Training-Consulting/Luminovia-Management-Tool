import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  currentPushToken,
  pushCapability,
  pushSupported,
} from "./push-browser";

beforeEach(() => {
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", {
    userAgent: "Desktop Chromium",
    maxTouchPoints: 0,
    serviceWorker: {},
  });
  vi.stubGlobal("Notification", { permission: "default" });
  vi.stubGlobal("PushManager", class {});
  vi.stubGlobal("indexedDB", {});
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => vi.unstubAllGlobals());
it("offers supported desktop push only after explicit consent", () => {
  expect(pushSupported()).toBe(true);
  expect(pushCapability()).toBe("ready");
});
it("explains iPhone home-screen installation before unsupported fallback", () => {
  vi.stubGlobal("navigator", { userAgent: "iPhone", maxTouchPoints: 5 });
  expect(pushCapability()).toBe("install");
});
it("recognizes installed iPadOS PWA using desktop user-agent", () => {
  vi.stubGlobal("navigator", {
    userAgent: "Macintosh",
    maxTouchPoints: 5,
    serviceWorker: {},
    standalone: true,
  });
  expect(pushCapability()).toBe("ready");
});
it("supports Android browser and installed desktop PWA capabilities", () => {
  vi.stubGlobal("navigator", {
    userAgent: "Android Chrome",
    maxTouchPoints: 5,
    serviceWorker: {},
  });
  expect(pushCapability()).toBe("ready");
  vi.stubGlobal("matchMedia", () => ({ matches: true }));
  expect(pushCapability()).toBe("ready");
});
it("explains denied permission and refuses insecure unsupported contexts", () => {
  vi.stubGlobal("Notification", { permission: "denied" });
  expect(pushCapability()).toBe("blocked");
  vi.stubGlobal("isSecureContext", false);
  expect(pushCapability()).toBe("unsupported");
});
it("does not treat a stored binding as a surviving native subscription", async () => {
  const getSubscription = vi.fn().mockResolvedValue(null);
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration: async () => ({ pushManager: { getSubscription } }),
    },
  });
  vi.stubGlobal("indexedDB", {
    open: () => {
      const open: { result?: unknown; onsuccess?: () => void } = {};
      queueMicrotask(() => {
        open.result = {
          close: () => {},
          transaction: () => {
            const transaction: {
              oncomplete?: () => void;
              objectStore?: () => unknown;
            } = {};
            transaction.objectStore = () => ({
              get: () => {
                const request: { result?: unknown; onsuccess?: () => void } =
                  {};
                queueMicrotask(() => {
                  request.result = { actor: "owner", token: "old-token" };
                  request.onsuccess?.();
                  transaction.oncomplete?.();
                });
                return request;
              },
            });
            return transaction;
          },
        };
        open.onsuccess?.();
      });
      return open;
    },
  });
  expect(await currentPushToken("owner")).toBeNull();
  getSubscription.mockResolvedValue({
    endpoint: "https://fcm.googleapis.com/existing",
  });
  expect(await currentPushToken("owner")).toBe("old-token");
});
