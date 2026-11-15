import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ChatThread } from "./thread";
import type { ChatRoom } from "./types";
const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("./realtime", () => ({
  useChatRealtime: () => ({ status: "connected", revoked: false }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("retains exactly one composer and its unsent draft across room-list refreshes", async () => {
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  const room: ChatRoom = {
    id: "room",
    kind: "dm",
    title: "Other lecturer",
    job_id: null,
    owner_id: null,
    unread_count: 0,
    last_message_at: null,
    muted: false,
  };
  client.setQueryData(["profile", "actor"], { time_zone: "Europe/Berlin" });
  client.setQueryData(["chat-messages", "actor", "room", ""], {
    pages: [[]],
    pageParams: [null],
  });
  const element = (next: ChatRoom) => (
    <QueryClientProvider client={client}>
      <ChatThread
        actor="actor"
        room={next}
        canManageCourses={false}
        onBack={() => undefined}
      />
    </QueryClientProvider>
  );
  const view = render(element(room));
  expect(
    screen.getAllByRole("button", { name: "Nachricht senden" }),
  ).toHaveLength(1);
  await user.type(
    screen.getByLabelText("Deine Nachricht"),
    "Ungesendeter Entwurf",
  );
  for (let count = 1; count <= 4; count++) {
    view.rerender(
      element({
        ...room,
        unread_count: count,
        title: `Other lecturer ${count}`,
      }),
    );
    expect(
      screen.getAllByRole("button", { name: "Nachricht senden" }),
    ).toHaveLength(1);
    expect(
      screen.getAllByRole("textbox", { name: "Deine Nachricht" }),
    ).toHaveLength(1);
    expect(screen.getByLabelText("Deine Nachricht")).toHaveValue(
      "Ungesendeter Entwurf",
    );
  }
});
