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
  claims: [] as unknown[],
  events: [] as unknown[],
  deleteEvent: vi.fn(),
  saveEvent: vi.fn(),
  rpc: vi.fn(),
  datesSetOnLocale: false,
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
  topicsQuery: { queryKey: ["topics"], queryFn: async () => [] },
  eventsQuery: () => ({
    queryKey: ["events"],
    queryFn: async () => state.events,
  }),
}));
vi.mock("../operations/data", () => ({
  orgQuery: () => ({ queryKey: ["organisations"], queryFn: async () => [] }),
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
    timeZone,
    initialDate,
    ref,
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
    ref?: Ref<{
      getApi: () => {
        getDate: () => Date;
        formatIso: (date: Date, omitTime: boolean) => string;
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
        }),
      }),
      [],
    );
    state.callbacks.push(datesSet);
    state.initialDate = initialDate;
    state.displayedZone = timeZone;
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
  state.initialDate = undefined;
  state.displayedZone = undefined;
});
afterEach(() => {
  cleanup();
  state.claims = [];
  state.events = [];
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
  expect(screen.getByText("Teaching assignment")).toBeInTheDocument();
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
  expect(state.displayedZone).toBe("Europe/Berlin");
  const originalInstance =
    screen.getByTestId("calendar-engine").dataset.instance;
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
  expect(state.initialDate).toBe("2060-09-02T08:00:00Z");
  expect(screen.getByTestId("calendar-engine")).not.toHaveAttribute(
    "data-instance",
    prior,
  );
  await user.click(screen.getByRole("link", { name: "Unknown assignment" }));
  expect(state.initialDate).toBeUndefined();
  client.clear();
});

it("filters confirmed course sessions by customer and any selected topic while retaining title/type search", async () => {
  const jobA = "d7000000-0000-4000-8000-000000000011",
    jobB = "d7000000-0000-4000-8000-000000000012";
  const customerA = "c7000000-0000-4000-8000-000000000011",
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
          organisation_id: customerA,
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
  expect(screen.getByText("Private planning")).toBeVisible();
  expect(screen.queryByText(/Kalender-Abonnements/)).not.toBeInTheDocument();
  expect(
    state.rpc.mock.calls.some(([name]) => name === "my_calendar_subscriptions"),
  ).toBe(false);
  client.clear();
});
