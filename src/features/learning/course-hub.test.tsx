/** Regression coverage for the own-course dashboard, phases and protected cache. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
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

const fixture = vi.hoisted(() => ({ courses: [] as CourseOverview[] }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "fictional-learner" } } }),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: (name: string) => ({
      abortSignal: async () => ({
        data: name === "my_course_workspaces" ? fixture.courses : [],
        error: null,
      }),
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
    name: "Abgeschlossene Kurse",
  });
  expect(within(completed).getByText("Lernzugriff deaktiviert")).toBeVisible();
  expect(within(completed).queryByRole("link")).toBeNull();

  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  fireEvent(window, new Event("offline"));
  expect(await screen.findByText(/Verbinde dich|Offline/)).toBeVisible();
  expect(screen.queryByText("Fictional company A")).toBeNull();
});
