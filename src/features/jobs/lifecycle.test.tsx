/**
 * Regressions for versioned administration, confirmed cancellation and stable request IDs.
 * Controlled SDK responses do not replace real transaction/permission checks.
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
import { MemoryRouter, useLocation } from "react-router-dom";
import i18n from "../../lib/i18n";
import { JobLifecyclePanel } from "./lifecycle";
import type { JobLifecycle } from "./lifecycle-api";
import type { Job } from "../../lib/types";
const state = vi.hoisted(() => ({ rpc: vi.fn(), online: true }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../../lib/online", () => ({
  useOnline: () => state.online,
  requireOnline: () => {
    if (!state.online) throw new Error("offline");
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
const job: Job = {
  id: "job",
  title: "Fictional lifecycle offer",
  description: "Fictional description",
  customer_name: "Fictional academy",
  delivery_type: "online",
  location: "",
  time_zone: "Europe/Berlin",
  status: "published",
  amount: 100,
  total_amount: 200,
  currency: "EUR",
  rate_unit: "per_day",
  terms: "Exact original terms",
  terms_version: 1,
  requires_contract: false,
  claim_deadline: null,
  job_sessions: [
    {
      id: "session",
      job_id: "job",
      starts_at: "2039-01-01T08:00:00Z",
      ends_at: "2039-01-01T09:00:00Z",
    },
  ],
  job_requirements: [],
};
const empty: JobLifecycle = {
  version: 1,
  can_manage: true,
  can_edit: true,
  can_duplicate: true,
  claims: [],
};
const assigned: JobLifecycle = {
  version: 2,
  can_manage: false,
  can_edit: false,
  can_duplicate: false,
  claims: [
    {
      id: "claim",
      lecturer_id: "actor",
      lecturer_name: "Fictional lecturer",
      status: "confirmed",
      can_cancel: true,
      created_at: "2026-01-01T12:00Z",
      sessions: [
        {
          starts_at: "2039-01-01T08:00Z",
          ends_at: "2039-01-01T09:00Z",
          released_at: null,
        },
      ],
      events: [
        { type: "confirmed", created_at: "2026-01-01T12:00Z", reason: null },
      ],
    },
  ],
};
/** Configure the reviewed lifecycle state and targeted SDK mutation responses. */
function mock(
  meta: JobLifecycle,
  write: (
    name: string,
    args: Record<string, unknown>,
  ) => { data?: unknown; error?: unknown } = () => ({ data: "job" }),
) {
  state.rpc.mockImplementation(
    (name: string, args: Record<string, unknown>) => {
      const response =
        name === "job_lifecycle"
          ? { data: structuredClone(meta), error: null }
          : write(name, args);
      const promise = Promise.resolve({ error: null, ...response });
      return Object.assign(promise, { abortSignal: () => promise });
    },
  );
}
/** Expose the actual router location after a confirmed lifecycle action. */
function CurrentLocation() {
  const location = useLocation();
  return <output aria-label="route">{location.pathname}</output>;
}
/** Render the subject with local provider/router fixtures and an isolated QueryClient. */
function setup(meta = empty, write?: Parameters<typeof mock>[1]) {
  mock(meta, write);
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/jobs/job"]}>
        <JobLifecyclePanel job={job} />
        <CurrentLocation />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
it("shows the server maximum across lecturer tiers instead of multiplying the viewer's own quote", async () => {
  setup({ ...empty, capacity: 3, max_net_budget: 219.03 });
  expect(
    await screen.findByText(/Maximale Dozierendenvergütung: 219,03/),
  ).toBeVisible();
  expect(screen.queryByText(/600,00/)).not.toBeInTheDocument();
});
it("honours an explicitly protected budget without falling back to a cached personal quote", async () => {
  setup({ ...empty, capacity: 3, max_net_budget: null });
  await screen.findByRole("heading", { name: "Zuweisung und Auftragsverlauf" });
  expect(
    screen.queryByText(/Maximale Dozierendenvergütung/),
  ).not.toBeInTheDocument();
});
it("requires an explicit reason and server confirmation before releasing an own assignment", async () => {
  const meta = structuredClone(assigned);
  setup(meta, (name) => {
    expect(name).toBe("cancel_job_assignment");
    meta.claims[0].status = "cancelled";
    meta.claims[0].can_cancel = false;
    meta.claims[0].sessions[0].released_at = "2026-12-01T12:00Z";
    return { data: "claim" };
  });
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Zuweisung stornieren" }),
  );
  const confirm = screen.getByRole("button", {
    name: "Stornierung bestätigen",
  });
  expect(confirm).toBeDisabled();
  expect(
    state.rpc.mock.calls.filter(([name]) => name === "cancel_job_assignment"),
  ).toHaveLength(0);
  await user.type(
    screen.getByLabelText("Begründung (5–1000 Zeichen)"),
    "Fictional schedule change",
  );
  await user.click(confirm);
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByText("Storniert", { exact: true })).toBeVisible();
  expect(screen.getByText("Termine freigegeben")).toBeVisible();
  expect(state.rpc).toHaveBeenCalledWith(
    "cancel_job_assignment",
    expect.objectContaining({
      p_claim_id: "claim",
      p_reason: "Fictional schedule change",
      p_request_id: expect.any(String),
    }),
  );
});
it("a failed cancellation retains current assignment and retries the same idempotency key", async () => {
  let calls = 0;
  setup(structuredClone(assigned), () => ({
    data: "claim",
    error: ++calls === 1 ? { message: "Private internal detail" } : null,
  }));
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Zuweisung stornieren" }),
  );
  await user.type(
    screen.getByLabelText("Begründung (5–1000 Zeichen)"),
    "Fictional retry reason",
  );
  await user.click(
    screen.getByRole("button", { name: "Stornierung bestätigen" }),
  );
  await screen.findAllByText(/Die Änderung wurde abgelehnt/);
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByText("Bestätigt", { exact: true })).toBeVisible();
  expect(screen.queryByText("Private internal detail")).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Stornierung bestätigen" }),
  );
  await waitFor(() => expect(calls).toBe(2));
  const requests = state.rpc.mock.calls.filter(
    ([name]) => name === "cancel_job_assignment",
  );
  expect(requests[0][1].p_request_id).toBe(requests[1][1].p_request_id);
});
it("captures the reviewed edit version across background refresh and language changes", async () => {
  const meta = structuredClone(empty);
  const client = setup(meta, () => ({
    error: { message: "changed", code: "40001" },
  }));
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", {
      name: "Unangenommenen Auftrag bearbeiten",
    }),
  );
  await user.clear(screen.getByLabelText("Auftragstitel"));
  await user.type(screen.getByLabelText("Auftragstitel"), "Reviewed draft");
  meta.version = 2;
  await client.invalidateQueries();
  await i18n.changeLanguage("en");
  expect(screen.getByLabelText("Offer title")).toHaveValue("Reviewed draft");
  await user.click(screen.getByRole("button", { name: "Save offer" }));
  await screen.findByText(/This offer changed while you were editing/);
  expect(state.rpc).toHaveBeenCalledWith(
    "manage_job_offer",
    expect.objectContaining({
      p_expected_version: 1,
      p_action: "edit",
      p_payload: expect.objectContaining({ title: "Reviewed draft" }),
    }),
  );
});
it("an unpublished duplicate retries safely and navigates only after the successful server reply", async () => {
  let calls = 0;
  setup(structuredClone(empty), () =>
    ++calls === 1
      ? { error: { message: "Network response lost" } }
      : { data: "new-copy" },
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Als Entwurf kopieren" }),
  );
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Als Entwurf kopieren",
    }),
  );
  await screen.findAllByText(/Die Änderung wurde abgelehnt/);
  expect(screen.getByLabelText("route")).toHaveTextContent("/jobs/job");
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Als Entwurf kopieren",
    }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText("route")).toHaveTextContent("/jobs/new-copy"),
  );
  const requests = state.rpc.mock.calls.filter(
    ([name]) => name === "manage_job_offer",
  );
  expect(requests[0][1].p_request_id).toBe(requests[1][1].p_request_id);
});
it("offline controls cannot mutate the stored job", async () => {
  state.online = false;
  setup();
  expect(
    await screen.findByRole("button", {
      name: "Unangenommenen Auftrag bearbeiten",
    }),
  ).toBeDisabled();
  expect(screen.getByRole("button", { name: "Archivieren" })).toBeDisabled();
  expect(state.rpc.mock.calls.every(([name]) => name === "job_lifecycle")).toBe(
    true,
  );
});
it("published outsiders receive no peer assignment history or lifecycle management controls", async () => {
  setup({ ...empty, can_manage: false, can_edit: false, can_duplicate: false });
  await waitFor(() => expect(state.rpc).toHaveBeenCalled());
  await waitFor(() =>
    expect(
      screen.queryByText("Zuweisung und Auftragsverlauf"),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("button", { name: "Zuweisung stornieren" }),
  ).not.toBeInTheDocument();
});
