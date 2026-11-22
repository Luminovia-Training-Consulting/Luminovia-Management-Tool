/** Regression coverage for the own-course dashboard, phases and protected cache. */
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import type { CourseOverview } from "./api";
import { LearningHubPage } from "./course-hub";

const fixture = vi.hoisted(() => ({
  courses: [] as CourseOverview[],
  invitations: [] as {
    organisation_id: string;
    organisation_name: string;
    version: number;
  }[],
  courseRead: undefined as Promise<void> | undefined,
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "fictional-learner" } } }),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: (name: string, args?: { p_run_id: string }) => ({
      abortSignal: async () => {
        await fixture.courseRead;
        return {
          data:
            name === "my_course_workspaces"
              ? fixture.courses
              : name === "course_workspace"
                ? {
                    lms_enabled: true,
                    access: {
                      learner: true,
                      teacher: args?.p_run_id === "soon",
                    },
                    resources: [
                      {
                        id: args?.p_run_id,
                        name:
                          args?.p_run_id === "now"
                            ? "Workshop.pdf"
                            : "Course notes.pdf",
                        category: "material",
                        version: 1,
                      },
                    ],
                  }
                : fixture.invitations,
          error: null,
        };
      },
    }),
    from: () => ({
      select: () => ({
        eq: async () => ({ data: [{ role: "participant" }], error: null }),
      }),
    }),
  }),
}));

/** Return displayed dates as real ISO instants relative to the test run. */
function date(offset: number) {
  return new Date(Date.now() + offset * 86_400_000).toISOString();
}

beforeEach(async () => {
  await i18n.changeLanguage("de");
  fixture.courseRead = undefined;
  fixture.invitations = [];
  const base = {
    description: "",
    syllabus: "",
    time_zone: "Europe/Berlin",
    venue: "",
    delivery_type: "online",
    lms_enabled: true,
    participant: true,
  };
  fixture.courses = [
    {
      ...base,
      id: "later",
      title: "Fictional workshop",
      organisation_name: "Fictional company B",
      starts_at: date(10),
      ends_at: date(11),
    },
    {
      ...base,
      id: "soon",
      title: "Upcoming course",
      starts_at: date(2),
      ends_at: date(3),
    },
    {
      ...base,
      id: "now",
      title: "Current course",
      organisation_name: "Fictional company A",
      starts_at: date(-1),
      ends_at: date(1),
      next_start_at: date(1),
    },
    {
      ...base,
      id: "finished",
      title: "Completed course",
      starts_at: date(-4),
      ends_at: date(-3),
      lms_enabled: false,
    },
  ];
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  onlineManager.setOnline(true);
});

it("groups current, next and past courses and preserves a direct scoped chat destination", async () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LearningHubPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const current = await screen.findByRole("region", { name: "Laufende Kurse" });
  expect(
    screen.getByRole("link", { name: "Hilfe & Anleitungen" }),
  ).toHaveAttribute("href", "/help?topic=lms-learning");
  expect(within(current).getByText("Fictional company A")).toBeVisible();
  expect(
    within(current).getByRole("link", { name: "Kurs-Chat" }),
  ).toHaveAttribute("href", "/courses/now/workspace#course-chat");
  const upcoming = screen.getByRole("region", { name: "Kommende Kurse" });
  expect(
    within(upcoming)
      .getAllByRole("heading")
      .map((item) => item.textContent),
  ).toEqual(["Kommende Kurse", "Upcoming course", "Fictional workshop"]);
  const completed = screen.getByRole("region", {
    name: "Vergangene Kurse",
  });
  expect(within(completed).getByText("Lernzugriff deaktiviert")).toBeVisible();
  expect(within(completed).queryByRole("link")).toBeNull();

  const phases = screen.getByRole("combobox", {
    name: "Kurse nach Zeitraum filtern",
  });
  fireEvent.change(phases, { target: { value: "completed" } });
  expect(
    screen.getByRole("region", { name: "Vergangene Kurse" }),
  ).toBeVisible();
  expect(screen.queryByRole("region", { name: "Laufende Kurse" })).toBeNull();
  fireEvent.change(phases, { target: { value: "unscheduled" } });
  expect(screen.getByText("Keine Kurse in diesem Zeitraum.")).toBeVisible();
  fireEvent.change(phases, { target: { value: "all" } });

  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  fireEvent(window, new Event("offline"));
  expect(await screen.findByText(/Verbinde dich|Offline/)).toBeVisible();
  expect(screen.queryByText("Fictional company A")).toBeNull();
});

it("waits for current company courses and invitations after reconnecting with a warm cache", async () => {
  fixture.invitations = [
    {
      organisation_id: "invitation-company",
      organisation_name: "Fictional invitation",
      version: 1,
    },
  ];
  const connectivity = vi
    .spyOn(navigator, "onLine", "get")
    .mockReturnValue(true);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LearningHubPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Fictional company A")).toBeVisible();
  expect(
    await screen.findByRole("button", { name: /Fictional invitation/ }),
  ).toBeVisible();
  connectivity.mockReturnValue(false);
  fireEvent(window, new Event("offline"));
  expect(screen.queryByText("Fictional company A")).toBeNull();

  let completeRead!: () => void;
  fixture.courseRead = new Promise((resolve) => {
    completeRead = resolve;
  });
  fixture.courses = fixture.courses.filter((course) => course.id !== "now");
  fixture.invitations = [];
  connectivity.mockReturnValue(true);
  fireEvent(window, new Event("online"));
  expect(screen.queryByText("Fictional company A")).toBeNull();
  expect(screen.queryByText("Fictional company B")).toBeNull();
  expect(
    screen.queryByRole("button", { name: /Fictional invitation/ }),
  ).toBeNull();
  await act(async () => completeRead());
  expect(await screen.findByText("Fictional company B")).toBeVisible();
  expect(screen.queryByText("Fictional company A")).toBeNull();
  expect(
    screen.queryByRole("button", { name: /Fictional invitation/ }),
  ).toBeNull();
  cleanup();
  queryClient.clear();
});

it("finds accessible material by course and file name and links upload only for a teaching assignment", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/learning?view=materials"]}>
        <LearningHubPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Workshop.pdf")).toBeVisible();
  expect(await screen.findAllByText("Course notes.pdf")).not.toHaveLength(0);
  expect(
    screen.queryByRole("heading", { name: "Completed course" }),
  ).toBeNull();

  const course = screen.getByRole("combobox", { name: "Nach Kurs filtern" });
  fireEvent.change(course, { target: { value: "now" } });
  expect(screen.queryByText("Course notes.pdf")).toBeNull();
  expect(
    screen.queryByRole("link", { name: "Neue Kursdatei freigeben" }),
  ).toBeNull();
  expect(
    screen.getByRole("button", { name: "Workshop.pdf herunterladen" }),
  ).toBeVisible();
  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "missing" },
  });
  expect(screen.queryByText("Workshop.pdf")).toBeNull();
  expect(
    screen.getByText("Keine passenden Dateien in diesem Kurs."),
  ).toBeVisible();

  fireEvent.change(course, { target: { value: "soon" } });
  expect(
    await screen.findByRole("link", { name: "Neue Kursdatei freigeben" }),
  ).toHaveAttribute("href", "/courses/soon/workspace#course-materials");
});
