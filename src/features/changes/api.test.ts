/** Guard the adapter contract: offline, denied and malformed responses cannot
 * produce a confirmed amendment. Actual role/transaction tests live in SQL/API. */
import { beforeEach, expect, it, vi } from "vitest";
import { saveAssignmentChange, changeAssignmentAction } from "./api";
const state = vi.hoisted(() => ({ rpc: vi.fn(), online: true }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../../lib/online", () => ({
  requireOnline: () => {
    if (!state.online) throw new Error("offline");
  },
}));
const id = "ed000000-0000-4000-8000-000000000010";
beforeEach(() => {
  state.online = true;
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ data: id, error: null });
});
it("change writes require online server acknowledgement", async () => {
  state.online = false;
  await expect(changeAssignmentAction(id, "apply", 3, "", id)).rejects.toThrow(
    "offline",
  );
  await expect(
    saveAssignmentChange(
      null,
      id,
      {
        reason: "Fictional reason",
        changes: {
          sessions: [],
          location: "",
          scope: "",
          terms: "Fictional",
          cancel: false,
        },
      },
      0,
      id,
    ),
  ).rejects.toThrow("offline");
  expect(state.rpc).not.toHaveBeenCalled();
});
it("rejected or malformed API responses never confirm an amendment", async () => {
  const error = { code: "42501", message: "denied" };
  state.rpc.mockResolvedValue({ data: null, error });
  await expect(changeAssignmentAction(id, "apply", 3, "", id)).rejects.toBe(
    error,
  );
  state.rpc.mockResolvedValue({ data: "invalid", error: null });
  await expect(
    changeAssignmentAction(id, "apply", 3, "", id),
  ).rejects.toThrow();
});
