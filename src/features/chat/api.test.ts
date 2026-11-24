import { QueryClient } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import { chatKeys, chatRoomsQuery } from "./api";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));

test("room polling reuses personal preferences until stale or invalidated", async () => {
  const client = new QueryClient();
  const query = { ...chatRoomsQuery("actor"), staleTime: 0 };
  let pins = ["room"];
  vi.spyOn(Date, "now").mockReturnValue(100_000);
  rpc.mockImplementation(async (name: string) => ({
    data:
      name === "chat_rooms_with_manual_unread"
        ? [{ id: "room" }]
        : name === "chat_pinned_rooms"
          ? pins
          : [],
    error: null,
  }));
  try {
    expect(await client.fetchQuery(query)).toMatchObject([{ pinned: true }]);
    expect(await client.fetchQuery(query)).toMatchObject([{ pinned: true }]);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "chat_rooms_with_manual_unread",
      "chat_pinned_rooms",
      "chat_personal_archives",
      "chat_rooms_with_manual_unread",
    ]);

    pins = [];
    await client.invalidateQueries({ queryKey: chatKeys.rooms("actor") });
    expect(await client.fetchQuery(query)).toMatchObject([{ pinned: false }]);

    pins = ["room"];
    vi.mocked(Date.now).mockReturnValue(131_000);
    expect(await client.fetchQuery(query)).toMatchObject([{ pinned: true }]);
  } finally {
    client.clear();
    vi.restoreAllMocks();
  }
});
