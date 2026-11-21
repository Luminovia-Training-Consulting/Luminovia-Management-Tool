/** Actual paused TanStack queries and IndexedDB snapshots reproduce a cold
 * offline shell. The mocked local session is not native Auth acceptance. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { IDBFactory } from "fake-indexeddb";
import { Shell } from "./shell";
import {
  clearOfflineSchedule,
  readOfflineSchedule,
  synchronizeOfflineActor,
} from "../features/calendar/offline-store";
import "../lib/i18n";

const actor = "11111111-1111-4111-8111-111111111111";
const state = vi.hoisted(() => ({ profile: vi.fn(), signOut: vi.fn() }));
vi.mock("../features/auth/auth-context", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "fictional@example.invalid",
      },
    },
  }),
}));
vi.mock("../features/profile/avatar", () => ({ Avatar: () => null }));
vi.mock("../features/notifications/notifications-menu", () => ({
  NotificationsMenu: () => null,
}));
vi.mock("../features/announcements/announcement-banners", () => ({
  AnnouncementBanners: () => null,
}));
vi.mock("../features/help/tour", () => ({ PortalTour: () => null }));
vi.mock("../lib/supabase", () => ({
  db: () => ({ auth: { signOut: state.signOut } }),
}));
vi.mock("../lib/queries", () => ({
  profileQuery: (id: string) => ({
    queryKey: ["profile", id],
    queryFn: state.profile,
  }),
  permissionsQuery: (id: string) => ({
    queryKey: ["permissions", id],
    queryFn: async () => [],
  }),
  userRolesQuery: (id: string) => ({
    queryKey: ["roles", id],
    queryFn: async () => [],
  }),
}));
const clients: QueryClient[] = [];

async function seed() {
  const now = Date.now();
  await new Promise<void>((resolve, reject) => {
    const open = indexedDB.open("luminovia-offline-schedule", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("snapshot");
    open.onerror = reject;
    open.onsuccess = () => {
      const db = open.result,
        tx = db.transaction("snapshot", "readwrite");
      tx.objectStore("snapshot").put(
        {
          actor,
          saved_at: new Date(now).toISOString(),
          expires_at: new Date(now + 86400000).toISOString(),
          items: [
            {
              title: "Fictional Brisbane teaching",
              starts_at: "2026-11-18T00:00:00Z",
              ends_at: "2026-11-18T01:00:00Z",
              time_zone: "Australia/Brisbane",
            },
          ],
        },
        "current",
      );
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = reject;
    };
  });
}

function show(profile?: { active: boolean } | null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  if (profile !== undefined) client.setQueryData(["profile", actor], profile);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Routes>
          <Route element={<Shell />}>
            <Route index element={<p>PRIVATE OUTLET</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(async () => {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  onlineManager.setOnline(false);
  state.profile.mockReset().mockImplementation(() => new Promise(() => {}));
  synchronizeOfflineActor(null);
  await clearOfflineSchedule();
  synchronizeOfflineActor(actor);
  await readOfflineSchedule(actor);
  await seed();
});
afterEach(async () => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  await clearOfflineSchedule();
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("shows only the explicit teaching snapshot while a fresh profile query is paused offline", async () => {
  const client = show();
  expect(client.getQueryState(["profile", actor])?.fetchStatus).toBe("paused");
  expect(await screen.findByText("Fictional Brisbane teaching")).toBeVisible();
  expect(screen.getByText(/Australia\/Brisbane/)).toBeVisible();
  expect(screen.getByText(/Gespeichert am/)).toHaveTextContent("UTC");
  expect(
    screen.getByText(/aktuelles Profil kann nicht geprüft werden/),
  ).toBeVisible();
  expect(screen.queryByText("PRIVATE OUTLET")).toBeNull();
  expect(
    screen.queryByRole("button", {
      name: "Unterrichtsplan für offline speichern",
    }),
  ).toBeNull();
  expect(state.profile).not.toHaveBeenCalled();
});
it.each([{ active: false }, null])(
  "hides and clears the snapshot for a known unavailable profile %j",
  async (profile) => {
    show(profile);
    expect(await screen.findByRole("alert")).toBeVisible();
    await waitFor(async () =>
      expect(await readOfflineSchedule(actor)).toBeNull(),
    );
    expect(screen.queryByText("Fictional Brisbane teaching")).toBeNull();
    expect(screen.queryByText("PRIVATE OUTLET")).toBeNull();
  },
);
it("retains normal profile loading when the browser is online", () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  onlineManager.setOnline(true);
  show();
  expect(screen.queryByText("Fictional Brisbane teaching")).toBeNull();
  expect(
    screen.queryByText(/aktuelles Profil kann nicht geprüft werden/),
  ).toBeNull();
});
it("offers the same minimal fallback when a failed online profile fetch goes offline", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  onlineManager.setOnline(true);
  state.profile.mockRejectedValue(new Error("Fictional unavailable profile"));
  show();
  await screen.findByRole("alert");
  act(() => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    onlineManager.setOnline(false);
    window.dispatchEvent(new Event("offline"));
  });
  expect(await screen.findByText("Fictional Brisbane teaching")).toBeVisible();
  expect(screen.queryByText("PRIVATE OUTLET")).toBeNull();
});
