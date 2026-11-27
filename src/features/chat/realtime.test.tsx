/**
 * Regressions for batched revalidation, room changes and immediate cache revocation. Channel
 * fixtures test the hook; real WebSocket/RLS acceptance remains separate.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { useChatRealtime } from "./realtime";
import { chatKeys } from "./api";

type Payload = { new: Record<string, unknown> };
type TestChannel = {
  handlers: Map<string, (payload: Payload) => void>;
  status: (value: string) => void;
  on: (
    kind: string,
    filter: { table: string; event: string },
    handler: (payload: Payload) => void,
  ) => TestChannel;
  subscribe: (callback: (status: string) => void) => TestChannel;
};
const state = vi.hoisted(() => ({
  channels: [] as TestChannel[],
  remove: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    channel: () => {
      const channel: TestChannel = {
        handlers: new Map(),
        status: () => undefined,
        on(_kind, filter, callback) {
          channel.handlers.set(`${filter.table}:${filter.event}`, callback);
          return channel;
        },
        subscribe(callback) {
          channel.status = callback;
          return channel;
        },
      };
      state.channels.push(channel);
      return channel;
    },
    removeChannel: state.remove,
  }),
}));
const clients: QueryClient[] = [];
const keepInFlight = { cancelRefetch: false };
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
  vi.clearAllMocks();
  state.channels = [];
});

/** Expose the real hook's connection/revocation state in the test DOM. */
function Status({ actor, room }: { actor: string; room: string }) {
  const value = useChatRealtime(actor, room);
  return (
    <p>
      {value.status}:{String(value.revoked)}
    </p>
  );
}

/** Render the subject with local provider/router fixtures and an isolated QueryClient. */
function setup() {
  vi.useFakeTimers();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  const invalidate = vi
    .spyOn(client, "invalidateQueries")
    .mockResolvedValue(undefined);
  const element = (actor = "actor-a", room = "room-a") => (
    <QueryClientProvider client={client}>
      <Status actor={actor} room={room} />
    </QueryClientProvider>
  );
  const view = render(element());
  return { client, invalidate, view, element };
}

/** Invoke a registered channel handler with fictional data; no actual WebSocket is opened. */
function emit(
  channel: TestChannel,
  event = "messages:INSERT",
  payload: Payload = { new: { body: "untrusted notification payload" } },
) {
  act(() => channel.handlers.get(event)!(payload));
}

/** Advance the controlled clock inside act so timer-driven React updates settle before assertions. */
async function advance(ms = 200) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

it("coalesces twenty committed message notifications into one authorised message/room refresh", async () => {
  const { client, invalidate } = setup();
  const channel = state.channels[0];
  for (let i = 0; i < 20; i++) emit(channel);
  expect(invalidate).not.toHaveBeenCalled();
  await advance();
  expect(invalidate.mock.calls).toEqual([
    [{ queryKey: chatKeys.messages("actor-a", "room-a") }, keepInFlight],
    [{ queryKey: chatKeys.rooms("actor-a") }, keepInFlight],
  ]);
  expect(
    client.getQueryData([...chatKeys.messages("actor-a", "room-a"), ""]),
  ).toBeUndefined();
  for (let i = 0; i < 20; i++) emit(channel, "messages:UPDATE");
  await advance();
  expect(invalidate).toHaveBeenCalledTimes(3);
});
it("uses a bounded batching window so a continuous stream cannot postpone refresh indefinitely", async () => {
  const { invalidate } = setup();
  for (let i = 0; i < 4; i++) {
    emit(state.channels[0]);
    await advance(50);
  }
  expect(invalidate.mock.calls.length).toBeGreaterThan(0);
});
it.each(["realtime", "already running"])(
  "finishes a slow %s history refresh and follows it with an authorized refetch",
  async (source) => {
    const { client, invalidate } = setup();
    invalidate.mockRestore();
    const messages = [...chatKeys.messages("actor-a", "room-a"), ""];
    client.setQueryData(messages, "initial");
    const replies: ((value: string) => void)[] = [];
    const signals: AbortSignal[] = [];
    const observer = new QueryObserver(client, {
      queryKey: messages,
      refetchOnMount: false,
      queryFn: ({ signal }) => {
        signals.push(signal);
        return new Promise<string>((resolve) => replies.push(resolve));
      },
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      if (source === "already running") void observer.refetch();
      const events = source === "realtime" ? 5 : 1;
      for (let i = 0; i < events; i++) {
        emit(state.channels[0]);
        await advance();
      }
      expect(replies).toHaveLength(1);
      expect(signals[0].aborted).toBe(false);
      replies[0]("first");
      await advance();
      expect(client.getQueryData(messages)).toBe("first");
      expect(replies).toHaveLength(2);
      replies[1]("latest");
      await advance();
      expect(client.getQueryData(messages)).toBe("latest");
      expect(replies).toHaveLength(2);
    } finally {
      unsubscribe();
    }
  },
);
it("refreshes the current history after a personal visibility change from another session", async () => {
  const { invalidate } = setup();
  emit(state.channels[0], "chat_members:UPDATE", {
    new: { room_id: "room-a", removed_at: null, hidden_generation: 1 },
  });
  await advance();
  expect(invalidate.mock.calls).toEqual([
    [{ queryKey: chatKeys.messages("actor-a", "room-a") }, keepInFlight],
    [{ queryKey: chatKeys.rooms("actor-a") }, keepInFlight],
  ]);
});
it("revalidates saved history only when membership visibility changes or the connection was interrupted", async () => {
  const { invalidate } = setup();
  const channel = state.channels[0];
  const rooms = { queryKey: chatKeys.rooms("actor-a") };
  const messages = { queryKey: chatKeys.messages("actor-a", "room-a") };
  const member = {
    room_id: "room-a",
    removed_at: null,
    hidden_generation: 2,
    joined_at: "2026-11-16T00:00:00Z",
  };
  act(() => channel.status("SUBSCRIBED"));
  emit(channel, "chat_members:UPDATE", { new: member });
  await advance();
  expect(invalidate.mock.calls).toEqual([
    [messages, keepInFlight],
    [rooms, keepInFlight],
  ]);

  invalidate.mockClear();
  for (let i = 0; i < 20; i++)
    emit(channel, "chat_members:UPDATE", {
      new: { ...member, last_read_message_id: `fictional-${i}` },
    });
  await advance();
  expect(invalidate.mock.calls).toEqual([[rooms, keepInFlight]]);

  invalidate.mockClear();
  emit(channel, "chat_members:UPDATE", {
    new: { ...member, hidden_generation: 3 },
  });
  await advance();
  expect(invalidate.mock.calls).toEqual([
    [messages, keepInFlight],
    [rooms, keepInFlight],
  ]);

  invalidate.mockClear();
  act(() => channel.status("CHANNEL_ERROR"));
  act(() => channel.status("SUBSCRIBED"));
  await advance();
  expect(invalidate.mock.calls).toEqual([
    [messages, keepInFlight],
    [rooms, keepInFlight],
  ]);
});
it("removes revoked private rows synchronously and cancels queued or late message refreshes", async () => {
  const { client, invalidate } = setup();
  const key = [...chatKeys.messages("actor-a", "room-a"), ""];
  client.setQueryData(key, {
    pages: [[{ body: "previously authorised message" }]],
  });
  client.setQueryData(chatKeys.members("actor-a", "room-a"), [
    { user_id: "actor-a" },
  ]);
  const channel = state.channels[0];
  emit(channel);
  invalidate.mockClear();
  emit(channel, "chat_members:UPDATE", {
    new: { room_id: "room-a", removed_at: "2026-11-16T00:00:00Z" },
  });
  expect(client.getQueryData(key)).toBeUndefined();
  expect(
    client.getQueryData(chatKeys.members("actor-a", "room-a")),
  ).toBeUndefined();
  expect(screen.getByText("connecting:true")).toBeInTheDocument();
  expect(invalidate.mock.calls).toEqual([
    [{ queryKey: chatKeys.rooms("actor-a") }],
  ]);
  emit(channel);
  await advance();
  expect(invalidate).toHaveBeenCalledTimes(1);
});
it("cancels old actor/room timers and ignores old channel callbacks after cleanup", async () => {
  const { invalidate, view, element } = setup();
  const old = state.channels[0];
  emit(old);
  invalidate.mockClear();
  view.rerender(element("actor-b", "room-b"));
  const current = state.channels[1];
  expect(state.remove).toHaveBeenCalledWith(old);
  emit(old);
  act(() => current.status("SUBSCRIBED"));
  act(() => old.status("CLOSED"));
  expect(screen.getByText("connected:false")).toBeInTheDocument();
  await advance();
  expect(invalidate).not.toHaveBeenCalled();
  emit(current);
  await advance();
  expect(invalidate.mock.calls).toEqual([
    [{ queryKey: chatKeys.messages("actor-b", "room-b") }, keepInFlight],
    [{ queryKey: chatKeys.rooms("actor-b") }, keepInFlight],
  ]);
  emit(current);
  view.unmount();
  invalidate.mockClear();
  await advance();
  expect(invalidate).not.toHaveBeenCalled();
  expect(state.remove).toHaveBeenCalledTimes(2);
});
