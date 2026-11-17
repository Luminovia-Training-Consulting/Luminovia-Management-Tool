import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ManualAssignment } from "./manual-assignment";
import "../../lib/i18n";
const state = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "admin" } } }),
}));
afterEach(cleanup);
beforeEach(() => state.rpc.mockReset());
it("submits the exact lecturer and reviewed version; keeps dialog pending until online confirmation", async () => {
  let resolve!: (value: unknown) => void;
  const pending = new Promise((r) => (resolve = r));
  state.rpc.mockImplementation(async (name: string) =>
    name === "manual_assignment_candidates"
      ? {
          error: null,
          data: [
            {
              id: "teacher-a",
              name: "Fictional Teacher",
              eligibility: "eligible",
              terms_version: 1000021,
              quote: { amount: 200, total_amount: 400, currency: "EUR" },
            },
            {
              id: "busy",
              name: "Busy teacher",
              eligibility: "conflict",
              terms_version: 1000021,
              quote: null,
            },
          ],
        }
      : pending,
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ManualAssignment jobId="job-a" version={7} published />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Dozent:in zuweisen" }));
  await user.selectOptions(
    await screen.findByLabelText("Dozent:in"),
    "teacher-a",
  );
  expect(
    screen.getByRole("option", { name: "Busy teacher · Terminüberschneidung" }),
  ).toBeDisabled();
  await user.click(
    screen.getByRole("button", { name: "Gesamten Auftrag zuweisen" }),
  );
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(state.rpc).toHaveBeenCalledWith("manual_assign_job", {
    p_job_id: "job-a",
    p_lecturer_id: "teacher-a",
    p_terms_version: 1000021,
    p_expected_job_version: 7,
    p_request_id: expect.any(String),
  });
  await act(async () =>
    resolve({
      error: null,
      data: { status: "confirmed", claim_id: "claim-a" },
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  client.clear();
});
