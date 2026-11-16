import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { CalendarPage } from "./calendar";
import "../../lib/i18n";
const state = vi.hoisted(() => ({ claims: [] as unknown[], rpc: vi.fn() }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: state.rpc,
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
  claimsQuery: () => ({
    queryKey: ["claims"],
    queryFn: async () => state.claims,
  }),
  eventsQuery: () => ({ queryKey: ["events"], queryFn: async () => [] }),
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
afterEach(() => {
  cleanup();
  state.claims = [];
  vi.clearAllMocks();
});
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
  expect(state.rpc).not.toHaveBeenCalled();
});
it("loads titles only for own confirmed assignment IDs rather than the entire marketplace", async () => {
  const jobID = "d7000000-0000-4000-8000-000000000001";
  state.claims = [
    {
      id: "claim",
      job_id: jobID,
      assignment_sessions: [
        {
          id: "session",
          starts_at: "2060-01-01T08:00:00Z",
          ends_at: "2060-01-01T10:00:00Z",
        },
      ],
    },
  ];
  state.rpc.mockImplementation(() => {
    const response = Promise.resolve({
      data: [{ id: jobID, title: "Own old teaching block" }],
      error: null,
    });
    return Object.assign(response, { abortSignal: () => response });
  });
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
  expect(
    await screen.findByRole("link", { name: "Own old teaching block" }),
  ).toHaveAttribute("href", `/jobs/${jobID}`);
  expect(state.rpc).toHaveBeenCalledTimes(1);
  expect(state.rpc).toHaveBeenCalledWith("assignment_job_titles", {
    p_job_ids: [jobID],
  });
});
