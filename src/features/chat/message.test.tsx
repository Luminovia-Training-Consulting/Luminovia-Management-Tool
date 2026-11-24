/**
 * Regressions for literal untrusted text, author boundaries, confirmed edits and hidden deleted
 * content. UI fixtures do not replace actual chat authorization.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MessageBubble, MessageText } from "./message";
import { orderedCursorRows } from "../../lib/cursor-rows";
import type { ChatMessage } from "./types";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const message: ChatMessage = {
  id: "message-a",
  room_id: "room-a",
  sender_id: "lecturer-a",
  sender_name: "Mara Beispiel",
  body: "Gemeinsam lernen.",
  created_at: "2027-01-18T08:00:00Z",
  edited_at: null,
  deleted_at: null,
  document_id: null,
  reactions: [],
};

/** Render a real message bubble with an isolated cache and selectable fictional author. */
function bubble(value: ChatMessage = message, actor = "lecturer-a") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MessageBubble
          message={value}
          actor={actor}
          zone="Europe/Berlin"
          editable
          online
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("safe chat presentation and confirmed edits", () => {
  it("preserves code and untrusted HTML as text and links only explicit HTTP(S)", () => {
    const text =
      "<img src=x onerror=alert(1)> javascript:alert(1) https://example.invalid/hello";
    render(
      <p>
        <MessageText body={text} />
      </p>,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://example.invalid/hello");
    expect(links[0]).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getByText(/<img src=x/)).toBeInTheDocument();
  });
  it("never presents another sender edit/delete controls", () => {
    bubble(message, "lecturer-b");
    expect(
      screen.queryByRole("button", { name: "Nachricht bearbeiten" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Nachricht löschen" }),
    ).not.toBeInTheDocument();
  });
  it("does not erase a message until the server confirms deletion", async () => {
    const user = userEvent.setup();
    let finish: (result: { error: null }) => void = () => undefined;
    rpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    bubble();
    await user.click(screen.getByRole("button", { name: "Nachricht löschen" }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", {
        name: "Nachricht löschen",
      }),
    );
    expect(rpc).toHaveBeenCalledWith("delete_message", {
      p_message_id: message.id,
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByText(message.body)).toHaveLength(2);
    finish({ error: null });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
  it("retains the edit draft when backend confirmation fails", async () => {
    rpc.mockResolvedValue({ error: { code: "42501" } });
    const user = userEvent.setup();
    bubble();
    await user.click(
      screen.getByRole("button", { name: "Nachricht bearbeiten" }),
    );
    const dialog = screen.getByRole("dialog");
    const input = within(dialog).getByLabelText("Deine Nachricht");
    await user.clear(input);
    await user.type(input, "Geänderter Text");
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toBeInTheDocument(),
    );
    expect(input).toHaveValue("Geänderter Text");
    expect(screen.getByText(message.body)).toBeInTheDocument();
  });
  it("renders tombstones without revealing deleted body or attachment", () => {
    bubble({ ...message, deleted_at: "2027-01-18T08:01:00Z" });
    expect(
      screen.getByText("Diese Nachricht wurde gelöscht."),
    ).toBeInTheDocument();
    expect(screen.queryByText(message.body)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Nachricht bearbeiten" }),
    ).not.toBeInTheDocument();
  });
  it("orders authorised pages chronologically without duplicate rows", () => {
    const b = {
      ...message,
      id: "message-b",
      created_at: "2027-01-18T09:00:00Z",
    };
    expect(orderedCursorRows([[b, message], [message]], "ascending")).toEqual([
      message,
      b,
    ]);
  });
});
