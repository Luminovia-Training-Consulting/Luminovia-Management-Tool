/**
 * Protect lifecycle client boundaries: offline refusal, confirmed mutations,
 * retry identity, actor-scoped reads and targeted cache refresh. These controlled
 * transport fixtures complement the separate real PostgreSQL/API acceptance.
 */
import { QueryClient, type QueryKey } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readinessQuery } from "../readiness/api";
import {
  replacementAssignmentsQuery,
  replacementQuery,
} from "../replacements/api";
import { supportContextQuery, supportTicketQuery } from "../support/api";
import {
  cancelAssignment,
  lifecycleQuery,
  manageOffer,
  refreshJobState,
  setCapacity,
} from "./lifecycle-api";

// Only the transport is replaced; the real API functions, online guard and
// QueryClient own request sequencing, cancellation and cached state in each test.
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
const clients: QueryClient[] = [];

/** Give each scenario a cache with no retry that could hide the first rejection. */
function client() {
  const value = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(value);
  return value;
}

beforeEach(() => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  rpc.mockReset();
});
afterEach(() => {
  // Release pending queries and navigator overrides before the next scenario.
  clients.splice(0).forEach((value) => value.clear());
  vi.restoreAllMocks();
});

describe("server-confirmed job lifecycle operations", () => {
  // Fictional targets share a reusable request identity, never an actor/role
  // authorization argument. The backend remains responsible for accepting them.
  const operations = [
    {
      name: "capacity change",
      run: () => setCapacity("job-a", 3, 8, "request-a"),
      endpoint: "set_job_capacity",
      payload: {
        p_job_id: "job-a",
        p_capacity: 3,
        p_expected_version: 8,
        p_request_id: "request-a",
      },
    },
    {
      name: "offer reopening",
      run: () =>
        manageOffer({
          job: "job-a",
          action: "reopen",
          version: 8,
          request: "request-a",
        }),
      endpoint: "manage_job_offer",
      payload: {
        p_job_id: "job-a",
        p_action: "reopen",
        p_expected_version: 8,
        p_request_id: "request-a",
        p_payload: {},
      },
    },
    {
      name: "whole-assignment cancellation",
      run: () =>
        cancelAssignment("claim-a", "Fictional cancellation", "request-a"),
      endpoint: "cancel_job_assignment",
      payload: {
        p_claim_id: "claim-a",
        p_reason: "Fictional cancellation",
        p_request_id: "request-a",
      },
    },
  ];

  it.each(operations)(
    "refuses offline $name before making a request",
    async ({ run }) => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      await expect(run()).rejects.toThrow("offline");
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it.each(operations)(
    "waits for the database to confirm $name",
    async ({ run, endpoint, payload }) => {
      let resolve!: (value: { data: string; error: null }) => void;
      rpc.mockReturnValue(
        new Promise<{ data: string; error: null }>((done) => {
          resolve = done;
        }),
      );
      let completed = false;
      const pending = run().then((value) => {
        completed = true;
        return value;
      });
      await Promise.resolve();
      expect(completed).toBe(false);
      expect(rpc).toHaveBeenCalledExactlyOnceWith(endpoint, payload);
      resolve({ data: "committed-result", error: null });
      await expect(pending).resolves.toBe("committed-result");
    },
  );

  it.each(operations)(
    "propagates the exact server rejection for $name",
    async ({ run }) => {
      const error = { code: "40001", message: "stale_version" };
      rpc.mockResolvedValue({ data: "must-not-confirm", error });
      await expect(run()).rejects.toBe(error);
      expect(rpc).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves an accepted request identity and the authored edit payload", async () => {
    rpc.mockResolvedValue({ data: "job-a", error: null });
    const payload = { title: "Fictional <course>", claim_deadline: null };
    const input = {
      job: "job-a",
      action: "edit" as const,
      version: 12,
      request: "same-idempotency-key",
      payload,
    };
    await manageOffer(input);
    await manageOffer(input);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc.mock.calls[0][1]).toEqual({
      p_job_id: "job-a",
      p_action: "edit",
      p_expected_version: 12,
      p_request_id: "same-idempotency-key",
      p_payload: payload,
    });
    expect(payload).toEqual({
      title: "Fictional <course>",
      claim_deadline: null,
    });
  });
});

describe("lifecycle reads and connected cache refresh", () => {
  it("separates actors and jobs and forwards the actual cancellation signal", async () => {
    const data = {
      version: 3,
      can_manage: false,
      can_edit: false,
      can_duplicate: false,
      claims: [
        {
          id: "claim-a",
          lecturer_id: "lecturer-a",
          lecturer_name: "Fictional lecturer",
          status: "confirmed" as const,
          created_at: "2030-01-01T00:00:00Z",
          can_cancel: false,
          sessions: null,
          events: null,
        },
      ],
    };
    const abortSignal = vi.fn().mockResolvedValue({ data, error: null });
    rpc.mockReturnValue({ abortSignal });
    const cache = client();
    await expect(
      cache.fetchQuery(lifecycleQuery("actor-a", "job-a")),
    ).resolves.toMatchObject({
      ...data,
      claims: [{ ...data.claims[0], sessions: [], events: [] }],
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("job_lifecycle", {
      p_job_id: "job-a",
    });
    expect(abortSignal).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(
      cache.getQueryData(lifecycleQuery("actor-b", "job-a").queryKey),
    ).toBeUndefined();
    expect(
      cache.getQueryData(lifecycleQuery("actor-a", "job-b").queryKey),
    ).toBeUndefined();
  });

  it("does not cache a rejected lifecycle read as an empty success", async () => {
    const error = { code: "42501", message: "not_authorized" };
    rpc.mockReturnValue({
      abortSignal: vi.fn().mockResolvedValue({ data: null, error }),
    });
    const cache = client();
    const query = lifecycleQuery("actor-a", "job-a");
    await expect(cache.fetchQuery(query)).rejects.toBe(error);
    expect(cache.getQueryData(query.queryKey)).toBeUndefined();
    expect(cache.getQueryState(query.queryKey)?.status).toBe("error");
  });

  it("aborts the in-flight lifecycle request when its query is cancelled", async () => {
    let signal: AbortSignal | undefined;
    rpc.mockReturnValue({
      abortSignal: (value: AbortSignal) => {
        signal = value;
        return new Promise(() => {});
      },
    });
    const cache = client();
    const query = lifecycleQuery("actor-a", "job-a");
    const pending = cache.fetchQuery(query);
    const rejected = expect(pending).rejects.toMatchObject({ name: "Error" });
    await cache.cancelQueries({ queryKey: query.queryKey });
    await rejected;
    expect(signal?.aborted).toBe(true);
    expect(cache.getQueryData(query.queryKey)).toBeUndefined();
  });

  it("invalidates connected allocation state without refetching unrelated private modules", async () => {
    const cache = client();
    const affected = [
      ["jobs", "actor-a"],
      ["job-board", "actor-a", "published"],
      ["job-lifecycle", "actor-a", "job-a"],
      ["claims", "actor-a"],
      ["finance", "actor-a", "earnings"],
      ["commission-report", "actor-a"],
      ["client-requests", "actor-a"],
      ["client-spend", "actor-a"],
      ["company-monthly-spending", "actor-a", null],
      ["notifications", "actor-a", "preview"],
      ["chat-rooms", "actor-a"],
      ["chat-members", "actor-a", "room-a"],
      ["chat-messages", "actor-a", "room-a"],
      ["operations", "actor-a", "courses"],
      // Accepted handovers affect both the recipient inbox and the per-job
      // projection; waitlist availability and teaching-day allocations must
      // also become stale after a confirmed lifecycle mutation.
      ["job-substitutions", "actor-a", "inbox"],
      ["job-substitutions", "actor-a", "job-a"],
      ["job-waitlist", "actor-a", "job-a"],
      ["my-job-waitlist", "actor-a"],
      ["substitution-candidates", "actor-a", "claim-a", "Fictional lecturer"],
      ["teaching-day", "actor-a"],
    ];
    const unrelated = [
      ["profile", "actor-a"],
      ["documents", "actor-a"],
      ["knowledge", "actor-a"],
      ["personal-events", "actor-a"],
    ];
    for (const key of [...affected, ...unrelated])
      cache.setQueryData(key, { retained: true });
    await refreshJobState(cache);
    for (const key of affected) {
      expect(cache.getQueryState(key)?.isInvalidated).toBe(true);
      expect(cache.getQueryData(key)).toEqual({ retained: true });
    }
    for (const key of unrelated)
      expect(cache.getQueryState(key)?.isInvalidated).toBe(false);
  });

  it("refreshes actual preparation and replacement views while retaining private support state", async () => {
    const cache = client();
    // Build the released modules' actual keys, including nested detail/history
    // views. Merely calling invalidateQueries with a new prefix must not count
    // as success if these cached projections remain fresh after an allocation.
    const resource = "dfd10801-30b5-49a9-85ae-f30ede7be3a4";
    const affected: QueryKey[] = [
      readinessQuery("actor-a").queryKey,
      readinessQuery("actor-a", resource).queryKey,
      replacementQuery("actor-a").queryKey,
      replacementAssignmentsQuery("actor-a").queryKey,
    ];
    const unrelated: QueryKey[] = [
      supportContextQuery("actor-a").queryKey,
      supportTicketQuery("actor-a", resource).queryKey,
    ];
    // Inactive cache entries retain their in-memory data; this local refresh
    // neither acknowledges a server mutation nor contacts another private API.
    const retained = { title: "Fictional cached projection" };
    for (const key of [...affected, ...unrelated])
      cache.setQueryData(key, retained);

    await refreshJobState(cache);

    for (const key of affected)
      expect(cache.getQueryState(key)?.isInvalidated).toBe(true);
    for (const key of unrelated)
      expect(cache.getQueryState(key)?.isInvalidated).toBe(false);
    for (const key of [...affected, ...unrelated])
      expect(cache.getQueryData(key)).toBe(retained);
    expect(rpc).not.toHaveBeenCalled();
  });
});
