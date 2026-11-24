/** Discovery integration fixtures separate own handover reads from saved-view mutations and require current role access. */
import { afterEach, expect, it, vi } from "vitest";
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
import { MemoryRouter, useLocation } from "react-router-dom";
import i18n from "../../lib/i18n";
import type { Topic } from "../../lib/types";
import { JobDiscovery } from "./discovery";
import { defaultJobFilters } from "./discovery-api";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  online: true,
  actor: "actor",
  roles: ["lecturer"],
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: state.actor } } }),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: state.rpc,
    from: () => ({
      select: () => ({
        eq: async () => ({
          data: state.roles.map((role) => ({ role })),
          error: null,
        }),
      }),
    }),
  }),
}));
vi.mock("../../lib/online", () => ({
  useOnline: () => state.online,
  requireOnline: () => {
    if (!state.online) throw Error("offline");
  },
}));
const clients: QueryClient[] = [];
const job = (n = 1) => ({
  id: `d7000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  title: `Fictional discovery ${n}`,
  description: "Fictional text",
  customer_name: "Fictional academy",
  delivery_type: "online",
  location: "",
  time_zone: "Europe/Berlin",
  status: "published",
  amount: 25,
  total_amount: 100,
  currency: "EUR",
  rate_unit: "per_hour",
  terms: "Fictional terms",
  terms_version: 1,
  requires_contract: false,
  claim_deadline: null,
  capacity: 1,
  capacity_basis: "single_position",
  created_at: "2040-01-01T00:00:00Z",
  job_sessions: [],
  job_requirements: [],
  confirmed_count: 0,
  open_positions: 1,
});

function Location() {
  return <output aria-label="route">{useLocation().search}</output>;
}

function setup({
  role = "lecturer",
  write = (args: Record<string, unknown>) =>
    Promise.resolve({
      data: {
        id: args.p_id,
        name: args.p_name,
        filters: args.p_filters,
        version: 1,
        created_at: "2040-01-01T00:00:00Z",
        updated_at: "2040-01-01T00:00:00Z",
      },
      error: null,
    }),
  views = [] as unknown[],
  readViews,
  topics = [] as Topic[],
  queryRetry = false,
  expandFilters = true,
  initialEntry = "/",
}: {
  role?: string;
  write?: (
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
  views?: unknown[];
  readViews?: () => Promise<{ data: unknown; error: unknown }>;
  topics?: Topic[];
  queryRetry?: boolean | number;
  expandFilters?: boolean;
  initialEntry?: string;
} = {}) {
  state.roles = [role];
  state.rpc.mockImplementation(
    (name: string, args: Record<string, unknown>) => {
      const response =
        name === "job_discovery"
          ? Promise.resolve({
              data: {
                items: [job(args.p_cursor ? 2 : 1)],
                has_more: !args.p_cursor,
                next_cursor: args.p_cursor
                  ? null
                  : {
                      id: job().id,
                      number: "1",
                      text: "fixture",
                      fingerprint: "a".repeat(32),
                    },
                as_of: "2040-01-01T00:00:00Z",
                filters: {
                  ...defaultJobFilters,
                  ...(args.p_filters as object),
                },
              },
              error: null,
            })
          : ["job_substitutions", "my_job_waitlist"].includes(name)
            ? Promise.resolve({ data: [], error: null })
            : name === "saved_job_views"
              ? (readViews?.() ?? Promise.resolve({ data: views, error: null }))
              : write(args);
      return Object.assign(response, { abortSignal: () => response });
    },
  );
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: queryRetry, retryDelay: 0, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  client.setQueryData(["user-roles", state.actor], [role]);
  client.setQueryData(["topics"], topics);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <JobDiscovery />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  // These mutation/filter fixtures explicitly open the optional controls they exercise.
  const summary = document.querySelector(
    ".discovery-filter-disclosure > summary",
  );
  if (expandFilters && summary) fireEvent.click(summary);
  return client;
}

afterEach(async () => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  vi.clearAllMocks();
  state.online = true;
  state.actor = "actor";
  state.roles = ["lecturer"];
  await i18n.changeLanguage("de");
});
it("clears unapplied filter edits even on the default URL", async () => {
  setup();
  const user = userEvent.setup();
  await screen.findByRole("link", { name: "Fictional discovery 1" });
  await user.type(screen.getByRole("searchbox", { name: "Suchtext" }), "draft");
  await user.click(
    screen.getByLabelText("Ohne Überschneidung in meinem Kalender"),
  );
  await user.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
  expect(screen.getByRole("searchbox", { name: "Suchtext" })).toHaveValue("");
  expect(
    screen.getByLabelText("Ohne Überschneidung in meinem Kalender"),
  ).not.toBeChecked();
  expect(screen.getByLabelText("route")).toBeEmptyDOMElement();
});

it("rechecks availability when the same filter is applied again", async () => {
  setup({ initialEntry: "/?available=1" });
  const user = userEvent.setup();
  await screen.findByRole("link", { name: "Fictional discovery 1" });
  await user.click(screen.getByRole("button", { name: "Filter anwenden" }));
  await waitFor(() => {
    const requests = state.rpc.mock.calls.filter(
      ([name]) => name === "job_discovery",
    );
    expect(requests).toHaveLength(2);
    expect(requests[1][1].p_filters).toMatchObject({ available_only: true });
  });
});

it("loads a saved view over unapplied edits even when its filters are already active", async () => {
  setup({
    views: [
      {
        id: job().id,
        name: "Fictional default view",
        filters: defaultJobFilters,
        version: 1,
        created_at: "2040-01-01T00:00:00Z",
        updated_at: "2040-01-01T00:00:00Z",
      },
    ],
  });
  const user = userEvent.setup();
  await screen.findByRole("option", { name: "Fictional default view" });
  await user.type(screen.getByRole("searchbox", { name: "Suchtext" }), "draft");
  await user.selectOptions(
    screen.getByLabelText("Ansicht auswählen"),
    job().id,
  );
  expect(screen.getByRole("searchbox", { name: "Suchtext" })).toHaveValue("");
  await user.click(screen.getByRole("button", { name: "Filter zurücksetzen" }));
  expect(screen.getByLabelText("Ansicht auswählen")).toHaveValue("");
});

it("submits combined filters once instead of requesting every typed character and pages only on demand", async () => {
  setup();
  const user = userEvent.setup();
  await screen.findByRole("link", { name: "Fictional discovery 1" });
  await user.type(
    screen.getByRole("searchbox", { name: "Suchtext" }),
    "Fictional %_",
  );
  expect(
    state.rpc.mock.calls.filter(([n]) => n === "job_discovery"),
  ).toHaveLength(1);
  await user.selectOptions(screen.getByLabelText("Währung"), "EUR");
  await user.type(screen.getByLabelText("Gesamthonorar ab"), "100");
  await user.click(screen.getByRole("button", { name: "Filter anwenden" }));
  await waitFor(() =>
    expect(
      state.rpc.mock.calls.filter(([n]) => n === "job_discovery"),
    ).toHaveLength(2),
  );
  expect(
    state.rpc.mock.calls.filter(([n]) => n === "job_discovery")[1][1].p_filters,
  ).toMatchObject({ q: "Fictional %_", currency: "EUR", min_total: 100 });
  expect(screen.getByLabelText("route").textContent).toContain("q=Fictional");
  await user.click(
    await screen.findByRole("button", { name: "Weitere Aufträge laden" }),
  );
  await screen.findByRole("link", { name: "Fictional discovery 2" });
  expect(screen.getByText("2 Aufträge geladen")).toBeVisible();
  expect(
    state.rpc.mock.calls.filter(([n]) => n === "job_discovery"),
  ).toHaveLength(3);
});
it("keeps a saved date-search time zone selected and applies a choice from the shared catalogue", async () => {
  setup({ initialEntry: "/?from=2040-01-02&zone=US%2FEastern" });
  const user = userEvent.setup();
  await screen.findByRole("link", { name: "Fictional discovery 1" });
  const select = screen.getByRole("combobox", {
    name: "Zeitzone der Datumssuche",
  });
  expect(select).toHaveValue("US/Eastern");
  expect(
    within(select).getByRole("option", { name: "Europe/Berlin" }),
  ).toBeInTheDocument();

  await user.selectOptions(select, "Australia/Brisbane");
  expect(
    state.rpc.mock.calls.filter(([name]) => name === "job_discovery"),
  ).toHaveLength(1);
  await user.click(screen.getByRole("button", { name: "Filter anwenden" }));

  await waitFor(() =>
    expect(
      state.rpc.mock.calls
        .filter(([name]) => name === "job_discovery")
        .at(-1)?.[1].p_filters,
    ).toMatchObject({
      from: "2040-01-02",
      zone: "Australia/Brisbane",
    }),
  );
  expect(
    new URLSearchParams(screen.getByLabelText("route").textContent ?? "").get(
      "zone",
    ),
  ).toBe("Australia/Brisbane");
  expect(
    screen.getByRole("combobox", { name: "Zeitzone der Datumssuche" }),
  ).toHaveValue("Australia/Brisbane");
});
it("matches any selected subject, combines other filters, and keeps history opt-in", async () => {
  const topics: Topic[] = [
    {
      id: "d7000000-0000-4000-8000-000000000101",
      label_de: "Fictional topic A",
      label_en: "Fictional topic A",
      kind: "topic",
    },
    {
      id: "d7000000-0000-4000-8000-000000000102",
      label_de: "Fictional topic B",
      label_en: "Fictional topic B",
      kind: "topic",
    },
  ];
  setup({ topics });
  const user = userEvent.setup();
  const topicA = screen.getByRole("checkbox", { name: "Fictional topic A" }),
    topicB = screen.getByRole("checkbox", { name: "Fictional topic B" });
  await user.click(topicA);
  await user.click(topicB);
  await user.click(
    screen.getByLabelText(
      "Vergangene, abgelaufene und belegte Aufträge einbeziehen",
    ),
  );
  await user.click(screen.getByRole("button", { name: "Filter anwenden" }));
  await waitFor(() =>
    expect(
      state.rpc.mock.calls.filter(([name]) => name === "job_discovery"),
    ).toHaveLength(2),
  );
  const latest = state.rpc.mock.calls
      .filter(([name]) => name === "job_discovery")
      .at(-1)![1].p_filters,
    filters = latest as {
      topic_ids: string[];
      include_history: boolean;
      sort: string;
    };
  expect(filters).toMatchObject({
    topic_ids: topics.map((topic) => topic.id),
    include_history: true,
    sort: "soonest",
  });
  const params = new URLSearchParams(
    screen.getByLabelText("route").textContent ?? "",
  );
  expect(params.getAll("topic")).toEqual(topics.map((topic) => topic.id));
  expect(params.get("history")).toBe("1");
});
it("hides old quote pages immediately after an observed role change and starts without their cursor", async () => {
  const client = setup();
  const user = userEvent.setup();
  await screen.findByRole("link", { name: "Fictional discovery 1" });
  await user.click(
    screen.getByRole("button", { name: "Weitere Aufträge laden" }),
  );
  await screen.findByRole("link", { name: "Fictional discovery 2" });

  const previous = state.rpc.getMockImplementation()!;
  let finish!: (value: unknown) => void;
  const currentRole = new Promise((resolve) => {
    finish = resolve;
  });
  state.rpc.mockImplementation(
    (name: string, args: Record<string, unknown>) => {
      if (name !== "job_discovery") return previous(name, args);
      return Object.assign(currentRole, { abortSignal: () => currentRole });
    },
  );
  await act(async () => {
    client.setQueryData(["user-roles", state.actor], ["senior_lecturer"]);
  });
  // Wait for the observer to consume the role, not its deferred price response.
  // The old tier must already be absent while the new first page is pending.
  await waitFor(() =>
    expect(
      state.rpc.mock.calls.filter(([name]) => name === "job_discovery"),
    ).toHaveLength(3),
  );
  expect(
    screen.queryByRole("link", { name: "Fictional discovery 1" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Fictional discovery 2" }),
  ).not.toBeInTheDocument();
  expect(
    state.rpc.mock.calls
      .filter(([name]) => name === "job_discovery")
      .at(-1)?.[1].p_cursor,
  ).toBeNull();
  await act(async () =>
    finish({
      data: {
        items: [
          { ...job(), title: "Fictional current tier", terms_version: 32 },
        ],
        has_more: false,
        next_cursor: null,
        as_of: "2040-01-01T00:00:00Z",
        filters: defaultJobFilters,
      },
      error: null,
    }),
  );
  expect(
    await screen.findByRole("link", { name: "Fictional current tier" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("link", { name: "Fictional discovery 2" }),
  ).not.toBeInTheDocument();
});
it("requires original currency before monetary requests and does not send invalid filters", async () => {
  setup();
  await screen.findByRole("link", { name: "Fictional discovery 1" });
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("Gesamthonorar ab"), "100");
  await user.click(screen.getByRole("button", { name: "Filter anwenden" }));
  expect(
    await screen.findByText(
      "Wähle für Preisgrenzen oder Preissortierung eine Originalwährung.",
    ),
  ).toBeVisible();
  expect(
    state.rpc.mock.calls.filter(([n]) => n === "job_discovery"),
  ).toHaveLength(1);
});
it("retains the create operation ID after a lost response and reports success only after a real acknowledgement", async () => {
  let attempt = 0;
  const calls: Record<string, unknown>[] = [];
  setup({
    write: async (args) => {
      calls.push(args);
      if (++attempt === 1)
        return { data: null, error: { message: "Lost response" } };
      return {
        data: {
          id: args.p_id,
          name: args.p_name,
          filters: args.p_filters,
          version: 1,
          created_at: "2040-01-01T00:00:00Z",
          updated_at: "2040-01-01T00:00:00Z",
        },
        error: null,
      };
    },
  });
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Angewendete Filter speichern" }),
  );
  const dialog = screen.getByRole("dialog");
  await user.type(
    within(dialog).getByLabelText("Name der Ansicht"),
    "Fictional private saved view",
  );
  await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
  await within(dialog).findByText(/Die Ansicht wurde nicht gespeichert/);
  expect(screen.queryByText("Ansicht gespeichert.")).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
  await screen.findByText("Ansicht gespeichert.");
  expect(calls).toHaveLength(2);
  expect(calls[0].p_id).toBe(calls[1].p_id);
  expect(calls[0].p_expected_version).toBe(0);
});
it.each(["client", "participant"])(
  "a pure %s does not request lecturer discovery or saved views",
  async (role) => {
    setup({ role });
    await screen.findByText(
      "Diese Ansicht benötigt eine aktuelle Dozierenden- oder Auftragsverwaltungsberechtigung.",
    );
    expect(state.rpc).not.toHaveBeenCalled();
  },
);
it("offline disables persisted-view writes without claiming an operation completed", async () => {
  state.online = false;
  setup();
  expect(
    await screen.findByRole("button", { name: "Angewendete Filter speichern" }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Ansichten aktualisieren" }),
  ).toBeDisabled();
  expect(state.rpc.mock.calls.some(([name]) => name === "save_job_view")).toBe(
    false,
  );
});

it("retains the reviewed saved-view version when another session changes the list", async () => {
  const view = {
    id: job(9).id,
    name: "Fictional existing view",
    filters: defaultJobFilters,
    version: 1,
    created_at: "2040-01-01T00:00:00Z",
    updated_at: "2040-01-01T00:00:00Z",
  };
  const client = setup({
    views: [view],
    write: async () => ({
      data: null,
      error: { code: "40001", message: "Changed" },
    }),
  });
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText("Ansicht auswählen"),
    view.id,
  );
  await user.click(
    await screen.findByRole("button", { name: "Ansicht umbenennen" }),
  );
  const dialog = screen.getByRole("dialog");
  await user.clear(within(dialog).getByLabelText("Name der Ansicht"));
  await user.type(
    within(dialog).getByLabelText("Name der Ansicht"),
    "Fictional reviewed rename",
  );
  await act(async () => {
    client.setQueryData(
      ["saved-job-views", state.actor],
      [{ ...view, version: 2, name: "Changed elsewhere" }],
    );
  });
  await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
  await within(dialog).findByText(/Die Ansicht wurde nicht gespeichert/);
  expect(within(dialog).getByLabelText("Name der Ansicht")).toHaveValue(
    "Fictional reviewed rename",
  );
  expect(
    state.rpc.mock.calls.find(([name]) => name === "save_job_view")?.[1],
  ).toMatchObject({
    p_id: view.id,
    p_expected_version: 1,
    p_name: "Fictional reviewed rename",
  });
});

it("starts a fresh operation after cancelling an uncertain committed create, retaining retries only inside one dialog", async () => {
  const committed = new Map<string, string>();
  const calls: Record<string, unknown>[] = [];
  setup({
    write: async (args) => {
      calls.push(args);
      const id = String(args.p_id),
        name = String(args.p_name);
      if (!committed.size) {
        committed.set(id, name);
        return {
          data: null,
          error: { message: "Acknowledgement lost after commit" },
        };
      }
      if (committed.has(id) && committed.get(id) !== name)
        return {
          data: null,
          error: {
            code: "40001",
            message: "Operation identity already committed",
          },
        };
      committed.set(id, name);
      return {
        data: {
          id,
          name,
          filters: args.p_filters,
          version: 1,
          created_at: "2040-01-01T00:00:00Z",
          updated_at: "2040-01-01T00:00:00Z",
        },
        error: null,
      };
    },
  });
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Angewendete Filter speichern" }),
  );
  let dialog = screen.getByRole("dialog");
  await user.type(
    within(dialog).getByLabelText("Name der Ansicht"),
    "Fictional uncertain first view",
  );
  await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
  await within(dialog).findByText(/Die Ansicht wurde nicht gespeichert/);
  await user.click(within(dialog).getByRole("button", { name: "Abbrechen" }));
  await user.click(
    screen.getByRole("button", { name: "Angewendete Filter speichern" }),
  );
  dialog = screen.getByRole("dialog");
  await user.type(
    within(dialog).getByLabelText("Name der Ansicht"),
    "Fictional genuinely new view",
  );
  await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
  await screen.findByText("Ansicht gespeichert.");
  expect(calls).toHaveLength(2);
  expect(calls[0].p_id).not.toBe(calls[1].p_id);
  expect(calls.map((c) => c.p_expected_version)).toEqual([0, 0]);
  expect(committed.size).toBe(2);
});
const privateView = {
  id: job(9).id,
  name: "Fictional private saved label",
  filters: { ...defaultJobFilters, customer: "Fictional private customer" },
  version: 1,
  created_at: "2040-01-01T00:00:00Z",
  updated_at: "2040-01-01T00:00:00Z",
};
it.each(["create", "rename", "remove"] as const)(
  "discards the private %s dialog on a denied list refresh, even through a later network failure",
  async (mode) => {
    let failure: { code?: string; message: string } | null = null;
    setup({
      views: [privateView],
      readViews: async () => ({
        data: failure ? null : [privateView],
        error: failure,
      }),
    });
    const user = userEvent.setup();
    await user.selectOptions(
      await screen.findByLabelText("Ansicht auswählen"),
      privateView.id,
    );
    await user.click(
      await screen.findByRole("button", {
        name:
          mode === "create"
            ? "Angewendete Filter speichern"
            : mode === "rename"
              ? "Ansicht umbenennen"
              : "Ansicht entfernen",
      }),
    );
    if (mode !== "remove") {
      await user.clear(screen.getByLabelText("Name der Ansicht"));
      await user.type(
        screen.getByLabelText("Name der Ansicht"),
        "Fictional captured private draft",
      );
    }
    failure = { code: "42501", message: "Role revoked" };
    // Invalidate through the real observer while the modal is open.
    await act(async () => {
      await clients
        .at(-1)!
        .refetchQueries({ queryKey: ["saved-job-views", state.actor] });
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("option", { name: privateView.name }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("Fictional captured private draft"),
    ).not.toBeInTheDocument();
    failure = { message: "Network unavailable" };
    await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() =>
      expect(
        state.rpc.mock.calls.filter(([n]) => n === "saved_job_views"),
      ).toHaveLength(3),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: privateView.name }),
    ).not.toBeInTheDocument();
    failure = null;
    await user.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await screen.findByRole("option", { name: privateView.name });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Ansicht auswählen")).toHaveValue("");
  },
);
it.each(["create", "rename", "remove"] as const)(
  "discards the private %s dialog and list on a denied mutation despite a stale lecturer-role cache",
  async (mode) => {
    setup({
      views: [privateView],
      write: async () => ({
        data: null,
        error: { code: "42501", message: "Role revoked" },
      }),
    });
    const user = userEvent.setup();
    await user.selectOptions(
      await screen.findByLabelText("Ansicht auswählen"),
      privateView.id,
    );
    await user.click(
      await screen.findByRole("button", {
        name:
          mode === "create"
            ? "Angewendete Filter speichern"
            : mode === "rename"
              ? "Ansicht umbenennen"
              : "Ansicht entfernen",
      }),
    );
    const dialog = screen.getByRole("dialog");
    if (mode === "create")
      await user.type(
        within(dialog).getByLabelText("Name der Ansicht"),
        "Fictional new private label",
      );
    await user.click(
      within(dialog).getByRole("button", {
        name: mode === "remove" ? "Ansicht entfernen" : "Speichern",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("option", { name: privateView.name }),
    ).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Name der Ansicht")).not.toBeInTheDocument();
    expect(clients.at(-1)!.getQueryData(["user-roles", state.actor])).toEqual([
      "lecturer",
    ]);
  },
);
it("preserves a captured rename draft and version through an ordinary list network error", async () => {
  let failed = false;
  setup({
    views: [privateView],
    readViews: async () => ({
      data: failed ? null : [privateView],
      error: failed ? { message: "Network unavailable" } : null,
    }),
  });
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText("Ansicht auswählen"),
    privateView.id,
  );
  await user.click(
    await screen.findByRole("button", { name: "Ansicht umbenennen" }),
  );
  const dialog = screen.getByRole("dialog");
  await user.clear(within(dialog).getByLabelText("Name der Ansicht"));
  await user.type(
    within(dialog).getByLabelText("Name der Ansicht"),
    "Fictional retained network draft",
  );
  failed = true;
  await act(async () => {
    await clients
      .at(-1)!
      .refetchQueries({ queryKey: ["saved-job-views", state.actor] });
  });
  expect(screen.getByRole("dialog")).toBe(dialog);
  expect(within(dialog).getByLabelText("Name der Ansicht")).toHaveValue(
    "Fictional retained network draft",
  );
  await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(
      state.rpc.mock.calls.find(([n]) => n === "save_job_view")?.[1],
    ).toMatchObject({
      p_id: privateView.id,
      p_expected_version: 1,
      p_name: "Fictional retained network draft",
    }),
  );
});

it("hides a captured private dialog on the first denied response before an automatic retry finishes", async () => {
  let attempt = 0;
  let finishRetry!: (value: { data: null; error: { message: string } }) => void;
  const retry = new Promise<{ data: null; error: { message: string } }>(
    (resolve) => {
      finishRetry = resolve;
    },
  );
  const client = setup({
    queryRetry: 1,
    readViews: async () => {
      if (++attempt === 1) return { data: [privateView], error: null };
      if (attempt === 2)
        return {
          data: null,
          error: { code: "42501", message: "Role revoked" },
        };
      return retry;
    },
  });
  const user = userEvent.setup();
  await user.selectOptions(
    await screen.findByLabelText("Ansicht auswählen"),
    privateView.id,
  );
  await user.click(
    await screen.findByRole("button", { name: "Ansicht umbenennen" }),
  );
  const refresh = client.refetchQueries({
    queryKey: ["saved-job-views", state.actor],
  });
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("option", { name: privateView.name }),
  ).not.toBeInTheDocument();
  await act(async () => {
    finishRetry({ data: null, error: { message: "Network unavailable" } });
    await refresh;
  });
  expect(
    screen.queryByRole("option", { name: privateView.name }),
  ).not.toBeInTheDocument();
});

it.each([
  [
    "de",
    "Sortieren",
    "Filter anwenden",
    "Unternehmen A–Z",
    "Erstes Thema A–Z (deutsche Bezeichnung; ohne Thema zuerst)",
  ],
  [
    "en",
    "Sort",
    "Apply filters",
    "Company A–Z",
    "First topic A–Z (German label; no topic first)",
  ],
])(
  "offers authorized customer and explicit topic ordering in %s",
  async (language, sortLabel, applyLabel, customerLabel, topicLabel) => {
    await i18n.changeLanguage(language);
    setup();
    const user = userEvent.setup();
    await screen.findByRole("link", { name: "Fictional discovery 1" });
    const sort = screen.getByLabelText(sortLabel);
    expect(
      within(sort).getByRole("option", { name: customerLabel }),
    ).toHaveValue("customer_asc");
    expect(within(sort).getByRole("option", { name: topicLabel })).toHaveValue(
      "topic_de_asc",
    );
    await user.selectOptions(sort, "customer_asc");
    await user.click(screen.getByRole("button", { name: applyLabel }));
    await waitFor(() =>
      expect(
        state.rpc.mock.calls.filter(([n]) => n === "job_discovery").at(-1)?.[1]
          .p_filters.sort,
      ).toBe("customer_asc"),
    );
    await user.selectOptions(screen.getByLabelText(sortLabel), "topic_en_asc");
    await user.click(screen.getByRole("button", { name: applyLabel }));
    await waitFor(() =>
      expect(
        state.rpc.mock.calls.filter(([n]) => n === "job_discovery").at(-1)?.[1]
          .p_filters.sort,
      ).toBe("topic_en_asc"),
    );
  },
);

it("starts with optional filters and saved views collapsed while offers remain visible", async () => {
  setup({ expandFilters: false });
  expect(await screen.findByText("Fictional discovery 1")).toBeVisible();
  const disclosure = document.querySelector(".discovery-filter-disclosure")!;
  expect(disclosure).not.toHaveAttribute("open");
  expect(screen.getByLabelText("Ansicht auswählen")).not.toBeVisible();
  await userEvent.click(screen.getByText("Filter & Ansichten"));
  expect(screen.getByLabelText("Ansicht auswählen")).toBeVisible();
});
