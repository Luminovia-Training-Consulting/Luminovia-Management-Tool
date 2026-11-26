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
import type { MaterialMetadata } from "./material-metadata-schema";

const fixture = vi.hoisted(() => ({
  courses: [] as CourseOverview[],
  invitations: [] as {
    organisation_id: string;
    organisation_name: string;
    version: number;
  }[],
  courseRead: undefined as Promise<void> | undefined,
  materials: [] as {
    id: string;
    course_id: string;
    course_title: string;
    name: string;
    category: string;
    version: number;
    can_upload: boolean;
    can_edit_metadata?: boolean;
    metadata_revision?: number;
    metadata?: MaterialMetadata;
  }[],
  revise: vi.fn(),
  nextPageForbidden: false,
  calls: [] as {
    p_course_id?: string;
    p_search?: string;
    p_category?: string;
    p_offset?: number;
  }[],
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "fictional-learner" } } }),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: (name: string, args: (typeof fixture.calls)[number] = {}) =>
      name === "set_course_material_metadata"
        ? fixture.revise(args)
        : {
            abortSignal: async () => {
              await fixture.courseRead;
              if (name === "search_course_materials") {
                fixture.calls.push(args);
                const offset = args.p_offset ?? 0;
                if (offset && fixture.nextPageForbidden)
                  return { data: null, error: { code: "42501" }, status: 403 };
                const matches = fixture.materials.filter(
                  (file) =>
                    (!args.p_course_id ||
                      args.p_course_id === file.course_id) &&
                    (!args.p_category || args.p_category === file.category) &&
                    file.name
                      .toLowerCase()
                      .includes((args.p_search ?? "").toLowerCase()),
                );
                return {
                  data: matches.slice(offset, offset + 25),
                  error: null,
                };
              }
              return {
                data:
                  name === "my_course_workspaces"
                    ? fixture.courses
                    : fixture.invitations,
                error: null,
              };
            },
          },
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
  fixture.materials = [];
  fixture.calls = [];
  fixture.revise.mockReset();
  fixture.nextPageForbidden = false;
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
  expect(
    within(completed).getByRole("link", { name: "Kurs öffnen" }),
  ).toHaveAttribute("href", "/courses/finished/workspace");
  expect(
    within(completed).queryByRole("link", { name: "Kurs-Chat" }),
  ).toBeNull();

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

it("searches beyond the course overview, applies all three filters and preserves scoped file actions", async () => {
  fixture.materials = [
    {
      id: "a",
      course_id: "older",
      course_title: "Older course outside the dashboard",
      name: "Workshop.pdf",
      category: "material",
      version: 1,
      can_upload: false,
    },
    {
      id: "b",
      course_id: "soon",
      course_title: "Upcoming course",
      name: "Workshop report.pdf",
      category: "report",
      version: 2,
      can_upload: true,
    },
  ];
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/learning?view=materials"]}>
        <LearningHubPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Workshop.pdf")).toBeVisible();
  const course = screen.getByRole("combobox", { name: "Nach Kurs filtern" });
  const search = screen.getByRole("searchbox");
  fireEvent.change(search, { target: { value: "workshop" } });
  expect(
    await screen.findByRole("button", { name: "Workshop.pdf herunterladen" }),
  ).toBeVisible();
  fireEvent.change(screen.getByRole("combobox", { name: "Dokumentart" }), {
    target: { value: "report" },
  });
  expect(await screen.findByText("Workshop report.pdf")).toBeVisible();
  expect(screen.queryByText("Workshop.pdf")).toBeNull();

  fireEvent.change(course, { target: { value: "soon" } });
  expect(
    await screen.findByRole("link", { name: "Neue Kursdatei freigeben" }),
  ).toHaveAttribute("href", "/courses/soon/workspace#course-materials");
  expect(fixture.calls.at(-1)).toEqual({
    p_course_id: "soon",
    p_search: "workshop",
    p_category: "report",
    p_offset: 0,
  });
  fireEvent.change(search, { target: { value: "missing" } });
  expect(
    await screen.findByText("Keine passenden Dateien gefunden."),
  ).toBeVisible();
});

it("validates catalogue tags and preserves unsaved input on a revision conflict", async () => {
  await i18n.changeLanguage("en");
  const file = {
    id: "a",
    course_id: "soon",
    course_title: "Fictional course",
    name: "Workshop.pdf",
    category: "material",
    version: 1,
    can_upload: true,
    can_edit_metadata: true,
    metadata_revision: 1,
    metadata: {
      title: "First metadata",
      description: "",
      subject: "",
      licence: "",
      language: "en" as const,
      tags: ["Linux"],
    },
  };
  fixture.materials = [file];
  fixture.revise.mockImplementationOnce(async () => {
    fixture.materials = [
      {
        ...file,
        metadata_revision: 2,
        metadata: { ...file.metadata, title: "Newer metadata" },
      },
    ];
    return { error: { code: "PT409" } };
  });
  fixture.revise.mockImplementationOnce(async () => {
    fixture.materials = [
      {
        ...file,
        metadata_revision: 3,
        metadata: { ...file.metadata, title: "Reviewed metadata" },
      },
    ];
    return { error: null };
  });

  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/learning?view=materials"]}>
        <LearningHubPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const edit = await screen.findByRole("button", { name: "Edit metadata" });
  fireEvent.click(edit);
  const title = screen.getByRole("textbox", { name: "Title" });
  const tags = screen.getByRole("textbox", { name: "Tags" });
  const save = screen.getByRole("button", { name: "Save metadata" });
  fireEvent.change(title, { target: { value: "  My notes  " } });
  fireEvent.change(tags, { target: { value: "Linux, linux" } });
  fireEvent.click(save);
  expect(tags).toHaveAttribute("aria-invalid", "true");
  expect(fixture.revise).not.toHaveBeenCalled();

  fireEvent.change(tags, { target: { value: " Linux , Storage " } });
  fireEvent.click(save);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The metadata has changed",
  );
  expect(title).toHaveValue("  My notes  ");
  expect(save).toBeDisabled();
  expect(fixture.revise).toHaveBeenCalledWith({
    p_resource_id: file.id,
    p_expected_revision: 1,
    p_metadata: {
      ...file.metadata,
      title: "My notes",
      tags: ["Linux", "Storage"],
    },
  });

  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(edit).toHaveFocus();
  await screen.findByRole("heading", { name: "Newer metadata" });
  fireEvent.click(edit);
  fireEvent.change(screen.getByRole("textbox", { name: "Title" }), {
    target: { value: "Reviewed metadata" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save metadata" }));
  await screen.findByText("The metadata was saved.");
  expect(
    await screen.findByRole("heading", { name: "Reviewed metadata" }),
  ).toBeVisible();
  expect(fixture.revise.mock.lastCall?.[0].p_expected_revision).toBe(2);
});

it("paginates matching files and uses the result to filter a course outside the overview", async () => {
  fixture.materials = Array.from({ length: 25 }, (_, index) => ({
    id: String(index),
    course_id: "older",
    course_title: "Outside dashboard",
    name: `Handout-${index}.pdf`,
    category: "material",
    version: 1,
    can_upload: false,
  }));
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/learning?view=materials"]}>
        <LearningHubPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Weitere Dateien laden" }),
  );
  expect(await screen.findByText("Handout-24.pdf")).toBeVisible();
  expect(screen.getByText("Handout-0.pdf")).toBeVisible();
  expect(fixture.calls.at(-1)?.p_offset).toBe(24);
  fireEvent.click(
    screen.getByRole("button", { name: "Nur diesen Kurs anzeigen" }),
  );
  expect(await screen.findByText("Handout-0.pdf")).toBeVisible();
  expect(
    screen.getByRole("combobox", { name: "Nach Kurs filtern" }),
  ).toHaveValue("older");
  expect(
    screen.queryByRole("link", { name: "Neue Kursdatei freigeben" }),
  ).toBeNull();
  expect(fixture.calls.at(-1)?.p_course_id).toBe("older");
});

it("hides the material already shown when a continuation reports permission revocation", async () => {
  fixture.materials = Array.from({ length: 25 }, (_, index) => ({
    id: String(index),
    course_id: "older",
    course_title: "Restricted course",
    name: `Restricted-${index}.pdf`,
    category: "material",
    version: 1,
    can_upload: false,
  }));
  fixture.nextPageForbidden = true;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/learning?view=materials"]}>
        <LearningHubPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Restricted-0.pdf")).toBeVisible();
  fireEvent.click(
    screen.getByRole("button", { name: "Weitere Dateien laden" }),
  );
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByText("Restricted-0.pdf")).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Erneut versuchen" }),
  ).toBeVisible();
});
