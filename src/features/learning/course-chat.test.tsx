/** Component checks for scoped course chat and scan/confirmation boundaries. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CourseChat } from "./course-chat";
import i18n from "../../lib/i18n";

const fake = vi.hoisted(() => ({
  rpc: vi.fn(),
  revoked: false,
  canPost: true,
  uploadDocument: vi.fn(),
  uploadAcademyCourseChatAttachment: vi.fn(),
  downloadPortalDocument: vi.fn(),
  attachment: false,
  internalEdition: true,
  roomAvailable: true,
  channel: vi.fn(),
  on: vi.fn(),
  subscribe: vi.fn(),
  removeChannel: vi.fn(),
}));
vi.mock("../../lib/installation-brand", async (load) => ({
  ...(await load<typeof import("../../lib/installation-brand")>()),
  get portalInternalEdition() {
    return fake.internalEdition;
  },
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: fake.rpc,
    channel: fake.channel,
    removeChannel: fake.removeChannel,
  }),
}));
vi.mock("../files/api", () => ({
  acceptedFiles: ".txt",
  uploadDocument: fake.uploadDocument,
  uploadAcademyCourseChatAttachment: fake.uploadAcademyCourseChatAttachment,
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
  fake.internalEdition = true;
  fake.roomAvailable = true;
  const channel = { on: fake.on, subscribe: fake.subscribe };
  fake.channel.mockReset().mockReturnValue(channel);
  fake.on.mockReset().mockReturnValue(channel);
  fake.subscribe.mockReset().mockReturnValue(channel);
  fake.removeChannel.mockReset().mockResolvedValue("ok");
  fake.uploadDocument.mockReset();
  fake.uploadAcademyCourseChatAttachment.mockReset();
  fake.downloadPortalDocument.mockReset();
  fake.rpc.mockReset().mockImplementation((name: string) => {
    if (name === "course_chat_rooms")
      return Promise.resolve(
        fake.revoked
          ? { data: null, error: { code: "42501" } }
          : {
              data: fake.roomAvailable
                ? [
                    {
                      id: "room-a",
                      title: "Fictional course room",
                      can_post: fake.canPost,
                    },
                  ]
                : [],
              error: null,
            },
      );
    if (name === "academy_ensure_course_chat") {
      fake.roomAvailable = true;
      return Promise.resolve({ data: "room-a", error: null });
    }
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
  vi.useRealTimers();
  client.clear();
});

function show(canCreate = false) {
  render(
    <QueryClientProvider client={client}>
      <CourseChat run="course-a" actor="learner" canCreate={canCreate} />
    </QueryClientProvider>,
  );
}

it("opens a dedicated participant channel through the course-specific action", async () => {
  fake.internalEdition = false;
  fake.roomAvailable = false;
  fake.attachment = true;
  const user = userEvent.setup();
  show(true);
  await user.click(
    await screen.findByRole("button", { name: "Open course chat" }),
  );
  expect(fake.rpc).toHaveBeenCalledWith("academy_ensure_course_chat", {
    p_run_id: "course-a",
  });
  expect(await screen.findByText("Fictional course question")).toBeVisible();
  expect(screen.getByLabelText("Attach file")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Download exercise.txt" }),
  ).toBeVisible();
  await user.type(screen.getByLabelText("Message"), "Fictional text reply");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith(
      "send_course_chat_message",
      expect.objectContaining({
        p_room_id: "room-a",
        p_body: "Fictional text reply",
      }),
    ),
  );
  expect(fake.uploadDocument).not.toHaveBeenCalled();
});

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

it("keeps the draft and matching request key when the course rate limit rejects a send", async () => {
  const setup = fake.rpc.getMockImplementation();
  let limited = true;
  fake.rpc.mockImplementation((name, args) =>
    name === "send_course_chat_message" && limited
      ? Promise.resolve({ data: null, error: { code: "PT429" } })
      : setup?.(name, args),
  );
  show();
  const user = userEvent.setup();
  const field = await screen.findByLabelText("Message");
  await user.type(field, "My retained draft");
  await user.click(screen.getByRole("button", { name: "Send message" }));
  expect(
    await screen.findByText(/too many course chat messages/i),
  ).toBeVisible();
  expect(field).toHaveValue("My retained draft");
  limited = false;
  await user.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() => expect(field).toHaveValue(""));
  const attempts = fake.rpc.mock.calls.filter(
    ([name]) => name === "send_course_chat_message",
  );
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toEqual(attempts[1]);
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
  expect(fake.removeChannel).toHaveBeenCalledOnce();
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

it.each([true, false])(
  "keeps the draft until an exact scan receipt (internal edition: %s)",
  async (internal) => {
    fake.internalEdition = internal;
    const user = userEvent.setup();
    let clearScan: (value: unknown) => void = () => undefined;
    const upload = internal
      ? fake.uploadDocument
      : fake.uploadAcademyCourseChatAttachment;
    upload.mockImplementation(
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
    if (internal) {
      expect(upload).toHaveBeenCalledWith(
        file,
        expect.objectContaining({
          roomId: "room-a",
          messageOnly: true,
          courseChat: true,
        }),
        expect.any(Function),
      );
    } else {
      expect(upload).toHaveBeenCalledWith(
        file,
        "room-a",
        expect.any(String),
        expect.any(Function),
      );
      expect(fake.uploadDocument).not.toHaveBeenCalled();
    }
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
  },
);

it("downloads read-only history by message and exact version without querying documents", async () => {
  const user = userEvent.setup();
  fake.internalEdition = false;
  fake.canPost = false;
  fake.attachment = true;
  fake.downloadPortalDocument.mockResolvedValue(undefined);
  show();
  await user.click(
    await screen.findByRole("button", { name: "Download exercise.txt" }),
  );
  expect(screen.queryByLabelText("Attach file")).toBeNull();
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

it("uses scoped metadata only to refresh real history and discards a detached channel", async () => {
  show();
  await screen.findByText("Fictional course question");
  expect(fake.on.mock.calls.map(([type, filter]) => [type, filter])).toEqual([
    [
      "postgres_changes",
      {
        schema: "public",
        table: "course_chat_activity",
        filter: "room_id=eq.room-a",
        event: "INSERT",
      },
    ],
    [
      "postgres_changes",
      {
        schema: "public",
        table: "course_chat_activity",
        filter: "room_id=eq.room-a",
        event: "UPDATE",
      },
    ],
  ]);
  const called = (name: string) =>
    fake.rpc.mock.calls.filter(([rpc]) => rpc === name).length;
  const roomReads = called("course_chat_rooms");
  const historyReads = called("course_chat_messages");
  for (const [, , listener] of fake.on.mock.calls)
    listener({ new: { body: "Untrusted event payload" } });
  await waitFor(() => {
    expect(called("course_chat_rooms")).toBe(roomReads + 1);
    expect(called("course_chat_messages")).toBe(historyReads + 1);
  });
  expect(screen.queryByText("Untrusted event payload")).toBeNull();

  const refresh = fake.on.mock.calls[0][2];
  vi.useFakeTimers();
  refresh();
  cleanup();
  const callsAfterUnmount = fake.rpc.mock.calls.length;
  refresh();
  expect(fake.removeChannel).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(175);
  expect(fake.rpc.mock.calls).toHaveLength(callsAfterUnmount);
});

it("uses a bounded date and id cursor to show older history and can return to the latest page", async () => {
  const user = userEvent.setup();
  const original = fake.rpc.getMockImplementation();
  const sameTimestamp = "2026-11-20T12:00:00Z";
  fake.rpc.mockImplementation((name, args) => {
    if (name !== "course_chat_messages") return original?.(name, args);
    const page = args.p_before_id
      ? [1]
      : Array.from({ length: 51 }, (_, i) => i + 1);
    return Promise.resolve({
      error: null,
      data: page.map((n) => ({
        id: `message-${n}`,
        sender_name: "Peer",
        body: `Fictional message ${n}`,
        created_at: sameTimestamp,
        deleted_at: null,
        attachment: null,
      })),
    });
  });

  show();
  expect(await screen.findByText("Fictional message 2")).toBeVisible();
  expect(screen.queryByText("Fictional message 1")).toBeNull();
  await user.click(screen.getByRole("button", { name: "Load older messages" }));
  expect(await screen.findByText("Fictional message 1")).toBeVisible();
  expect(screen.queryByText("Fictional message 2")).toBeNull();
  expect(fake.rpc).toHaveBeenCalledWith("course_chat_messages", {
    p_room_id: "room-a",
    p_before_at: sameTimestamp,
    p_before_id: "message-2",
    p_limit: 51,
  });
  expect(
    screen.getByRole("heading", { name: "Fictional course room" }),
  ).toHaveFocus();
  expect(
    screen.queryByRole("button", { name: "Load older messages" }),
  ).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Back to latest messages" }),
  );
  expect(await screen.findByText("Fictional message 2")).toBeVisible();
});

it("keeps the three-second access check while cutting idle history reads tenfold", async () => {
  vi.useFakeTimers();
  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  const roomReads = () =>
    fake.rpc.mock.calls.filter(([name]) => name === "course_chat_rooms").length;
  const historyReads = () =>
    fake.rpc.mock.calls.filter(([name]) => name === "course_chat_messages")
      .length;
  show();
  await advance(50);
  const status = fake.subscribe.mock.calls[0][0];
  expect(historyReads()).toBe(1);
  await advance(3_000);
  expect(historyReads()).toBe(2);

  status("SUBSCRIBED");
  await advance(200);
  expect(historyReads()).toBe(3);
  const roomBaseline = roomReads();
  await advance(29_000);
  expect(historyReads()).toBe(3);
  expect(roomReads() - roomBaseline).toBe(9);
  await advance(1_000);
  expect(historyReads()).toBe(4);

  status("CHANNEL_ERROR");
  await advance(200);
  expect(historyReads()).toBe(5);
  await advance(3_000);
  expect(historyReads()).toBe(6);

  status("SUBSCRIBED");
  await advance(200);
  expect(historyReads()).toBe(7);
  fake.revoked = true;
  await advance(3_100);
  expect(screen.queryByText("Fictional course question")).toBeNull();
  expect(screen.getByText(/course chat is unavailable/i)).toBeVisible();
  expect(fake.removeChannel).toHaveBeenCalledOnce();
  expect(historyReads()).toBe(7);
});

it("keeps an in-flight history response and runs one trailing refresh for a burst", async () => {
  vi.useFakeTimers();
  const advance = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };
  show();
  await advance(50);
  const status = fake.subscribe.mock.calls[0][0];
  status("SUBSCRIBED");
  await advance(200);

  const original = fake.rpc.getMockImplementation()!;
  let resolve!: (value: unknown) => void;
  const slow = new Promise((done) => {
    resolve = done;
  });
  fake.rpc.mockImplementation((name, args) =>
    name === "course_chat_messages" ? slow : original(name, args),
  );
  const activity = fake.on.mock.calls[1][2];
  const historyReads = () =>
    fake.rpc.mock.calls.filter(([name]) => name === "course_chat_messages")
      .length;
  activity();
  await advance(200);
  const beforeBurst = historyReads();
  for (let i = 0; i < 5; i++) activity();
  await advance(500);
  expect(historyReads()).toBe(beforeBurst);
  fake.rpc.mockImplementation(original);
  resolve(await original("course_chat_messages", {}));
  await advance(200);
  expect(historyReads()).toBe(beforeBurst + 1);
});
