import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { CalendarPage } from "./calendar";
import i18n from "../../lib/i18n";
const state = vi.hoisted(() => ({
  claims: [] as unknown[],
  rpc: vi.fn(),
  datesSetOnLocale: false,
  callbacks: [] as unknown[],
}));
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
  default: function Calendar({
    events,
    datesSet,
    eventClick,
    locale,
  }: {
    events: {
      id: string;
      title: string;
      url?: string;
      extendedProps?: { kind: string };
    }[];
    datesSet?: (value: { start: Date; end: Date }) => void;
    eventClick?: (value: {
      event: { id: string; extendedProps: { kind?: string } };
      jsEvent: { preventDefault: () => void };
    }) => void;
    locale: unknown;
  }) {
    state.callbacks.push(datesSet);
    // FullCalendar rebuilds its DateProfile when locale options change and may
    // deliver datesSet again even though the visible instants remain identical.
    useEffect(() => {
      if (state.datesSetOnLocale)
        datesSet?.({
          start: new Date("2060-03-01T00:00Z"),
          end: new Date("2060-04-10T00:00Z"),
        });
    }, [locale, datesSet]);
    return (
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
          <a
            key={event.id}
            href={event.url}
            onClick={(jsEvent) =>
              eventClick?.({
                event: {
                  id: event.id,
                  extendedProps: event.extendedProps ?? {},
                },
                jsEvent,
              })
            }
          >
            {event.title}
          </a>
        ))}
      </div>
    );
  },
}));
beforeEach(async () => {
  await i18n.changeLanguage("de");
  state.datesSetOnLocale = false;
  state.callbacks = [];
});
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

it("preserves the same global-event dialog/link across locale and equal-range signals/refetch, but closes it on real navigation", async () => {
  const event = {
    id: "c8000000-0000-4000-8000-000000000001",
    title: "Fictional published lesson",
    description: "Authored <script> description stays plain text",
    link_url: "https://example.invalid/lesson",
    starts_at: "2060-03-28T00:30:45Z",
    ends_at: "2060-03-28T02:30:45Z",
    time_zone: "Europe/Berlin",
    published: true,
    archived_at: null,
    version: 1,
    updated_at: "2060-01-01T00:00:00Z",
  };
  state.datesSetOnLocale = true;
  state.rpc.mockImplementation(() => {
    const result = Promise.resolve({
      data: { items: [event], has_more: false, next_cursor: null },
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
  await user.click(
    await screen.findByRole("button", { name: "Globale Termine" }),
  );
  await user.click(await screen.findByText(event.title));
  const dialog = screen.getByRole("dialog");
  const signal = state.callbacks.at(-1) as (range: {
    start: Date;
    end: Date;
  }) => void;
  expect(within(dialog).getByText(event.description)).toBeInTheDocument();
  expect(
    within(dialog).getByRole("link", { name: "Weiterführenden Link öffnen" }),
  ).toHaveAttribute("href", event.link_url);
  expect(state.rpc).toHaveBeenCalledTimes(1);
  await act(() => i18n.changeLanguage("en"));
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(
    within(dialog).getByRole("link", { name: "Open related link" }),
  ).toHaveAttribute("rel", "noopener noreferrer");
  expect(within(dialog).getByText(event.description)).toBeInTheDocument();
  expect(state.rpc).toHaveBeenCalledTimes(1);
  await act(async () => {
    signal({
      start: new Date("2060-03-01T00:00Z"),
      end: new Date("2060-04-10T00:00Z"),
    });
  });
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(state.rpc).toHaveBeenCalledTimes(1);
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["global-events"] });
  });
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(state.rpc).toHaveBeenCalledTimes(2);
  expect(new Set(state.callbacks).size).toBe(1);
  await act(async () => {
    // FullCalendar can navigate A→B→A before React commits a render. Comparing
    // a stale render's range would accidentally leave B selected and query it.
    signal({
      start: new Date("2060-04-10T00:00Z"),
      end: new Date("2060-05-20T00:00Z"),
    });
    signal({
      start: new Date("2060-03-01T00:00Z"),
      end: new Date("2060-04-10T00:00Z"),
    });
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(state.rpc).toHaveBeenCalledTimes(2);
  await user.click(screen.getByText(event.title));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(state.rpc).toHaveBeenCalledTimes(2);
  await act(async () => {
    signal({
      start: new Date("2060-04-10T00:00Z"),
      end: new Date("2060-05-20T00:00Z"),
    });
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(state.rpc).toHaveBeenCalledTimes(3);
  expect(state.rpc).toHaveBeenLastCalledWith(
    "global_calendar_events",
    expect.objectContaining({
      p_from: "2060-04-10T00:00:00.000Z",
      p_to: "2060-05-20T00:00:00.000Z",
    }),
  );
  expect(new Set(state.callbacks).size).toBe(1);
  client.clear();
});
