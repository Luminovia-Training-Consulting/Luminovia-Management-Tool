import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { DocumentAttachment } from "./document-attachment";
import { documentsQuery } from "./api";

const state = vi.hoisted(() => ({
  actor: "actor-a",
  status: "clean",
  name: "Fictional lesson A.pdf",
  error: null as null | { code: string },
  read: vi.fn(),
  saveDownload: vi.fn().mockResolvedValue(undefined),
  hold: false,
  signals: [] as AbortSignal[],
}));
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  saveDownload: state.saveDownload,
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: state.actor } } }),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    from: () => {
      let single = false;
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "is", "order"])
        query[method] = () => query;
      query.maybeSingle = () => {
        single = true;
        return query;
      };
      query.abortSignal = (signal: AbortSignal) => {
        state.signals.push(signal);
        return query;
      };
      query.then = (resolve: (value: unknown) => unknown) => {
        state.read(single ? "attachment" : "list");
        const file = {
          id: "file",
          original_name: state.name,
          status: state.status,
          current_version_id: "reviewed-version",
        };
        const response = state.hold
          ? new Promise<never>(() => undefined)
          : Promise.resolve({
              data: state.error ? null : single ? file : [file],
              error: state.error,
            });
        return response.then(resolve);
      };
      return query;
    },
  }),
}));
const clients: QueryClient[] = [];
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
  vi.clearAllMocks();
  state.actor = "actor-a";
  state.status = "clean";
  state.name = "Fictional lesson A.pdf";
  state.error = null;
  state.signals = [];
  state.hold = false;
});
function List() {
  const files = useQuery(documentsQuery(state.actor));
  return <p>{files.data?.length ?? 0} files</p>;
}
function setup(list = false) {
  vi.useFakeTimers();
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const element = () => (
    <QueryClientProvider client={client}>
      {list && <List />}
      <DocumentAttachment documentId="file" />
      <DocumentAttachment documentId="file" />
    </QueryClientProvider>
  );
  const view = render(element());
  return { client, view, element };
}
async function advance(ms = 1) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
it("announces an initial metadata request as loading rather than a failed attachment", async () => {
  state.hold = true;
  setup();
  await advance();
  expect(screen.getAllByRole("status")).toHaveLength(2);
  expect(screen.queryAllByRole("button")).toHaveLength(0);
});
it("shares duplicate attachment metadata and avoids repeated settled-file loads during idle time", async () => {
  setup(true);
  await advance();
  expect(state.read.mock.calls.map(([kind]) => kind).sort()).toEqual([
    "attachment",
    "list",
  ]);
  await advance(20000);
  expect(state.read).toHaveBeenCalledTimes(2);
  await advance(40000);
  expect(state.read).toHaveBeenCalledTimes(4);
});
it("follows an active scan promptly then returns to bounded settled refresh", async () => {
  state.status = "scanning";
  setup();
  await advance();
  expect(state.read).toHaveBeenCalledTimes(1);
  state.status = "clean";
  await advance(3000);
  expect(state.read).toHaveBeenCalledTimes(2);
  expect(
    screen.getAllByRole("button", { name: /Fictional lesson A/ })[0],
  ).toBeEnabled();
  await advance(30000);
  expect(state.read).toHaveBeenCalledTimes(2);
});
it("backs off a stuck scan instead of polling rapidly for the entire session", async () => {
  state.status = "scanning";
  setup();
  await advance();
  await advance(125000);
  const calls = state.read.mock.calls.length;
  await advance(30000);
  expect(state.read).toHaveBeenCalledTimes(calls);
  await advance(30000);
  expect(state.read).toHaveBeenCalledTimes(calls + 1);
});
it("hides revoked metadata and stops recurring forbidden requests until explicit revalidation", async () => {
  const { client } = setup();
  await advance();
  state.error = { code: "42501" };
  await act(async () => {
    await client.invalidateQueries();
  });
  await advance();
  expect(screen.queryAllByText(state.name)).toHaveLength(0);
  const calls = state.read.mock.calls.length;
  await advance(20000);
  expect(state.read).toHaveBeenCalledTimes(calls);
});
it("keeps attachment metadata keyed to the authenticated actor", async () => {
  const { view, element } = setup();
  await advance();
  state.actor = "actor-b";
  state.name = "Fictional lesson B.pdf";
  view.rerender(element());
  await advance();
  expect(screen.queryAllByText("Fictional lesson A.pdf")).toHaveLength(0);
  expect(screen.getAllByText(state.name)).toHaveLength(2);
  expect(state.read).toHaveBeenCalledTimes(2);
});
it("passes cancellation to metadata requests so discarded observers can abort transport", async () => {
  state.hold = true;
  const { view } = setup();
  await advance();
  expect(state.signals).toHaveLength(1);
  expect(state.signals[0].aborted).toBe(false);
  view.unmount();
  expect(state.signals[0].aborted).toBe(true);
});
it("downloads the exact metadata version so concurrent replacements cannot mismatch its filename", async () => {
  setup();
  await advance();
  fireEvent.click(
    screen.getAllByRole("button", { name: /Fictional lesson A/ })[0],
  );
  await advance();
  expect(state.saveDownload).toHaveBeenCalledWith(
    "file",
    state.name,
    "reviewed-version",
  );
});
