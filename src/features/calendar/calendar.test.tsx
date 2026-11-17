/**
 * Calendar regressions for own assignment titles, authorised course links and
 * global-event detail lifetime across locale, query refresh and range changes.
 * Controlled Query/FullCalendar fixtures do not replace native ACL acceptance.
 */
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
  events: [] as unknown[],
  deleteEvent: vi.fn(),
  saveEvent: vi.fn(),
  rpc: vi.fn(),
  datesSetOnLocale: false,
  callbacks: [] as unknown[],
}));
// The real subscription panel remains mounted. Its independent metadata read
// must not be mistaken for a global-range crawl or marketplace-title request.
const calendarCalls = () =>
  state.rpc.mock.calls.filter(([name]) => name !== "my_calendar_subscriptions");
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: state.rpc,
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
  eventsQuery: () => ({
    queryKey: ["events"],
    queryFn: async () => state.events,
  }),
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
  state.events = [];
  vi.clearAllMocks();
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
  expect(state.rpc).toHaveBeenCalledWith("my_calendar_subscriptions");
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
          : [{ id: jobID, title: "Own old teaching block" }],
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
  expect(state.rpc).toHaveBeenCalledWith("assignment_job_titles", {
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
