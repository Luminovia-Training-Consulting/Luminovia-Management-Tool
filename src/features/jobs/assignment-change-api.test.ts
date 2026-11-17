/** Protect actor-scoped amendment reads, exact RPC payloads, and validated receipts without claiming database transaction acceptance. */
import { afterEach, expect, it, vi } from "vitest";
import {
  assignmentChangesQuery,
  applyAssignmentChange,
  proposeAssignmentChange,
  respondAssignmentChange,
  withdrawAssignmentChange,
} from "./assignment-change-api";

const state = vi.hoisted(() => ({ rpc: vi.fn(), online: true }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../../lib/online", () => ({
  requireOnline: () => {
    if (!state.online) throw new Error("offline");
  },
}));
const id = "62da3d99-106f-4adb-b9bf-a913c871395d";

afterEach(() => {
  vi.clearAllMocks();
  state.online = true;
});

it("reads only the job's database-filtered request projection and rejects malformed rows", async () => {
  const result = [
    {
      id,
      job_id: id,
      reason: "Time change requested",
      original_location: "Room A",
      proposed_location: "Room B",
      original_sessions: [
        { starts_at: "2030-05-01T08:00:00Z", ends_at: "2030-05-01T09:00:00Z" },
      ],
      proposed_sessions: [
        { starts_at: "2030-05-02T08:00:00Z", ends_at: "2030-05-02T09:00:00Z" },
      ],
      status: "awaiting_response",
      created_at: "2026-11-17T08:00:00Z",
      resolved_at: null,
      can_decide: true,
      can_apply: false,
      responses: [],
    },
  ];
  state.rpc.mockReturnValue({
    abortSignal: () => Promise.resolve({ data: result, error: null }),
  });
  const query = assignmentChangesQuery(id, id);
  await expect(
    query.queryFn!({
      signal: new AbortController().signal,
      queryKey: query.queryKey,
      client: {} as never,
      meta: undefined,
      pageParam: undefined,
      direction: "forward",
    }),
  ).resolves.toEqual(result);
  expect(state.rpc).toHaveBeenCalledExactlyOnceWith(
    "assignment_change_request",
    { p_id: null, p_job: id },
  );
  state.rpc.mockReturnValue({
    abortSignal: () =>
      Promise.resolve({
        data: [{ ...result[0], status: "unknown" }],
        error: null,
      }),
  });
  await expect(
    query.queryFn!({
      signal: new AbortController().signal,
      queryKey: query.queryKey,
      client: {} as never,
      meta: undefined,
      pageParam: undefined,
      direction: "forward",
    }),
  ).rejects.toThrow();
});

it("uses stable caller keys and exact lecturer/apply transitions, validating server receipts", async () => {
  state.rpc.mockImplementation((name) =>
    Promise.resolve({
      data:
        name === "propose_assignment_change"
          ? id
          : name === "respond_assignment_change"
            ? "accepted"
            : "applied",
      error: null,
    }),
  );
  const sessions = [
    { starts_at: "2030-05-02T08:00:00Z", ends_at: "2030-05-02T09:00:00Z" },
  ];
  await expect(
    proposeAssignmentChange({
      job: id,
      reason: "Customer date update",
      location: "Room B",
      sessions,
      requestId: id,
    }),
  ).resolves.toBe(id);
  expect(state.rpc).toHaveBeenLastCalledWith("propose_assignment_change", {
    p_job: id,
    p_reason: "Customer date update",
    p_location: "Room B",
    p_sessions: sessions,
    p_request: id,
  });
  await expect(respondAssignmentChange(id, true)).resolves.toBe("accepted");
  expect(state.rpc).toHaveBeenLastCalledWith("respond_assignment_change", {
    p_id: id,
    p_accept: true,
  });
  await expect(applyAssignmentChange(id)).resolves.toBe("applied");
  expect(state.rpc).toHaveBeenLastCalledWith("apply_assignment_change", {
    p_id: id,
  });
  state.rpc.mockResolvedValue({ data: "not-applied", error: null });
  await expect(applyAssignmentChange(id)).rejects.toThrow();
  state.rpc.mockResolvedValue({ data: "superseded", error: null });
  await expect(withdrawAssignmentChange(id)).resolves.toBe("superseded");
  expect(state.rpc).toHaveBeenLastCalledWith("withdraw_assignment_change", {
    p_id: id,
  });
});

it("refuses writes offline before calling the database", async () => {
  state.online = false;
  await expect(respondAssignmentChange(id, true)).rejects.toThrow("offline");
  expect(state.rpc).not.toHaveBeenCalled();
});
