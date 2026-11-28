/**
 * Calendar regressions for own assignment titles, authorised course links and
 * global-event detail lifetime across locale, query refresh and range changes.
 * Controlled Query/FullCalendar fixtures do not replace native ACL acceptance.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  type ReactNode,
  type Ref,
  useEffect,
  useId,
  useImperativeHandle,
  useState,
} from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryRouter,
  Link,
  RouterProvider,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { CalendarPage } from "./calendar";
import type { DateClickArg } from "@fullcalendar/interaction";
import type { DateSelectArg } from "@fullcalendar/core";
import i18n from "../../lib/i18n";

function MemoryRouter({
  children,
  initialEntries,
}: {
  children: ReactNode;
  initialEntries?: string[];
}) {
  const [router] = useState(() =>
    createMemoryRouter([{ path: "*", element: <>{children}</> }], {
      initialEntries,
    }),
  );
  return <RouterProvider router={router} />;
}

const state = vi.hoisted(() => ({
  claims: [] as {
    id: string;
    job_id: string;
    assignment_sessions: { id: string; starts_at: string; ends_at: string }[];
  }[],
  permissions: [] as string[],
  events: [] as unknown[],
  loadEvents: vi.fn(),
  deleteEvent: vi.fn(),
  saveEvent: vi.fn(),
  rpc: vi.fn(),
  datesSetOnLocale: false,
  reportInitialWindow: true,
  callbacks: [] as unknown[],
  initialDate: undefined as string | undefined,
  displayedZone: undefined as string | undefined,
}));
const calendarCalls = () => state.rpc.mock.calls;
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: (...args: unknown[]) => {
      if (args[0] === "calendar_invitations")
        return {
          abortSignal: async () => ({
            data: { items: [], next_cursor: null },
            error: null,
          }),
        };
      if (args[0] === "get_my_calendar_color_preferences")
        return Promise.resolve({
          data: {
            personal_event_color: "#E1EDDA",
            assignment_event_color: "#DCE9F8",
            customer_event_color: "#FFF0C5",
            version: 0,
          },
          error: null,
        });
      return state.rpc(...args);
    },
    from: () => ({
      select: () => ({ eq: async () => ({ data: [], error: null }) }),
      insert: (payload: unknown) => ({
        select: () => ({ single: () => state.saveEvent(payload) }),
      }),
      update: (payload: unknown) => ({
        eq: () => ({
          eq: () => ({
            select: () => ({ single: () => state.saveEvent(payload) }),
          }),
        }),
      }),
      delete: () => ({
        eq: () => ({
          eq: () => ({ select: () => ({ single: state.deleteEvent }) }),
        }),
      }),
    }),
  }),
}));
vi.mock("../../lib/queries", () => ({
  permissionsQuery: () => ({
    queryKey: ["permissions"],
    queryFn: async () => state.permissions,
  }),
  profileQuery: () => ({
    queryKey: ["profile"],
    queryFn: async () => ({ time_zone: "Europe/Berlin" }),
  }),
}));
vi.mock("./calendar-window-api", () => ({
  calendarAssignmentsQuery: (
    actor: string,
    range: { from: string; to: string },
  ) => ({
    queryKey: ["claims", actor, "calendar", range.from, range.to],
    queryFn: async () =>
      state.claims.flatMap(({ job_id, assignment_sessions }) =>
        assignment_sessions.map((slot) => ({
          ...slot,
          job_claims: { job_id },
        })),
      ),
  }),
  calendarAssignmentStartQuery: (actor: string, assignment: string | null) => ({
    queryKey: ["claims", actor, "calendar-start", assignment],
    enabled: Boolean(assignment),
    queryFn: async () =>
      state.claims
        .filter((item) => item.job_id === assignment)
        .flatMap((item) => item.assignment_sessions)
        .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0]
        ?.starts_at ?? null,
  }),
  privateCalendarEventsQuery: (
    actor: string,
    range: { from: string; to: string },
  ) => ({
    queryKey: ["events", actor, range.from, range.to],
    queryFn: () => state.loadEvents(range),
  }),
}));
vi.mock("../operations/data", () => ({
  calendarCourseRunsQuery: (_actor: string, from: string, to: string) => ({
    queryKey: ["runs", from, to],
    queryFn: async () => [
      {
        id: "specific-course",
        template_id: "template",
        course_templates: {
          title: "Published course",
          course_template_topics: [],
        },
        organisations: null,
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
}));
vi.mock("@fullcalendar/react", () => ({
  default: function Calendar({
    events,
    datesSet,
    eventClick,
    locale,
    timeZone,
    initialDate,
    ref,
    selectable,
    dateClick,
    select,
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
    timeZone: string;
    initialDate?: string;
    selectable?: boolean;
    dateClick?: (value: Pick<DateClickArg, "dateStr" | "allDay">) => void;
    select?: (
      value: Pick<DateSelectArg, "startStr" | "endStr" | "allDay">,
    ) => void;
    ref?: Ref<{
      getApi: () => {
        getDate: () => Date;
        formatIso: (date: Date, omitTime: boolean) => string;
        unselect: () => void;
      };
    }>;
  }) {
    const instanceId = useId();
    useImperativeHandle(
      ref,
      () => ({
        getApi: () => ({
          getDate: () => new Date("2030-10-27T12:00:00Z"),
          formatIso: (date, omitTime) =>
            omitTime ? date.toISOString().slice(0, 10) : date.toISOString(),
          unselect: () => undefined,
        }),
      }),
      [],
    );
    state.callbacks.push(datesSet);
    state.initialDate = initialDate;
    state.displayedZone = timeZone;
    const [initialDatesSet] = useState(() => datesSet);
    useEffect(() => {
      if (!state.reportInitialWindow) return;
      initialDatesSet?.({
        start: new Date("2060-02-01T00:00Z"),
        end: new Date("2060-03-01T00:00Z"),
      });
    }, [initialDatesSet]);
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
      <div data-testid="calendar-engine" data-instance={instanceId}>
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
        <button
          disabled={!selectable}
          onClick={() =>
            select?.({
              startStr: "2030-03-30",
              endStr: "2030-04-02",
              allDay: true,
            })
          }
        >
          Select date range
        </button>
        <button
          disabled={!selectable}
          onClick={() =>
            dateClick?.({
              dateStr: "2030-03-30T09:00:00+10:00",
              allDay: false,
            })
          }
        >
          Click time slot
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
  state.reportInitialWindow = true;
  state.loadEvents.mockImplementation(async () => state.events);
  state.callbacks = [];
  state.initialDate = undefined;
  state.displayedZone = undefined;
});
afterEach(() => {
  cleanup();
  state.claims = [];
  state.permissions = [];
  state.events = [];
  state.loadEvents.mockReset();
  vi.clearAllMocks();
});
it("keeps calendar tools collapsed until explicitly opened and preserves the disclosure across locale changes", async () => {
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
  await waitFor(() =>
    expect(document.querySelector(".calendar-panel")).toBeInTheDocument(),
  );
  const summary = await screen.findByText("Kalenderfunktionen");
  expect(summary.tagName).toBe("SUMMARY");
  const tools = summary.closest("details");
  expect(tools).not.toHaveAttribute("open");
  expect(
    tools?.querySelectorAll(".calendar-tools-content > details"),
  ).toHaveLength(5);
  expect(
    state.rpc.mock.calls.some(([name]) => name === "my_calendar_subscriptions"),
  ).toBe(false);

  summary.focus();
  expect(document.activeElement).toBe(summary);
  fireEvent.click(summary);
  expect(tools).toHaveAttribute("open", "");
  expect(
    tools?.querySelectorAll(".calendar-tools-content > details > summary"),
  ).toHaveLength(5);
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  expect(screen.getByText("Calendar tools")).toBeInTheDocument();
  expect(tools).toHaveAttribute("open", "");
  client.clear();
});
it("keeps a populated grid stable when the search input changes without changing its filter", async () => {
  state.events = Array.from({ length: 200 }, (_, index) => ({
    id: `private-${index}`,
    title: `Planning ${index}`,
    starts_at: "2060-01-01T08:00:00Z",
    ends_at: "2060-01-01T09:00:00Z",
  }));
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
  const grid = await screen.findByTestId("calendar-engine");
  expect(await within(grid).findAllByText(/^Planning /)).toHaveLength(200);
  const renders = state.callbacks.length;

  const search = screen.getByRole("searchbox", {
    name: "Kalendertermine suchen",
  });
  fireEvent.change(search, { target: { value: "   " } });
  expect(search).toHaveValue("   ");
  expect(state.callbacks).toHaveLength(renders);

  fireEvent.change(search, { target: { value: "Planning 199" } });
  await waitFor(() =>
    expect(within(grid).getAllByText(/^Planning /)).toHaveLength(1),
  );
  expect(within(grid).getByText("Planning 199")).toBeInTheDocument();
});

it("retries a failed private calendar read without requesting global events or empty assignment metadata", async () => {
  state.loadEvents.mockRejectedValueOnce(
    new Error("temporary calendar read failure"),
  );
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

  const retry = await screen.findByRole("button", { name: "Erneut versuchen" });
  await userEvent.click(retry);
  await screen.findByTestId("calendar-engine");
  expect(state.loadEvents).toHaveBeenCalledTimes(2);
  expect(
    calendarCalls().some(([name]) =>
      ["global_calendar_events", "assignment_calendar_metadata"].includes(
        String(name),
      ),
    ),
  ).toBe(false);
});

it("filters loaded private, assignment, global and course titles without extra queries and supports both languages", async () => {
  const jobID = "d7000000-0000-4000-8000-000000000001";
  state.events = [
    {
      id: "private-one",
      title: "Private planning",
      starts_at: "2060-01-01T08:00:00Z",
      ends_at: "2060-01-01T09:00:00Z",
    },
  ];
  state.claims = [
    {
      id: "claim",
      job_id: jobID,
      assignment_sessions: [
        {
          id: "session-a",
          starts_at: "2060-01-01T08:00:00Z",
          ends_at: "2060-01-01T10:00:00Z",
        },
      ],
    },
  ];
  state.rpc.mockImplementation((name) => {
    const data =
      name === "my_calendar_subscriptions"
        ? []
        : name === "global_calendar_events"
          ? {
              items: [
                {
                  id: "c8000000-0000-4000-8000-000000000001",
                  title: "Global seminar",
                  description: "",
                  link_url: "",
                  time_zone: "UTC",
                  published: true,
                  archived_at: null,
                  version: 1,
                  updated_at: "2060-01-01T00:00:00Z",
                  starts_at: "2060-01-01T08:00:00Z",
                  ends_at: "2060-01-01T09:00:00Z",
                },
              ],
              has_more: false,
              next_cursor: null,
            }
          : [
              {
                id: jobID,
                title: "Teaching assignment",
                organisation_id: null,
                organisation_name: "Fictional Academy",
                topics: [],
              },
            ];
    const result = Promise.resolve({ data, error: null });
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
  await screen.findByText("Private planning");
  expect(await screen.findByText("Teaching assignment")).toBeInTheDocument();
  const search = screen.getByLabelText("Kalendertermine suchen");
  await user.type(search, "PLANNING");
  expect(screen.getByText("Private planning")).toBeInTheDocument();
  expect(screen.queryByText("Teaching assignment")).not.toBeInTheDocument();
  await user.clear(search);
  await user.selectOptions(screen.getByLabelText("Terminart"), "assignment");
  expect(screen.queryByText("Private planning")).not.toBeInTheDocument();
  expect(screen.getByText("Teaching assignment")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Globale Termine" }));
  expect(await screen.findByText("Global seminar")).toBeInTheDocument();
  expect(await screen.findByText("Published course")).toBeInTheDocument();
  const count = calendarCalls().length;
  await user.selectOptions(screen.getByLabelText("Terminart"), "course");
  expect(screen.queryByText("Global seminar")).not.toBeInTheDocument();
  expect(screen.getByText("Published course")).toBeInTheDocument();
  await act(() => i18n.changeLanguage("en"));
  expect(screen.getByLabelText("Event type")).toHaveValue("course");
  await user.type(screen.getByLabelText("Search calendar events"), "missing");
  expect(screen.queryByText("Published course")).not.toBeInTheDocument();
  expect(calendarCalls()).toHaveLength(count);
  client.clear();
});

it("global published session links open the precise authorised course detail rather than an unselected catalogue", async () => {
  state.rpc.mockImplementation((name) => {
    const response = Promise.resolve({
      data:
        name === "my_calendar_subscriptions"
          ? []
          : { items: [], has_more: false, next_cursor: null },
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
  expect(calendarCalls()).toHaveLength(1);
  expect(state.rpc).not.toHaveBeenCalledWith("my_calendar_subscriptions");
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
  state.rpc.mockImplementation((name) => {
    const response = Promise.resolve({
      data:
        name === "my_calendar_subscriptions"
          ? []
          : [
              {
                id: jobID,
                title: "Own old teaching block",
                organisation_id: null,
                organisation_name: "Fictional Academy",
                topics: [],
              },
            ],
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
  expect(calendarCalls()).toHaveLength(1);
  expect(state.rpc).toHaveBeenCalledWith("assignment_calendar_metadata", {
    p_job_ids: [jobID],
  });
});

it("waits for the grid before reading any personal appointments", async () => {
  state.reportInitialWindow = false;
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
  const dateChange = await screen.findByRole("button", {
    name: "Change visible range",
  });
  expect(state.loadEvents).not.toHaveBeenCalled();
  await userEvent.setup().click(dateChange);
  await waitFor(() => expect(state.loadEvents).toHaveBeenCalledTimes(1));
  expect(state.loadEvents).toHaveBeenCalledWith(
    expect.objectContaining({
      from: "2060-03-01T00:00:00.000Z",
      to: "2060-04-10T00:00:00.000Z",
    }),
  );
});

it("keeps the calendar mounted while the private range changes", async () => {
  let finishRange!: (rows: unknown[]) => void;
  const nextRange = new Promise<unknown[]>((resolve) => {
    finishRange = resolve;
  });
  state.loadEvents.mockResolvedValueOnce([]).mockReturnValueOnce(nextRange);
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
  const grid = await screen.findByTestId("calendar-engine");
  await userEvent.click(
    within(grid).getByRole("button", { name: "Change visible range" }),
  );
  expect(screen.getByTestId("calendar-engine")).toBe(grid);
  expect(state.loadEvents).toHaveBeenLastCalledWith({
    from: "2060-03-01T00:00:00.000Z",
    to: "2060-04-10T00:00:00.000Z",
  });
  await act(async () => finishRange([]));
  expect(screen.getByTestId("calendar-engine")).toBe(grid);
  expect(state.loadEvents).toHaveBeenCalledTimes(2);
  client.clear();
});

it("queries only the visible global range on navigation, without remounting or crawling other months", async () => {
  state.rpc.mockImplementation((name) => {
    const result = Promise.resolve({
      data:
        name === "my_calendar_subscriptions"
          ? []
          : { items: [], has_more: false, next_cursor: null },
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
  expect(calendarCalls()).toHaveLength(0);
  await user.click(
    await screen.findByRole("button", { name: "Globale Termine" }),
  );
  await screen.findByText("0 Termine geladen");
  expect(calendarCalls()).toHaveLength(1);
  await user.click(navigate);
  await screen.findByText("0 Termine geladen");
  expect(calendarCalls()).toHaveLength(2);
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
  state.rpc.mockImplementation((name) => {
    const result = Promise.resolve({
      data:
        name === "my_calendar_subscriptions"
          ? []
          : { items: [event], has_more: false, next_cursor: null },
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
  expect(calendarCalls()).toHaveLength(1);
  await act(() => i18n.changeLanguage("en"));
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(
    within(dialog).getByRole("link", { name: "Open related link" }),
  ).toHaveAttribute("rel", "noopener noreferrer");
  expect(within(dialog).getByText(event.description)).toBeInTheDocument();
  expect(calendarCalls()).toHaveLength(1);
  await act(async () => {
    signal({
      start: new Date("2060-03-01T00:00Z"),
      end: new Date("2060-04-10T00:00Z"),
    });
  });
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(calendarCalls()).toHaveLength(1);
  await act(async () => {
    await client.invalidateQueries({ queryKey: ["global-events"] });
  });
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(calendarCalls()).toHaveLength(2);
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
  expect(calendarCalls()).toHaveLength(2);
  await user.click(screen.getByText(event.title));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(calendarCalls()).toHaveLength(2);
  await act(async () => {
    signal({
      start: new Date("2060-04-10T00:00Z"),
      end: new Date("2060-05-20T00:00Z"),
    });
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(calendarCalls()).toHaveLength(3);
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

it.each(["de", "en"])(
  "confirms private appointment deletion, preserves errors and blocks closing while pending (%s)",
  async (language) => {
    await i18n.changeLanguage(language);
    state.events = [
      {
        id: "event",
        user_id: "actor",
        title: "Fictional private appointment",
        starts_at: "2035-01-01T08:00:00Z",
        ends_at: "2035-01-01T09:00:00Z",
        time_zone: "Europe/Berlin",
      },
    ];
    state.rpc.mockImplementation(() => {
      const result = Promise.resolve({ data: [], error: null });
      return Object.assign(result, { abortSignal: () => result });
    });
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CalendarPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByText("Fictional private appointment"));
    const deleteLabel =
      language === "de"
        ? "Privaten Termin löschen"
        : "Delete private appointment";
    const cancelLabel = language === "de" ? "Abbrechen" : "Cancel";
    const title =
      language === "de"
        ? "Privaten Termin löschen?"
        : "Delete private appointment?";
    await user.click(screen.getByRole("button", { name: deleteLabel }));
    let confirmation = screen.getByRole("dialog", { name: title });
    await user.click(
      within(confirmation).getByRole("button", { name: cancelLabel }),
    );
    expect(state.deleteEvent).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: deleteLabel }));
    confirmation = screen.getByRole("dialog", { name: title });
    state.deleteEvent.mockResolvedValueOnce({
      data: null,
      error: { message: "unconfirmed" },
    });
    await user.click(
      within(confirmation).getByRole("button", { name: deleteLabel }),
    );
    expect(await within(confirmation).findByRole("alert")).toHaveTextContent(
      language === "de" ? "nicht bestätigt" : "not confirmed",
    );
    expect(confirmation).toBeVisible();
    let complete!: (value: unknown) => void;
    state.deleteEvent.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await user.click(
      within(confirmation).getByRole("button", { name: deleteLabel }),
    );
    expect(
      within(confirmation).getByRole("button", { name: deleteLabel }),
    ).toBeDisabled();
    expect(
      within(confirmation).getByRole("button", { name: cancelLabel }),
    ).toBeDisabled();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: title })).toBeVisible();
    await act(async () => complete({ data: { id: "event" }, error: null }));
    expect(
      screen.queryByRole("dialog", { name: title }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByText(
        language === "de" ? "Termin gelöscht." : "Appointment deleted.",
      ),
    ).toBeVisible();
    client.clear();
  },
);

it("validates meeting links, preserves the private note on rejection, and saves both fields", async () => {
  state.events = [
    {
      id: "event",
      user_id: "actor",
      title: "Fictional private appointment",
      description: "Existing note",
      meeting_url: "https://meet.example.invalid/old",
      starts_at: "2035-01-01T08:00:00Z",
      ends_at: "2035-01-01T09:00:00Z",
      time_zone: "Europe/Berlin",
    },
  ];
  state.rpc.mockImplementation(() => {
    const response = Promise.resolve({ data: [], error: null });
    return Object.assign(response, { abortSignal: () => response });
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CalendarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(await screen.findByText("Fictional private appointment"));
  const dialog = screen.getByRole("dialog", { name: "Privater Termin" });
  expect(
    within(dialog).getByRole("link", { name: "Meeting-Link öffnen" }),
  ).toHaveAttribute("href", "https://meet.example.invalid/old");
  await user.clear(within(dialog).getByLabelText("Beschreibung oder Notiz"));
  await user.type(
    within(dialog).getByLabelText("Beschreibung oder Notiz"),
    "Private fictional note",
  );
  await user.clear(within(dialog).getByLabelText("Meeting-Link (HTTPS)"));
  await user.type(
    within(dialog).getByLabelText("Meeting-Link (HTTPS)"),
    "https://user:pass@example.invalid",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Termin speichern" }),
  );
  expect(await within(dialog).findByRole("alert")).toBeVisible();
  expect(state.saveEvent).not.toHaveBeenCalled();
  expect(within(dialog).getByLabelText("Beschreibung oder Notiz")).toHaveValue(
    "Private fictional note",
  );
  await user.clear(within(dialog).getByLabelText("Meeting-Link (HTTPS)"));
  await user.type(
    within(dialog).getByLabelText("Meeting-Link (HTTPS)"),
    "https://meet.example.invalid/new",
  );
  state.saveEvent.mockResolvedValue({ data: { id: "event" }, error: null });
  await user.click(
    within(dialog).getByRole("button", { name: "Termin speichern" }),
  );
  expect(state.saveEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      description: "Private fictional note",
      meeting_url: "https://meet.example.invalid/new",
    }),
  );
  expect(await screen.findByText("Termin gespeichert.")).toBeVisible();
  client.clear();
});

it("switches calendar zones without writing and preserves the original DST-fold instant during a metadata edit", async () => {
  state.events = [
    {
      id: "event",
      user_id: "actor",
      title: "Fictional autumn appointment",
      description: "",
      meeting_url: null,
      starts_at: "2030-10-27T02:30:18+02:00",
      ends_at: "2030-10-27T02:15:40+01:00",
      time_zone: "Europe/Berlin",
    },
  ];
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
  const select = await screen.findByLabelText("Kalenderanzeige in");
  await screen.findByTestId("calendar-engine");
  expect(state.displayedZone).toBe("Europe/Berlin");
  const originalInstance = (await screen.findByTestId("calendar-engine"))
    .dataset.instance;
  await user.selectOptions(select, "Australia/Brisbane");
  expect(state.displayedZone).toBe("Australia/Brisbane");
  expect(screen.getByTestId("calendar-engine").dataset.instance).not.toBe(
    originalInstance,
  );
  expect(state.initialDate).toBe("2030-10-27");
  expect(state.saveEvent).not.toHaveBeenCalled();
  await user.click(screen.getByText("Fictional autumn appointment"));
  const dialog = within(
    screen.getByRole("dialog", { name: "Privater Termin" }),
  );
  expect(dialog.getByLabelText("Zeitzone", { exact: true })).toHaveValue(
    "Europe/Berlin",
  );
  expect(dialog.getByLabelText("Beginn", { exact: true })).toHaveValue(
    "2030-10-27T02:30",
  );
  await user.type(
    dialog.getByLabelText("Beschreibung oder Notiz"),
    "Fictional detail",
  );
  state.saveEvent.mockResolvedValue({ data: { id: "event" }, error: null });
  await user.click(dialog.getByRole("button", { name: "Termin speichern" }));
  await screen.findByText("Termin gespeichert.");
  expect(state.saveEvent).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      starts_at: "2030-10-27T02:30:18+02:00",
      ends_at: "2030-10-27T02:15:40+01:00",
      time_zone: "Europe/Berlin",
    }),
  );
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  expect(screen.getByLabelText("Show calendar in")).toHaveValue(
    "Australia/Brisbane",
  );
  await user.selectOptions(screen.getByLabelText("Show calendar in"), "");
  expect(state.displayedZone).toBe("Europe/Berlin");
  client.clear();
});

it.each([
  [
    "de",
    "Privaten Termin hinzufügen",
    "Titel",
    "Ungespeicherte Änderungen verwerfen?",
    "Entwurf behalten",
    "Änderungen verwerfen",
    "Schließen",
  ],
  [
    "en",
    "Add private appointment",
    "Title",
    "Discard unsaved changes?",
    "Keep draft",
    "Discard changes",
    "Close",
  ],
])(
  "preserves a dirty private appointment on escape or close until explicit discard (%s)",
  async (language, add, field, prompt, keep, discard, close) => {
    await i18n.changeLanguage(language);
    state.rpc.mockImplementation(() => {
      const result = Promise.resolve({ data: [], error: null });
      return Object.assign(result, { abortSignal: () => result });
    });
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CalendarPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: add }));
    const dialog = screen.getByRole("dialog", { name: add });
    await user.type(
      within(dialog).getByLabelText(field),
      "Fictional unsaved event",
    );
    const unload = new Event("beforeunload", { cancelable: true });
    expect(window.dispatchEvent(unload)).toBe(false);
    await user.keyboard("{Escape}");
    let confirmation = screen.getByRole("dialog", { name: prompt });
    await user.click(within(confirmation).getByRole("button", { name: keep }));
    expect(within(dialog).getByLabelText(field)).toHaveValue(
      "Fictional unsaved event",
    );
    await user.click(within(dialog).getByRole("button", { name: close }));
    confirmation = screen.getByRole("dialog", { name: prompt });
    await user.click(
      within(confirmation).getByRole("button", { name: discard }),
    );
    expect(screen.queryByRole("dialog", { name: add })).not.toBeInTheDocument();
    expect(
      window.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ).toBe(true);
    expect(state.saveEvent).not.toHaveBeenCalled();
    client.clear();
  },
);

it("blocks an internal navigation until the dirty appointment is explicitly discarded", async () => {
  state.rpc.mockImplementation(() => {
    const result = Promise.resolve({ data: [], error: null });
    return Object.assign(result, { abortSignal: () => result });
  });

  function Location() {
    return <output aria-label="current route">{useLocation().pathname}</output>;
  }

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Link to="/profile">Profil öffnen</Link>
        <CalendarPage />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const nav = await screen.findByRole("link", {
    name: "Profil öffnen",
  });
  await user.click(
    await screen.findByRole("button", { name: "Privaten Termin hinzufügen" }),
  );
  const form = screen.getByRole("dialog", {
    name: "Privaten Termin hinzufügen",
  });
  await user.type(within(form).getByLabelText("Titel"), "Fictional draft");
  fireEvent.click(nav, { button: 0 });
  let confirm = screen.getByRole("dialog", {
    name: "Ungespeicherte Änderungen verwerfen?",
  });
  await user.click(
    within(confirm).getByRole("button", { name: "Entwurf behalten" }),
  );
  expect(screen.getByLabelText("current route")).toHaveTextContent("/");
  expect(within(form).getByLabelText("Titel")).toHaveValue("Fictional draft");
  fireEvent.click(nav, { button: 0 });
  confirm = screen.getByRole("dialog", {
    name: "Ungespeicherte Änderungen verwerfen?",
  });
  await user.click(
    within(confirm).getByRole("button", { name: "Änderungen verwerfen" }),
  );
  expect(screen.getByLabelText("current route")).toHaveTextContent("/profile");
  client.clear();
});

it.each(["back", "programmatic"] as const)(
  "guards %s navigation and preserves or discards the draft on explicit choice",
  async (mode) => {
    state.rpc.mockImplementation(() => {
      const result = Promise.resolve({ data: [], error: null });
      return Object.assign(result, { abortSignal: () => result });
    });

    function Controls() {
      const navigate = useNavigate();
      const location = useLocation();
      return (
        <>
          <output aria-label="route">{location.pathname}</output>
          <button
            onClick={() =>
              mode === "back" ? navigate(-1) : navigate("/destination")
            }
          >
            Go
          </button>
        </>
      );
    }

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/previous", "/calendar"]}>
          <CalendarPage />
          <Controls />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Privaten Termin hinzufügen" }),
    );
    const form = screen.getByRole("dialog", {
      name: "Privaten Termin hinzufügen",
    });
    await user.type(within(form).getByLabelText("Titel"), "Draft retained");
    fireEvent.click(screen.getByText("Go"));
    let confirmation = await screen.findByRole("dialog", {
      name: "Ungespeicherte Änderungen verwerfen?",
    });
    await user.click(
      within(confirmation).getByRole("button", { name: "Entwurf behalten" }),
    );
    expect(screen.getByLabelText("route")).toHaveTextContent("/calendar");
    expect(within(form).getByLabelText("Titel")).toHaveValue("Draft retained");
    fireEvent.click(screen.getByText("Go"));
    confirmation = await screen.findByRole("dialog", {
      name: "Ungespeicherte Änderungen verwerfen?",
    });
    await user.click(
      within(confirmation).getByRole("button", {
        name: "Änderungen verwerfen",
      }),
    );
    // POP retries can complete after the confirmation click returns, especially
    // while the wider suite is running; assert the eventual router transition.
    await waitFor(() =>
      expect(screen.getByLabelText("route")).toHaveTextContent(
        mode === "back" ? "/previous" : "/destination",
      ),
    );
    client.clear();
  },
);

it("centres a job deep link only on an own confirmed assignment session", async () => {
  const jobID = "d7000000-0000-4000-8000-000000000001";
  const secondJob = "d7000000-0000-4000-8000-000000000002";
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
        {
          id: "earlier",
          starts_at: "2060-01-01T09:00:00+10:00",
          ends_at: "2060-01-01T11:00:00+10:00",
        },
      ],
    },
    {
      id: "second-claim",
      job_id: secondJob,
      assignment_sessions: [
        {
          id: "second-session",
          starts_at: "2060-09-02T08:00:00Z",
          ends_at: "2060-09-02T10:00:00Z",
        },
      ],
    },
  ];
  state.rpc.mockImplementation((name) => {
    const result = Promise.resolve({
      data:
        name === "my_calendar_subscriptions"
          ? []
          : [
              {
                id: jobID,
                title: "Fictional own job",
                organisation_id: null,
                organisation_name: "Fictional Academy",
                topics: [],
              },
            ],
      error: null,
    });
    return Object.assign(result, { abortSignal: () => result });
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/calendar?assignment=${jobID}`]}>
        <CalendarPage />
        <Link to={`/calendar?assignment=${secondJob}`}>Another assignment</Link>
        <Link to="/calendar?assignment=unrelated">Unknown assignment</Link>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findAllByRole("link", { name: "Fictional own job" });
  expect(state.initialDate).toBe("2060-01-01T09:00:00+10:00");
  const prior = screen
    .getByTestId("calendar-engine")
    .getAttribute("data-instance");
  const user = userEvent.setup();
  await user.click(screen.getByRole("link", { name: "Another assignment" }));
  await waitFor(() => expect(state.initialDate).toBe("2060-09-02T08:00:00Z"));
  expect(screen.getByTestId("calendar-engine")).not.toHaveAttribute(
    "data-instance",
    prior,
  );
  await user.click(screen.getByRole("link", { name: "Unknown assignment" }));
  await waitFor(() => expect(state.initialDate).toBeUndefined());
  client.clear();
});

it("filters confirmed course sessions by customer and any selected topic while retaining title/type search", async () => {
  const jobA = "d7000000-0000-4000-8000-000000000011",
    jobB = "d7000000-0000-4000-8000-000000000012";
  const customerA = "name:Fictional Alpha",
    customerB = "c7000000-0000-4000-8000-000000000012";
  const topicA = "a7000000-0000-4000-8000-000000000011",
    topicB = "a7000000-0000-4000-8000-000000000012";
  state.claims = [jobA, jobB].map((job_id, index) => ({
    id: `claim-${index}`,
    job_id,
    assignment_sessions: [
      {
        id: `session-${index}`,
        starts_at: "2060-01-01T08:00:00Z",
        ends_at: "2060-01-01T10:00:00Z",
      },
    ],
  }));
  state.events = [
    {
      id: "personal",
      title: "Private planning",
      starts_at: "2060-01-01T08:00:00Z",
      ends_at: "2060-01-01T09:00:00Z",
    },
  ];
  state.rpc.mockImplementation(() => {
    const result = Promise.resolve({
      data: [
        {
          id: jobA,
          title: "Python course",
          organisation_id: null,
          organisation_name: "Fictional Alpha",
          topics: [{ id: topicA, label_de: "Python", label_en: "Python" }],
        },
        {
          id: jobB,
          title: "Linux course",
          organisation_id: customerB,
          organisation_name: "Fictional Beta",
          topics: [{ id: topicB, label_de: "Linux", label_en: "Linux" }],
        },
      ],
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
  await screen.findByRole("link", { name: "Python course" });
  await user.selectOptions(screen.getByLabelText("Unternehmen"), customerA);
  expect(screen.getByRole("link", { name: "Python course" })).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Linux course" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Private planning")).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Dein privater Kalender" }),
  );
  expect(screen.getByLabelText("Unternehmen")).toHaveValue(customerA);

  // The next range has no authorised company data. The dropdown must not
  // claim that all companies are shown, or carry the previous company name.
  const previousClaims = state.claims;
  state.claims = [];
  act(() => {
    const changeRange = state.callbacks.at(-1) as (range: {
      start: Date;
      end: Date;
    }) => void;
    changeRange({
      start: new Date("2060-02-01T00:00Z"),
      end: new Date("2060-02-28T00:00Z"),
    });
  });
  expect(
    await screen.findByText("Keine geladenen Termine passen zu den Filtern."),
  ).toBeVisible();
  expect(screen.getByLabelText("Unternehmen")).toHaveValue("unavailable");
  expect(screen.getByLabelText("Unternehmen").innerHTML).not.toContain(
    "Fictional Alpha",
  );
  expect(
    screen.getByRole("option", {
      name: "Gewähltes Unternehmen ohne sichtbare Termine",
    }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Fictional Alpha" }),
  ).not.toBeInTheDocument();

  state.claims = previousClaims;
  act(() => {
    const changeRange = state.callbacks.at(-1) as (range: {
      start: Date;
      end: Date;
    }) => void;
    changeRange({
      start: new Date("2060-01-01T00:00Z"),
      end: new Date("2060-01-31T00:00Z"),
    });
  });
  expect(
    await screen.findByRole("link", { name: "Python course" }),
  ).toBeVisible();
  expect(screen.getByLabelText("Unternehmen")).toHaveValue(customerA);
  await user.selectOptions(screen.getByLabelText("Unternehmen"), "");
  await user.selectOptions(screen.getByLabelText("Themen & Tags"), topicB);
  expect(screen.getByRole("link", { name: "Linux course" })).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Python course" }),
  ).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Themen & Tags"), topicA);
  expect(screen.getByRole("link", { name: "Python course" })).toBeVisible();
  expect(screen.getByRole("link", { name: "Linux course" })).toBeVisible();
  await user.click(
    screen.getByRole("button", { name: "Thema Linux entfernen" }),
  );
  expect(
    screen.queryByRole("link", { name: "Linux course" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
  expect(screen.getByLabelText("Kalendertermine suchen")).toHaveFocus();
  expect(screen.getByText("Private planning")).toBeVisible();
  expect(screen.queryByText(/Kalender-Abonnements/)).not.toBeInTheDocument();
  expect(
    state.rpc.mock.calls.some(([name]) => name === "my_calendar_subscriptions"),
  ).toBe(false);
  client.clear();
});

it("prefills a dragged range through the DST change and saves its exclusive end in the selected zone", async () => {
  state.saveEvent.mockResolvedValue({ data: { id: "saved" }, error: null });
  const user = userEvent.setup();
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
  await user.click(
    await screen.findByRole("button", { name: "Select date range" }),
  );
  const dialog = within(
    screen.getByRole("dialog", { name: "Privaten Termin hinzufügen" }),
  );
  expect(dialog.getByLabelText("Beginn")).toHaveValue("2030-03-30T00:00");
  expect(dialog.getByLabelText("Ende")).toHaveValue("2030-04-02T00:00");
  expect(dialog.getByLabelText("Zeitzone")).toHaveValue("Europe/Berlin");
  expect(state.saveEvent).not.toHaveBeenCalled();
  await user.type(dialog.getByLabelText("Titel"), "Window");
  await user.click(dialog.getByRole("button", { name: "Termin speichern" }));
  await waitFor(() =>
    expect(state.saveEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        starts_at: "2030-03-29T23:00:00.000Z",
        ends_at: "2030-04-01T22:00:00.000Z",
        time_zone: "Europe/Berlin",
        user_id: "actor",
      }),
    ),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  client.clear();
});

it("uses the clicked clock time in the display zone and leaves the read-only global grid untouched", async () => {
  const user = userEvent.setup();
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
  await user.selectOptions(
    await screen.findByLabelText("Kalenderanzeige in"),
    "Australia/Brisbane",
  );
  expect(
    screen.queryByText("Kurs aus dem Kalender planen"),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Click time slot" }));
  const dialog = within(
    screen.getByRole("dialog", { name: "Privaten Termin hinzufügen" }),
  );
  expect(dialog.getByLabelText("Beginn")).toHaveValue("2030-03-30T09:00");
  expect(dialog.getByLabelText("Ende")).toHaveValue("2030-03-30T09:30");
  expect(dialog.getByLabelText("Zeitzone")).toHaveValue("Australia/Brisbane");
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Globale Termine" }));
  expect(
    screen.getByRole("button", { name: "Select date range" }),
  ).toBeDisabled();
  expect(state.saveEvent).not.toHaveBeenCalled();
  client.clear();
});

it("opens a course draft from a selected calendar slot without saving a calendar event", async () => {
  state.permissions = ["courses.manage"];
  const user = userEvent.setup();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function CurrentRoute() {
    const location = useLocation();
    return (
      <output aria-label="current route">
        {location.pathname}
        {location.search}
      </output>
    );
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/calendar"]}>
        <CalendarPage />
        <CurrentRoute />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.selectOptions(
    await screen.findByLabelText("Kalenderanzeige in"),
    "Australia/Brisbane",
  );
  await user.click(await screen.findByText("Kurs aus dem Kalender planen"));
  await screen.findByText(/Wähle einen Unterrichtstag oder einen Zeitraum/);
  await user.click(screen.getByRole("button", { name: "Click time slot" }));
  const current = new URL(
    screen.getByLabelText("current route").textContent!,
    "http://localhost",
  );
  expect(current.pathname).toBe("/courses");
  expect(Object.fromEntries(current.searchParams)).toEqual({
    creator: "new",
    planFrom: "2030-03-30T09:00",
    planUntil: "2030-03-30T09:30",
    planZone: "Australia/Brisbane",
  });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(state.saveEvent).not.toHaveBeenCalled();
  client.clear();
});

it("opens the existing unpublished global event editor with the selected period for authorised staff", async () => {
  state.permissions = ["courses.manage"];
  state.rpc.mockImplementation((name) => {
    const response = Promise.resolve({
      data: { items: [], has_more: false, next_cursor: null },
      error: null,
    });
    return name === "global_calendar_events"
      ? Object.assign(response, { abortSignal: () => response })
      : response;
  });
  const user = userEvent.setup();
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
  await user.click(
    await screen.findByRole("button", { name: "Globale Termine" }),
  );
  await user.click(screen.getByRole("button", { name: "Select date range" }));
  const editor = within(
    screen.getByRole("dialog", { name: "Globalen Termin erstellen" }),
  );
  expect(editor.getByLabelText("Beginn")).toHaveValue("2030-03-30T00:00");
  expect(editor.getByLabelText("Ende")).toHaveValue("2030-04-02T00:00");
  expect(
    editor.getByRole("button", { name: "Als Entwurf speichern" }),
  ).toBeVisible();
  expect(
    state.rpc.mock.calls.some(([name]) => name === "manage_global_event"),
  ).toBe(false);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  client.clear();
});

it("reviews weekly personal instants before dispatch and retries with the same request identity", async () => {
  const series = "63b06d60-945f-4fa9-b476-ade6b07cbe89";
  const writes: unknown[] = [];
  state.rpc.mockImplementation(async (name, payload) => {
    if (name === "create_my_personal_event_series") {
      writes.push(payload);
      return writes.length === 1
        ? { data: null, error: { code: "503" } }
        : { data: { series_id: series, created: 2 }, error: null };
    }
    return { data: [], error: null };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CalendarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.click(
    await screen.findByRole("button", { name: "Privaten Termin hinzufügen" }),
  );
  const editor = within(
    screen.getByRole("dialog", { name: "Privaten Termin hinzufügen" }),
  );
  await user.type(editor.getByLabelText("Titel"), "Fictional recurring event");
  fireEvent.change(editor.getByLabelText("Beginn"), {
    target: { value: "2030-03-25T09:00" },
  });
  fireEvent.change(editor.getByLabelText("Ende"), {
    target: { value: "2030-03-25T10:00" },
  });
  await user.selectOptions(editor.getByLabelText("Wiederholung"), "weekly");
  fireEvent.change(editor.getByLabelText("Anzahl der Termine"), {
    target: { value: "2" },
  });
  await user.click(editor.getByRole("button", { name: "Terminserie prüfen" }));
  const review = within(
    await screen.findByRole("dialog", { name: "Terminserie prüfen" }),
  );
  expect(review.getAllByRole("listitem")).toHaveLength(2);
  expect(writes).toHaveLength(0);
  await user.click(
    review.getByRole("button", { name: "Terminserie speichern" }),
  );
  expect(await review.findByRole("alert")).toHaveTextContent(
    "Die Terminserie konnte nicht bestätigt werden.",
  );
  await user.click(
    review.getByRole("button", { name: "Terminserie speichern" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]);
  expect(writes[0]).toEqual({
    p_request_id: expect.any(String),
    p_title: "Fictional recurring event",
    p_description: "",
    p_meeting_url: "",
    p_time_zone: "Europe/Berlin",
    p_occurrences: [
      {
        starts_at: "2030-03-25T08:00:00.000Z",
        ends_at: "2030-03-25T09:00:00.000Z",
      },
      {
        starts_at: "2030-04-01T07:00:00.000Z",
        ends_at: "2030-04-01T08:00:00.000Z",
      },
    ],
  });
  expect(state.saveEvent).not.toHaveBeenCalled();
  client.clear();
});

it("offers an independent confirmed action to cancel only future occurrences", async () => {
  const series = "63b06d60-945f-4fa9-b476-ade6b07cbe89";
  state.events = [
    {
      id: "existing-recurrence",
      title: "Fictional series appointment",
      starts_at: "2030-03-25T08:00:00.000Z",
      ends_at: "2030-03-25T09:00:00.000Z",
      time_zone: "Europe/Berlin",
      recurrence_series_id: series,
    },
  ];
  const name = "Künftige Serientermine löschen";
  state.rpc.mockImplementation(async (operation) => ({
    data: operation === "cancel_my_future_personal_events" ? 3 : [],
    error: null,
  }));
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CalendarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.click(await screen.findByText("Fictional series appointment"));
  await user.click(screen.getByRole("button", { name }));
  const review = within(
    await screen.findByRole("dialog", {
      name: "Künftige Termine dieser Serie löschen?",
    }),
  );
  expect(
    review.getByText(/Vergangene und bereits begonnene Termine/),
  ).toBeVisible();
  expect(state.rpc).not.toHaveBeenCalledWith(
    "cancel_my_future_personal_events",
    expect.anything(),
  );
  await user.click(review.getByRole("button", { name }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(state.rpc).toHaveBeenCalledWith("cancel_my_future_personal_events", {
    p_series_id: series,
  });
  expect(state.deleteEvent).not.toHaveBeenCalled();
  client.clear();
});
