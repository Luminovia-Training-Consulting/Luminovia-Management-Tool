/** Fictional actor tests: topic pins wait for server confirmation and stale access is hidden. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
import i18n from "../../lib/i18n";
import { ChatThread } from "./thread";
import type { ChatRoom } from "./types";
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  pins: [] as unknown[],
  denied: false,
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("./realtime", () => ({
  useChatRealtime: () => ({ status: "connected", revoked: false }),
}));
const message = {
  id: "msg",
  room_id: "room",
  sender_id: "owner",
  sender_name: "Fictional sender",
  body: "Fictional body",
  created_at: "2035-01-01T08:00:00Z",
  edited_at: null,
  deleted_at: null,
  document_id: null,
  reactions: [],
  content_version: 1,
  mentions: [],
  can_moderate: true,
};
const room: ChatRoom = {
  id: "room",
  kind: "topic",
  title: "Fictional group",
  job_id: null,
  owner_id: "owner",
  unread_count: 0,
  last_message_at: null,
  muted: false,
};
const clients: QueryClient[] = [];
function view(next = room) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  client.setQueryData(["profile", "owner"], { time_zone: "Europe/Berlin" });
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChatThread
          actor="owner"
          room={next}
          canManageCourses={false}
          onBack={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, ...result };
}
beforeEach(async () => {
  await i18n.changeLanguage("de");
  state.pins = [];
  state.denied = false;
  state.rpc
    .mockReset()
    .mockImplementation(async (name: string) =>
      name === "chat_topic_pinned_messages"
        ? state.denied
          ? { data: null, error: { code: "42501" } }
          : { data: state.pins, error: null }
        : name === "chat_messages_with_mentions"
          ? { data: [message], error: null }
          : name === "chat_reply_previews"
            ? { data: {}, error: null }
            : { data: null, error: null },
    );
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    setTimeout(cb, 0),
  );
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("awaits pin confirmation, shows current context, navigates and unpins", async () => {
  const user = userEvent.setup();
  let settle!: (value: unknown) => void;
  state.rpc.mockImplementation((name: string) =>
    name === "set_chat_topic_message_pin"
      ? new Promise((resolve) => {
          settle = resolve;
        })
      : name === "chat_topic_pinned_messages"
        ? Promise.resolve({ data: state.pins, error: null })
        : name === "chat_messages_with_mentions"
          ? Promise.resolve({ data: [message], error: null })
          : name === "chat_reply_previews"
            ? Promise.resolve({ data: {}, error: null })
            : Promise.resolve({ data: null, error: null }),
  );
  view();
  await user.click(
    screen.getByText("Suche, angeheftete Nachrichten & Hinweise"),
  );
  const pin = await screen.findByRole("button", {
    name: "Nachricht in Gruppe anheften",
  });
  await user.click(pin);
  expect(state.rpc).toHaveBeenCalledWith("set_chat_topic_message_pin", {
    p_message_id: "msg",
    p_pinned: true,
  });
  expect(pin).toHaveAttribute("aria-pressed", "false");
  state.pins = [
    {
      id: "msg",
      sender_name: "Fictional sender",
      body: "Fictional body",
      created_at: message.created_at,
    },
  ];
  await act(async () => settle({ error: null }));
  const list = await screen.findByRole("region", {
    name: "Angeheftete Nachrichten",
  });
  expect(await within(list).findByText("Fictional body")).toBeVisible();
  await user.click(
    within(list).getByRole("button", {
      name: "Zur ursprünglichen Nachricht von Fictional sender",
    }),
  );
  await waitFor(() =>
    expect(document.querySelector('[data-message-id="msg"]')).toHaveFocus(),
  );
  await user.click(
    await screen.findByRole("button", { name: "Nachricht in Gruppe lösen" }),
  );
  expect(state.rpc).toHaveBeenLastCalledWith("set_chat_topic_message_pin", {
    p_message_id: "msg",
    p_pinned: false,
  });
});
it("removes the prior pinned context on an authoritative room denial", async () => {
  state.pins = [
    {
      id: "msg",
      sender_name: "Fictional sender",
      body: "Fictional body",
      created_at: message.created_at,
    },
  ];
  const { client } = view();
  await userEvent.click(
    screen.getByText("Suche, angeheftete Nachrichten & Hinweise"),
  );
  const region = await screen.findByRole("region", {
    name: "Angeheftete Nachrichten",
  });
  expect(await within(region).findByText("Fictional body")).toBeVisible();
  state.denied = true;
  await act(async () => {
    await client.invalidateQueries({
      queryKey: ["chat-messages", "owner", "room"],
    });
  });
  expect(
    await screen.findByText(
      "Du hast keinen Zugriff mehr auf diese Unterhaltung.",
    ),
  ).toBeVisible();
  expect(screen.queryByText("Fictional body")).not.toBeInTheDocument();
});
it("does not offer group pinning in direct messages", async () => {
  view({ ...room, kind: "dm" });
  await screen.findByText("Fictional body");
  expect(
    screen.queryByRole("button", { name: "Nachricht in Gruppe anheften" }),
  ).not.toBeInTheDocument();
  expect(
    state.rpc.mock.calls.some(
      ([name]) => name === "chat_topic_pinned_messages",
    ),
  ).toBe(false);
});
