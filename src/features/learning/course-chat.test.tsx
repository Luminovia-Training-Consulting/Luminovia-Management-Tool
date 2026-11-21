/** Component checks for scoped course chat and scan/confirmation boundaries. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CourseChat } from "./course-chat";
import i18n from "../../lib/i18n";

const fake = vi.hoisted(() => ({
  rpc: vi.fn(),
  revoked: false,
  canPost: true,
  uploadDocument: vi.fn(),
  downloadPortalDocument: vi.fn(),
  attachment: false,
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
vi.mock("../files/api", () => ({
  acceptedFiles: ".txt",
  uploadDocument: fake.uploadDocument,
}));
vi.mock("./api", () => ({
  downloadPortalDocument: fake.downloadPortalDocument,
}));
vi.mock("../../lib/online", () => ({
  useOnline: () => true,
  requireOnline: () => undefined,
}));

let client: QueryClient;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  fake.revoked = false;
  fake.canPost = true;
  fake.attachment = false;
  fake.uploadDocument.mockReset();
  fake.downloadPortalDocument.mockReset();
  fake.rpc.mockReset().mockImplementation((name: string) => {
    if (name === "course_chat_rooms")
      return Promise.resolve(
        fake.revoked
          ? { data: null, error: { code: "42501" } }
          : {
              data: [
                {
                  id: "room-a",
                  title: "Fictional course room",
                  can_post: fake.canPost,
                },
              ],
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
            attachment: fake.attachment
              ? { version_id: "version", name: "exercise.txt", size_bytes: 4 }
              : null,
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

it("shows a scoped read-only room without offering to send", async () => {
  fake.canPost = false;
  render(
    <QueryClientProvider client={client}>
      <CourseChat run="run" actor="company" />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Fictional course question")).toBeVisible();
  expect(
    screen.getByText("You can read messages for this course."),
  ).toBeVisible();
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("keeps the draft from sending until scanning confirms the exact version", async () => {
  const user = userEvent.setup();
  let clearScan: (value: unknown) => void = () => undefined;
  fake.uploadDocument.mockImplementation(
    () =>
      new Promise((resolve) => {
        clearScan = resolve;
      }),
  );
  show();
  const picker = await screen.findByLabelText("Attach file");
  const file = new File(["data"], "exercise.txt", { type: "text/plain" });
  await user.upload(picker, file);
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  expect(fake.uploadDocument).toHaveBeenCalledWith(
    file,
    expect.objectContaining({
      roomId: "room-a",
      messageOnly: true,
      courseChat: true,
    }),
    expect.any(Function),
  );
  clearScan({
    id: "document",
    current_version_id: "version",
    original_name: "exercise.txt",
  });
  await screen.findByText("exercise.txt");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith("send_course_chat_attachment", {
      p_room_id: "room-a",
      p_body: "",
      p_client_id: expect.any(String),
      p_document_id: "document",
      p_version_id: "version",
    }),
  );
});

it("downloads read-only history by message and exact version without querying documents", async () => {
  const user = userEvent.setup();
  fake.canPost = false;
  fake.attachment = true;
  fake.downloadPortalDocument.mockResolvedValue(undefined);
  show();
  await user.click(
    await screen.findByRole("button", { name: "Download exercise.txt" }),
  );
  expect(fake.downloadPortalDocument).toHaveBeenCalledWith(
    {
      kind: "course_chat_attachment",
      id: "message-a",
      version_id: "version",
    },
    "exercise.txt",
    expect.any(AbortSignal),
  );
});
