/** Query adapter regressions for independent room access checks and canceled history reads. */
import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import {
  chatKeys,
  chatMessagesQuery,
  chatRoomPreferencesQuery,
  chatRoomsQuery,
  decorateChatRooms,
} from "./api";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
afterEach(() => {
  client.clear();
  vi.resetAllMocks();
});

test("room invalidations reuse personal preferences and omit a revoked room even if preferences fail", async () => {
  const actor = "actor";
  const room = { id: "room" };
  const remaining = { id: "remaining" };
  const rooms = chatRoomsQuery(actor);
  const preferences = chatRoomPreferencesQuery(actor);
  let visible = [room, remaining];
  rpc.mockImplementation(async (name: string) => ({
    data:
      name === "chat_rooms_with_manual_unread"
        ? visible
        : name === "chat_pinned_rooms"
          ? ["room"]
          : ["remaining"],
    error: null,
  }));
  const initialRooms = await client.fetchQuery(rooms);
  const initial = await client.fetchQuery(preferences);
  expect(decorateChatRooms(initialRooms, initial)).toMatchObject([
    { id: "room", pinned: true, pinOrder: 0, personal_archived: false },
    { id: "remaining", pinned: false, personal_archived: true },
  ]);

  // A published directory update must not request either personal projection.
  visible = [remaining];
  await client.invalidateQueries({ queryKey: chatKeys.rooms(actor) });
  expect(await client.fetchQuery(preferences)).toBe(initial);
  const afterRevocation = await client.fetchQuery(rooms);
  expect(rpc.mock.calls.map(([name]) => name)).toEqual([
    "chat_rooms_with_manual_unread",
    "chat_pinned_rooms",
    "chat_personal_archives",
    "chat_rooms_with_manual_unread",
  ]);

  const error = { code: "503", message: "Preferences unavailable" };
  rpc.mockResolvedValue({ data: null, error });
  await client.invalidateQueries({ queryKey: chatKeys.roomPreferences(actor) });
  await expect(client.fetchQuery(preferences)).rejects.toEqual(error);
  expect(
    decorateChatRooms(
      afterRevocation,
      client.getQueryData(preferences.queryKey),
    ),
  ).toMatchObject([{ id: "remaining", personal_archived: true }]);
});

test.each([false, true])(
  "canceling history aborts its active request (reply preview started: %s)",
  async (startedPreview) => {
    const query = chatMessagesQuery("actor", "room", "old search");
    let resolveResponse!: (value: { data: unknown; error: null }) => void;
    let recordSignal!: (signal: AbortSignal) => void;
    const response = new Promise<{ data: unknown; error: null }>((resolve) => {
      resolveResponse = resolve;
    });
    const activeRequest = new Promise<AbortSignal>((resolve) => {
      recordSignal = resolve;
    });
    rpc.mockImplementation((name: string) => ({
      abortSignal(signal: AbortSignal) {
        if (startedPreview && name === "chat_messages_with_mentions") {
          return Promise.resolve({ data: [{ id: "message" }], error: null });
        }
        recordSignal(signal);
        return response;
      },
    }));
    const historyFetch = client.fetchInfiniteQuery(query);
    const canceled = expect(historyFetch).rejects.toHaveProperty(
      "name",
      "Error",
    );
    const signal = await activeRequest;
    await client.cancelQueries({ queryKey: query.queryKey });
    expect(signal.aborted).toBe(true);
    // Simulate a response that arrives as cancellation is delivered. Its result
    // must not enter the cache or start another RPC for an abandoned page.
    resolveResponse({ data: [{ id: "message" }], error: null });
    await canceled;
    await Promise.resolve();
    expect(client.getQueryData(query.queryKey)).toBeUndefined();
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(
      startedPreview
        ? ["chat_messages_with_mentions", "chat_reply_previews"]
        : ["chat_messages_with_mentions"],
    );
  },
);
