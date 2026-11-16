import {
  act,
  fireEvent,
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
import { documentDiscoveryQuery } from "./discovery-api";
import { FilesPage } from "./files";
const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  reads: vi.fn(),
  online: true,
}));
vi.mock("../../lib/online", () => ({
  useOnline: () => state.online,
  requireOnline: () => {
    if (!state.online) throw Error("offline");
  },
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
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: state.rpc,
    from: () => {
      const chain: Record<string, unknown> = {};
      for (const name of ["select", "is", "eq", "order", "abortSignal"])
        chain[name] = () => chain;
      chain.then = (resolve: (value: unknown) => unknown) => {
        state.reads();
        return Promise.resolve({
          data: documents.slice(0, 1000),
          error: null,
        }).then(resolve);
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
  await i18n.changeLanguage("de");
});
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.length = 0;
  window.history.replaceState({}, "", "/");
  vi.clearAllMocks();
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
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <FilesPage />
      </QueryClientProvider>,
    ),
  };
}
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
      <FilesPage />
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
  expect(await screen.findByText("No files yet.")).toBeInTheDocument();
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
  await act(() =>
    finish({
      data: { tags: current.personal_tags, folder: "Teaching", version: 1 },
      error: null,
    }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("Linux")).toBeInTheDocument();
  expect(screen.getByText("Your virtual folder: Teaching")).toBeInTheDocument();
});
it("retains stale drafts and disables offline organisation changes", async () => {
  state.rpc.mockImplementation((name) =>
    name === "document_discovery"
      ? response({ items: [item()], has_more: false, next_cursor: null })
      : response(null, { code: "40001" }),
  );
  const view = mount();
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
  view.rerender(
    <QueryClientProvider client={clients[0]}>
      <FilesPage />
    </QueryClientProvider>,
  );
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

// Hold the actual filtered request after advancing the real debounce explicitly.
// The old result deliberately contains this file before the new filter settles.
function pendingFilter() {
  let finishFilter!: (value: unknown) => void;
  const filter = new Promise((resolve) => {
    finishFilter = resolve;
  });
  let finishMutation!: (value: unknown) => void;
  const mutation = new Promise((resolve) => {
    finishMutation = resolve;
  });
  const initial = { ...item(), personal_tags: ["visible-filter"] };
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
      screen.getByLabelText(`Dateiname: ${fixture.initial.original_name}`),
    );
    fireEvent.click(screen.getByRole("button", { name: "Archivieren" }));
    const dialog = screen.getByRole("dialog");
    await advanceFilter();
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(document.querySelectorAll(".document-list > li")).toHaveLength(0);
    await act(async () => {
      fixture.finishFilter({
        data: { items: [], has_more: false, next_cursor: null },
        error: null,
      });
      await vi.advanceTimersByTimeAsync(0);
    });
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
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(input).toHaveValue("PRIVATE captured draft");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Eigene Ordnung speichern" }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
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
          screen.getByLabelText(`Dateiname: ${fixture.initial.original_name}`),
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
      screen.getByLabelText(`Dateiname: ${fixture.initial.original_name}`),
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
