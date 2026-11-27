import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { CourseSeriesForm } from "./course-series";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
afterEach(cleanup);

const organisation = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Fictional organisation",
};
const template = {
  id: "20000000-0000-4000-8000-000000000001",
  title: "Fictional course",
};
const group = {
  id: "30000000-0000-4000-8000-000000000001",
  name: "Fictional class",
};
const runIds = [1, 2, 3, 4].map(
  (number) => `40000000-0000-4000-8000-00000000000${number}`,
);
const getRun = (number: number) =>
  within(screen.getByRole("group", { name: `Run ${number}` }));
const firstDay = (number: number) =>
  getRun(number).getByLabelText("First possible teaching day");

it.each([false, true])(
  "repeats separate run start dates and keeps the conflict review before saving (Academy: %s)",
  async (academic) => {
    await i18n.changeLanguage("en");
    rpc.mockReset();
    const reviewed = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          run_ids: [],
          conflicts: [{ run_no: 3, session_no: 1, reason: "class" }],
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { run_ids: [], conflicts: [] },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { run_ids: runIds, conflicts: [] },
        error: null,
      });
    rpc.mockImplementation((operation, payload) => {
      if (operation === "course_series_classes")
        return {
          abortSignal: async () => ({ data: [group], error: null }),
        };
      if (operation === "plan_course_series") return reviewed(payload);
      throw new Error(`Unexpected RPC: ${operation}`);
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const user = userEvent.setup();
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CourseSeriesForm
            actor="fictional-scheduler"
            organisations={[organisation]}
            templates={[template]}
            defaultOrganisation={organisation.id}
            defaultTemplate={template.id}
            academic={academic}
            canPrepareOffer
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.selectOptions(screen.getByLabelText("Session time zone"), "UTC");
    fireEvent.change(firstDay(1), { target: { value: "2030-04-08" } });
    fireEvent.change(firstDay(2), { target: { value: "2030-04-01" } });
    await user.type(screen.getByLabelText("Excluded dates"), "2030-05-08");
    await user.click(screen.getByRole("button", { name: "Add run" }));
    await getRun(3).findByRole("option", { name: group.name });
    await user.selectOptions(getRun(3).getByLabelText("Class"), group.id);
    await user.selectOptions(
      getRun(3).getByLabelText("Delivery mode"),
      "onsite",
    );
    await user.type(getRun(3).getByLabelText("Room or venue"), "Practice room");
    await user.selectOptions(screen.getByLabelText("Repeat"), "monthly");
    fireEvent.change(screen.getByLabelText("Number of appointments"), {
      target: { value: "3" },
    });
    await user.click(screen.getByRole("button", { name: "Add repeats" }));
    expect(firstDay(1)).toHaveValue("2030-04-08");
    expect(firstDay(2)).toHaveValue("2030-04-01");
    expect(firstDay(3)).toHaveValue("2030-05-08");
    expect(firstDay(3)).toHaveFocus();
    expect(firstDay(4)).toHaveValue("2030-06-08");
    expect(getRun(3).getByLabelText("Room or venue")).toHaveValue(
      "Practice room",
    );
    expect(getRun(3).getByLabelText("Class")).toHaveValue(group.id);
    await user.click(getRun(3).getByText("Schedule pattern for this run"));
    fireEvent.change(getRun(3).getByLabelText("Custom daily start"), {
      target: { value: "10:30" },
    });
    expect(reviewed).not.toHaveBeenCalled();

    const review = screen.getByRole("button", {
      name: "Review sessions and conflicts",
    });
    await user.click(review);
    expect(
      await screen.findByText("This class is already scheduled at this time."),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Create all runs as drafts" }),
    ).toBeNull();
    const teachingPattern = {
      days: 1,
      start: "09:00",
      end: "17:00",
      weekdays: [1, 2, 3, 4, 5],
      excluded_dates: "2030-05-08",
    };
    expect(reviewed.mock.calls[0][0]).toEqual({
      p_request_id: null,
      p_organisation_id: organisation.id,
      p_template_id: template.id,
      p_time_zone: "UTC",
      p_runs: [
        {
          delivery_type: "online",
          venue: "",
          class_id: null,
          pattern: { ...teachingPattern, first_day: "2030-04-08" },
          sessions: [
            {
              starts_at: "2030-04-08T09:00:00.000Z",
              ends_at: "2030-04-08T17:00:00.000Z",
            },
          ],
        },
        {
          delivery_type: "online",
          venue: "",
          class_id: null,
          pattern: { ...teachingPattern, first_day: "2030-04-01" },
          sessions: [
            {
              starts_at: "2030-04-01T09:00:00.000Z",
              ends_at: "2030-04-01T17:00:00.000Z",
            },
          ],
        },
        {
          delivery_type: "onsite",
          venue: "Practice room",
          class_id: group.id,
          pattern: {
            ...teachingPattern,
            first_day: "2030-05-08",
            start: "10:30",
          },
          sessions: [
            {
              starts_at: "2030-05-09T10:30:00.000Z",
              ends_at: "2030-05-09T17:00:00.000Z",
            },
          ],
        },
        {
          delivery_type: "online",
          venue: "",
          class_id: null,
          pattern: { ...teachingPattern, first_day: "2030-06-08" },
          sessions: [
            {
              starts_at: "2030-06-10T09:00:00.000Z",
              ends_at: "2030-06-10T17:00:00.000Z",
            },
          ],
        },
      ],
    });

    await user.selectOptions(getRun(3).getByLabelText("Class"), "");
    expect(
      screen.queryByRole("heading", { name: "Reviewed sessions" }),
    ).toBeNull();
    await user.click(review);
    await user.click(
      await screen.findByRole("button", { name: "Create all runs as drafts" }),
    );
    await waitFor(() => expect(reviewed).toHaveBeenCalledTimes(3));
    expect(reviewed.mock.calls[2][0]).toEqual({
      ...reviewed.mock.calls[1][0],
      p_request_id: expect.any(String),
    });
    const link = await screen.findByRole("link", { name: "Open run 3" });
    expect(link).toHaveAttribute(
      "href",
      academic
        ? `/courses/${runIds[2]}/workspace`
        : `/courses?run=${runIds[2]}`,
    );
    expect(
      screen.getByRole("link", { name: "Edit schedule pattern for run 3" }),
    ).toHaveAttribute(
      "href",
      academic
        ? `/courses/${runIds[2]}/workspace?editSeries=1`
        : `/courses?run=${runIds[2]}&editSeries=1`,
    );
    if (!academic) {
      for (const [index, run] of runIds.entries()) {
        expect(
          screen.getByRole("link", {
            name: `Prepare offer for run ${index + 1}`,
          }),
        ).toHaveAttribute("href", `/courses?offer=${run}`);
      }
    } else {
      expect(
        screen.queryByRole("link", { name: /prepare offer for run/i }),
      ).toBeNull();
    }
    client.clear();
  },
);
