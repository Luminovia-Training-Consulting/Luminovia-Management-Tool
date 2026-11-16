/** Component-level withdrawal/review confirmations; real SQL and native HTTP checks are separate. */
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
import i18n from "../../lib/i18n";
import { JobWithdrawalPanel } from "./withdrawal";

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
const job = "58083b8e-5fde-450f-a35a-78cc464baf83";
const claim = "9dfed38c-84c3-4ea1-9452-c06b1c55c78c";
const id = "62da3d99-106f-4adb-b9bf-a913c871395d";
const clients: QueryClient[] = [];
const baseline = () => ({
  can_review: false,
  claims: [
    {
      claim_id: claim,
      starts_at: "2039-01-01T08:00Z",
      can_withdraw: true,
      requires_approval: true,
    },
  ],
  items: [] as {
    id: string;
    claim_id: string;
    job_id: string;
    job_title: string;
    lecturer_id: string;
    lecturer_name: string;
    status: string;
    reason: string;
    review_reason: string | null;
    created_at: string;
    resolved_at: string | null;
    can_review: boolean;
  }[],
});
const pendingItem = () => ({
  id,
  claim_id: claim,
  job_id: job,
  job_title: "Fictional teaching block",
  lecturer_id: "dc797af4-c220-451d-aefd-ea5778dc4b78",
  lecturer_name: "Fictional Lecturer",
  status: "pending",
  reason: "Fictional family commitment",
  review_reason: null,
  created_at: "2026-11-17T08:00Z",
  resolved_at: null,
  can_review: false,
});
function setup(
  snapshot = baseline(),
  write: (name: string, args: Record<string, unknown>) => unknown = () => ({
    data: { id, status: "pending" },
  }),
) {
  state.rpc.mockImplementation((name, args) => {
    const response =
      name === "assignment_withdrawals"
        ? { data: structuredClone(snapshot) }
        : write(name, args);
    const promise = Promise.resolve({ error: null, ...(response as object) });
    return Object.assign(promise, { abortSignal: () => promise });
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <JobWithdrawalPanel jobId={job} zone="Europe/Berlin" />
    </QueryClientProvider>,
  );
  return client;
}
afterEach(async () => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.clearAllMocks();
  state.online = true;
  await i18n.changeLanguage("de");
});

it("requires a reason for short-notice requests and retains the assignment while awaiting review", async () => {
  const snapshot = baseline();
  setup(snapshot, (name) => {
    expect(name).toBe("request_assignment_withdrawal");
    snapshot.claims[0].can_withdraw = false;
    snapshot.items.push(pendingItem());
    return { data: { id, status: "pending" } };
  });
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Rücktritt beantragen" }),
  );
  const dialog = screen.getByRole("dialog");
  expect(
    within(dialog).getByRole("button", { name: "Antrag absenden" }),
  ).toBeDisabled();
  await user.type(
    within(dialog).getByLabelText("Begründung"),
    "Fictional family commitment",
  );
  await user.click(
    within(dialog).getByRole("button", { name: "Antrag absenden" }),
  );
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "In Prüfung — Zuweisung bleibt bestätigt",
  );
  expect(state.rpc).toHaveBeenCalledWith("request_assignment_withdrawal", {
    p_claim_id: claim,
    p_reason: "Fictional family commitment",
    p_request_id: expect.any(String),
  });
  expect(
    screen.queryByRole("button", { name: "Rücktritt beantragen" }),
  ).not.toBeInTheDocument();
});

it("allows a direct whole-block withdrawal with an optional reason and reports only the server receipt", async () => {
  const snapshot = baseline();
  snapshot.claims[0].requires_approval = false;
  setup(snapshot, () => ({ data: { id, status: "withdrawn" } }));
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", {
      name: "Von diesem Auftrag zurücktreten",
    }),
  );
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Rücktritt bestätigen",
    }),
  );
  expect(await screen.findByText("Rücktritt bestätigt")).toBeVisible();
  expect(state.rpc).toHaveBeenCalledWith(
    "request_assignment_withdrawal",
    expect.objectContaining({ p_reason: "" }),
  );
});

it("keeps one retry identity after a failed response and does not claim release", async () => {
  let attempts = 0;
  setup(baseline(), () =>
    ++attempts === 1
      ? { error: { message: "private internal error" } }
      : { data: { id, status: "pending" } },
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Rücktritt beantragen" }),
  );
  await user.type(
    screen.getByLabelText("Begründung"),
    "Fictional retry reason",
  );
  await user.click(screen.getByRole("button", { name: "Antrag absenden" }));
  expect(
    await screen.findByText(/Die Aktion wurde nicht bestätigt/),
  ).toBeVisible();
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.queryByText("private internal error")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Antrag absenden" }));
  await waitFor(() => expect(attempts).toBe(2));
  const calls = state.rpc.mock.calls.filter(
    ([name]) => name === "request_assignment_withdrawal",
  );
  expect(calls[0][1].p_request_id).toBe(calls[1][1].p_request_id);
});

it.each([true, false])(
  "submits an explicit management decision (approve=%s) without optimistic release",
  async (approve) => {
    const snapshot = baseline();
    snapshot.can_review = true;
    snapshot.claims = [];
    snapshot.items = [{ ...pendingItem(), can_review: true }];
    setup(snapshot, () => ({
      data: { id, status: approve ? "approved" : "rejected" },
    }));
    const user = userEvent.setup();
    const label = approve ? "Rücktritt genehmigen" : "Antrag ablehnen";
    await user.click(await screen.findByRole("button", { name: label }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: label })).toBeDisabled();
    await user.type(
      within(dialog).getByLabelText("Entscheidungsbegründung"),
      "Fictional reviewed decision",
    );
    await user.click(within(dialog).getByRole("button", { name: label }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(state.rpc).toHaveBeenCalledWith("review_assignment_withdrawal", {
      p_withdrawal_id: id,
      p_approve: approve,
      p_reason: "Fictional reviewed decision",
      p_request_id: expect.any(String),
    });
  },
);

it("keeps authored reasons and draft text while switching from German to English", async () => {
  setup();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Rücktritt beantragen" }),
  );
  await user.type(
    screen.getByLabelText("Begründung"),
    "Persönlich verfasster Text",
  );
  await i18n.changeLanguage("en");
  expect(screen.getByLabelText("Reason")).toHaveValue(
    "Persönlich verfasster Text",
  );
  expect(screen.getByRole("button", { name: "Submit request" })).toBeVisible();
});

it("blocks offline requests and never calls a write", async () => {
  state.online = false;
  setup();
  expect(
    await screen.findByRole("button", { name: "Rücktritt beantragen" }),
  ).toBeDisabled();
  expect(
    state.rpc.mock.calls.every(([name]) => name === "assignment_withdrawals"),
  ).toBe(true);
});

it("does not offer peer review when the server denies that capability", async () => {
  const snapshot = baseline();
  snapshot.items = [pendingItem()];
  setup(snapshot);
  await screen.findByText("Fictional family commitment");
  expect(
    screen.queryByRole("button", { name: "Rücktritt genehmigen" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Antrag ablehnen" }),
  ).not.toBeInTheDocument();
});
