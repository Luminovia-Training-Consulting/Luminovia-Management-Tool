import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  clearOfflineSchedule,
  readOfflineSchedule,
  refreshOfflineSchedule,
  synchronizeOfflineActor,
} from "./offline-store";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUser: vi.fn(),
  online: true,
  signals: [] as AbortSignal[],
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc }),
}));
vi.mock("../../lib/online", () => ({
  requireOnline: () => {
    if (!mocks.online) throw new Error("offline");
  },
}));
const owner = "11111111-1111-4111-8111-111111111111",
  peer = "22222222-2222-4222-8222-222222222222";
const event = {
  id: "33333333-3333-4333-8333-333333333333",
  kind: "assignment",
  title: "Fictional teaching",
  starts_at: "2026-11-18T09:00:00Z",
  ends_at: "2026-11-18T10:00:00Z",
  time_zone: "Europe/Berlin",
  link: "https://PRIVATE.invalid",
  fee: 500,
  contact: "PRIVATE CONTACT",
};

function response(data: unknown) {
  mocks.rpc.mockReturnValue({
    abortSignal: (signal: AbortSignal) => {
      mocks.signals.push(signal);
      return Promise.resolve({ data, error: null });
    },
  });
}

async function raw() {
  return new Promise<unknown>((resolve, reject) => {
    const open = indexedDB.open("luminovia-offline-schedule", 1);
    open.onerror = reject;
    open.onsuccess = () => {
      const database = open.result,
        request = database
          .transaction("snapshot")
          .objectStore("snapshot")
          .get("current");
      request.onsuccess = () => {
        database.close();
        resolve(request.result);
      };
    };
  });
}

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  mocks.online = true;
  mocks.signals = [];
  mocks.getUser.mockResolvedValue({
    data: { user: { id: owner } },
    error: null,
  });
  response([event]);
  synchronizeOfflineActor(null);
  await clearOfflineSchedule();
  synchronizeOfflineActor(owner);
  await readOfflineSchedule(owner);
  mocks.rpc.mockClear();
});
afterEach(async () => {
  await clearOfflineSchedule();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
it("does not cache anything before explicit opt-in; fresh fetch stores only minimal confirmed teaching", async () => {
  expect(await readOfflineSchedule(owner)).toBeNull();
  expect(mocks.rpc).not.toHaveBeenCalled();
  const snapshot = await refreshOfflineSchedule(owner);
  expect(mocks.rpc.mock.calls[0][1].p_include_private).toBe(false);
  expect(Object.keys(snapshot.items[0]).sort()).toEqual([
    "ends_at",
    "starts_at",
    "time_zone",
    "title",
  ]);
  expect(JSON.stringify(await raw())).not.toContain("PRIVATE");
  expect(Date.parse(snapshot.expires_at) - Date.parse(snapshot.saved_at)).toBe(
    7 * 86400000,
  );
});
it("rejects private events rather than persisting them offline", async () => {
  response([{ ...event, kind: "private", title: "PRIVATE APPOINTMENT" }]);
  await expect(refreshOfflineSchedule(owner)).rejects.toThrow();
  expect(await readOfflineSchedule(owner)).toBeNull();
});
it("binds fresh export to the server-verified account, not an editable browser user id", async () => {
  mocks.getUser.mockResolvedValue({
    data: { user: { id: peer } },
    error: null,
  });
  await expect(refreshOfflineSchedule(owner)).rejects.toThrow(
    "offline_verified_identity_required",
  );
  expect(mocks.rpc).not.toHaveBeenCalled();
  expect(await raw()).toBeUndefined();
});
it("aborts and rejects late old-account HTTP data after an account switch", async () => {
  let finish: (value: unknown) => void = () => {};
  mocks.rpc.mockReturnValue({
    abortSignal: (signal: AbortSignal) => {
      mocks.signals.push(signal);
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const saving = refreshOfflineSchedule(owner);
  await vi.waitFor(() => expect(mocks.signals).toHaveLength(1));
  synchronizeOfflineActor(peer);
  finish({ data: [event], error: null });
  await expect(saving).rejects.toThrow();
  expect(mocks.signals[0].aborted).toBe(true);
  expect(await readOfflineSchedule(owner)).toBeNull();
  expect(await readOfflineSchedule(peer)).toBeNull();
  expect(await raw()).toBeUndefined();
});
it("clears on logout, preserves same-identity use and never exposes a foreign snapshot", async () => {
  await refreshOfflineSchedule(owner);
  synchronizeOfflineActor(owner);
  expect((await readOfflineSchedule(owner))?.items).toHaveLength(1);
  expect(await readOfflineSchedule(peer)).toBeNull();
  synchronizeOfflineActor(null);
  expect(await readOfflineSchedule(owner)).toBeNull();
  synchronizeOfflineActor(owner);
  expect(await readOfflineSchedule(owner)).toBeNull();
  expect(await raw()).toBeUndefined();
});
it("expiry makes the snapshot unreadable and removes its stored data", async () => {
  await refreshOfflineSchedule(owner);
  expect(
    await readOfflineSchedule(owner, Date.now() + 8 * 86400000),
  ).toBeNull();
  expect(await raw()).toBeUndefined();
});
it("explicit deletion cancels an in-flight opt-in and prevents its late write", async () => {
  let finish: (value: unknown) => void = () => {};
  mocks.rpc.mockReturnValue({
    abortSignal: (signal: AbortSignal) => {
      mocks.signals.push(signal);
      return new Promise((resolve) => {
        finish = resolve;
      });
    },
  });
  const saving = refreshOfflineSchedule(owner);
  await vi.waitFor(() => expect(mocks.signals).toHaveLength(1));
  await clearOfflineSchedule();
  finish({ data: [event], error: null });
  await expect(saving).rejects.toThrow();
  expect(await raw()).toBeUndefined();
});
it("checks generation inside a late IDB open callback before creating a write transaction", async () => {
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
      const facade = {
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
      };
      return facade as unknown as IDBOpenDBRequest;
    });
  const saving = refreshOfflineSchedule(owner);
  await held;
  synchronizeOfflineActor(peer);
  release();
  await expect(saving).rejects.toThrow();
  expect(await readOfflineSchedule(peer)).toBeNull();
  expect(await raw()).toBeUndefined();
});
it("refuses offline refresh even when a valid snapshot already exists", async () => {
  await refreshOfflineSchedule(owner);
  mocks.online = false;
  await expect(refreshOfflineSchedule(owner)).rejects.toThrow("offline");
  expect((await readOfflineSchedule(owner))?.items).toHaveLength(1);
});
