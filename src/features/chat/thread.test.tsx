/**
 * Regressions for visibility-bound read receipts and retries after uncertain outcomes. SDK/DOM
 * fixtures do not replace native chat acceptance.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
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
      <MemoryRouter>
        <ChatThread
          actor="actor"
          room={next}
          canManageCourses={false}
          onBack={() => undefined}
        />
      </MemoryRouter>
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
  // Optional tools must not consume the initial transcript or remount an unsent draft.
  const tools = document.querySelector(".chat-thread-tools")!;
  expect(tools).not.toHaveAttribute("open");
  await user.click(
    screen.getByText("Suche, angeheftete Nachrichten & Hinweise"),
  );
  expect(tools).toHaveAttribute("open");
  expect(screen.getByLabelText("Deine Nachricht")).toHaveValue(
    "Ungesendeter Entwurf",
  );
  await user.click(
    screen.getByText("Suche, angeheftete Nachrichten & Hinweise"),
  );
  expect(tools).not.toHaveAttribute("open");
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

/** Create an isolated real thread with fictional history and controlled read receipts. */
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

it("clears only the manual flag for an empty visible room and retries an unconfirmed clear", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  let readAttempts = 0;
  rpc.mockImplementation(async (name: string) => {
    if (name === "clear_chat_manual_unread") {
      readAttempts++;
      return readAttempts === 1
        ? { data: null, error: { message: "Network error" } }
        : { data: null, error: null };
    }
    return {
      data: name === "chat_topic_pinned_messages" ? [] : null,
      error: null,
    };
  });
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["profile", "actor"], { time_zone: "Europe/Berlin" });
  client.setQueryData(["chat-messages", "actor", "empty-room", ""], {
    pages: [[]],
    pageParams: [null],
  });
  const room: ChatRoom = {
    id: "empty-room",
    kind: "topic",
    title: "Fictional empty room",
    job_id: null,
    owner_id: "peer",
    unread_count: 0,
    last_message_at: null,
    muted: false,
    manual_unread: true,
  };
  const view = render(
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
  await screen.findByRole("alert");
  expect(
    rpc.mock.calls.filter(([name]) => name === "clear_chat_manual_unread"),
  ).toEqual([["clear_chat_manual_unread", { p_room_id: "empty-room" }]]);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Erneut versuchen" }));
  await waitFor(() =>
    expect(
      rpc.mock.calls.filter(([name]) => name === "clear_chat_manual_unread"),
    ).toEqual([
      ["clear_chat_manual_unread", { p_room_id: "empty-room" }],
      ["clear_chat_manual_unread", { p_room_id: "empty-room" }],
    ]),
  );
  view.unmount();
  client.clear();
});

it("does not clear an empty unread room in a hidden tab", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["profile", "actor"], { time_zone: "Europe/Berlin" });
  client.setQueryData(["chat-messages", "actor", "empty-room", ""], {
    pages: [[]],
    pageParams: [null],
  });
  const room: ChatRoom = {
    id: "empty-room",
    kind: "topic",
    title: "Fictional empty room",
    job_id: null,
    owner_id: "peer",
    unread_count: 0,
    last_message_at: null,
    muted: false,
    manual_unread: true,
  };
  const view = render(
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
  expect(
    rpc.mock.calls.filter(([name]) => name === "clear_chat_manual_unread"),
  ).toEqual([]);
  view.unmount();
  client.clear();
});

it("does not clear an empty unread room offline and retries when connectivity returns", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  let online = false;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["profile", "actor"], { time_zone: "Europe/Berlin" });
  client.setQueryData(["chat-messages", "actor", "empty-room", ""], {
    pages: [[]],
    pageParams: [null],
  });
  const room: ChatRoom = {
    id: "empty-room",
    kind: "topic",
    title: "Fictional empty room",
    job_id: null,
    owner_id: "peer",
    unread_count: 0,
    last_message_at: null,
    muted: false,
    manual_unread: true,
  };
  const view = render(
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
  expect(rpc).not.toHaveBeenCalled();
  await act(async () => {
    online = true;
    window.dispatchEvent(new Event("online"));
  });
  await waitFor(() =>
    expect(rpc).toHaveBeenCalledWith("clear_chat_manual_unread", {
      p_room_id: "empty-room",
    }),
  );
  view.unmount();
  client.clear();
});

it("hides the retained reply target when a refreshed history page is rejected as stale", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  rpc.mockImplementation(async (name: string) => {
    if (name === "chat_messages_with_mentions")
      return {
        data: [
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
            content_version: 1,
          },
        ],
        error: null,
      };
    if (name === "chat_reply_previews")
      return { data: null, error: { code: "40001" } };
    return { data: null, error: null };
  });
  const { client, view } = populatedThread();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Auf Nachricht antworten" }));
  expect(screen.getAllByText("Confirmed fictional message")).toHaveLength(2);
  await act(async () => {
    await client.refetchQueries({
      queryKey: ["chat-messages", "actor", "room", ""],
    });
  });
  await screen.findByRole("alert");
  expect(
    screen.queryByText("Confirmed fictional message"),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText("Die ursprüngliche Nachricht ist nicht verfügbar."),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Nachricht senden" }),
  ).toBeDisabled();
  view.unmount();
  client.clear();
});
