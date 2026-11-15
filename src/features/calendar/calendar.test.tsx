import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { CalendarPage } from "./calendar";
import "../../lib/i18n";
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    from: () => ({
      select: () => ({ eq: async () => ({ data: [], error: null }) }),
    }),
  }),
}));
vi.mock("../../lib/queries", () => ({
  profileQuery: () => ({
    queryKey: ["profile"],
    queryFn: async () => ({ time_zone: "Europe/Berlin" }),
  }),
  claimsQuery: () => ({ queryKey: ["claims"], queryFn: async () => [] }),
  eventsQuery: () => ({ queryKey: ["events"], queryFn: async () => [] }),
  jobsQuery: { queryKey: ["jobs"], queryFn: async () => [] },
}));
vi.mock("../operations/data", () => ({
  runsQuery: () => ({
    queryKey: ["runs"],
    queryFn: async () => [
      {
        id: "specific-course",
        template_id: "template",
        published: true,
        archived_at: null,
        course_sessions: [
          {
            id: "session",
            starts_at: "2035-01-01T08:00:00Z",
            ends_at: "2035-01-01T10:00:00Z",
          },
        ],
      },
    ],
  }),
  templatesQuery: () => ({
    queryKey: ["templates"],
    queryFn: async () => [{ id: "template", title: "Published course" }],
  }),
}));
vi.mock("@fullcalendar/react", () => ({
  default: ({
    events,
  }: {
    events: { id: string; title: string; url?: string }[];
  }) => (
    <div>
      {events.map((event) => (
        <a key={event.id} href={event.url}>
          {event.title}
        </a>
      ))}
    </div>
  ),
}));
afterEach(cleanup);
it("global published session links open the precise authorised course detail rather than an unselected catalogue", async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CalendarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Globale Termine" }),
  );
  expect(
    await screen.findByRole("link", { name: "Published course" }),
  ).toHaveAttribute("href", "/courses?run=specific-course");
});
