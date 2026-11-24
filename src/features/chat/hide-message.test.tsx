/** Hiding is personal, explicitly confirmed, and waits for the actual server. */
import { afterEach, expect, it, vi } from "vitest";
import {
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
import { MessageBubble } from "./message";
import type { ChatMessage } from "./types";

const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
const message: ChatMessage = {
  id: "message",
  room_id: "room",
  sender_id: "other",
  sender_name: "Fictional",
  body: "Private example",
  created_at: "2035-01-01T00:00:00Z",
  edited_at: null,
  deleted_at: null,
  document_id: null,
  reactions: [],
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("confirms personal-only scope and keeps the dialog open until the server responds", async () => {
  await i18n.changeLanguage("de");
  let complete!: (result: unknown) => void;
  fake.rpc.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MessageBubble
          message={message}
          actor="viewer"
          zone="UTC"
          editable
          online
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Für mich ausblenden" }));
  const dialog = screen.getByRole("dialog");
  expect(
    within(dialog).getByText(/Andere Mitglieder sehen sie weiterhin/),
  ).toBeVisible();
  await user.click(
    within(dialog).getByRole("button", { name: "Für mich ausblenden" }),
  );
  expect(fake.rpc).toHaveBeenCalledWith("hide_chat_message", {
    p_message_id: "message",
  });
  expect(dialog).toBeVisible();
  complete({ error: null });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  client.clear();
});
it("keeps personal hiding unconfirmed when the server rejects it", async () => {
  await i18n.changeLanguage("en");
  fake.rpc.mockResolvedValue({ error: { code: "42501" } });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MessageBubble
          message={message}
          actor="viewer"
          zone="UTC"
          editable
          online
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Hide for me" }));
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Hide for me" }));
  expect(await within(dialog).findByRole("alert")).toBeVisible();
  expect(screen.getByText("Private example")).toBeVisible();
  client.clear();
  await i18n.changeLanguage("de");
});
