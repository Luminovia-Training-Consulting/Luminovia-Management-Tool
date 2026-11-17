/** Component regression for the affected lecturer's private comparison and explicit acceptance; database conflict/revalidation checks remain separate. */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Job } from "../../lib/types";
import { AssignmentChangePanel } from "./assignment-change";

const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "b7b505ad-684f-470b-983f-dfc0b54b2814" } },
  }),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../../lib/online", () => ({
  useOnline: () => true,
  requireOnline: () => undefined,
}));

const jobId = "58083b8e-5fde-450f-a35a-78cc464baf83";
const requestId = "62da3d99-106f-4adb-b9bf-a913c871395d";
const lecturer = "b7b505ad-684f-470b-983f-dfc0b54b2814";
const claimId = "9dfed38c-84c3-4ea1-9452-c06b1c55c78c";
const row = {
  id: requestId,
  job_id: jobId,
  reason: "Customer requested a date change",
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
  responses: [
    {
      claim_id: claimId,
      lecturer_id: lecturer,
      decision: null,
      responded_at: null,
    },
  ],
};
const job = {
  id: jobId,
  time_zone: "Europe/Berlin",
  location: "Room A",
  job_sessions: [
    {
      id: "b6133838-edbb-48ad-ad9f-d94f44cfade5",
      starts_at: row.original_sessions[0].starts_at,
      ends_at: row.original_sessions[0].ends_at,
    },
  ],
} as Job;
let client: QueryClient;

afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});
function setup(manager = false, items = [structuredClone(row)]) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  state.rpc.mockImplementation((name: string) => {
    const response =
      name === "job_lifecycle"
        ? {
            version: 1,
            can_manage: manager,
            can_edit: false,
            can_duplicate: false,
            claims: [
              {
                id: claimId,
                lecturer_id: lecturer,
                lecturer_name: "Fictional Lecturer",
                status: "confirmed",
                created_at: "2026-11-17T08:00:00Z",
                can_cancel: false,
                sessions: [],
                events: [],
              },
            ],
          }
        : name === "assignment_change_request"
          ? structuredClone(items)
          : name === "propose_assignment_change"
            ? requestId
            : "accepted";
    const promise = Promise.resolve({ data: response, error: null });
    return Object.assign(promise, { abortSignal: () => promise });
  });
  return render(
    <QueryClientProvider client={client}>
      <AssignmentChangePanel job={job} />
    </QueryClientProvider>,
  );
}

it("shows the original/proposed values only to the affected lecturer and records deliberate acceptance", async () => {
  const user = userEvent.setup();
  setup();
  expect(await screen.findByText("Room A → Room B")).toBeTruthy();
  expect(screen.getByText(/01\.05\.2030, 10:00/)).toBeTruthy();
  expect(screen.getByText(/02\.05\.2030, 10:00/)).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Apply accepted change" }),
  ).toBeNull();
  await user.click(
    screen.getByRole("button", { name: "Vorgeschlagene Änderung annehmen" }),
  );
  await waitFor(() =>
    expect(state.rpc).toHaveBeenCalledWith("respond_assignment_change", {
      p_id: requestId,
      p_accept: true,
    }),
  );
});

it("requires a separate explicit lecturer rejection and calls no manager apply action", async () => {
  const user = userEvent.setup();
  setup();
  await user.click(
    await screen.findByRole("button", {
      name: "Vorgeschlagene Änderung ablehnen",
    }),
  );
  await waitFor(() =>
    expect(state.rpc).toHaveBeenCalledWith("respond_assignment_change", {
      p_id: requestId,
      p_accept: false,
    }),
  );
  expect(state.rpc).not.toHaveBeenCalledWith(
    "apply_assignment_change",
    expect.anything(),
  );
});

it("lets management submit a reasoned proposal with the complete replacement schedule", async () => {
  const user = userEvent.setup();
  setup(true, []);
  await user.type(
    await screen.findByLabelText("Begründung"),
    "Customer asks for a date",
  );
  await user.clear(screen.getByLabelText("Ort oder Besprechungslink"));
  await user.type(screen.getByLabelText("Ort oder Besprechungslink"), "Room B");
  await user.clear(screen.getByLabelText("Beginn Einheit 1"));
  await user.type(
    screen.getByLabelText("Beginn Einheit 1"),
    "2030-05-03T10:00",
  );
  await user.click(screen.getByRole("button", { name: "Änderung beantragen" }));
  await waitFor(() =>
    expect(state.rpc).toHaveBeenCalledWith(
      "propose_assignment_change",
      expect.objectContaining({
        p_job: jobId,
        p_reason: "Customer asks for a date",
        p_location: "Room B",
        p_request: expect.any(String),
        p_sessions: [
          expect.objectContaining({
            starts_at: expect.stringContaining("2030-05-03"),
          }),
        ],
      }),
    ),
  );
});
