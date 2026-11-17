import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { ChatPage } from "./chat";
import { RoomActivity } from "./room-activity";
const fake = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
vi.mock("../../lib/supabase", () => ({ db: () => fake }));
vi.mock("./thread", () => ({ ChatThread: () => null }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("renders the existing server message time using the cached preferred zone and language without a new request", async () => {
  await i18n.changeLanguage("de");
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(["profile", "actor"], { time_zone: "Europe/Berlin" });
  client.setQueryData(["permissions", "actor"], []);
  client.setQueryData(["user-roles", "actor"], []);
  client.setQueryData(
    ["chat-rooms", "actor"],
    [
      {
        id: "a",
        kind: "topic",
        title: "Fictional",
        unread_count: 0,
        muted: false,
        last_message_at: "2026-10-25T00:30:00Z",
        last_message_preview: "Fictional latest message",
      },
      {
        id: "b",
        kind: "topic",
        title: "Empty",
        unread_count: 0,
        muted: false,
        last_message_at: null,
      },
    ],
  );
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChatPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const time = view.container.querySelector("time")!;
  const formatted = (locale: string, zone: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "short",
      timeStyle: "short",
      timeZone: zone,
    }).format(new Date("2026-10-25T00:30:00Z"));
  expect(time).toHaveTextContent(formatted("de", "Europe/Berlin"));
  expect(time).toHaveAttribute("datetime", "2026-10-25T00:30:00Z");
  expect(screen.getByText(/Letzte Nachricht:/)).toBeVisible();
  expect(screen.getByText("Fictional latest message")).toBeVisible();
  expect(view.container.querySelectorAll("time")).toHaveLength(1);
  expect(fake.rpc).not.toHaveBeenCalled();
  expect(fake.from).not.toHaveBeenCalled();
  await act(async () => {
    client.setQueryData(["profile", "actor"], {
      time_zone: "Australia/Brisbane",
    });
    await i18n.changeLanguage("en");
  });
  expect(time).toHaveTextContent(formatted("en", "Australia/Brisbane"));
  expect(screen.getByText(/Last message:/)).toBeVisible();
  expect(fake.rpc).not.toHaveBeenCalled();
  expect(fake.from).not.toHaveBeenCalled();
  view.unmount();
  client.clear();
  await i18n.changeLanguage("de");
});
it("never invents a timestamp or timezone when the server value is unavailable or malformed", () => {
  const view = render(
    <>
      <RoomActivity instant={null} zone="Europe/Berlin" />
      <RoomActivity instant="not-a-date" zone="UTC" />
      <RoomActivity instant="2026-10-25T00:30:00Z" />
      <RoomActivity instant="2026-10-25T00:30:00Z" zone="bad/zone" />
    </>,
  );
  expect(view.container.querySelector("time")).toBeNull();
});
