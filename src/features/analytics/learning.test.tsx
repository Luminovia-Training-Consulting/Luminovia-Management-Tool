import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { LearningAnalyticsPage } from "./learning";
import type {
  LearningAnalyticsAccess,
  LearningAnalyticsReport,
} from "./learning-schema";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "fictional-course-admin" } } }),
}));

const organisation = "9b542f92-ed1d-43a0-a51f-28ab7042f8a1";
const course = "5e2056b6-6849-4691-a329-1b06ca552378";
const access: LearningAnalyticsAccess = {
  staff: true,
  personal: true,
  time_zone: "Australia/Brisbane",
  organisations: [
    { id: organisation, company: true, name: "Fictional Academy" },
  ],
};
const metrics = {
  enrolments: 3,
  completions: 2,
  certificates: 1,
  sessions: 2,
  minutes: 150,
  present: 4,
  absent: 1,
  excused: 1,
};
const report: LearningAnalyticsReport = {
  time_zone: "Australia/Brisbane",
  totals: { courses: 26, participants: 3, upcoming: 0, ...metrics },
  months: [
    {
      month: "2026-11-01",
      enrolments: 3,
      completions: 2,
      finished: 1,
      upcoming: 0,
    },
  ],
  courses: [
    {
      id: course,
      title: "Fictional Linux training",
      organisation: "Fictional Academy",
      class_name: "Linux group",
      status: "finished",
      cohort_date: "2026-11-17",
      starts_at: "2026-11-17T00:00:00+00:00",
      ends_at: "2026-11-19T00:00:00+00:00",
      ...metrics,
    },
  ],
};

function open(capabilities: LearningAnalyticsAccess) {
  rpc.mockImplementation((name: string) => ({
    abortSignal: async () => ({
      data: name === "learning_analytics_access" ? capabilities : report,
      error: null,
    }),
  }));
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <MemoryRouter>
      <QueryClientProvider client={cache}>
        <LearningAnalyticsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  rpc.mockReset();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  await i18n.changeLanguage("en");
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("shows scoped metrics and queries the chosen company, date, status, search and page", async () => {
  const user = userEvent.setup();
  open(access);
  const table = await screen.findByRole("region", {
    name: "Metrics by course",
  });
  expect(
    within(table).getByRole("link", { name: "Fictional Linux training" }),
  ).toHaveAttribute("href", `/courses/${course}/workspace`);
  expect(within(table).getByText("80%")).toBeInTheDocument();
  expect(screen.getByText("67%", { selector: "dd" })).toBeInTheDocument();
  expect(screen.getByText("2.5 hr", { selector: "dd" })).toBeInTheDocument();
  expect(rpc).toHaveBeenCalledWith(
    "learning_analytics_report",
    expect.objectContaining({ p_scope: "staff", p_organisation_id: null }),
  );
  await user.selectOptions(screen.getByLabelText("Report scope"), "company");
  await user.selectOptions(screen.getByLabelText("Course status"), "finished");
  await user.type(screen.getByRole("searchbox"), "Linux group");
  await user.click(screen.getByRole("button", { name: /^Search$/ }));
  await user.click(await screen.findByRole("button", { name: "Next page" }));
  await waitFor(() =>
    expect(rpc).toHaveBeenLastCalledWith(
      "learning_analytics_report",
      expect.objectContaining({
        p_scope: "company",
        p_organisation_id: organisation,
        p_status: "finished",
        p_search: "Linux group",
        p_page: 2,
      }),
    ),
  );
  await user.selectOptions(screen.getByLabelText("Date range"), "nextQuarter");
  await waitFor(() =>
    expect(rpc).toHaveBeenLastCalledWith(
      "learning_analytics_report",
      expect.objectContaining({
        p_scope: "company",
        p_status: "finished",
        p_page: 1,
        p_from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      }),
    ),
  );
});

it("does not request a course report when the account has no reporting scope", async () => {
  open({ staff: false, personal: false, organisations: [], time_zone: "UTC" });
  await screen.findByText(
    "LMS analytics are currently unavailable for your role.",
  );
  expect(rpc).toHaveBeenCalledExactlyOnceWith("learning_analytics_access");
});
