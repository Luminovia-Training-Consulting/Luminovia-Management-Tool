/** A review is required for both customer-local allocation and release. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { AcademyInstructors } from "./academy-instructors";

const api = vi.hoisted(() => ({ rpc: vi.fn(), assigned: false, fail: false }));
vi.mock("../../lib/supabase", () => ({ db: () => api }));
vi.mock("../../lib/online", () => ({
  useOnline: () => true,
  requireOnline: () => {},
}));

beforeEach(async () => {
  await i18n.changeLanguage("en");
  api.assigned = false;
  api.fail = false;
  api.rpc.mockImplementation((name) => {
    if (name === "academy_course_instructor_candidates")
      return {
        abortSignal: async () => ({
          data: [
            {
              id: "instructor-a",
              name: "Fictional lecturer",
              assignment_id: api.assigned ? "claim-a" : null,
            },
          ],
          error: null,
        }),
      };
    if (api.fail)
      return Promise.resolve({ data: { status: "conflict" }, error: null });
    api.assigned = name === "academy_assign_course_instructor";
    return Promise.resolve({
      data: { status: api.assigned ? "confirmed" : "cancelled" },
      error: null,
    });
  });
});
afterEach(() => {
  cleanup();
  api.rpc.mockReset();
});

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <AcademyInstructors courseId="course-a" actor="admin-a" />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

it("waits for a confirmed booking then requires a reason to release the same assignment", async () => {
  const user = renderPanel();
  const select = await screen.findByRole("combobox", { name: "Instructor" });
  await user.selectOptions(select, "instructor-a");
  await user.click(
    screen.getByRole("button", { name: "Assign course sessions" }),
  );
  expect(api.rpc.mock.calls.map(([name]) => name)).not.toContain(
    "academy_assign_course_instructor",
  );
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "Confirm" }),
  );
  expect(await screen.findByText("Assignment updated.")).toBeVisible();
  await user.selectOptions(select, "instructor-a");
  await user.click(screen.getByRole("button", { name: "Release assignment" }));
  const confirmation = within(screen.getByRole("dialog"));
  expect(confirmation.getByRole("button", { name: "Confirm" })).toBeDisabled();
  await user.type(
    confirmation.getByRole("textbox", { name: "Reason" }),
    "Course schedule adjustment",
  );
  await user.click(confirmation.getByRole("button", { name: "Confirm" }));
  expect(await screen.findByText("Assignment updated.")).toBeVisible();
  expect(api.rpc).toHaveBeenCalledWith("academy_release_course_instructor", {
    p_course_id: "course-a",
    p_claim_id: "claim-a",
    p_reason: "Course schedule adjustment",
    p_request_id: expect.any(String),
  });
});

it("keeps a rejected conflict visible and retries the exact reviewed request", async () => {
  api.fail = true;
  const user = renderPanel();
  await user.selectOptions(
    await screen.findByRole("combobox", { name: "Instructor" }),
    "instructor-a",
  );
  await user.click(
    screen.getByRole("button", { name: "Assign course sessions" }),
  );
  const confirm = within(screen.getByRole("dialog")).getByRole("button", {
    name: "Confirm",
  });
  await user.click(confirm);
  expect(
    await screen.findByText(/conflicts with an existing booking/),
  ).toBeVisible();
  expect(screen.queryByText("Assignment updated.")).toBeNull();
  api.fail = false;
  await user.click(confirm);
  expect(await screen.findByText("Assignment updated.")).toBeVisible();
  const writes = api.rpc.mock.calls.filter(
    ([name]) => name === "academy_assign_course_instructor",
  );
  expect(writes).toHaveLength(2);
  expect(writes[0][1]).toEqual(writes[1][1]);
});
