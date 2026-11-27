import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import CourseSeriesRevision from "./course-series-revision";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
afterEach(() => {
  cleanup();
  rpc.mockReset();
});

const draftId = "80000000-0000-4000-8000-000000000001";
const protectedId = "80000000-0000-4000-8000-000000000002";
const existingSession = {
  starts_at: "2030-04-08T07:00:00.000Z",
  ends_at: "2030-04-08T15:00:00.000Z",
};
const savedPattern = {
  first_day: "2030-04-08",
  days: 1,
  start: "09:00",
  end: "17:00",
  weekdays: [1, 2, 3, 4, 5],
  excluded_dates: "",
};
const version = "a".repeat(64);

function snapshot(pattern: typeof savedPattern | null, revision = version) {
  return {
    revision,
    time_zone: "Europe/Berlin",
    runs: [
      { id: draftId, editable: true, pattern, sessions: [existingSession] },
      {
        id: protectedId,
        editable: false,
        pattern: null,
        sessions: [existingSession],
      },
    ],
  };
}

function renderRevision() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CourseSeriesRevision actor="fictional-manager" courseId={draftId} />
    </QueryClientProvider>,
  );
}

const checkLabel = "Change pattern for run 1";
const previewLabel = "Review sessions and conflicts";
const confirmLabel = "Save series changes";

it("invalidates reviewed dates after input changes and rechecks a stale server revision", async () => {
  await i18n.changeLanguage("en");
  const user = userEvent.setup();
  const loaded = vi
    .fn()
    .mockResolvedValueOnce({ data: snapshot(savedPattern), error: null })
    .mockResolvedValueOnce({
      data: snapshot({ ...savedPattern, start: "11:00" }, "b".repeat(64)),
      error: null,
    });
  const revise = vi
    .fn()
    .mockResolvedValueOnce({
      data: { conflicts: [], run_ids: [] },
      error: null,
    })
    .mockResolvedValueOnce({
      data: { conflicts: [], run_ids: [] },
      error: null,
    })
    .mockResolvedValueOnce({ data: null, error: new Error("stale") });
  rpc.mockImplementation((operation, payload) =>
    operation === "course_series_for_run"
      ? { abortSignal: loaded }
      : revise(payload),
  );
  renderRevision();

  await user.click(await screen.findByText("Edit series pattern"));
  expect(
    screen.getByRole("checkbox", { name: "Change pattern for run 2" }),
  ).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: checkLabel }));
  expect(screen.getByLabelText("Daily start")).toHaveValue("09:00");
  fireEvent.change(screen.getByLabelText("Daily start"), {
    target: { value: "10:00" },
  });
  await user.click(screen.getByRole("button", { name: previewLabel }));
  expect(
    await screen.findByRole("button", { name: confirmLabel }),
  ).toBeEnabled();
  expect(
    within(screen.getByRole("list", { name: "Current sessions" })).getByRole(
      "listitem",
    ),
  ).toHaveTextContent("9:00");
  expect(
    within(screen.getByRole("list", { name: "Proposed sessions" })).getByRole(
      "listitem",
    ),
  ).toHaveTextContent("10:00");
  expect(revise).toHaveBeenLastCalledWith({
    p_course_id: draftId,
    p_revision: version,
    p_changes: [
      {
        id: draftId,
        pattern: { ...savedPattern, start: "10:00" },
        sessions: [
          {
            starts_at: "2030-04-08T08:00:00.000Z",
            ends_at: existingSession.ends_at,
          },
        ],
      },
    ],
    p_confirm: false,
  });

  fireEvent.change(screen.getByLabelText("Daily start"), {
    target: { value: "10:30" },
  });
  expect(screen.queryByRole("button", { name: confirmLabel })).toBeNull();
  await user.click(screen.getByRole("button", { name: previewLabel }));
  await user.click(await screen.findByRole("button", { name: confirmLabel }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be processed",
  );
  expect(revise.mock.calls[1][0].p_changes).toEqual(
    revise.mock.calls[2][0].p_changes,
  );
  expect(revise.mock.calls[1][0].p_confirm).toBe(false);
  expect(revise.mock.calls[2][0].p_confirm).toBe(true);
  expect(screen.getByRole("button", { name: confirmLabel })).toBeDisabled();

  await user.click(screen.getByRole("button", { name: "Reload series" }));
  await screen.findByRole("button", { name: previewLabel });
  await user.click(screen.getByRole("checkbox", { name: checkLabel }));
  expect(screen.getByLabelText("Daily start")).toHaveValue("11:00");
  expect(screen.queryByRole("button", { name: confirmLabel })).toBeNull();
});

it("requires an explicit pattern for a legacy series and hides itself for an unrelated course", async () => {
  await i18n.changeLanguage("en");
  const user = userEvent.setup();
  const data = { value: null as ReturnType<typeof snapshot> | null };
  rpc.mockReturnValue({
    abortSignal: async () => ({ data: data.value, error: null }),
  });
  renderRevision();
  await vi.waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  expect(screen.queryByText("Edit series pattern")).toBeNull();
  cleanup();

  data.value = snapshot(null);
  renderRevision();
  await user.click(await screen.findByText("Edit series pattern"));
  await user.click(screen.getByRole("checkbox", { name: checkLabel }));
  expect(screen.getByText(/This run has no saved pattern/)).toBeVisible();
  expect(screen.getByLabelText("First possible teaching day")).toHaveValue("");
  expect(screen.getByLabelText("Daily start")).toHaveValue("");
  expect(screen.getByLabelText("Mon")).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: previewLabel }));
  expect(
    rpc.mock.calls.every(([name]) => name === "course_series_for_run"),
  ).toBe(true);
});
