/**
 * Vitest-Regressionen für sichere Inboxziele, bestätigte Lesestände und erhaltene Entwürfe bei Versionskonflikten. Lokale SDK-/DOM-Fixtures isolieren den Browservertrag; echte Datenbank-/API-Abnahme bleibt Teil des separaten Gesamtprüflaufs.
 */
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import {
  NotificationsMenu,
  NotificationsPage,
  SettingsPage,
} from "./notifications";
import {
  notificationInboxQuery,
  notificationPreviewQuery,
  mergeNotificationPages,
} from "./api";
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  actor: "actor-a",
  online: true,
  rejectMark: false,
  staleSave: false,
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: state.actor } } }),
}));
vi.mock("../../lib/queries", () => ({
  profileQuery: (actor: string) => ({
    queryKey: ["profile", actor],
    queryFn: async () => ({ time_zone: "UTC" }),
  }),
}));
vi.mock("../../lib/online", () => ({
  useOnline: () => state.online,
  requireOnline: () => {
    if (!state.online) throw new Error("offline");
  },
}));
const clients: QueryClient[] = [];
const notice = {
  id: "fe82d6cc-91ef-4a98-8a59-c8c90ad7eaa4",
  kind: "claim_confirmed",
  title: "Fictional course <script>text</script>",
  href: "/jobs/job-a",
  read_at: null,
  created_at: "2026-11-15T10:00:00Z",
};
const initialPreferences = {
  chat: true,
  forum: true,
  job_updates: true,
  reminders: true,
  version: 1,
};
beforeEach(async () => {
  state.actor = "actor-a";
  state.online = true;
  state.rejectMark = false;
  state.staleSave = false;
  await i18n.changeLanguage("de");
  state.rpc.mockImplementation(
    (name: string, payload?: Record<string, unknown>) => {
      let result: { data: unknown; error: unknown } = {
        data: null,
        error: null,
      };
      if (name === "notification_inbox")
        result.data = {
          items: payload?.p_unread_only ? [] : [notice],
          unread_count: 45,
          as_of: "2026-11-15T11:00:00Z",
        };
      else if (name === "notification_preferences")
        result.data = { ...initialPreferences };
      else if (name === "save_notification_preferences")
        result = state.staleSave
          ? { data: null, error: { code: "40001", message: "stale" } }
          : {
              data: { ...(payload?.p_payload as object), version: 2 },
              error: null,
            };
      else if (name === "mark_notifications")
        result = state.rejectMark
          ? { data: null, error: { code: "42501", message: "denied" } }
          : { data: 1, error: null };
      else if (name === "refresh_my_notifications") result.data = 0;
      const request = Promise.resolve(result);
      return Object.assign(request, { abortSignal: () => request });
    },
  );
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.clearAllMocks();
});
/** Rendert die untersuchte Komponente mit den für diesen Test notwendigen lokalen Providern. */
function view(component: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{component}</MemoryRouter>
    </QueryClientProvider>,
  );
}
describe("connected notification inbox", () => {
  it.each([
    [],
    { items: [], unread_count: -1, as_of: "2026-11-15T11:00:00Z" },
    {
      items: [{ ...notice, href: "//foreign.example.invalid" }],
      unread_count: 1,
      as_of: "2026-11-15T11:00:00Z",
    },
    {
      items: [{ ...notice, href: "javascript:alert(1)" }],
      unread_count: 1,
      as_of: "2026-11-15T11:00:00Z",
    },
    {
      items: [{ ...notice, href: "/\\foreign.example.invalid" }],
      unread_count: 1,
      as_of: "2026-11-15T11:00:00Z",
    },
  ])(
    "rejects malformed or unsafe API data instead of rendering it: %j",
    async (data) => {
      const request = Promise.resolve({ data, error: null });
      state.rpc.mockReturnValueOnce(
        Object.assign(request, { abortSignal: () => request }),
      );
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      clients.push(client);
      await expect(
        client.fetchQuery(notificationPreviewQuery("actor-a")),
      ).rejects.toThrow();
    },
  );
  it("renders current safe links as text and uses the global unread count beyond the page", async () => {
    view(<NotificationsPage />);
    expect(await screen.findByText("45 ungelesen")).toBeVisible();
    expect(screen.getByText(notice.title)).toBeVisible();
    expect(screen.getByRole("link", { name: "Öffnen" })).toHaveAttribute(
      "href",
      "/jobs/job-a",
    );
    expect(document.querySelector("script")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", {
        name: "Alle bisher eingegangenen Meldungen lesen",
      }),
    );
    await waitFor(() =>
      expect(state.rpc).toHaveBeenCalledWith("mark_notifications", {
        p_ids: null,
        p_all_before: "2026-11-15T11:00:00Z",
        p_read: true,
      }),
    );
  });
  it("a failed server acknowledgement keeps the notification unread and offers an honest error", async () => {
    state.rejectMark = true;
    view(<NotificationsPage />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Als gelesen markieren" }),
    );
    expect(
      await screen.findByText(
        "Das hat nicht geklappt. Deine Änderung wurde nicht bestätigt.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Als gelesen markieren" }),
    ).toBeVisible();
    expect(state.rpc).toHaveBeenCalledWith("mark_notifications", {
      p_ids: [notice.id],
      p_all_before: null,
      p_read: true,
    });
  });
  it("duplicate menu observers share one actor-scoped metadata request", async () => {
    view(
      <>
        <NotificationsMenu id="actor-a" zone="UTC" />
        <NotificationsMenu id="actor-a" zone="UTC" />
      </>,
    );
    await waitFor(() => expect(screen.getAllByText("45")).toHaveLength(2));
    expect(
      state.rpc.mock.calls.filter(([name]) => name === "notification_inbox"),
    ).toHaveLength(1);
    expect(notificationPreviewQuery("actor-a").queryKey).not.toEqual(
      notificationPreviewQuery("actor-b").queryKey,
    );
    expect(
      notificationInboxQuery("actor-a", false).refetchInterval,
    ).toBeUndefined();
  });
  it("filters unread items without unmounting the filter and disables offline writes", async () => {
    state.online = false;
    view(<NotificationsPage />);
    await screen.findByText(notice.title);
    const filter = screen.getByRole("combobox");
    expect(
      screen.getByRole("button", { name: "Als gelesen markieren" }),
    ).toBeDisabled();
    await userEvent.selectOptions(filter, "unread");
    expect(
      await screen.findByText("Hier gibt es gerade keine Meldungen."),
    ).toBeVisible();
    expect(screen.getByRole("combobox")).toBe(filter);
    expect(
      state.rpc.mock.calls.filter(([name]) => name === "mark_notifications"),
    ).toHaveLength(0);
  });
});
describe("versioned notification preferences", () => {
  it("keeps unsaved choices across language changes and saves only current-account fields", async () => {
    view(<SettingsPage />);
    const chat = await screen.findByRole("checkbox", {
      name: "Neue Chatnachrichten",
    });
    await userEvent.click(chat);
    await act(() => i18n.changeLanguage("en"));
    expect(screen.getByRole("checkbox", { name: "New chat messages" })).toBe(
      chat,
    );
    expect(chat).not.toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Preferences saved.")).toBeVisible();
    expect(state.rpc).toHaveBeenCalledWith("save_notification_preferences", {
      p_payload: {
        chat: false,
        forum: true,
        job_updates: true,
        reminders: true,
      },
      p_expected_version: 1,
    });
  });
  it("stale writes preserve the draft until the user explicitly reloads", async () => {
    state.staleSave = true;
    view(<SettingsPage />);
    const chat = await screen.findByRole("checkbox", {
      name: "Neue Chatnachrichten",
    });
    await userEvent.click(chat);
    await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
    expect(
      await screen.findByText(
        /Deine Einstellungen wurden zwischenzeitlich geändert/,
      ),
    ).toBeVisible();
    expect(chat).not.toBeChecked();
    await userEvent.click(
      screen.getByRole("button", { name: "Aktuellen Stand laden" }),
    );
    await waitFor(() => expect(chat).toBeChecked());
    expect(
      within(screen.getByRole("group")).getAllByRole("checkbox"),
    ).toHaveLength(4);
  });
});

it("the newest fetched copy wins if notification cursor pages overlap", () => {
  const current = {
    ...notice,
    href: null,
    title: "",
    read_at: "2026-11-15T11:00:00Z",
  };
  const rows = mergeNotificationPages([
    { items: [current], unread_count: 0, as_of: current.read_at },
    { items: [notice], unread_count: 1, as_of: notice.created_at },
  ]);
  expect(rows).toEqual([current]);
});

it("opening the inbox closes the native notification popover", async () => {
  view(<NotificationsMenu id="actor-a" zone="UTC" />);
  const summary = await screen.findByLabelText(
    "Benachrichtigungen: 45 ungelesen",
  );
  expect(summary).toHaveAccessibleName("Benachrichtigungen: 45 ungelesen");
  await userEvent.click(summary);
  const menu = summary.closest("details")!;
  expect(menu).toHaveAttribute("open");
  await userEvent.click(
    await screen.findByRole("link", { name: "Alle Benachrichtigungen" }),
  );
  await waitFor(() => expect(menu).not.toHaveAttribute("open"));
});
