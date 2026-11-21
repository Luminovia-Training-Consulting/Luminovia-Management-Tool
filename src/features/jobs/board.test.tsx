/**
 * Regressions for confirmed board transitions and prohibition of drag-based claim success. UI
 * fixtures do not replace actual transactional allocation checks.
 */
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { OfferBoard } from "./board";

const state = vi.hoisted(() => ({ rpc: vi.fn(), online: true }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../../lib/online", () => ({
  useOnline: () => state.online,
  requireOnline: () => {
    if (!state.online) throw Error("offline");
  },
}));
const clients: QueryClient[] = [];
afterEach(async () => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
  vi.clearAllMocks();
  state.online = true;
  await i18n.changeLanguage("de");
});
const initial = [
  {
    id: "offer",
    title: "Fictional open course",
    status: "draft",
    version: 2,
    capacity: 3,
    confirmed_count: 0,
    can_transition: true,
  },
  {
    id: "accepted",
    title: "Fictional accepted course",
    status: "published",
    version: 4,
    capacity: 3,
    confirmed_count: 1,
    can_transition: false,
  },
];

/** Render the subject with local provider/router fixtures and an isolated QueryClient. */
function setup(
  write: (
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }> = async () => ({
    data: "offer",
    error: null,
  }),
) {
  let offers = structuredClone(initial);
  state.rpc.mockImplementation(
    (name: string, args: Record<string, unknown>) => {
      const response =
        name === "job_board"
          ? Promise.resolve({ data: structuredClone(offers), error: null })
          : write(args).then((r) => {
              if (!r.error)
                offers = offers.map((o) =>
                  o.id === args.p_job_id
                    ? {
                        ...o,
                        status: String(args.p_action),
                        version: o.version + 1,
                      }
                    : o,
                );
              return r;
            });
      return Object.assign(response, { abortSignal: () => response });
    },
  );
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OfferBoard />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

it("uses a single batch and provides a server-confirmed status fallback without exposing acceptance transitions", async () => {
  let resolve!: (r: { data: unknown; error: unknown }) => void;
  setup(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const select = await screen.findByRole("combobox", {
    name: "Status: Fictional open course",
  });
  expect(
    within(select).queryByRole("option", { name: "Vergeben" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", {
      name: "Status: Fictional accepted course",
    }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", {
      name: "Fictional accepted course verschieben",
    }),
  ).not.toBeInTheDocument();
  await userEvent.selectOptions(select, "published");
  expect(select).toHaveValue("draft");
  expect(select).toBeDisabled();
  expect(state.rpc.mock.calls.filter(([n]) => n === "job_board")).toHaveLength(
    1,
  );
  const [, args] = state.rpc.mock.calls.find(
    ([n]) => n === "manage_job_offer",
  )!;
  expect(args).toMatchObject({
    p_job_id: "offer",
    p_action: "published",
    p_expected_version: 2,
  });
  resolve({ data: "offer", error: null });
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Status: Fictional open course" }),
    ).toHaveValue("published"),
  );
  expect(state.rpc.mock.calls.filter(([n]) => n === "job_board")).toHaveLength(
    2,
  );
  expect(state.rpc.mock.calls.some(([n]) => n === "claim_job")).toBe(false);
});
it("retains the original state after a refused change and retries the identical idempotency key", async () => {
  let tries = 0;
  setup(async () =>
    ++tries === 1
      ? { data: null, error: { message: "lost response" } }
      : { data: "offer", error: null },
  );
  const select = await screen.findByRole("combobox", {
    name: "Status: Fictional open course",
  });
  await userEvent.selectOptions(select, "published");
  await screen.findByText(
    /Die Änderung wurde verweigert|Die Änderung wurde abgelehnt/,
  );
  expect(select).toHaveValue("draft");
  await userEvent.selectOptions(select, "published");
  await waitFor(() =>
    expect(
      screen.getByRole("combobox", { name: "Status: Fictional open course" }),
    ).toHaveValue("published"),
  );
  const writes = state.rpc.mock.calls.filter(([n]) => n === "manage_job_offer");
  expect(writes[0][1].p_request_id).toBe(writes[1][1].p_request_id);
});
it("disables online-only move controls and translates keyboard instructions", async () => {
  state.online = false;
  await i18n.changeLanguage("en");
  setup();
  expect(
    await screen.findByRole("combobox", {
      name: "Status: Fictional open course",
    }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "Move Fictional open course" }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Refresh board" })).toBeDisabled();
  expect(
    await screen.findByText(/Press Space to pick up an offer/),
  ).toBeInTheDocument();
  expect(state.rpc.mock.calls.filter(([n]) => n !== "job_board")).toHaveLength(
    0,
  );
});
