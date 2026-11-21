import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { messageDay, messageDayLabel } from "./message-days";
import { ChatThread } from "./thread";
import type { ChatMessage, ChatRoom } from "./types";

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("./realtime", () => ({
  useChatRealtime: () => ({ status: "connected", revoked: false }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("groups UTC instants by the reader's day across Berlin DST and Brisbane midnight", () => {
  // Berlin repeats 02:30 on the autumn clock change, but both instants are the same day.
  expect(messageDay("2026-10-25T00:30:00Z", "Europe/Berlin")).toBe(
    "2026-10-25",
  );
  expect(messageDay("2026-10-25T01:30:00Z", "Europe/Berlin")).toBe(
    "2026-10-25",
  );
  // At the very same instant, Brisbane is the next day but Berlin is not.
  expect(messageDay("2026-10-24T14:30:00Z", "Europe/Berlin")).toBe(
    "2026-10-24",
  );
  expect(messageDay("2026-10-24T14:30:00Z", "Australia/Brisbane")).toBe(
    "2026-10-25",
  );
  expect(
    messageDayLabel("2026-10-25T00:30:00Z", "Europe/Berlin", "de"),
  ).toContain("25. Oktober 2026");
  expect(
    messageDayLabel("2026-10-25T00:30:00Z", "Europe/Berlin", "en"),
  ).toContain("October 25, 2026");
});
it("renders one chronological day separator per reader-local day across overlapping pages", async () => {
  await i18n.changeLanguage("de");
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["profile", "actor"], { time_zone: "Europe/Berlin" });
  const message = (id: string, created_at: string): ChatMessage => ({
    id,
    room_id: "room",
    sender_id: "actor",
    sender_name: "Fictional",
    body: `Message ${id}`,
    created_at,
    edited_at: null,
    deleted_at: null,
    document_id: null,
    reactions: [],
  });
  const older = message("older", "2026-10-24T14:30:00Z"),
    first = message("first", "2026-10-25T00:30:00Z"),
    second = message("second", "2026-10-25T01:30:00Z");
  client.setQueryData(["chat-messages", "actor", "room", ""], {
    pages: [
      [second, first],
      [first, older],
    ],
    pageParams: [null, null],
  });
  const room: ChatRoom = {
    id: "room",
    kind: "dm",
    title: "Fictional",
    job_id: null,
    owner_id: null,
    unread_count: 0,
    last_message_at: null,
    muted: false,
  };
  const page = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChatThread
          actor="actor"
          room={room}
          canManageCourses={false}
          onBack={() => undefined}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const list = screen.getByRole("list", { name: "Chats" });
  const separatorDates = () =>
    Array.from(list.querySelectorAll(".chat-date-separator time")).map((item) =>
      item.getAttribute("datetime"),
    );
  expect(separatorDates()).toEqual(["2026-10-24", "2026-10-25"]);
  expect(
    Array.from(list.querySelectorAll(".chat-message-body")).map(
      (item) => item.textContent,
    ),
  ).toEqual(["Message older", "Message first", "Message second"]);
  await act(async () => {
    client.setQueryData(["profile", "actor"], {
      time_zone: "Australia/Brisbane",
    });
    await i18n.changeLanguage("en");
  });
  expect(separatorDates()).toEqual(["2026-10-25"]);
  expect(list.querySelector(".chat-date-separator")?.textContent).toContain(
    "October 25, 2026",
  );
  page.unmount();
  client.clear();
  await i18n.changeLanguage("de");
});
