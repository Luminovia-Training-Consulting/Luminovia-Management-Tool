/**
 * Exercise the current inbox/preferences client contract using real query
 * observers and fictional transport replies. Preserve cursor identity, reject
 * unsafe DTOs and never turn a denied acknowledgement into a successful count.
 */
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type InboxPage,
  markNotifications,
  mergeNotificationPages,
  notificationInboxQuery,
  type NotificationItem,
  notificationPreferencesQuery,
  notificationPreviewQuery,
  refreshNotifications,
  saveNotificationPreferences,
} from "./api";

// No account or database is contacted. Query execution, response validation and
// cache ownership remain the production implementations under test.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
const clients: QueryClient[] = [];

/** Isolate actor caches and expose a failed request without automatic retries. */
function client() {
  const value = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(value);
  return value;
}

// All authored content, IDs and timestamps below belong to fictional fixtures.
const notice: NotificationItem = {
  id: "5b7275ea-b1a5-4570-9141-8d22a2756de3",
  kind: "claim_confirmed",
  title: "Fictional accepted assignment",
  href: "/jobs/job-a",
  read_at: null,
  created_at: "2030-01-01T10:00:00Z",
};
const preferences = {
  chat: true,
  forum: false,
  job_updates: true,
  reminders: false,
  version: 4,
};
/** Build a finite server page; unread totals deliberately exceed loaded items. */
const page = (items = [notice]): InboxPage => ({
  items,
  unread_count: 50,
  as_of: "2030-01-01T11:00:00Z",
});

/** Mimic the awaitable RPC/abortSignal interface without bypassing DTO parsing. */
function response(data: unknown, error: unknown = null) {
  const result = Promise.resolve({ data, error });
  return Object.assign(result, {
    abortSignal: vi.fn().mockReturnValue(result),
  });
}

beforeEach(() => rpc.mockReset());
afterEach(() => {
  // Observers are destroyed by their scenarios; release the remaining caches.
  clients.splice(0).forEach((value) => value.clear());
});

describe("bounded notification pagination", () => {
  it("continues from the exact last timestamp and UUID and stops after a short page", async () => {
    const first = page(
      Array.from({ length: 40 }, (_, index) => ({
        ...notice,
        id: `00000000-0000-4000-8000-${String(100 - index).padStart(12, "0")}`,
      })),
    );
    const last = first.items[39];
    const second = page([
      { ...notice, id: "00000000-0000-4000-8000-000000000060" },
    ]);
    const request = response(first);
    rpc.mockReturnValueOnce(request).mockReturnValueOnce(response(second));
    const cache = client();
    const query = notificationInboxQuery("actor-a", true);
    await cache.fetchInfiniteQuery(query);
    const observer = new InfiniteQueryObserver(cache, query);
    const result = await observer.fetchNextPage();
    expect(rpc.mock.calls).toEqual([
      [
        "notification_inbox",
        {
          p_unread_only: true,
          p_before_at: null,
          p_before_id: null,
          p_limit: 40,
        },
      ],
      [
        "notification_inbox",
        {
          p_unread_only: true,
          p_before_at: last.created_at,
          p_before_id: last.id,
          p_limit: 40,
        },
      ],
    ]);
    expect(request.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(result.data?.pages).toEqual([first, second]);
    expect(result.hasNextPage).toBe(false);
    await observer.fetchNextPage();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(
      cache.getQueryData(notificationInboxQuery("actor-b", true).queryKey),
    ).toBeUndefined();
    expect(
      cache.getQueryData(notificationInboxQuery("actor-a", false).queryKey),
    ).toBeUndefined();
    observer.destroy();
  });

  it("retains existing pages and exposes a failed next-page response", async () => {
    const first = page(
      Array.from({ length: 40 }, () => ({
        ...notice,
        id: crypto.randomUUID(),
      })),
    );
    const error = { code: "42501", message: "session_revoked" };
    rpc
      .mockReturnValueOnce(response(first))
      .mockReturnValueOnce(response(null, error));
    const cache = client();
    const query = notificationInboxQuery("actor-a", false);
    await cache.fetchInfiniteQuery(query);
    const observer = new InfiniteQueryObserver(cache, query);
    const result = await observer.fetchNextPage();
    expect(result.isFetchNextPageError).toBe(true);
    expect(result.error).toBe(error);
    expect(result.data?.pages).toEqual([first]);
    observer.destroy();
  });

  it("bounds dashboard preview requests and avoids polling notification history", async () => {
    const request = response(page([]));
    rpc.mockReturnValue(request);
    const cache = client();
    const query = notificationPreviewQuery("actor-a");
    await cache.fetchQuery(query);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("notification_inbox", {
      p_limit: 8,
    });
    expect(request.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(query.refetchInterval).toBe(30000);
    expect(
      notificationInboxQuery("actor-a", false).refetchInterval,
    ).toBeUndefined();
  });

  it("merges overlapping history without restoring stale read states or revoked links", () => {
    const current = {
      ...notice,
      title: "",
      href: null,
      read_at: "2030-01-01T10:30:00Z",
    };
    expect(mergeNotificationPages(undefined)).toEqual([]);
    expect(mergeNotificationPages([page([current]), page([notice])])).toEqual([
      current,
    ]);
  });
});

describe("notification response trust boundaries", () => {
  it.each([
    { name: "dashboard preview", query: notificationPreviewQuery },
    { name: "notification preferences", query: notificationPreferencesQuery },
  ])(
    "preserves server authorization errors for $name reads",
    async ({ query }) => {
      const error = { code: "42501", message: "session_revoked" };
      rpc.mockReturnValue(response(null, error));
      const cache = client();
      const options = query("actor-a");
      await expect(
        cache.fetchQuery(
          options as ReturnType<typeof notificationPreviewQuery>,
        ),
      ).rejects.toBe(error);
      expect(cache.getQueryData(options.queryKey)).toBeUndefined();
    },
  );

  it.each([
    "/jobs/job-a\u0000",
    "/jobs/job-a\n",
    "/jobs/job-a\t",
    "/jobs/job-a\u007f",
    "/jobs/job a",
    "//foreign.example.invalid",
    "https://foreign.example.invalid",
    "data:text/html,unsafe",
    "\\\\foreign.example.invalid",
  ])("refuses unsafe server-resolved destination %j", async (href) => {
    rpc.mockReturnValue(response(page([{ ...notice, href }])));
    await expect(
      client().fetchQuery(notificationPreviewQuery("actor-a")),
    ).rejects.toThrow();
  });

  it.each(["/jobs/job-a?tab=details#sessions", "/chat/room-a", null])(
    "accepts a safe current destination %j without changing authored text",
    async (href) => {
      const data = page([
        { ...notice, href, title: "Authored <b>plain text</b>" },
      ]);
      rpc.mockReturnValue(response(data));
      await expect(
        client().fetchQuery(notificationPreviewQuery("actor-a")),
      ).resolves.toEqual(data);
    },
  );

  it.each([
    { ...page(), unread_count: 0.5 },
    { ...page(), as_of: "invalid" },
    { ...page(), items: [{ ...notice, id: "not-a-uuid" }] },
    { ...page(), items: [{ ...notice, read_at: "tomorrow" }] },
  ])("refuses malformed inbox metadata %j", async (data) => {
    rpc.mockReturnValue(response(data));
    await expect(
      client().fetchQuery(notificationPreviewQuery("actor-a")),
    ).rejects.toThrow();
  });

  const operations = [
    {
      name: "mark",
      run: () => markNotifications([notice.id], null, true),
      endpoint: "mark_notifications",
    },
    {
      name: "refresh",
      run: () => refreshNotifications(),
      endpoint: "refresh_my_notifications",
    },
  ];
  it.each(operations)(
    "propagates a server denial for $name without fabricating a count",
    async ({ run }) => {
      const error = { code: "42501", message: "not_authorized" };
      rpc.mockReturnValue(response(42, error));
      await expect(run()).rejects.toBe(error);
    },
  );

  it.each([-1, 1.5, "1", null])(
    "rejects invalid acknowledgement count %j",
    async (data) => {
      rpc.mockReturnValue(response(data));
      await expect(
        markNotifications([notice.id], null, false),
      ).rejects.toThrow();
      await expect(refreshNotifications()).rejects.toThrow();
    },
  );

  it("forwards a finite bulk-read cutoff and accepts a committed zero-result refresh", async () => {
    rpc.mockReturnValue(response(0));
    await expect(markNotifications(null, page().as_of, true)).resolves.toBe(0);
    expect(rpc).toHaveBeenCalledWith("mark_notifications", {
      p_ids: null,
      p_all_before: page().as_of,
      p_read: true,
    });
    await expect(refreshNotifications()).resolves.toBe(0);
    expect(rpc).toHaveBeenLastCalledWith("refresh_my_notifications");
  });
});

describe("versioned notification preferences API", () => {
  it("uses separate actor cache entries and abortable authenticated reads", async () => {
    const request = response(preferences);
    rpc.mockReturnValue(request);
    const cache = client();
    const query = notificationPreferencesQuery("actor-a");
    await expect(cache.fetchQuery(query)).resolves.toEqual(preferences);
    expect(rpc).toHaveBeenCalledExactlyOnceWith("notification_preferences");
    expect(request.abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(
      cache.getQueryData(notificationPreferencesQuery("actor-b").queryKey),
    ).toBeUndefined();
  });

  it("sends the expected version separately and returns the committed version", async () => {
    rpc.mockReturnValue(response({ ...preferences, version: 5 }));
    await expect(saveNotificationPreferences(preferences)).resolves.toEqual({
      ...preferences,
      version: 5,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "save_notification_preferences",
      {
        p_payload: {
          chat: true,
          forum: false,
          job_updates: true,
          reminders: false,
        },
        p_expected_version: 4,
      },
    );
    expect(preferences.version).toBe(4);
  });

  it("preserves the exact concurrency rejection rather than accepting a stale draft", async () => {
    const error = { code: "40001", message: "stale_version" };
    rpc.mockReturnValue(response({ ...preferences, version: 5 }, error));
    await expect(saveNotificationPreferences(preferences)).rejects.toBe(error);
  });

  it.each([
    { ...preferences, version: 0 },
    { ...preferences, version: 1.5 },
    { ...preferences, chat: "false" },
    { forum: true, job_updates: true, reminders: true, version: 1 },
  ])("refuses malformed committed preferences %j", async (data) => {
    rpc.mockReturnValue(response(data));
    await expect(saveNotificationPreferences(preferences)).rejects.toThrow();
    await expect(
      client().fetchQuery(notificationPreferencesQuery("actor-a")),
    ).rejects.toThrow();
  });
});

describe("server-computed quiet-hour attention contract", () => {
  it.each([
    { quiet_active: true, attention_count: 0 },
    { quiet_active: true, attention_count: 3 },
    { quiet_active: true, attention_count: 50 },
    { quiet_active: false },
    {},
  ])(
    "retains all unread records and the current server attention state %j",
    async (attention) => {
      const data = { ...page(), ...attention };
      rpc.mockReturnValue(response(data));
      const cache = client();
      await expect(
        cache.fetchQuery(notificationPreviewQuery("actor-a")),
      ).resolves.toEqual(data);
      expect(data.unread_count).toBe(50);
      expect(data.items).toEqual([notice]);
      expect(rpc).toHaveBeenCalledExactlyOnceWith("notification_inbox", {
        p_limit: 8,
      });
    },
  );

  it.each([
    { quiet_active: true },
    { quiet_active: true, attention_count: 51 },
    { quiet_active: false, attention_count: 0 },
    { attention_count: 0 },
    { quiet_active: true, attention_count: -1 },
    { quiet_active: true, attention_count: 0.5 },
    { quiet_active: "true", attention_count: 3 },
    { quiet_active: true, attention_count: null },
  ])(
    "rejects inconsistent quiet-hour metadata %j rather than inventing a badge count",
    async (attention) => {
      rpc.mockReturnValue(response({ ...page(), ...attention }));
      const cache = client();
      const query = notificationPreviewQuery("actor-a");
      await expect(cache.fetchQuery(query)).rejects.toThrow();
      expect(cache.getQueryData(query.queryKey)).toBeUndefined();
    },
  );

  it("fetches full quiet-hour history without acknowledging or suppressing its records", async () => {
    const data = {
      ...page(),
      quiet_active: true,
      attention_count: 0,
    };
    rpc.mockReturnValue(response(data));
    const cache = client();
    const query = notificationInboxQuery("actor-a", false);
    const result = await cache.fetchInfiniteQuery(query);
    expect(result.pages).toEqual([data]);
    expect(result.pages[0].unread_count).toBe(50);
    expect(result.pages[0].items[0].read_at).toBeNull();
    expect(rpc).toHaveBeenCalledExactlyOnceWith("notification_inbox", {
      p_unread_only: false,
      p_before_at: null,
      p_before_id: null,
      p_limit: 40,
    });
  });
});
