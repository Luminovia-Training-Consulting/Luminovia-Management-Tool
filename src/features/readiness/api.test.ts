/** Mocked component/adapter regressions for readiness. Real authentication, PostgreSQL, scanner and browser acceptance are exercised by the separate isolated integration suites. */
import { beforeEach, expect, it, vi } from "vitest";
import {
  acknowledgeCourseInstructions,
  completeReadinessTask,
  confirmCourseSessions,
  meetingHref,
  saveReadinessSettings,
  saveReadinessTask,
} from "./api";
const state = vi.hoisted(() => ({ rpc: vi.fn(), online: true }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../../lib/online", () => ({
  requireOnline: () => {
    if (!state.online) throw new Error("offline");
  },
}));
const id = "e8000000-0000-4000-8000-000000000010";
beforeEach(() => {
  state.online = true;
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ data: id, error: null });
});
it("all readiness mutations require online confirmation before reaching the API", () => {
  state.online = false;
  const settings = {
    materials_required: true,
    customer_required: true,
    contact_required: true,
    agreement_required: true,
    instructions_required: false,
    instructions: "",
    meeting_url: "",
    preparation_deadline: null,
  };
  for (const write of [
    () => saveReadinessSettings(id, settings, 1, id),
    () => confirmCourseSessions(id, 1, id),
    () =>
      saveReadinessTask(
        id,
        null,
        {
          title: "Fictional",
          responsible_user_id: id,
          required: true,
          due_at: null,
          archived: false,
        },
        0,
        id,
      ),
    () => completeReadinessTask(id, true, 1, id),
    () => acknowledgeCourseInstructions(id, 1, id),
  ])
    expect(write).toThrow("offline");
  expect(state.rpc).not.toHaveBeenCalled();
});
it("does not return success for rejected or malformed server responses", async () => {
  const error = { code: "42501", message: "denied" };
  state.rpc.mockResolvedValue({ data: null, error });
  await expect(confirmCourseSessions(id, 1, id)).rejects.toBe(error);
  state.rpc.mockResolvedValue({ data: "not-a-confirmed-id", error: null });
  await expect(confirmCourseSessions(id, 1, id)).rejects.toThrow();
});
it("meeting links preserve HTTPS and refuse embedded credentials, active schemes and malformed strings", () => {
  expect(meetingHref("https://meeting.example.invalid/path?a=1")).toBe(
    "https://meeting.example.invalid/path?a=1",
  );
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,hi",
    "http://example.invalid/",
    "https://user:pass@example.invalid/",
    "not a URL",
  ])
    expect(meetingHref(value)).toBeNull();
});
