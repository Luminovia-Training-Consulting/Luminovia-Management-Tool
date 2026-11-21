import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CourseChat } from "./course-chat";
import i18n from "../../lib/i18n";

const fake = vi.hoisted(() => ({ rpc: vi.fn(), revoked: false }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
vi.mock("../../lib/online", () => ({
  useOnline: () => true,
  requireOnline: () => undefined,
}));

let client: QueryClient;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  fake.revoked = false;
  fake.rpc.mockReset().mockImplementation((name: string) => {
    if (name === "course_chat_rooms")
      return Promise.resolve(
        fake.revoked
          ? { data: null, error: { code: "42501" } }
          : {
              data: [{ id: "room-a", title: "Fictional course room" }],
              error: null,
            },
      );
    if (name === "course_chat_messages")
      return Promise.resolve({
        data: [
          {
            id: "message-a",
            sender_id: "peer",
            sender_name: "Peer",
            body: "Fictional course question",
            created_at: "2026-11-20T12:00:00Z",
            deleted_at: null,
          },
        ],
        error: null,
      });
    return Promise.resolve({ data: "saved-message", error: null });
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});

function show() {
  render(
    <QueryClientProvider client={client}>
      <CourseChat run="course-a" actor="learner" />
    </QueryClientProvider>,
  );
}

it("shows only current course-room text and posts without attachment arguments", async () => {
  const user = userEvent.setup();
  show();
  expect(await screen.findByText("Fictional course question")).toBeTruthy();
  await user.type(screen.getByLabelText("Message"), "A safe reply");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith(
      "send_course_chat_message",
      expect.objectContaining({ p_room_id: "room-a", p_body: "A safe reply" }),
    ),
  );
  const sendArgs = fake.rpc.mock.calls.find(
    ([name]) => name === "send_course_chat_message",
  )?.[1];
  expect(Object.keys(sendArgs).sort()).toEqual([
    "p_body",
    "p_client_id",
    "p_room_id",
  ]);
});

it("hides retained messages when a fresh course-room check revokes access", async () => {
  show();
  expect(await screen.findByText("Fictional course question")).toBeTruthy();
  fake.revoked = true;
  await client.invalidateQueries({
    queryKey: ["course-chat-rooms", "learner", "course-a"],
  });
  expect(await screen.findByText(/course chat is unavailable/i)).toBeTruthy();
  expect(screen.queryByText("Fictional course question")).toBeNull();
  expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
});
