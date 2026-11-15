import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
  vi.restoreAllMocks();
  rpc.mockResolvedValue({ data: [], error: null });
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

function populatedThread() {
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["profile", "actor"], { time_zone: "Europe/Berlin" });
  client.setQueryData(["chat-messages", "actor", "room", ""], {
    pages: [
      [
        {
          id: "latest",
          room_id: "room",
          sender_id: "peer",
          sender_name: "Fictional Peer",
          body: "Confirmed fictional message",
          created_at: "2026-01-01T08:00:00Z",
          edited_at: null,
          deleted_at: null,
          document_id: null,
          reactions: [],
        },
      ],
    ],
    pageParams: [null],
  });
  const room: ChatRoom = {
    id: "room",
    kind: "dm",
    title: "Fictional Peer",
    job_id: null,
    owner_id: null,
    unread_count: 1,
    last_message_at: null,
    muted: false,
  };
  const element = () => (
    <QueryClientProvider client={client}>
      <ChatThread
        actor="actor"
        room={room}
        canManageCourses={false}
        onBack={() => undefined}
      />
    </QueryClientProvider>
  );
  const view = render(element());
  return { client, view, element };
}
it("keeps a failed read receipt retryable without a rerender request loop", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  rpc
    .mockResolvedValueOnce({
      data: null,
      error: { message: "Uncertain network result" },
    })
    .mockResolvedValue({ data: null, error: null });
  const user = userEvent.setup();
  const { view, element, client } = populatedThread();
  await screen.findByRole("alert");
  for (let i = 0; i < 4; i++) view.rerender(element());
  expect(rpc).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
  expect(rpc).toHaveBeenLastCalledWith("mark_chat_read", {
    p_room_id: "room",
    p_message_id: "latest",
    p_muted: null,
  });
  await waitFor(() =>
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
  );
  view.rerender(element());
  expect(rpc).toHaveBeenCalledTimes(2);
  client.clear();
});
it("retries the same failed latest read receipt after reconnecting", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  let online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  rpc
    .mockResolvedValueOnce({
      data: null,
      error: { message: "Transport failed" },
    })
    .mockResolvedValue({ data: null, error: null });
  const { client } = populatedThread();
  await screen.findByRole("alert");
  await act(async () => {
    online = false;
    window.dispatchEvent(new Event("offline"));
  });
  await act(async () => {
    online = true;
    window.dispatchEvent(new Event("online"));
  });
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
  client.clear();
});
it("marks a message received in a hidden tab only after the tab becomes visible", async () => {
  let visibility: DocumentVisibilityState = "hidden";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
  rpc.mockResolvedValue({ data: null, error: null });
  const { client } = populatedThread();
  expect(rpc).not.toHaveBeenCalled();
  await act(async () => {
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  client.clear();
});
