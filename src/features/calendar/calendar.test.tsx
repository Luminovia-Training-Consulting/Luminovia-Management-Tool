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
  permissionsQuery: () => ({
    queryKey: ["permissions"],
    queryFn: async () => [],
  }),
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
    datesSet,
  }: {
    events: { id: string; title: string; url?: string }[];
    datesSet?: (value: { start: Date; end: Date }) => void;
  }) => (
    <div>
      <button
        onClick={() =>
          datesSet?.({
            start: new Date("2060-03-01T00:00Z"),
            end: new Date("2060-04-10T00:00Z"),
          })
        }
      >
        Change visible range
      </button>
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
  state.rpc.mockImplementation(() => {
    const response = Promise.resolve({
      data: { items: [], has_more: false, next_cursor: null },
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
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Globale Termine" }),
  );
  expect(
    await screen.findByRole("link", { name: "Published course" }),
  ).toHaveAttribute("href", "/courses?run=specific-course");
  expect(state.rpc).toHaveBeenCalledTimes(1);
  expect(state.rpc).toHaveBeenCalledWith(
    "global_calendar_events",
    expect.objectContaining({ p_manage: false, p_limit: 50 }),
  );
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

it("queries only the visible global range on navigation, without remounting or crawling other months", async () => {
  state.rpc.mockImplementation(() => {
    const result = Promise.resolve({
      data: { items: [], has_more: false, next_cursor: null },
      error: null,
    });
    return Object.assign(result, { abortSignal: () => result });
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
  const user = userEvent.setup();
  const navigate = await screen.findByRole("button", {
    name: "Change visible range",
  });
  expect(state.rpc).not.toHaveBeenCalled();
  await user.click(
    await screen.findByRole("button", { name: "Globale Termine" }),
  );
  await screen.findByText("0 Termine geladen");
  expect(state.rpc).toHaveBeenCalledTimes(1);
  await user.click(navigate);
  await screen.findByText("0 Termine geladen");
  expect(state.rpc).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("button", { name: "Change visible range" })).toBe(
    navigate,
  );
  expect(state.rpc).toHaveBeenLastCalledWith(
    "global_calendar_events",
    expect.objectContaining({
      p_from: "2060-03-01T00:00:00.000Z",
      p_to: "2060-04-10T00:00:00.000Z",
      p_limit: 50,
    }),
  );
});
