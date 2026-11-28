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
import {
  focusManager,
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { documentDiscoveryQuery } from "./discovery-api";
import { FilesPage, JobDocuments, SubjectDocuments } from "./files";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  reads: vi.fn(),
  exact: vi.fn(),
  online: true,
  roles: ["lecturer"],
}));
const actor = "47000000-0000-4000-8000-000000000001";
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "47000000-0000-4000-8000-000000000001" } },
  }),
}));
vi.mock("../../lib/queries", () => ({
  permissionsQuery: () => ({
    queryKey: ["permissions"],
    queryFn: async () => [],
  }),
  jobsQuery: { queryKey: ["jobs"], queryFn: async () => [] },
  userRolesQuery: () => ({
    queryKey: ["user-roles"],
    queryFn: async () => state.roles,
  }),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: state.rpc,
    from: () => {
      let id = "";
      const chain: Record<string, unknown> = {};
      for (const name of ["select", "is", "eq", "order", "abortSignal"])
        chain[name] = () => chain;
      chain.eq = (field: string, value: string) => {
        if (field === "id") id = value;
        return chain;
      };
      chain.maybeSingle = () => state.exact(id);
      chain.then = (resolve: (value: unknown) => unknown) => {
        const result = state.reads();
        return Promise.resolve(
          result ?? { data: documents.slice(0, 1000), error: null },
        ).then(resolve);
      };
      return chain;
    },
  }),
}));
const documents = Array.from({ length: 1001 }, (_, n) => ({
  id: `47000000-0000-4000-8000-${String(n + 2).padStart(12, "0")}`,
  owner_id: actor,
  uploaded_by: actor,
  scope: "personal",
  kind: "material",
  room_id: null,
  job_id: null,
  original_name: n === 1000 ? "Older-needle-handout.txt" : `Recent-${n}.txt`,
  mime_type: "text/plain",
  size_bytes: 100,
  status: "clean",
  current_version_id: "47000000-0000-4000-9000-000000000001",
  created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 1001 - n)).toISOString(),
  deleted_at: null,
}));
const clients: QueryClient[] = [];
beforeEach(async () => {
  state.online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => state.online);
  state.roles = ["lecturer"];
  state.reads.mockReset();
  state.exact.mockReset();
  state.exact.mockImplementation((id: string) =>
    response(documents.find((file) => file.id === id) ?? null),
  );
  await i18n.changeLanguage("de");
});
afterEach(() => {
  cleanup();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  for (const client of clients) client.clear();
  clients.length = 0;
  window.history.replaceState({}, "", "/");
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function response(data: unknown, error: unknown = null) {
  return Object.assign(Promise.resolve({ data, error }), {
    abortSignal() {
      return this;
    },
  });
}

function item(index = 0) {
  return {
    ...documents[index],
    personal_tags: [] as string[],
    personal_folder: "",
    personal_version: 0,
  };
}

function mount(view = <FilesPage />) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter>{view}</MemoryRouter>
      </QueryClientProvider>,
    ),
  };
}

it("shows the invoice document kind only while the actor has a teaching role", async () => {
  state.roles = ["client"];
  state.rpc.mockReturnValue(
    response({ items: [], has_more: false, next_cursor: null }),
  );
  const { client } = mount();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Datei hochladen" }));
  expect(
    screen.queryByRole("option", { name: "Rechnung" }),
  ).not.toBeInTheDocument();
  await act(async () =>
    client.setQueryData(["user-roles"], ["client", "lecturer"]),
  );
  expect(await screen.findByRole("option", { name: "Rechnung" })).toBeVisible();
});

it("finds an authorized old file beyond the actual 1000-row list-response contract through its q deep link", async () => {
  window.history.replaceState({}, "", "/files?q=Older-needle");
  state.rpc.mockImplementation((_name, args) => {
    const data = {
      items: documents
        .filter((file) =>
          file.original_name
            .toLowerCase()
            .includes(args.p_search.toLowerCase()),
        )
        .map((file) => ({
          ...file,
          personal_tags: [],
          personal_folder: "",
          personal_version: 0,
        })),
      has_more: false,
      next_cursor: null,
    };
    const promise = Promise.resolve({ data, error: null });
    return Object.assign(promise, { abortSignal: () => promise });
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FilesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText("Older-needle-handout.txt"),
  ).toBeInTheDocument();
  expect(state.reads).not.toHaveBeenCalled();
});
it("requests an actual returned tuple cursor and deduplicates a row across loaded pages", async () => {
  const cursor = { at: item(1).created_at, id: item(1).id };
  state.rpc.mockImplementation((_name, args) =>
    response(
      args.p_before_id
        ? { items: [item(1), item(2)], has_more: false, next_cursor: null }
        : { items: [item(0), item(1)], has_more: true, next_cursor: cursor },
    ),
  );
  mount();
  await screen.findByText(item().original_name);
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Weitere Dateien laden" }));
  expect(await screen.findByText(item(2).original_name)).toBeInTheDocument();
  expect(screen.getAllByText(item(1).original_name)).toHaveLength(1);
  expect(state.rpc).toHaveBeenLastCalledWith(
    "document_discovery",
    expect.objectContaining({
      p_before_at: cursor.at,
      p_before_id: cursor.id,
      p_limit: 40,
    }),
  );
  expect(
    screen.queryByRole("button", { name: "Weitere Dateien laden" }),
  ).not.toBeInTheDocument();
});
it("shows unfiled files instead of the selected folder until the option is cleared", async () => {
  state.rpc.mockReturnValue(
    response({ items: [], has_more: false, next_cursor: null }),
  );
  mount();
  const user = userEvent.setup();
  const folder = screen.getByRole("textbox", {
    name: "Eigenen Ordner filtern",
  });
  const unfiled = screen.getByRole("checkbox", {
    name: "Nur ohne eigenen Ordner",
  });
  await user.type(folder, "Unterricht");
  await waitFor(() =>
    expect(state.rpc).toHaveBeenLastCalledWith(
      "document_discovery",
      expect.objectContaining({ p_folder: "Unterricht" }),
    ),
  );

  await user.click(unfiled);
  expect(folder).toBeDisabled();
  await waitFor(() =>
    expect(state.rpc).toHaveBeenLastCalledWith(
      "document_discovery",
      expect.objectContaining({ p_folder: "" }),
    ),
  );

  await user.click(unfiled);
  expect(folder).toBeEnabled();
  expect(folder).toHaveValue("Unterricht");
});
it("keeps filter inputs focused while pending and preserves drafts across language changes", async () => {
  state.rpc.mockReturnValue(
    response({ items: [item()], has_more: false, next_cursor: null }),
  );
  mount();
  await screen.findByText(item().original_name);
  let finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  state.rpc.mockReturnValue(
    Object.assign(pending, {
      abortSignal() {
        return this;
      },
    }),
  );
  const user = userEvent.setup(),
    search = screen.getByRole("searchbox", { name: "Dateien suchen" });
  await user.type(search, "literal%_");
  await waitFor(() =>
    expect(state.rpc).toHaveBeenCalledWith(
      "document_discovery",
      expect.objectContaining({ p_search: "literal%_" }),
    ),
  );
  expect(search).toHaveFocus();
  await act(() => i18n.changeLanguage("en"));
  expect(screen.getByRole("searchbox", { name: "Search files" })).toHaveValue(
    "literal%_",
  );
  await act(() =>
    finish({
      data: { items: [], has_more: false, next_cursor: null },
      error: null,
    }),
  );
  expect(
    await screen.findByText("No files match this search or these filters."),
  ).toBeInTheDocument();
});
it("clears the search and combined private filters in one keyboard action", async () => {
  state.rpc.mockImplementation((_name, args) =>
    response({
      items:
        args.p_search || args.p_tag || args.p_folder === "" ? [] : [item()],
      has_more: false,
      next_cursor: null,
    }),
  );
  mount();
  await screen.findByText(item().original_name);
  const user = userEvent.setup();
  const search = screen.getByRole("searchbox", { name: "Dateien suchen" });
  const tag = screen.getByLabelText("Eigenes Tag filtern");
  const folder = screen.getByLabelText("Eigenen Ordner filtern");
  const unfiled = screen.getByRole("checkbox", {
    name: "Nur ohne eigenen Ordner",
  });
  await user.type(search, "missing");
  await user.type(tag, "Tag");
  await user.type(folder, "Ordner");
  await user.click(unfiled);
  expect(
    await screen.findByText(
      "Keine Dateien für diese Suche oder Filter gefunden.",
    ),
  ).toBeInTheDocument();
  const clear = screen.getByRole("button", {
    name: "Suche und Filter zurücksetzen",
  });
  clear.focus();
  await user.keyboard("{Enter}");
  expect(search).toHaveFocus();
  expect(search).toHaveValue("");
  expect(tag).toHaveValue("");
  expect(folder).toHaveValue("");
  expect(unfiled).not.toBeChecked();
  expect(clear).not.toBeInTheDocument();
  expect(await screen.findByText(item().original_name)).toBeInTheDocument();
});
it("waits for server confirmation before showing personal tags and preserves organisation drafts in DE/EN", async () => {
  let current = item(),
    finish!: (value: unknown) => void;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  state.rpc.mockImplementation((name) =>
    name === "document_discovery"
      ? response({ items: [current], has_more: false, next_cursor: null })
      : pending,
  );
  mount();
  await screen.findByText(item().original_name);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", {
      name: `Persönlich organisieren: ${item().original_name}`,
    }),
  );
  await user.type(screen.getByLabelText("Eigene Tags"), "Linux\nNetworking");
  await user.type(
    screen.getByLabelText("Eigener virtueller Ordner"),
    "Teaching",
  );
  await act(() => i18n.changeLanguage("en"));
  expect(screen.getByLabelText("Your tags")).toHaveValue("Linux\nNetworking");
  await user.click(
    screen.getByRole("button", { name: "Save my organisation" }),
  );
  expect(
    screen.getByRole("button", { name: "Save my organisation" }),
  ).toBeDisabled();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(state.rpc).toHaveBeenCalledWith("save_document_organisation", {
    p_document_id: current.id,
    p_expected_version: 0,
    p_payload: { tags: ["Linux", "Networking"], folder: "Teaching" },
  });
  current = {
    ...current,
    personal_tags: ["Linux", "Networking"],
    personal_folder: "Teaching",
    personal_version: 1,
  };
  vi.useFakeTimers();
  try {
    await act(async () => {
      finish({
        data: { tags: current.personal_tags, folder: "Teaching", version: 1 },
        error: null,
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    await drainTargetQueries();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Linux")).toBeInTheDocument();
    expect(
      screen.getByText("Your virtual folder: Teaching"),
    ).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});
it("retains stale drafts and disables offline organisation changes", async () => {
  state.rpc.mockImplementation((name) =>
    name === "document_discovery"
      ? response({ items: [item()], has_more: false, next_cursor: null })
      : response(null, { code: "PT409" }),
  );
  mount();
  await screen.findByText(item().original_name);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", {
      name: `Persönlich organisieren: ${item().original_name}`,
    }),
  );
  await user.type(screen.getByLabelText("Eigene Tags"), "Keep draft");
  await user.click(
    screen.getByRole("button", { name: "Eigene Ordnung speichern" }),
  );
  expect(
    await screen.findByText(/Deine Ordnung wurde inzwischen geändert/),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Eigene Tags")).toHaveValue("Keep draft");
  state.online = false;
  act(() => window.dispatchEvent(new Event("offline")));
  expect(
    screen.getByRole("button", { name: "Eigene Ordnung speichern" }),
  ).toBeDisabled();
});
it("hides all retained metadata after current server access denial and does not poll every loaded page", async () => {
  state.rpc.mockReturnValue(
    response({
      items: [{ ...item(), personal_tags: ["PRIVATE organisation"] }],
      has_more: false,
      next_cursor: null,
    }),
  );
  const { client } = mount();
  await screen.findByText("PRIVATE organisation");
  expect(
    documentDiscoveryQuery(actor, { search: "", tag: "", folder: null })
      .refetchInterval,
  ).toBe(false);
  state.rpc.mockReturnValue(response(null, { code: "42501" }));
  await act(() => client.invalidateQueries({ queryKey: ["documents"] }));
  await waitFor(() =>
    expect(screen.queryByText("PRIVATE organisation")).not.toBeInTheDocument(),
  );
  expect(screen.queryByText(item().original_name)).not.toBeInTheDocument();
});
it("rejects malformed cursor contracts without retrying or displaying a false complete list", async () => {
  state.rpc.mockReturnValue(
    response({ items: [item()], has_more: true, next_cursor: null }),
  );
  mount();
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(screen.queryByText(item().original_name)).not.toBeInTheDocument();
  expect(state.rpc).toHaveBeenCalledTimes(1);
});
it("retains oversized tag input locally without sending invalid personal metadata", async () => {
  state.rpc.mockReturnValue(
    response({ items: [item()], has_more: false, next_cursor: null }),
  );
  mount();
  await screen.findByText(item().original_name);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", {
      name: `Persönlich organisieren: ${item().original_name}`,
    }),
  );
  const tags = Array.from({ length: 21 }, (_, i) => `Tag ${i}`).join("\n");
  await user.type(screen.getByLabelText("Eigene Tags"), tags);
  await user.click(
    screen.getByRole("button", { name: "Eigene Ordnung speichern" }),
  );
  expect(
    await screen.findByText(/Das Speichern konnte nicht bestätigt/),
  ).toBeInTheDocument();
  expect(screen.getByLabelText("Eigene Tags")).toHaveValue(tags);
  expect(
    state.rpc.mock.calls.some(
      ([name]) => name === "save_document_organisation",
    ),
  ).toBe(false);
});

// A result notification can commit a new query observer, whose own transport
// completion schedules a second notification. Flush both real scheduler stages.
async function drainTargetQueries() {
  // Fake timers schedule notifications created inside another timer on the
  // next millisecond. Advance that scheduler tick, not an application timeout.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}

// Hold the actual filtered request after advancing the real debounce explicitly.
// The old result deliberately contains this file before the new filter settles.
function pendingFilter(overrides: Record<string, unknown> = {}) {
  let finishFilter!: (value: unknown) => void;
  const filter = new Promise((resolve) => {
    finishFilter = resolve;
  });
  let finishMutation!: (value: unknown) => void;
  const mutation = new Promise((resolve) => {
    finishMutation = resolve;
  });
  const initial = {
    ...item(),
    personal_tags: ["visible-filter"],
    ...overrides,
  };
  state.rpc.mockImplementation((name, args) => {
    if (name !== "document_discovery") return mutation;
    if (!args.p_tag)
      return response({ items: [initial], has_more: false, next_cursor: null });
    return Object.assign(filter, {
      abortSignal() {
        return this;
      },
    });
  });
  return { initial, finishFilter, finishMutation };
}

async function advanceFilter() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  expect(state.rpc).toHaveBeenCalledWith(
    "document_discovery",
    expect.objectContaining({ p_tag: "visible-filter" }),
  );
}

it("restores only the open menu ID when its authorized row returns after the real filter debounce and archives exactly once", async () => {
  const fixture = pendingFilter();
  mount();
  await screen.findByText(fixture.initial.original_name);
  vi.useFakeTimers();
  try {
    fireEvent.change(screen.getByLabelText("Eigenes Tag filtern"), {
      target: { value: "visible-filter" },
    });
    const summary = screen.getByLabelText(
      `Weitere Aktionen für ${fixture.initial.original_name}`,
    );
    fireEvent.click(summary);
    expect(summary.closest("details")).toHaveAttribute("open");
    await advanceFilter();
    await drainTargetQueries();
    expect(document.querySelectorAll(".document-list > li")).toHaveLength(0);
    expect(
      screen.queryByText(fixture.initial.original_name),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Archivieren" }),
    ).not.toBeInTheDocument();
    expect(state.exact).not.toHaveBeenCalled();
    await act(async () => {
      fixture.finishFilter({
        data: { items: [fixture.initial], has_more: false, next_cursor: null },
        error: null,
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    await drainTargetQueries();
    const returnedSummary = screen.getByLabelText(
      `Weitere Aktionen für ${fixture.initial.original_name}`,
    );
    expect(returnedSummary).not.toBe(summary);
    expect(returnedSummary.closest("details")).toHaveAttribute("open");
    // A detached native details element may still deliver its queued toggle.
    fireEvent(summary.closest("details")!, new Event("toggle"));
    expect(returnedSummary.closest("details")).toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "Archivieren" }));
    await drainTargetQueries();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Archivieren",
      }),
    );
    await drainTargetQueries();
    expect(
      state.rpc.mock.calls.filter(([name]) => name === "rename_document"),
    ).toEqual([
      [
        "rename_document",
        {
          p_id: fixture.initial.id,
          p_name: fixture.initial.original_name,
          p_delete: true,
        },
      ],
    ]);
    await act(async () => {
      fixture.finishMutation({ data: null, error: null });
      await vi.advanceTimersByTimeAsync(0);
    });
    await drainTargetQueries();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(returnedSummary.closest("details")).not.toHaveAttribute("open");
    expect(
      state.rpc.mock.calls.filter(([name]) => name === "rename_document"),
    ).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});
it("discards an initial filter response started before the confirmed archive and replaces it with a post-commit read", async () => {
  const record = { ...item(), personal_tags: ["visible-filter"] };
  let finishStale!: (value: unknown) => void;
  const stale = new Promise((resolve) => {
    finishStale = resolve;
  });
  let finishArchive!: (value: unknown) => void;
  const archive = new Promise((resolve) => {
    finishArchive = resolve;
  });
  let committed = false;
  let filteredReads = 0;
  let staleSignal: AbortSignal | undefined;
  state.rpc.mockImplementation((name, args) => {
    if (name === "rename_document") return archive;
    if (name !== "document_discovery") throw Error("Unexpected RPC");
    if (!args.p_tag)
      return response({ items: [record], has_more: false, next_cursor: null });
    filteredReads++;
    if (filteredReads === 1)
      return Object.assign(stale, {
        abortSignal(signal: AbortSignal) {
          staleSignal = signal;
          return this;
        },
      });
    // Only a new request after the server acknowledgement may establish the
    // current empty result. The first response retains its pre-commit snapshot.
    expect(committed).toBe(true);
    return response({ items: [], has_more: false, next_cursor: null });
  });
  const { client } = mount();
  await screen.findByText(record.original_name);
  vi.useFakeTimers();
  try {
    const dialog = openCaptured("archive", record.original_name);
    await drainTargetQueries();
    fireEvent.change(screen.getByLabelText("Eigenes Tag filtern"), {
      target: { value: "visible-filter" },
    });
    await advanceFilter();
    await drainTargetQueries();
    const filterQuery = client
      .getQueryCache()
      .findAll({ queryKey: ["documents", actor, "discovery"] })
      .find(
        (query) =>
          (query.queryKey.at(-1) as { tag: string }).tag === "visible-filter",
      )!;
    expect(filterQuery.state.data).toBeUndefined();
    expect(filterQuery.state.fetchStatus).toBe("fetching");
    const confirm = within(dialog).getByRole("button", {
      name: "Archivieren",
    });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await drainTargetQueries();
    expect(
      state.rpc.mock.calls.filter(([name]) => name === "rename_document"),
    ).toEqual([
      [
        "rename_document",
        { p_id: record.id, p_name: record.original_name, p_delete: true },
      ],
    ]);
    await act(async () => {
      committed = true;
      finishArchive({ data: null, error: null });
    });
    await drainTargetQueries();
    await act(async () => {
      finishStale({
        data: { items: [record], has_more: false, next_cursor: null },
        error: null,
      });
    });
    await drainTargetQueries();
    await drainTargetQueries();
    expect(screen.queryByText(record.original_name)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(staleSignal?.aborted).toBe(true);
    expect(filteredReads).toBe(2);
    expect(filterQuery.state.data).toMatchObject({
      pages: [{ items: [] }],
      pageParams: [null],
    });
    expect(
      state.rpc.mock.calls.filter(([name]) => name === "rename_document"),
    ).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});
it("keeps only one menu open and ignores delayed native toggle events from the previously open row", async () => {
  state.rpc.mockReturnValue(
    response({ items: [item(), item(1)], has_more: false, next_cursor: null }),
  );
  mount();
  await screen.findByText(item().original_name);
  const first = screen.getByLabelText(
    `Weitere Aktionen für ${item().original_name}`,
  );
  const second = screen.getByLabelText(
    `Weitere Aktionen für ${item(1).original_name}`,
  );
  fireEvent.click(first);
  expect(first.closest("details")).toHaveAttribute("open");
  fireEvent.click(second);
  expect(first.closest("details")).not.toHaveAttribute("open");
  expect(second.closest("details")).toHaveAttribute("open");
  fireEvent(first.closest("details")!, new Event("toggle"));
  expect(second.closest("details")).toHaveAttribute("open");
  expect(
    within(first.closest("details")!).getByRole("button", {
      name: "Archivieren",
    }),
  ).not.toBeVisible();
  expect(
    within(second.closest("details")!).getByRole("button", {
      name: "Archivieren",
    }),
  ).toBeVisible();
  fireEvent.click(second);
  expect(second.closest("details")).not.toHaveAttribute("open");
  expect(
    within(second.closest("details")!).getByRole("button", {
      name: "Archivieren",
    }),
  ).not.toBeVisible();
  expect(state.exact).not.toHaveBeenCalled();
  expect(
    state.rpc.mock.calls.every(([name]) => name === "document_discovery"),
  ).toBe(true);
});
it("discards a denied target's open menu before a genuinely renewed list grant restores the row", async () => {
  state.rpc.mockImplementation((name) =>
    name === "document_discovery"
      ? response({ items: [item()], has_more: false, next_cursor: null })
      : response(null, { code: "42501" }),
  );
  const { client } = mount();
  await screen.findByText(item().original_name);
  const user = userEvent.setup();
  await user.click(
    screen.getByLabelText(`Weitere Aktionen für ${item().original_name}`),
  );
  await user.click(screen.getByRole("button", { name: "Archivieren" }));
  const confirm = within(await screen.findByRole("dialog")).getByRole(
    "button",
    {
      name: "Archivieren",
    },
  );
  await waitFor(() => expect(confirm).toBeEnabled());
  await user.click(confirm);
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByText(item().original_name)).not.toBeInTheDocument();
  });
  await act(() => client.invalidateQueries({ queryKey: ["documents"] }));
  const restored = await screen.findByLabelText(
    `Weitere Aktionen für ${item().original_name}`,
  );
  expect(restored.closest("details")).not.toHaveAttribute("open");
  expect(
    within(restored.closest("details")!).getByRole("button", {
      name: "Archivieren",
    }),
  ).not.toBeVisible();
  expect(
    state.rpc.mock.calls.filter(([name]) => name === "rename_document"),
  ).toHaveLength(1);
});
it("keeps the identical archive confirmation across pending and empty filter results, then sends exactly one confirmed mutation", async () => {
  const fixture = pendingFilter();
  mount();
  await screen.findByText(fixture.initial.original_name);
  vi.useFakeTimers();
  try {
    fireEvent.change(screen.getByLabelText("Eigenes Tag filtern"), {
      target: { value: "visible-filter" },
    });
    fireEvent.click(
      screen.getByLabelText(
        `Weitere Aktionen für ${fixture.initial.original_name}`,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Archivieren" }));
    const dialog = screen.getByRole("dialog");
    await advanceFilter();
    await drainTargetQueries();
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(document.querySelectorAll(".document-list > li")).toHaveLength(0);
    await act(async () => {
      fixture.finishFilter({
        data: { items: [], has_more: false, next_cursor: null },
        error: null,
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    await drainTargetQueries();
    expect(screen.getByRole("dialog")).toBe(dialog);
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Archivieren" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(
      within(dialog).getByRole("button", { name: "Archivieren" }),
    ).toBeDisabled();
    await drainTargetQueries();
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(
      state.rpc.mock.calls.filter(([name]) => name === "rename_document"),
    ).toEqual([
      [
        "rename_document",
        {
          p_id: fixture.initial.id,
          p_name: fixture.initial.original_name,
          p_delete: true,
        },
      ],
    ]);
    await act(async () => {
      fixture.finishMutation({ data: null, error: null });
      await vi.advanceTimersByTimeAsync(0);
    });
    await drainTargetQueries();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      state.rpc.mock.calls.filter(([name]) => name === "rename_document"),
    ).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});
it("preserves the exact organisation editor and its private draft while a new filter is pending and when it resolves", async () => {
  const fixture = pendingFilter();
  mount();
  await screen.findByText(fixture.initial.original_name);
  vi.useFakeTimers();
  try {
    fireEvent.change(screen.getByLabelText("Eigenes Tag filtern"), {
      target: { value: "visible-filter" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: `Persönlich organisieren: ${fixture.initial.original_name}`,
      }),
    );
    const dialog = screen.getByRole("dialog"),
      input = within(dialog).getByLabelText("Eigene Tags");
    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "PRIVATE captured draft" } });
    fireEvent.change(
      within(dialog).getByLabelText("Eigener virtueller Ordner"),
      { target: { value: "Private folder" } },
    );
    await advanceFilter();
    await drainTargetQueries();
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(within(dialog).getByLabelText("Eigene Tags")).toBe(input);
    expect(input).toHaveValue("PRIVATE captured draft");
    expect(document.querySelectorAll(".document-list > li")).toHaveLength(0);
    await act(async () => {
      fixture.finishFilter({
        data: { items: [fixture.initial], has_more: false, next_cursor: null },
        error: null,
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    await drainTargetQueries();
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(input).toHaveValue("PRIVATE captured draft");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Eigene Ordnung speichern" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await drainTargetQueries();
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(
      state.rpc.mock.calls.filter(
        ([name]) => name === "save_document_organisation",
      ),
    ).toEqual([
      [
        "save_document_organisation",
        {
          p_document_id: fixture.initial.id,
          p_expected_version: 0,
          p_payload: {
            tags: ["PRIVATE captured draft"],
            folder: "Private folder",
          },
        },
      ],
    ]);
    await act(async () => {
      fixture.finishMutation({
        data: {
          tags: ["PRIVATE captured draft"],
          folder: "Private folder",
          version: 1,
        },
        error: null,
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    await drainTargetQueries();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      state.rpc.mock.calls.filter(
        ([name]) => name === "save_document_organisation",
      ),
    ).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});
it.each(["archive", "organise"] as const)(
  "removes captured %s state on42501 after the held filter and performs no mutation",
  async (mode) => {
    const fixture = pendingFilter();
    mount();
    await screen.findByText(fixture.initial.original_name);
    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByLabelText("Eigenes Tag filtern"), {
        target: { value: "visible-filter" },
      });
      if (mode === "archive") {
        fireEvent.click(
          screen.getByLabelText(
            `Weitere Aktionen für ${fixture.initial.original_name}`,
          ),
        );
        fireEvent.click(screen.getByRole("button", { name: "Archivieren" }));
      } else {
        fireEvent.click(
          screen.getByRole("button", {
            name: `Persönlich organisieren: ${fixture.initial.original_name}`,
          }),
        );
        fireEvent.change(screen.getByLabelText("Eigene Tags"), {
          target: { value: "PRIVATE denied draft" },
        });
      }
      await advanceFilter();
      await act(async () => {
        fixture.finishFilter({ data: null, error: { code: "42501" } });
        await vi.advanceTimersByTimeAsync(0);
      });
      await drainTargetQueries();
      await drainTargetQueries();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(
        screen.queryByText(fixture.initial.original_name),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByDisplayValue(/PRIVATE denied draft/),
      ).not.toBeInTheDocument();
      expect(
        state.rpc.mock.calls.every(([name]) => name === "document_discovery"),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  },
);
it("hides the held archive dialog on a malformed filtered response without sending a mutation", async () => {
  const fixture = pendingFilter();
  mount();
  await screen.findByText(fixture.initial.original_name);
  vi.useFakeTimers();
  try {
    fireEvent.change(screen.getByLabelText("Eigenes Tag filtern"), {
      target: { value: "visible-filter" },
    });
    fireEvent.click(
      screen.getByLabelText(
        `Weitere Aktionen für ${fixture.initial.original_name}`,
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Archivieren" }));
    await advanceFilter();
    await act(async () => {
      fixture.finishFilter({
        data: { items: [fixture.initial], has_more: true, next_cursor: null },
        error: null,
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    await drainTargetQueries();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByText(fixture.initial.original_name),
    ).not.toBeInTheDocument();
    expect(
      state.rpc.mock.calls.every(([name]) => name === "document_discovery"),
    ).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

function openCaptured(mode: "archive" | "organise", filename: string) {
  if (mode === "archive") {
    fireEvent.click(screen.getByLabelText(`Weitere Aktionen für ${filename}`));
    const row = screen.getByText(filename).closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Archivieren" }));
  } else {
    fireEvent.click(
      screen.getByRole("button", {
        name: `Persönlich organisieren: ${filename}`,
      }),
    );
    fireEvent.change(screen.getByLabelText("Eigene Tags"), {
      target: { value: "PRIVATE room draft" },
    });
  }
  return screen.getByRole("dialog");
}

const roomFields = {
  scope: "room" as const,
  room_id: "47000000-0000-4000-8000-000000000099",
};
it.each(["archive", "organise"] as const)(
  "discards captured room %s after a successful empty list and exact RLS null, without a write",
  async (mode) => {
    const fixture = pendingFilter(roomFields);
    state.exact.mockReturnValue(response(fixture.initial));
    mount();
    await screen.findByText(fixture.initial.original_name);
    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByLabelText("Eigenes Tag filtern"), {
        target: { value: "visible-filter" },
      });
      openCaptured(mode, fixture.initial.original_name);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(state.exact).toHaveBeenCalledTimes(1);
      await advanceFilter();
      state.exact.mockReturnValue(response(null));
      await act(async () => {
        fixture.finishFilter({
          data: { items: [], has_more: false, next_cursor: null },
          error: null,
        });
        await vi.advanceTimersByTimeAsync(0);
      });
      await drainTargetQueries();
      await drainTargetQueries();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(
        screen.queryByDisplayValue("PRIVATE room draft"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(fixture.initial.original_name),
      ).not.toBeInTheDocument();
      expect(state.exact).toHaveBeenCalledTimes(2);
      expect(
        state.exact.mock.calls.every(([id]) => id === fixture.initial.id),
      ).toBe(true);
      expect(
        state.rpc.mock.calls.every(([name]) => name === "document_discovery"),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  },
);
it.each(["archive", "organise"] as const)(
  "retains the exact %s DOM/draft across empty filters, waits for the bounded fresh target grant and never writes early",
  async (mode) => {
    const fixture = pendingFilter(roomFields);
    state.exact.mockReturnValue(response(fixture.initial));
    mount();
    await screen.findByText(fixture.initial.original_name);
    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByLabelText("Eigenes Tag filtern"), {
        target: { value: "visible-filter" },
      });
      const dialog = openCaptured(mode, fixture.initial.original_name);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await advanceFilter();
      let finish!: (value: unknown) => void;
      const held = new Promise((resolve) => {
        finish = resolve;
      });
      state.exact.mockReturnValue(held);
      await act(async () => {
        fixture.finishFilter({
          data: { items: [], has_more: false, next_cursor: null },
          error: null,
        });
        await vi.advanceTimersByTimeAsync(0);
      });
      await drainTargetQueries();
      expect(screen.getByRole("dialog")).toBe(dialog);
      const save = within(dialog).getByRole("button", {
        name: mode === "archive" ? "Archivieren" : "Eigene Ordnung speichern",
      });
      expect(save).toBeDisabled();
      fireEvent.click(save);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(
        state.rpc.mock.calls.every(([name]) => name === "document_discovery"),
      ).toBe(true);
      expect(state.exact).toHaveBeenCalledTimes(2);
      await act(async () => {
        finish({ data: fixture.initial, error: null });
        await vi.advanceTimersByTimeAsync(0);
      });
      await drainTargetQueries();
      expect(screen.getByRole("dialog")).toBe(dialog);
      expect(save).toBeEnabled();
      if (mode === "organise")
        expect(screen.getByLabelText("Eigene Tags")).toHaveValue(
          "PRIVATE room draft",
        );
    } finally {
      vi.useRealTimers();
    }
  },
);
it.each([
  [
    "deleted",
    { data: { ...item(), deleted_at: "2026-11-16T00:00:00Z" }, error: null },
  ],
  ["wrong identity", { data: item(1), error: null }],
  ["permission denial", { data: null, error: { code: "42501" } }],
] as const)(
  "removes both captured metadata and private organisation draft on exact %s",
  async (_name, result) => {
    const fixture = pendingFilter(roomFields);
    state.exact.mockReturnValue(response(fixture.initial));
    const { client } = mount();
    await screen.findByText(fixture.initial.original_name);
    vi.useFakeTimers();
    try {
      openCaptured("organise", fixture.initial.original_name);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      state.exact.mockReturnValue(Promise.resolve(result));
      // Same clock instant and a new successful list: dataUpdateCount, not a newly
      // allocated rows array or timestamp sleep, triggers the exact ACL check.
      state.rpc.mockImplementation(() =>
        response({ items: [], has_more: false, next_cursor: null }),
      );
      await act(async () => {
        await client.invalidateQueries({ queryKey: ["documents"] });
        await vi.advanceTimersByTimeAsync(0);
      });
      await drainTargetQueries();
      await drainTargetQueries();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(
        screen.queryByDisplayValue("PRIVATE room draft"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(fixture.initial.original_name),
      ).not.toBeInTheDocument();
      expect(state.exact).toHaveBeenCalledTimes(2);
      expect(
        state.rpc.mock.calls.every(([name]) => name === "document_discovery"),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  },
);
it("rechecks only the open document on focus and hides a specifically revoked row without refreshing the catalogue", async () => {
  const fixture = pendingFilter(roomFields);
  state.exact.mockReturnValue(response(fixture.initial));
  mount();
  await screen.findByText(fixture.initial.original_name);
  vi.useFakeTimers();
  try {
    openCaptured("organise", fixture.initial.original_name);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(state.exact).toHaveBeenCalledTimes(1);
    state.exact.mockReturnValue(response(null));
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(0);
    });
    await drainTargetQueries();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(
      screen.queryByText(fixture.initial.original_name),
    ).not.toBeInTheDocument();
    expect(state.exact).toHaveBeenCalledTimes(2);
    expect(
      state.rpc.mock.calls.filter(([name]) => name === "document_discovery"),
    ).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

it.each(["archive", "organise"] as const)(
  "a first-ever pending exact read cannot authorise a newer %s epoch after late old grant",
  async (mode) => {
    const fixture = pendingFilter(roomFields);
    let oldFinish!: (value: unknown) => void,
      newFinish!: (value: unknown) => void;
    const oldRead = new Promise((resolve) => {
        oldFinish = resolve;
      }),
      newRead = new Promise((resolve) => {
        newFinish = resolve;
      });
    state.exact.mockReset();
    state.exact.mockReturnValueOnce(oldRead).mockReturnValue(newRead);
    mount();
    await screen.findByText(fixture.initial.original_name);
    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByLabelText("Eigenes Tag filtern"), {
        target: { value: "visible-filter" },
      });
      const dialog = openCaptured(mode, fixture.initial.original_name);
      await drainTargetQueries();
      expect(state.exact).toHaveBeenCalledTimes(1);
      await advanceFilter();
      await act(async () => {
        fixture.finishFilter({
          data: { items: [], has_more: false, next_cursor: null },
          error: null,
        });
      });
      await drainTargetQueries();
      expect(state.exact).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("dialog")).toBe(dialog);
      expect(
        within(dialog).getByRole("button", {
          name: mode === "archive" ? "Archivieren" : "Eigene Ordnung speichern",
        }),
      ).toBeDisabled();
      await act(async () => {
        newFinish({ data: null, error: null });
      });
      await drainTargetQueries();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await act(async () => {
        oldFinish({ data: fixture.initial, error: null });
      });
      await drainTargetQueries();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(
        screen.queryByText(fixture.initial.original_name),
      ).not.toBeInTheDocument();
      expect(state.exact).toHaveBeenCalledTimes(2);
      expect(
        state.rpc.mock.calls.every(([name]) => name === "document_discovery"),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  },
);
it.each(["archive", "organise"] as const)(
  "discards protected %s state immediately when its mutation itself returns42501",
  async (mode) => {
    const record = { ...item(), ...roomFields };
    state.rpc.mockImplementation((name) =>
      name === "document_discovery"
        ? response({ items: [record], has_more: false, next_cursor: null })
        : response(null, { code: "42501" }),
    );
    state.exact.mockReturnValue(response(record));
    mount();
    await screen.findByText(record.original_name);
    vi.useFakeTimers();
    try {
      const dialog = openCaptured(mode, record.original_name);
      await drainTargetQueries();
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: mode === "archive" ? "Archivieren" : "Eigene Ordnung speichern",
        }),
      );
      await drainTargetQueries();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(screen.queryByText(record.original_name)).not.toBeInTheDocument();
      expect(
        screen.queryByDisplayValue("PRIVATE room draft"),
      ).not.toBeInTheDocument();
      expect(
        state.rpc.mock.calls.filter(([name]) => name !== "document_discovery"),
      ).toHaveLength(1);
      expect(state.exact).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  },
);
it.each(["40001", undefined] as const)(
  "preserves captured private drafts on a non-revocation mutation error %s",
  async (code) => {
    state.rpc.mockImplementation((name) =>
      name === "document_discovery"
        ? response({ items: [item()], has_more: false, next_cursor: null })
        : response(null, { code, message: "Fictional uncertain error" }),
    );
    mount();
    await screen.findByText(item().original_name);
    vi.useFakeTimers();
    try {
      const dialog = openCaptured("organise", item().original_name);
      await drainTargetQueries();
      fireEvent.click(
        within(dialog).getByRole("button", {
          name: "Eigene Ordnung speichern",
        }),
      );
      await drainTargetQueries();
      expect(screen.getByRole("dialog")).toBe(dialog);
      expect(screen.getByLabelText("Eigene Tags")).toHaveValue(
        "PRIVATE room draft",
      );
      expect(
        state.rpc.mock.calls.filter(
          ([name]) => name === "save_document_organisation",
        ),
      ).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  },
);
it("a specifically quarantined filename stays hidden during a deferred background list refresh", async () => {
  const record = { ...item(), ...roomFields };
  state.rpc.mockReturnValue(
    response({ items: [record], has_more: false, next_cursor: null }),
  );
  state.exact.mockReturnValue(response(record));
  const { client } = mount();
  await screen.findByText(record.original_name);
  vi.useFakeTimers();
  try {
    openCaptured("organise", record.original_name);
    await drainTargetQueries();
    state.exact.mockReturnValue(response(null));
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await drainTargetQueries();
    expect(screen.queryByText(record.original_name)).not.toBeInTheDocument();
    let finish!: (value: unknown) => void;
    const held = new Promise((resolve) => {
      finish = resolve;
    });
    state.rpc.mockReturnValue(
      Object.assign(held, {
        abortSignal() {
          return this;
        },
      }),
    );
    let refresh!: Promise<void>;
    await act(async () => {
      refresh = client.invalidateQueries({ queryKey: ["documents"] });
    });
    await drainTargetQueries();
    expect(screen.queryByText(record.original_name)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => {
      finish({
        data: { items: [], has_more: false, next_cursor: null },
        error: null,
      });
      await refresh;
    });
    await drainTargetQueries();
    expect(screen.queryByText(record.original_name)).not.toBeInTheDocument();
    expect(state.exact).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});
it.each(["denied", "confirmed"] as const)(
  "a late %s archive outcome targets its original file and preserves a newer rename draft",
  async (outcome) => {
    const first = item(),
      second = item(1);
    let current = [first, second],
      finish!: (value: unknown) => void;
    const held = new Promise((resolve) => {
      finish = resolve;
    });
    state.rpc.mockImplementation((name) =>
      name === "document_discovery"
        ? response({ items: current, has_more: false, next_cursor: null })
        : held,
    );
    mount();
    await screen.findByText(first.original_name);
    vi.useFakeTimers();
    try {
      const old = openCaptured("archive", first.original_name);
      await drainTargetQueries();
      fireEvent.click(within(old).getByRole("button", { name: "Archivieren" }));
      await drainTargetQueries();
      fireEvent.click(within(old).getByRole("button", { name: "Schließen" }));
      fireEvent.click(
        screen.getByLabelText(`Weitere Aktionen für ${second.original_name}`),
      );
      const row = screen.getByText(second.original_name).closest("li")!;
      fireEvent.click(within(row).getByRole("button", { name: "Umbenennen" }));
      const newer = screen.getByRole("dialog");
      fireEvent.change(within(newer).getByLabelText("Dateiname"), {
        target: { value: "PRIVATE newer rename draft" },
      });
      await drainTargetQueries();
      current = [second];
      await act(async () => {
        finish({
          data: null,
          error: outcome === "denied" ? { code: "42501" } : null,
        });
      });
      await drainTargetQueries();
      expect(screen.getByRole("dialog")).toBe(newer);
      expect(within(newer).getByLabelText("Dateiname")).toHaveValue(
        "PRIVATE newer rename draft",
      );
      expect(
        state.rpc.mock.calls.filter(([name]) => name === "rename_document"),
      ).toEqual([
        [
          "rename_document",
          { p_id: first.id, p_name: first.original_name, p_delete: true },
        ],
      ]);
    } finally {
      vi.useRealTimers();
    }
  },
);
it.each(["subject", "job"] as const)(
  "rechecks a captured %s target after a same-clock successful scoped-list response",
  async (scope) => {
    const record = { ...item(), ...roomFields };
    state.reads.mockReturnValue({ data: [record], error: null });
    state.exact.mockReturnValue(response(record));
    const { client } = mount(
      scope === "subject" ? (
        <SubjectDocuments ownerId={actor} />
      ) : (
        <JobDocuments
          jobId="47000000-0000-4000-8000-000000000098"
          canManage={false}
        />
      ),
    );
    await screen.findByText(record.original_name);
    vi.useFakeTimers();
    try {
      const listKey = client
        .getQueryCache()
        .findAll({ queryKey: ["documents"] })[0].queryKey;
      const before = client.getQueryState(listKey)!;
      openCaptured("organise", record.original_name);
      await drainTargetQueries();
      expect(state.exact).toHaveBeenCalledTimes(1);
      state.reads.mockReturnValue({ data: [], error: null });
      state.exact.mockReturnValue(response(null));
      vi.setSystemTime(before.dataUpdatedAt);
      await act(async () => {
        await client.invalidateQueries({ queryKey: ["documents"] });
      });
      // dataUpdatedAt can stay exactly equal. The successful cache update
      // counter must still create a new bounded target-authorisation epoch.
      expect(client.getQueryState(listKey)!.dataUpdatedAt).toBe(
        before.dataUpdatedAt,
      );
      expect(client.getQueryState(listKey)!.dataUpdateCount).toBe(
        before.dataUpdateCount + 1,
      );
      await drainTargetQueries();
      await drainTargetQueries();
      expect(state.exact).toHaveBeenCalledTimes(2);
      expect(state.exact.mock.calls.every(([id]) => id === record.id)).toBe(
        true,
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(
        screen.queryByDisplayValue("PRIVATE room draft"),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(record.original_name)).not.toBeInTheDocument();
      expect(state.rpc).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  },
);
it.each(["observed", "previous-visit"] as const)(
  "a prior %s filter cache cannot renew a known-revoked filename, but a newer successful response can",
  async (cacheKind) => {
    const record = { ...item(), ...roomFields };
    state.rpc.mockReturnValue(
      response({ items: [record], has_more: false, next_cursor: null }),
    );
    state.exact.mockReturnValue(response(record));
    const { client } = mount();
    if (cacheKind === "previous-visit")
      client.setQueryData(
        documentDiscoveryQuery(actor, {
          search: "prior",
          tag: "",
          folder: null,
        }).queryKey,
        {
          pages: [{ items: [record], has_more: false, next_cursor: null }],
          pageParams: [null],
        },
      );
    await screen.findByText(record.original_name);
    vi.useFakeTimers();
    try {
      fireEvent.change(screen.getByLabelText("Eigenes Tag filtern"), {
        target: { value: "visible-filter" },
      });
      await advanceFilter();
      await drainTargetQueries();
      openCaptured("organise", record.original_name);
      await drainTargetQueries();
      state.exact.mockReturnValue(response(null));
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await drainTargetQueries();
      expect(screen.queryByText(record.original_name)).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      const calls = state.rpc.mock.calls.length;
      fireEvent.change(screen.getByLabelText("Eigenes Tag filtern"), {
        target: { value: "" },
      });
      if (cacheKind === "previous-visit")
        fireEvent.change(
          screen.getByRole("searchbox", { name: "Dateien suchen" }),
          { target: { value: "prior" } },
        );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      await drainTargetQueries();
      expect(state.rpc).toHaveBeenCalledTimes(calls);
      expect(screen.queryByText(record.original_name)).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole("button", { name: "Dateiliste aktualisieren" }),
      );
      await drainTargetQueries();
      expect(state.rpc).toHaveBeenCalledTimes(calls + 1);
      expect(screen.getByText(record.original_name)).toBeInTheDocument();
      expect(state.exact).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  },
);
it("appending a genuinely fresh page cannot renew the known-revoked cached prefix", async () => {
  const first = { ...item(), ...roomFields },
    second = item(1);
  state.rpc.mockImplementation((_name, args) =>
    response(
      args.p_before_id
        ? { items: [second], has_more: false, next_cursor: null }
        : {
            items: [first],
            has_more: true,
            next_cursor: { at: first.created_at, id: first.id },
          },
    ),
  );
  state.exact.mockReturnValue(response(first));
  mount();
  await screen.findByText(first.original_name);
  vi.useFakeTimers();
  try {
    openCaptured("organise", first.original_name);
    await drainTargetQueries();
    state.exact.mockReturnValue(response(null));
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await drainTargetQueries();
    expect(screen.queryByText(first.original_name)).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Weitere Dateien laden" }),
    );
    await drainTargetQueries();
    expect(screen.getByText(second.original_name)).toBeInTheDocument();
    expect(screen.queryByText(first.original_name)).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(state.exact).toHaveBeenCalledTimes(2);
    expect(state.rpc).toHaveBeenCalledTimes(2);
    expect(
      state.rpc.mock.calls.every(([name]) => name === "document_discovery"),
    ).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
it.each(["denied", "confirmed"] as const)(
  "a late %s organisation outcome cannot close or erase another file's newer draft",
  async (outcome) => {
    const first = { ...item(), ...roomFields },
      second = item(1);
    let current = [first, second],
      finish!: (value: unknown) => void;
    const held = new Promise((resolve) => {
      finish = resolve;
    });
    state.rpc.mockImplementation((name) =>
      name === "document_discovery"
        ? response({ items: current, has_more: false, next_cursor: null })
        : held,
    );
    mount();
    await screen.findByText(first.original_name);
    vi.useFakeTimers();
    try {
      const old = openCaptured("organise", first.original_name);
      await drainTargetQueries();
      fireEvent.click(
        within(old).getByRole("button", { name: "Eigene Ordnung speichern" }),
      );
      await drainTargetQueries();
      state.exact.mockImplementation((id: string) =>
        response(id === first.id ? null : second),
      );
      await act(async () => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
      });
      await drainTargetQueries();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      const newer = openCaptured("organise", second.original_name);
      fireEvent.change(within(newer).getByLabelText("Eigene Tags"), {
        target: { value: "PRIVATE newer organisation draft" },
      });
      await drainTargetQueries();
      current = [second];
      await act(async () => {
        finish(
          outcome === "denied"
            ? { data: null, error: { code: "42501" } }
            : {
                data: { tags: ["saved first"], folder: "", version: 1 },
                error: null,
              },
        );
        await vi.advanceTimersByTimeAsync(0);
      });
      await drainTargetQueries();
      expect(screen.getByRole("dialog")).toBe(newer);
      expect(within(newer).getByLabelText("Eigene Tags")).toHaveValue(
        "PRIVATE newer organisation draft",
      );
      const writes = state.rpc.mock.calls.filter(
        ([name]) => name === "save_document_organisation",
      );
      expect(writes).toHaveLength(1);
      expect(writes[0][1].p_document_id).toBe(first.id);
    } finally {
      vi.useRealTimers();
    }
  },
);

it("removes another staff member’s attachment only from its exact managed job after confirmation", async () => {
  const jobId = "47000000-0000-4000-8000-000000000098";
  const record = {
    ...item(),
    owner_id: "47000000-0000-4000-8000-000000000099",
    job_id: jobId,
    scope: "job_after",
  };
  state.reads.mockReturnValue({ data: [record], error: null });
  state.exact.mockImplementation((id) =>
    response(id === record.id ? record : null),
  );
  state.rpc.mockImplementation((name) => {
    if (name === "rename_document") {
      state.reads.mockReturnValue({ data: [], error: null });
      return response(null);
    }
    return response({ kinds: [] });
  });

  const user = userEvent.setup();
  mount(<JobDocuments jobId={jobId} canManage />);
  const section = screen.getByRole("region", { name: "Auftragsdateien" });
  await user.click(within(section).getByText("Auftragsdatei hinzufügen"));
  expect(within(section).getByLabelText("Freigabe")).toHaveValue("job_before");
  await user.selectOptions(
    within(section).getByLabelText("Freigabe"),
    "job_after",
  );
  expect(within(section).getByLabelText("Datei auswählen")).toBeEnabled();

  await user.click(
    await within(section).findByRole("button", {
      name: `Anhang entfernen: ${record.original_name}`,
    }),
  );
  const dialog = screen.getByRole("dialog", {
    name: "Anhang vom Auftrag entfernen?",
  });
  expect(dialog).toHaveTextContent(record.original_name);
  expect(
    state.rpc.mock.calls.filter(([name]) => name === "rename_document"),
  ).toEqual([]);
  const confirm = within(dialog).getByRole("button", {
    name: "Anhang entfernen",
  });
  await waitFor(() => expect(confirm).toBeEnabled());
  await user.click(confirm);

  expect(
    await within(section).findByText("Noch keine Dateien vorhanden."),
  ).toBeVisible();
  expect(
    state.rpc.mock.calls.filter(([name]) => name === "rename_document"),
  ).toEqual([
    [
      "rename_document",
      { p_id: record.id, p_name: record.original_name, p_delete: true },
    ],
  ]);
});

it("exposes the attachment for reading without providing job-management actions", async () => {
  await i18n.changeLanguage("en");
  const jobId = "47000000-0000-4000-8000-000000000098";
  const record = {
    ...item(),
    owner_id: "47000000-0000-4000-8000-000000000099",
    job_id: jobId,
    scope: "job_before",
  };
  state.reads.mockReturnValue({ data: [record], error: null });
  state.rpc.mockReturnValue(response({ kinds: [] }));
  mount(<JobDocuments jobId={jobId} canManage={false} />);
  const section = screen.getByRole("region", { name: "Job attachments" });
  expect(
    await within(section).findByRole("button", {
      name: `Download: ${record.original_name}`,
    }),
  ).toHaveTextContent(record.original_name);
  expect(
    within(section).queryByText("Add job attachment"),
  ).not.toBeInTheDocument();
  expect(
    within(section).queryByRole("button", {
      name: `Remove attachment: ${record.original_name}`,
    }),
  ).not.toBeInTheDocument();
});
