/** A reviewed copy does not commit automatically and preserves its retry key. */
import { afterEach, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import i18n from "../../lib/i18n";
import type { CourseRun } from "./data";
import { CourseReuseForm } from "./course-reuse";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: mocks.rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "fictional-staff" } } }),
}));
afterEach(cleanup);

it("reuses the exact confirmation on retry and invalidates the review when a copy option changes", async () => {
  await i18n.changeLanguage("en");
  const source: CourseRun = {
    id: "34879d80-a883-4185-872e-06ada50d6f30",
    template_id: "c77580b5-d44c-447c-89c1-72c6eec9e4ef",
    organisation_id: "3731440e-7927-488d-88e7-99366ba6246b",
    time_zone: "Europe/Berlin",
    delivery_type: "onsite",
    venue: "",
    published: true,
    archived_at: null,
    course_sessions: [
      {
        id: "6f9d33e1-c5c6-4c43-b844-695cf3c5fc66",
        starts_at: "2040-03-01T08:00:00Z",
        ends_at: "2040-03-01T10:00:00Z",
      },
    ],
  };
  const target = "77358810-79f6-47c4-9c48-77171a25e971";
  let attempts = 0;
  mocks.rpc.mockImplementation(async (_name, args) => {
    if (args.p_action === "preview") {
      return {
        error: null,
        data: {
          title: "Fictional template",
          time_zone: source.time_zone,
          revision: "a".repeat(64),
          sessions: source.course_sessions,
          structured_delivery: false,
          contact: false,
          preparation_count: 0,
          material_count: 0,
        },
      };
    }
    attempts++;
    return attempts === 1
      ? { data: null, error: { message: "Transport failed" } }
      : { data: { course_run_id: target }, error: null };
  });
  const onSaved = vi.fn();
  const cache = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  try {
    render(
      <QueryClientProvider client={cache}>
        <CourseReuseForm
          run={source}
          title="Fictional template"
          onSaved={onSaved}
        />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    const commit = screen.getByRole("button", { name: "Create course draft" });
    const preview = screen.getByRole("button", { name: "Review course copy" });
    expect(commit).toBeDisabled();
    await user.click(preview);
    expect(
      await screen.findByRole("heading", { name: "Fictional template" }),
    ).toBeVisible();
    expect(commit).toBeEnabled();
    await user.click(
      screen.getByRole("checkbox", {
        name: "Active contact for this customer",
      }),
    );
    expect(commit).toBeDisabled();
    await user.click(preview);
    await waitFor(() => expect(commit).toBeEnabled());
    await user.click(commit);
    expect(await screen.findByRole("alert")).toBeVisible();
    expect(commit).toBeEnabled();
    await user.click(commit);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(target));
    const saves = mocks.rpc.mock.calls.filter(
      ([, payload]) => payload.p_action === "save",
    );
    expect(saves).toHaveLength(2);
    expect(saves[0][1]).toEqual(saves[1][1]);
    expect(saves[0][1].p_options.contact).toBe(true);
  } finally {
    cache.clear();
  }
});
