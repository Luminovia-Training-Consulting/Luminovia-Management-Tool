/** Exercise authorization-based report pivots and serialized export bytes. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { TextWriter, Uint8ArrayReader, ZipReader } from "@zip.js/zip.js";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { LearningAnalyticsPage } from "./learning";
import type {
  LearningAnalyticsAccess,
  LearningAnalyticsReport,
} from "./learning-schema";

const { rpc, getSession, saveBlob } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getSession: vi.fn(),
  saveBlob: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({ rpc, auth: { getSession } }),
}));
vi.mock("../../lib/blob-download", () => ({ saveBlob }));
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

function open(
  capabilities: LearningAnalyticsAccess,
  pageReport: (
    page: number,
    signal: AbortSignal,
  ) => LearningAnalyticsReport | Promise<LearningAnalyticsReport> = () =>
    report,
) {
  rpc.mockImplementation((name: string, args?: { p_page: number }) => ({
    abortSignal: async (signal: AbortSignal) => ({
      data:
        name === "learning_analytics_access"
          ? capabilities
          : await pageReport(args?.p_page ?? 1, signal),
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
  return cache;
}

beforeEach(async () => {
  rpc.mockReset();
  saveBlob.mockReset();
  getSession.mockResolvedValue({
    data: { session: { user: { id: "fictional-course-admin" } } },
  });
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
  await user.type(screen.getByRole("searchbox"), " unapplied");
  await user.click(screen.getByRole("button", { name: "Reset filters" }));
  expect(screen.getByRole("searchbox")).toHaveValue("");
  expect(screen.getByLabelText("Course status")).toHaveValue("all");
  await waitFor(() =>
    expect(rpc).toHaveBeenLastCalledWith(
      "learning_analytics_report",
      expect.objectContaining({
        p_scope: "company",
        p_organisation_id: organisation,
        p_search: "",
        p_status: "all",
        p_page: 1,
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

it("returns to a valid page if the course count drops while changing pages", async () => {
  let removed = false;
  open(access, (page) => {
    if (page === 2) removed = true;
    return removed
      ? {
          ...report,
          totals: { ...report.totals, courses: 1 },
          courses: page === 1 ? report.courses : [],
        }
      : report;
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Next page" }));
  expect(
    await screen.findByRole("link", { name: "Fictional Linux training" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Next page" }),
  ).not.toBeInTheDocument();
  const requests = rpc.mock.calls.filter(
    ([name]) => name === "learning_analytics_report",
  );
  expect(requests.map(([, args]) => args.p_page)).toEqual([1, 2, 1]);
});

/** FileReader supports the JSDOM Blob used by the browser download path. */
function readReportBlob<T extends string | ArrayBuffer>(
  blob: Blob,
  read: (reader: FileReader, blob: Blob) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as T);
    reader.onerror = () => reject(reader.error);
    read(reader, blob);
  });
}

const assessmentReport: LearningAnalyticsReport = {
  ...report,
  courses: report.courses.map((row) => ({
    ...row,
    title: "=Fictional course & report",
  })),
  assessment: {
    metric_version: 1,
    minimum_learner_count: 3,
    courses: [
      {
        course_id: course,
        quiz_learners: 3,
        quiz_attempts: 4,
        quiz_passes: 2,
        quiz_best_average: 82.5,
        published_grades: 3,
        published_grade_average: null,
        submission_learners: null,
        submission_attempts: null,
        released_reviews: null,
        competency_learners: 3,
        competency_decisions: 8,
      },
    ],
  },
};

it("exports a refetched report with safe CSV text, true XLSX numbers and no suppressed values", async () => {
  const user = userEvent.setup();
  open(access, () => assessmentReport);
  const table = await screen.findByRole("region", {
    name: "Assessments and submissions by course",
  });
  expect(within(table).getByText("82.5")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "CSV for this page" }));
  await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1));
  const [csv, csvName] = saveBlob.mock.calls[0];
  expect(csvName).toMatch(/-1\.csv$/);
  const text = await readReportBlob<string>(csv, (reader, blob) =>
    reader.readAsText(blob),
  );
  expect(text).toContain('"Mean percentage grade (%)"');
  expect(text).toContain('"\'=Fictional course & report"');
  expect(text).toContain('"3","","","","","3","8"');
  expect(
    rpc.mock.calls.filter(([name]) => name === "learning_analytics_report"),
  ).toHaveLength(2);

  await user.click(screen.getByRole("button", { name: "XLSX for this page" }));
  await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(2));
  const [workbook, workbookName] = saveBlob.mock.calls[1];
  expect(workbookName).toMatch(/-1\.xlsx$/);
  const buffer = await readReportBlob<ArrayBuffer>(workbook, (reader, blob) =>
    reader.readAsArrayBuffer(blob),
  );
  const zip = new ZipReader(new Uint8ArrayReader(new Uint8Array(buffer)), {
    useWebWorkers: false,
  });
  try {
    const entry = (await zip.getEntries()).find(
      ({ filename }) => filename === "xl/worksheets/sheet1.xml",
    );
    if (!entry || entry.directory) throw new Error("Worksheet missing");
    const xml = await entry.getData(new TextWriter());
    expect(xml).toContain("=Fictional course &amp; report");
    expect(xml).not.toContain("<f>");
    expect(xml).toContain("<v>82.5</v>");
    expect(xml).toContain('<c r="AA2"><v>8</v></c>');
  } finally {
    await zip.close();
  }
});

it("reuses an in-flight report refresh for export without restarting the RPC", async () => {
  const user = userEvent.setup();
  let resolveRefresh!: (value: LearningAnalyticsReport) => void;
  const refreshed = new Promise<LearningAnalyticsReport>((resolve) => {
    resolveRefresh = resolve;
  });
  const load = vi
    .fn<
      (page: number, signal: AbortSignal) => Promise<LearningAnalyticsReport>
    >()
    .mockResolvedValueOnce(report)
    .mockReturnValue(refreshed);
  const cache = open(access, load);
  const exportButton = await screen.findByRole("button", {
    name: "CSV for this page",
  });

  const refresh = cache.refetchQueries({
    queryKey: ["learning-analytics", "fictional-course-admin"],
    predicate: ({ queryKey }) => typeof queryKey[2] === "object",
  });
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  const refreshSignal = load.mock.calls[1][1];

  await user.click(exportButton);
  expect(load).toHaveBeenCalledTimes(2);
  expect(refreshSignal.aborted).toBe(false);
  resolveRefresh({
    ...report,
    courses: report.courses.map((entry) => ({
      ...entry,
      title: "Refreshed fictional course",
    })),
  });

  await refresh;
  await waitFor(() => expect(saveBlob).toHaveBeenCalledTimes(1));
  const text = await readReportBlob<string>(
    saveBlob.mock.calls[0][0],
    (reader, blob) => reader.readAsText(blob),
  );
  expect(text).toContain("Refreshed fictional course");
});

it("keeps refreshed bytes local when the authenticated identity changes", async () => {
  open(access, () => assessmentReport);
  getSession.mockResolvedValue({
    data: { session: { user: { id: "another-account" } } },
  });
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "CSV for this page" }),
  );
  await screen.findByText("Could not export the current report.");
  expect(saveBlob).not.toHaveBeenCalled();
});

it("prints only the fresh report snapshot and removes it after printing", async () => {
  const print = vi.spyOn(window, "print").mockImplementation(() => {});
  try {
    open(access, () => assessmentReport);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Print this page" }),
    );
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    const snapshot = document.querySelector(".learning-report-print");
    expect(snapshot).toHaveTextContent("Mean best quiz score (%)");
    expect(snapshot).toHaveTextContent("82.5");
    window.dispatchEvent(new Event("afterprint"));
    await waitFor(() =>
      expect(document.querySelector(".learning-report-print")).toBeNull(),
    );
  } finally {
    print.mockRestore();
  }
});
