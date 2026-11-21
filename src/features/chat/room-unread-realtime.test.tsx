/** Realtime is a refetch signal; the test does not simulate native WebSocket/RLS. */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useChatRealtime } from "./realtime";

const state = vi.hoisted(() => ({
  callback: null as null | ((value: unknown) => void),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    channel: () => {
      const channel = {
        on: (
          _kind: string,
          filter: { table: string },
          callback: (value: unknown) => void,
        ) => {
          if (filter.table === "chat_members") state.callback = callback;
          return channel;
        },
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: vi.fn(),
  }),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  state.callback = null;
});
it("refreshes the server-confirmed room list when another session changes the unread marker", async () => {
  vi.useFakeTimers();
  const client = new QueryClient();
  const invalidate = vi
    .spyOn(client, "invalidateQueries")
    .mockResolvedValue(undefined);

  function Subject() {
    useChatRealtime("actor", "room");
    return null;
  }

  render(
    <QueryClientProvider client={client}>
      <Subject />
    </QueryClientProvider>,
  );
  act(() =>
    state.callback!({
      new: {
        room_id: "room",
        removed_at: null,
        manual_unread_at: "2026-11-17T00:00:00Z",
      },
    }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ["chat-rooms", "actor"],
  });
  client.clear();
});
