/** Structured-mention edit/retry and moderation regressions retain real routing
 * for the message-to-task link; fictional RPC fixtures never authorize access. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { MessageComposer } from "./composer";
import { MessageBubble } from "./message";
import type { ChatMessage } from "./types";

const fake = vi.hoisted(() => ({ rpc: vi.fn(), uploadDocument: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
vi.mock("../files/api", () => ({ uploadDocument: fake.uploadDocument }));
const target = {
  user_id: "8a9877f3-7967-43a6-8026-98612c91cfc1",
  display_name: "Fictional <img> Ada",
};
const clients: QueryClient[] = [];

function view(element: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const wrap = (node: React.ReactNode) => (
    <QueryClientProvider client={client}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>
  );
  const result = render(wrap(element));
  return {
    ...result,
    update: (node: React.ReactNode) => result.rerender(wrap(node)),
  };
}

function composer() {
  return view(<MessageComposer actor="author" room="room" />);
}

const message: ChatMessage = {
  id: "message",
  room_id: "room",
  sender_id: "author",
  sender_name: "Fictional author",
  body: "Fictional body",
  created_at: "2035-01-01T08:00:00Z",
  edited_at: null,
  deleted_at: null,
  document_id: null,
  reactions: [],
  content_version: 2,
  mentions: [target],
};
beforeEach(async () => {
  await i18n.changeLanguage("de");
  fake.rpc.mockReset().mockImplementation(async (name: string) => ({
    data: name === "chat_mention_candidates" ? [target] : "confirmed",
    error: null,
  }));
  fake.uploadDocument
    .mockReset()
    .mockResolvedValue({ id: "clean-file", original_name: "lesson.txt" });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.unstubAllGlobals();
});
describe("structured conversation mentions", () => {
  it("fetches only on picker demand and sends explicitly selected current IDs, not typed @names", async () => {
    const user = userEvent.setup();
    composer();
    expect(fake.rpc).not.toHaveBeenCalled();
    await user.type(
      screen.getByLabelText("Deine Nachricht"),
      "@unrelated This stays text",
    );
    await user.click(screen.getByRole("button", { name: "Personen erwähnen" }));
    await user.click(
      await screen.findByRole("checkbox", { name: target.display_name }),
    );
    expect(fake.rpc).toHaveBeenCalledWith("chat_mention_candidates", {
      p_room_id: "room",
    });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
    await screen.findByText("Nachricht gesendet.");
    expect(fake.rpc).toHaveBeenCalledWith(
      "send_message_with_mentions",
      expect.objectContaining({
        p_mention_ids: [target.user_id],
        p_body: "@unrelated This stays text",
      }),
    );
    expect(
      screen.queryByRole("list", { name: "Ausgewählte Erwähnungen" }),
    ).not.toBeInTheDocument();
  });
  it("preserves mentions and retry identity after uncertain send; changing targets creates a new operation", async () => {
    const user = userEvent.setup();
    fake.rpc.mockImplementation(async (name: string) =>
      name === "chat_mention_candidates"
        ? { data: [target], error: null }
        : { data: null, error: { code: "network" } },
    );
    composer();
    await user.type(
      screen.getByLabelText("Deine Nachricht"),
      "Fictional uncertain draft",
    );
    await user.click(screen.getByRole("button", { name: "Personen erwähnen" }));
    await user.click(
      await screen.findByRole("checkbox", { name: target.display_name }),
    );
    for (let i = 0; i < 2; i++) {
      await user.click(
        screen.getByRole("button", { name: "Nachricht senden" }),
      );
      await screen.findByRole("alert");
    }
    const sends = fake.rpc.mock.calls.filter(
      (call) => call[0] === "send_message_with_mentions",
    );
    expect(sends[0][1]).toEqual(sends[1][1]);
    await user.click(
      screen.getByRole("button", {
        name: `Erwähnung von ${target.display_name} entfernen`,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
    await screen.findByRole("alert");
    const final = fake.rpc.mock.calls
      .filter((call) => call[0] === "send_message_with_mentions")
      .at(-1)!;
    expect(final[1].p_mention_ids).toEqual([]);
    expect(final[1].p_client_id).not.toBe(sends[0][1].p_client_id);
  });
  it("does not display retained candidate names after a permission error", async () => {
    const user = userEvent.setup();
    composer();
    await user.click(screen.getByRole("button", { name: "Personen erwähnen" }));
    await screen.findByRole("checkbox", { name: target.display_name });
    await user.click(screen.getByRole("button", { name: "Personen erwähnen" }));
    fake.rpc.mockResolvedValue({ data: null, error: { code: "42501" } });
    await user.click(screen.getByRole("button", { name: "Personen erwähnen" }));
    await screen.findByRole("alert");
    expect(
      screen.queryByRole("checkbox", { name: target.display_name }),
    ).not.toBeInTheDocument();
  });
  it("edits bind the current content version and retain the exact retry key on failure", async () => {
    const user = userEvent.setup();
    fake.rpc.mockResolvedValue({ data: null, error: { code: "network" } });
    view(
      <MessageBubble
        message={message}
        actor="author"
        zone="Europe/Berlin"
        editable
        online
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Nachricht bearbeiten" }),
    );
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Deine Nachricht"),
      " revised",
    );
    for (let i = 0; i < 2; i++) {
      await user.click(
        within(dialog).getByRole("button", { name: "Speichern" }),
      );
      await within(dialog).findByRole("alert");
    }
    expect(fake.rpc.mock.calls[0]).toEqual([
      "edit_message_with_mentions",
      expect.objectContaining({
        p_expected_version: 2,
        p_mention_ids: [target.user_id],
        p_body: "Fictional body revised",
      }),
    ]);
    expect(fake.rpc.mock.calls[0][1]).toEqual(fake.rpc.mock.calls[1][1]);
  });
  it("keeps the revision captured when editing opened even when a poll refreshes the visible message", async () => {
    const user = userEvent.setup();
    fake.rpc.mockResolvedValue({ data: null, error: { code: "40001" } });
    const bubble = (current: ChatMessage) => (
      <MessageBubble
        message={current}
        actor="author"
        zone="UTC"
        editable
        online
      />
    );
    const page = view(bubble(message));
    await user.click(
      screen.getByRole("button", { name: "Nachricht bearbeiten" }),
    );
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Deine Nachricht"), " draft");
    page.update(
      bubble({
        ...message,
        body: "Another committed revision",
        content_version: 3,
      }),
    );
    await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "inzwischen geändert",
    );
    expect(fake.rpc).toHaveBeenCalledWith(
      "edit_message_with_mentions",
      expect.objectContaining({
        p_expected_version: 2,
        p_body: "Fictional body draft",
      }),
    );
    expect(within(dialog).getByLabelText("Deine Nachricht")).toHaveValue(
      "Fictional body draft",
    );
  });
  it("only server-authorized group moderation exposes foreign deletion and awaits confirmation", async () => {
    const user = userEvent.setup();
    let complete!: (value: unknown) => void;
    fake.rpc.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    view(
      <MessageBubble
        message={{ ...message, can_moderate: true }}
        actor="moderator"
        zone="UTC"
        editable
        online
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Nachricht bearbeiten" }),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Gruppenbeitrag moderieren" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(/Vorgang wird protokolliert/),
    ).toBeVisible();
    await user.click(
      within(dialog).getByRole("button", { name: "Nachricht löschen" }),
    );
    expect(fake.rpc).toHaveBeenCalledWith("delete_message", {
      p_message_id: message.id,
    });
    expect(dialog).toBeVisible();
    await act(async () => complete({ error: null }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
  it("copies the displayed message only after clipboard confirmation and handles rejection", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("denied"));
    vi.spyOn(navigator.clipboard, "writeText").mockImplementation(writeText);
    view(
      <MessageBubble
        message={message}
        actor="author"
        zone="UTC"
        editable
        online
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Nachrichtentext kopieren" }),
    );
    expect(writeText).toHaveBeenCalledWith("Fictional body");
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Nachrichtentext kopiert.",
    );
    await user.click(
      screen.getByRole("button", { name: "Nachrichtentext kopieren" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("manuell");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("does not offer copying a deleted message", () => {
    view(
      <MessageBubble
        message={{ ...message, deleted_at: "2035-01-01T08:02:00Z" }}
        actor="author"
        zone="UTC"
        editable
        online
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Nachrichtentext kopieren" }),
    ).not.toBeInTheDocument();
  });
  it("uses the existing scanner for a dropped file and blocks send until clean", async () => {
    let clean!: (value: unknown) => void;
    fake.uploadDocument.mockImplementation(
      () =>
        new Promise((resolve) => {
          clean = resolve;
        }),
    );
    composer();
    fireEvent.drop(
      screen.getByRole("button", { name: "Nachricht senden" }).closest("form")!,
      {
        dataTransfer: {
          files: [
            new File(["Fictional safe lesson"], "lesson.txt", {
              type: "text/plain",
            }),
          ],
        },
      },
    );
    expect(
      await screen.findByText(/Datei wird hochgeladen und geprüft/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Nachricht senden" }),
    ).toBeDisabled();
    expect(fake.uploadDocument).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({ scope: "room", roomId: "room" }),
      expect.any(Function),
    );
    await act(async () =>
      clean({ id: "clean-file", original_name: "lesson.txt" }),
    );
    expect(await screen.findByText("lesson.txt")).toBeVisible();
  });
  it("rejects multiple-file drops and retains the keyboard file picker", async () => {
    composer();
    fireEvent.drop(
      screen.getByRole("button", { name: "Nachricht senden" }).closest("form")!,
      {
        dataTransfer: {
          files: [new File(["a"], "a.txt"), new File(["b"], "b.txt")],
        },
      },
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "genau eine Datei",
    );
    expect(fake.uploadDocument).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Datei anhängen")).toHaveAttribute(
      "type",
      "file",
    );
  });
});
