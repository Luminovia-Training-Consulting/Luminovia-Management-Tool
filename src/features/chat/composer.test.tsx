/**
 * Regressions for retained drafts/retry identities and confirmed clean attachments. Controlled
 * SDK/DOM fixtures do not replace real chat/Storage acceptance.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MessageComposer } from "./composer";

const { rpc, uploadDocument } = vi.hoisted(() => ({
  rpc: vi.fn(),
  uploadDocument: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../files/api", () => ({ uploadDocument }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/** Render the subject with local provider/router fixtures and an isolated QueryClient. */
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MessageComposer actor="lecturer-a" room="room-a" />
    </QueryClientProvider>,
  );
}

describe("confirmed chat composer", () => {
  it("preserves a failed draft and the same idempotency key on retry", async () => {
    const user = userEvent.setup();
    rpc
      .mockResolvedValueOnce({
        data: null,
        error: { message: "Network result uncertain" },
      })
      .mockResolvedValueOnce({ data: "confirmed-message", error: null });
    setup();
    await user.type(
      screen.getByLabelText("Deine Nachricht"),
      "Entwurf bleibt erhalten",
    );
    await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Deine Nachricht")).toHaveValue(
      "Entwurf bleibt erhalten",
    );
    await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
    await screen.findByText("Nachricht gesendet.");
    expect(rpc.mock.calls[0][1].p_client_id).toBe(
      rpc.mock.calls[1][1].p_client_id,
    );
    expect(rpc.mock.calls[1][1]).toEqual({
      p_room_id: "room-a",
      p_body: "Entwurf bleibt erhalten",
      p_client_id: expect.any(String),
      p_document_id: null,
      p_mention_ids: [],
    });
    expect(screen.getByLabelText("Deine Nachricht")).toHaveValue("");
  });
  it("cannot send an attachment until its upload and scanner are confirmed", async () => {
    const user = userEvent.setup();
    let clean: (value: { id: string; original_name: string }) => void = () =>
      undefined;
    uploadDocument.mockImplementation(
      () =>
        new Promise((resolve) => {
          clean = resolve;
        }),
    );
    rpc.mockResolvedValue({ data: "message-with-file", error: null });
    setup();
    const file = new File(["Safe fictional text"], "lesson.txt", {
      type: "text/plain",
    });
    await user.upload(screen.getByLabelText("Datei anhängen"), file);
    await screen.findByText(/Datei wird hochgeladen und geprüft/);
    expect(
      screen.getByRole("button", { name: "Nachricht senden" }),
    ).toBeDisabled();
    expect(rpc).not.toHaveBeenCalled();
    expect(uploadDocument).toHaveBeenCalledWith(
      expect.any(File),
      expect.objectContaining({
        scope: "room",
        roomId: "room-a",
        messageOnly: true,
      }),
      expect.any(Function),
    );
    clean({ id: "clean-document", original_name: "lesson.txt" });
    await screen.findByText("lesson.txt");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Nachricht senden" }),
      ).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
    await screen.findByText("Nachricht gesendet.");
    expect(rpc).toHaveBeenCalledWith(
      "send_message_with_mentions",
      expect.objectContaining({ p_document_id: "clean-document", p_body: "" }),
    );
  });
  it("does not treat a rejected upload as an available attachment", async () => {
    const user = userEvent.setup();
    uploadDocument.mockRejectedValue(new Error("scan_rejected"));
    setup();
    await user.upload(
      screen.getByLabelText("Datei anhängen"),
      new File(["Fictional sample"], "lesson.txt", { type: "text/plain" }),
    );
    await screen.findByText(/Die Datei konnte nicht freigegeben werden/);
    expect(screen.queryByText("lesson.txt")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Nachricht senden" }));
    expect(rpc).not.toHaveBeenCalled();
  });
});
