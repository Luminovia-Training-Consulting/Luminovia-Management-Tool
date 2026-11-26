/** Learner peer feedback is fetched only on disclosure and never displays moderation controls. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CoursePeerFeedback } from "./peer-feedback";
import { peerFeedbackState } from "./peer-feedback-schema";
import i18n from "../../lib/i18n";

const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/online", () => ({
  useOnline: () => true,
  requireOnline: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));

const reassessment = {
  assignment_rubric: null,
  available_assignments: [],
  round_number: 1,
  rounds: [{ number: 1, prompt: "Review a lesson plan", stage: "reviewing" }],
  prompt: "Review a lesson plan",
  stage: "reviewing",
  can_write: true,
  can_moderate: false,
  entries: [],
  reviews: [],
  own_entry: { body: "My lesson plan", revision: 1, approved: true },
  assignment: { body: "A different plan", feedback: null },
  received: null,
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
  fake.rpc.mockImplementation(() => ({
    abortSignal: async () => ({ data: reassessment, error: null }),
  }));
});
afterEach(cleanup);

it("shows only anonymous assigned text and starts no request while closed", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CoursePeerFeedback actor="participant" course="course" staff={false} />
    </QueryClientProvider>,
  );
  expect(fake.rpc).not.toHaveBeenCalled();
  const details = screen.getByText("Peer feedback").closest("details");
  if (!details) throw Error("Peer disclosure is missing");
  details.open = true;
  fireEvent(details, new Event("toggle"));
  expect(await screen.findByText("A different plan")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Approve feedback" }),
  ).not.toBeInTheDocument();
  expect(fake.rpc).toHaveBeenCalledWith("course_peer_feedback", {
    p_run_id: "course",
  });
});

it("rejects counterpart identifiers from the anonymous response shape", () => {
  expect(peerFeedbackState.safeParse(reassessment).success).toBe(true);
  expect(
    peerFeedbackState.safeParse({
      ...reassessment,
      assignment: { ...reassessment.assignment, author_id: "peer" },
    }).success,
  ).toBe(false);
});
