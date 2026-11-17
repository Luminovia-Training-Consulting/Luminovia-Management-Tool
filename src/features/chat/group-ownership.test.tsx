import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import { GroupOwnership } from "./group-ownership";
import type { ChatRoom } from "./types";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
let client: QueryClient;
const room: ChatRoom = {
  id: "room",
  kind: "topic",
  title: "Group",
  job_id: null,
  owner_id: "owner",
  unread_count: 0,
  last_message_at: null,
  muted: false,
};
const members = [
  { user_id: "owner", display_name: "Owner", joined_at: "2026-01-01" },
  { user_id: "member", display_name: "Member", joined_at: "2026-01-01" },
];
beforeEach(async () => {
  await i18n.changeLanguage("de");
  rpc.mockReset().mockResolvedValue({ error: null });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});
function view(actor: string, onLeft = vi.fn()) {
  render(
    <QueryClientProvider client={client}>
      <GroupOwnership
        actor={actor}
        room={room}
        members={members}
        onLeft={onLeft}
      />
    </QueryClientProvider>,
  );
}
it("requires a reviewed target and server confirmation for transfer", async () => {
  const user = userEvent.setup();
  view("owner");
  const transfer = screen.getByRole("button", {
    name: "Gruppenverantwortung übertragen",
  });
  expect(transfer).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Gruppe verlassen" }),
  ).not.toBeInTheDocument();
  await user.selectOptions(
    screen.getByLabelText("Verantwortung übertragen an"),
    "member",
  );
  await user.click(transfer);
  const dialog = screen.getByRole("dialog");
  expect(rpc).not.toHaveBeenCalled();
  await user.click(
    within(dialog).getByRole("button", {
      name: "Gruppenverantwortung übertragen",
    }),
  );
  expect(rpc).toHaveBeenCalledWith("transfer_topic_group_owner", {
    p_room_id: "room",
    p_new_owner_id: "member",
  });
  expect(
    await screen.findByText("Die Gruppenverantwortung wurde übertragen."),
  ).toBeVisible();
});
it("does not hide history or leave on failed server confirmation", async () => {
  const user = userEvent.setup();
  const onLeft = vi.fn();
  rpc.mockResolvedValue({ error: { code: "42501" } });
  client.setQueryData(["chat-messages", "member", "room", ""], {
    pages: [[{ body: "private" }]],
  });
  view("member", onLeft);
  await user.click(screen.getByRole("button", { name: "Gruppe verlassen" }));
  const dialog = screen.getByRole("dialog");
  await user.click(
    within(dialog).getByRole("button", { name: "Gruppe verlassen" }),
  );
  expect(await within(dialog).findByRole("alert")).toBeVisible();
  expect(onLeft).not.toHaveBeenCalled();
  expect(
    client.getQueryData(["chat-messages", "member", "room", ""]),
  ).toBeDefined();
});
it("removes cached room data after confirmed departure", async () => {
  const user = userEvent.setup();
  const onLeft = vi.fn();
  client.setQueryData(["chat-messages", "member", "room", ""], {
    pages: [[{ body: "private" }]],
  });
  view("member", onLeft);
  await user.click(screen.getByRole("button", { name: "Gruppe verlassen" }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Gruppe verlassen",
    }),
  );
  await waitFor(() => expect(onLeft).toHaveBeenCalledOnce());
  expect(
    client.getQueryData(["chat-messages", "member", "room", ""]),
  ).toBeUndefined();
});
