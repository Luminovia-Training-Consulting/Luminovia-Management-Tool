/**
 * Regressions for batched revalidation, room changes and immediate cache revocation. Channel
 * fixtures test the hook; real WebSocket/RLS acceptance remains separate.
 */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
    [{ queryKey: chatKeys.messages("actor-a", "room-a") }],
    [{ queryKey: chatKeys.rooms("actor-a") }],
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
    [{ queryKey: chatKeys.messages("actor-b", "room-b") }],
    [{ queryKey: chatKeys.rooms("actor-b") }],
  ]);
  emit(current);
  view.unmount();
  invalidate.mockClear();
  await advance();
  expect(invalidate).not.toHaveBeenCalled();
  expect(state.remove).toHaveBeenCalledTimes(2);
});
