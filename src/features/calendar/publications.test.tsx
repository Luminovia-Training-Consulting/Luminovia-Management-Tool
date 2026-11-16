import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { GlobalEventManagement, GlobalEventDetails } from "./publications";
import {
  globalEventPayload,
  validEventLink,
  type GlobalEvent,
} from "./publications-api";
const state = vi.hoisted(() => ({ rpc: vi.fn(), online: true }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../../lib/online", () => ({
  useOnline: () => state.online,
  requireOnline: () => {
    if (!state.online) throw Error("offline");
  },
}));
const event: GlobalEvent = {
  id: "c8000000-0000-4000-8000-000000000001",
  title: "Fictional reviewed draft",
  description: "Fictional <script> plain body",
  link_url: "https://example.invalid/resource",
  starts_at: "2060-03-28T00:30:45Z",
  ends_at: "2060-03-28T02:30:45Z",
  time_zone: "Europe/Berlin",
  published: false,
  archived_at: null,
  version: 1,
  updated_at: "2060-01-01T00:00:00Z",
};
let rows: GlobalEvent[] = [],
  readError: unknown = null,
  writeError: unknown = null;
const clients: QueryClient[] = [];
function reply(data: unknown, error: unknown = null) {
  const promise = Promise.resolve({ data, error });
  return Object.assign(promise, { abortSignal: () => promise });
}
beforeEach(async () => {
  await i18n.changeLanguage("de");
  state.online = true;
  rows = [{ ...event }];
  readError = null;
  writeError = null;
  state.rpc.mockReset();
  state.rpc.mockImplementation((name, args) =>
    name === "global_calendar_events"
      ? reply({ items: rows, has_more: false, next_cursor: null }, readError)
      : reply({ ...event, ...args.p_payload, version: 2 }, writeError),
  );
});
afterEach(() => {
  cleanup();
  for (const c of clients) c.clear();
  clients.length = 0;
});
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <GlobalEventManagement
        actor="actor"
        from="2060-03-01T00:00:00Z"
        to="2060-04-10T00:00:00Z"
        zone="Europe/Berlin"
      />
    </QueryClientProvider>,
  );
  return client;
}
it("renders only text and explicitly labelled HTTPS links", () => {
  render(<GlobalEventDetails event={event} onClose={() => {}} />);
  expect(screen.getByText(event.description)).toBeInTheDocument();
  expect(document.querySelector("script")).toBeNull();
  expect(
    screen.getByRole("link", { name: "Weiterführenden Link öffnen" }),
  ).toHaveAttribute("href", event.link_url);
  expect(screen.getByRole("link")).toHaveAttribute(
    "rel",
    "noopener noreferrer",
  );
});
it("validates safe links, rejects credentials/backslashes/http and rejects DST gaps/folds", () => {
  for (const url of [
    "javascript:alert(1)",
    "http://example.invalid",
    "https://name:pass@example.invalid",
    "https://example.invalid\\@evil.invalid",
    "https://example.invalid:99999",
    "https://example..invalid/",
    "https://999.999.999.999/",
    "https://example.invalid/\nfoo",
  ])
    expect(validEventLink(url)).toBe(false);
  expect(validEventLink("")).toBe(true);
  expect(validEventLink(event.link_url)).toBe(true);
  for (const start of ["2027-03-28T02:30", "2027-10-31T02:30"])
    expect(() =>
      globalEventPayload({
        ...event,
        starts_at: start,
        ends_at: "2027-10-31T05:00",
      }),
    ).toThrow();
});
it("preserves precise existing seconds on metadata-only edits including an existing DST fold", () => {
  const previous = {
    ...event,
    starts_at: "2027-10-31T01:30:45Z",
    ends_at: "2027-10-31T03:30:45Z",
  };
  expect(
    globalEventPayload(
      {
        ...previous,
        starts_at: "2027-10-31T02:30",
        ends_at: "2027-10-31T04:30",
      },
      previous,
    ).starts_at,
  ).toBe(previous.starts_at);
});
it("keeps DE/EN form drafts and sends captured CAS version despite later list changes", async () => {
  const client = setup(),
    user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Entwurf bearbeiten" }),
  );
  const dialog = screen.getByRole("dialog");
  await user.clear(within(dialog).getByLabelText("Titel"));
  await user.type(
    within(dialog).getByLabelText("Titel"),
    "Fictional unsaved title",
  );
  await act(async () => {
    await i18n.changeLanguage("en");
    client.setQueriesData(
      { queryKey: ["global-events"] },
      {
        pages: [
          {
            items: [{ ...event, version: 2 }],
            has_more: false,
            next_cursor: null,
          },
        ],
        pageParams: [null],
      },
    );
  });
  expect(within(dialog).getByLabelText("Title")).toHaveValue(
    "Fictional unsaved title",
  );
  writeError = { code: "40001" };
  await user.click(
    within(dialog).getByRole("button", { name: "Save as draft" }),
  );
  await within(dialog).findByText(/Not saved/);
  expect(
    state.rpc.mock.calls.find(([name]) => name === "manage_global_event")?.[1],
  ).toMatchObject({
    p_expected_version: 1,
    p_payload: { title: "Fictional unsaved title", starts_at: event.starts_at },
  });
  expect(within(dialog).getByLabelText("Title")).toHaveValue(
    "Fictional unsaved title",
  );
});
it("hides private editor after42501 through network failures and restores a clean list only on successful refresh", async () => {
  const client = setup(),
    user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Entwurf bearbeiten" }),
  );
  readError = { code: "42501" };
  await act(async () => {
    await client.refetchQueries({ queryKey: ["global-events"] });
  });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.queryByText(event.title)).not.toBeInTheDocument();
  readError = { message: "network" };
  await user.click(screen.getByRole("button", { name: "Aktualisieren" }));
  expect(screen.queryByText(event.title)).not.toBeInTheDocument();
  readError = null;
  await user.click(screen.getByRole("button", { name: "Aktualisieren" }));
  await screen.findByText(event.title);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
it("clears captured draft on denied mutation and does not report success", async () => {
  setup();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Entwurf bearbeiten" }),
  );
  writeError = { code: "42501" };
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Als Entwurf speichern",
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByText("Änderung vom Server bestätigt."),
  ).not.toBeInTheDocument();
});
it("keeps stable operation key on uncertain retries and disables writes offline", async () => {
  setup();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Entwurf bearbeiten" }),
  );
  writeError = { message: "network" };
  const button = within(screen.getByRole("dialog")).getByRole("button", {
    name: "Als Entwurf speichern",
  });
  await user.click(button);
  await screen.findByText(/Nicht gespeichert/);
  await user.click(button);
  await waitFor(() =>
    expect(
      state.rpc.mock.calls.filter(([n]) => n === "manage_global_event"),
    ).toHaveLength(2),
  );
  const calls = state.rpc.mock.calls.filter(
    ([n]) => n === "manage_global_event",
  );
  expect(calls[0][1].p_request_id).toBe(calls[1][1].p_request_id);
});
it("offline management makes no write request", async () => {
  state.online = false;
  setup();
  expect(
    await screen.findByRole("button", { name: "Globalen Termin erstellen" }),
  ).toBeDisabled();
  expect(
    await screen.findByRole("button", { name: "Veröffentlichen" }),
  ).toBeDisabled();
  expect(
    state.rpc.mock.calls.every(([n]) => n === "global_calendar_events"),
  ).toBe(true);
});
