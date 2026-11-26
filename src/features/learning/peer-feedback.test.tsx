/** Learner peer feedback is fetched only on disclosure and never displays moderation controls. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CoursePeerFeedback } from "./peer-feedback";
import { peerFeedbackState } from "./peer-feedback-schema";
import i18n from "../../lib/i18n";

const fake = vi.hoisted(() => ({ rpc: vi.fn(), download: vi.fn() }));
vi.mock("../files/api", () => ({
  learningSubmissionMaxBytes: 10 * 1024 * 1024,
  saveCoursePeerAttachment: fake.download,
  uploadPortfolioEvidence: vi.fn(),
}));
vi.mock("../../lib/online", () => ({
  useOnline: () => true,
  requireOnline: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));

const reassessment = {
  assignment_rubric: null,
  scoring_rubric: null,
  available_assignments: [],
  round_number: 1,
  rounds: [{ number: 1, prompt: "Review a lesson plan", stage: "reviewing" }],
  prompt: "Review a lesson plan",
  stage: "reviewing",
  can_write: true,
  can_moderate: false,
  entries: [],
  reviews: [],
  own_entry: {
    body: "My lesson plan",
    revision: 1,
    approved: true,
    attachment: null,
  },
  assignment: {
    body: "A different plan",
    feedback: null,
    scores: null,
    attachment: null,
  },
  received: null,
};

beforeEach(async () => {
  await i18n.changeLanguage("en");
  vi.resetAllMocks();
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

it("requires a rating for every pinned criterion and preserves valid zero scores", async () => {
  const attachment = {
    version_id: "b1234567-1234-4234-8234-123456789012",
    name: "peer-attachment.pdf",
  };
  const scored = {
    ...reassessment,
    assignment: { ...reassessment.assignment, attachment },
    scoring_rubric: [
      {
        label: "Method",
        levels: [
          { label: "Missing", points: 0 },
          { label: "Complete", points: 2 },
        ],
      },
      {
        label: "Evidence",
        levels: [
          { label: "Missing", points: 0 },
          { label: "Complete", points: 5 },
        ],
      },
    ],
  };
  fake.rpc.mockImplementation((action: string) =>
    action === "course_peer_feedback"
      ? { abortSignal: async () => ({ data: scored, error: null }) }
      : Promise.resolve({ data: true, error: null }),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CoursePeerFeedback actor="participant" course="course" staff={false} />
    </QueryClientProvider>,
  );
  const details = screen.getByText("Peer feedback").closest("details");
  if (!details) throw Error("Peer disclosure is missing");
  details.open = true;
  fireEvent(details, new Event("toggle"));
  fireEvent.change(await screen.findByLabelText("Your feedback"), {
    target: { value: "A moderated observation" },
  });
  const submit = screen.getByRole("button", {
    name: "Submit feedback for moderation",
  });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Method"), { target: { value: "0" } });
  expect(submit).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Evidence"), {
    target: { value: "5" },
  });
  expect(submit).toBeEnabled();
  fireEvent.click(submit);
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith("course_peer_feedback_action", {
      p_run_id: "course",
      p_action: "feedback",
      p_payload: { body: "A moderated observation", round: 1, scores: [0, 5] },
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
  await waitFor(() =>
    expect(fake.download).toHaveBeenCalledWith(
      "course",
      1,
      attachment.version_id,
      attachment.name,
    ),
  );
  expect(peerFeedbackState.safeParse(scored).success).toBe(true);
});
