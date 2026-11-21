import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import { RoomUnread } from "./room-unread";
import type { ChatRoom } from "./types";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
const room: ChatRoom = {
  id: "room",
  kind: "topic",
  title: "Fictional",
  job_id: null,
  owner_id: "owner",
  unread_count: 0,
  last_message_at: null,
  muted: false,
  manual_unread: false,
};
const client = new QueryClient({
  defaultOptions: { mutations: { retry: false } },
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.resetAllMocks();
});

function show(current: ChatRoom, selected = false) {
  return render(
    <QueryClientProvider client={client}>
      <RoomUnread actor="actor" room={current} selected={selected} />
    </QueryClientProvider>,
  );
}

it("waits for server confirmation and never invents a read state on failure", async () => {
  await i18n.changeLanguage("de");
  const user = userEvent.setup();
  let resolve!: (result: unknown) => void;
  rpc.mockReturnValue(
    new Promise((r) => {
      resolve = r;
    }),
  );
  show(room);
  await user.click(
    screen.getByRole("button", { name: "Fictional als ungelesen markieren" }),
  );
  expect(rpc).toHaveBeenCalledWith("mark_chat_unread", { p_room_id: "room" });
  expect(
    screen.getByRole("button", { name: "Fictional als ungelesen markieren" }),
  ).toBeDisabled();
  await act(async () => resolve({ error: { code: "42501" } }));
  expect(await screen.findByRole("alert")).toHaveTextContent("nicht bestätigt");
  expect(
    screen.queryByRole("button", { name: "Fictional als gelesen markieren" }),
  ).not.toBeInTheDocument();
});
it("clears a confirmed manual flag or actual unread count using the existing read RPC", async () => {
  await i18n.changeLanguage("en");
  const user = userEvent.setup();
  rpc.mockResolvedValue({ error: null });
  show({ ...room, manual_unread: true });
  await user.click(screen.getByRole("button", { name: "Mark Fictional read" }));
  expect(rpc).toHaveBeenCalledWith("mark_chat_read", {
    p_room_id: "room",
    p_message_id: null,
    p_muted: null,
  });
});
it("prevents marking the currently open thread unread to protect unsent drafts", async () => {
  await i18n.changeLanguage("de");
  show(room, true);
  expect(
    screen.getByRole("button", { name: "Fictional als ungelesen markieren" }),
  ).toBeDisabled();
  expect(
    screen.getByTitle("Schließe zuerst die offene Unterhaltung."),
  ).toBeVisible();
});
