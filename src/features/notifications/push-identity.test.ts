// Real IndexedDB transactions prove that delayed old-account work cannot restore
// a binding or unsubscribe a newer login after the synchronous Auth boundary.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";

const owner = "11111111-1111-4111-8111-111111111111";
const peer = "22222222-2222-4222-8222-222222222222";
let browser: typeof import("./push-browser");
let unsubscribe = vi.fn();
beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("Notification", { permission: "granted" });
  vi.stubGlobal("PushManager", class {});
  unsubscribe = vi.fn().mockResolvedValue(true);
  vi.stubGlobal("navigator", {
    serviceWorker: {
      getRegistration: async () => ({
        pushManager: { getSubscription: async () => ({ unsubscribe }) },
        getNotifications: async () => [],
      }),
    },
  });
  browser = await import("./push-browser");
  await browser.synchronizePushActor(owner);
  unsubscribe.mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("rejects a delayed old binding write after a new actor has bound its own device", async () => {
  const original = indexedDB.open.bind(indexedDB);
  let release: () => void = () => {};
  let opened: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    opened = resolve;
  });
  const spy = vi
    .spyOn(indexedDB, "open")
    .mockImplementation((name, version) => {
      const request = original(name, version);
      return {
        get result() {
          return request.result;
        },
        set onupgradeneeded(
          handler: ((event: IDBVersionChangeEvent) => void) | null,
        ) {
          request.onupgradeneeded = handler;
        },
        set onerror(handler: ((event: Event) => void) | null) {
          request.onerror = handler;
        },
        set onsuccess(handler: ((event: Event) => void) | null) {
          request.onsuccess = (event) => {
            spy.mockRestore();
            release = () => handler?.(event);
            opened();
          };
        },
      } as unknown as IDBOpenDBRequest;
    });
  const oldWrite = browser.bindPushDevice(owner, "old-token");
  await held;
  await browser.synchronizePushActor(peer);
  await browser.bindPushDevice(peer, "new-token");
  release();
  await expect(oldWrite).rejects.toThrow("Push identity changed");
  expect(await browser.currentPushToken(peer)).toBe("new-token");
  expect(await browser.currentPushToken(owner)).toBeNull();
});

it("does not cancel a binding when Auth repeats the current actor", async () => {
  await Promise.all([
    browser.bindPushDevice(owner, "own-token"),
    browser.synchronizePushActor(owner),
  ]);
  expect(await browser.currentPushToken(owner)).toBe("own-token");
  expect(unsubscribe).not.toHaveBeenCalled();
});

it("does not interrupt explicit device removal when Auth refreshes the current actor", async () => {
  await browser.bindPushDevice(owner, "own-token");
  await Promise.all([
    browser.clearPushDevice(owner),
    browser.synchronizePushActor(owner),
  ]);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(await browser.currentPushToken(owner)).toBeNull();
});

it("retries cleanup for the same actor after a transient browser storage error", async () => {
  await browser.bindPushDevice(owner, "own-token");
  vi.spyOn(indexedDB, "open").mockImplementationOnce(() => {
    throw new Error("Browser storage temporarily unavailable");
  });
  await browser.synchronizePushActor(peer);
  expect(unsubscribe).not.toHaveBeenCalled();
  await browser.synchronizePushActor(peer);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(await browser.currentPushToken(owner)).toBeNull();
});

it("ignores stale current-device cleanup after switching accounts", async () => {
  await browser.synchronizePushActor(peer);
  await browser.bindPushDevice(peer, "new-token");
  unsubscribe.mockClear();
  await browser.clearPushDevice(owner);
  expect(unsubscribe).not.toHaveBeenCalled();
  expect(await browser.currentPushToken(peer)).toBe("new-token");
});

it.each(["default", "denied"])(
  "leaves native push untouched with %s permission and no binding",
  async (permission) => {
    vi.stubGlobal("Notification", { permission });
    const getRegistration = vi.spyOn(
      navigator.serviceWorker,
      "getRegistration",
    );
    await browser.synchronizePushActor(null);
    expect(getRegistration).not.toHaveBeenCalled();
    expect(unsubscribe).not.toHaveBeenCalled();
  },
);

it("clears a previous actor's native subscription when permission was revoked", async () => {
  await browser.bindPushDevice(owner, "own-token");
  vi.stubGlobal("Notification", { permission: "denied" });
  await browser.synchronizePushActor(peer);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(await browser.currentPushToken(owner)).toBeNull();
});

it("clears the current actor binding and native subscription on explicit removal", async () => {
  await browser.bindPushDevice(owner, "own-token");
  await browser.clearPushDevice(owner);
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(await browser.currentPushToken(owner)).toBeNull();
});
