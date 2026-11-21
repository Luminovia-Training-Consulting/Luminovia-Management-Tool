import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ChatThread } from "./thread";
import type { ChatRoom } from "./types";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("./realtime", () => ({
  useChatRealtime: () => ({ status: "connected", revoked: false }),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  rpc.mockReset();
});
const clears = () =>
  rpc.mock.calls.filter(([name]) => name === "clear_chat_manual_unread");

function setup() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["profile", "actor"], { time_zone: "UTC" });
  client.setQueryData(["chat-messages", "actor", "room", ""], {
    pages: [[]],
    pageParams: [null],
  });
  const room: ChatRoom = {
    id: "room",
    kind: "topic",
    title: "Fictional",
    job_id: null,
    owner_id: "actor",
    unread_count: 0,
    last_message_at: null,
    muted: false,
    manual_unread: true,
  };
  const element = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChatThread
          actor="actor"
          room={room}
          canManageCourses={false}
          onBack={() => undefined}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { client, element, view: render(element()) };
}

it("confirms the empty-room marker only once when visible, without a read cursor", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  rpc.mockResolvedValue({ data: [], error: null });
  const { client, view, element } = setup();
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith("clear_chat_manual_unread", {
      p_room_id: "room",
    }),
  );
  for (let i = 0; i < 3; i++) view.rerender(element());
  expect(clears()).toHaveLength(1);
  client.clear();
});
it("waits for visibility and online state before confirming", async () => {
  let visible: DocumentVisibilityState = "hidden",
    online = false;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visible,
  );
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  rpc.mockResolvedValue({ data: [], error: null });
  const { client } = setup();
  expect(clears()).toHaveLength(0);
  await act(async () => {
    visible = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(clears()).toHaveLength(0);
  await act(async () => {
    online = true;
    window.dispatchEvent(new Event("online"));
  });
  await waitFor(() => expect(clears()).toHaveLength(1));
  client.clear();
});
it("offers explicit retry after an uncertain result without a request loop", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  let attempts = 0;
  rpc.mockImplementation(async (name: string) =>
    name === "clear_chat_manual_unread" && attempts++ === 0
      ? { data: null, error: { code: "network" } }
      : { data: [], error: null },
  );
  const user = userEvent.setup();
  const { client, view, element } = setup();
  await screen.findByRole("alert");
  for (let i = 0; i < 3; i++) view.rerender(element());
  expect(clears()).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
  await waitFor(() => expect(clears()).toHaveLength(2));
  expect(clears().at(-1)).toEqual([
    "clear_chat_manual_unread",
    { p_room_id: "room" },
  ]);
  client.clear();
});
