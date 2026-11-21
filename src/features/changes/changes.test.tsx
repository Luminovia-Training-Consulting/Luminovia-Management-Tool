/** Component regressions exercise persisted before/after presentation, explicit
 * consent and truthful failure/offline states. RPC mocks are deliberately not
 * claimed as native database, Auth or browser acceptance. */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { ChangeRequestsPage } from "./changes";
import type {
  AssignmentChange,
  AssignmentSnapshot,
  ChangeCandidate,
} from "./api";
const state = vi.hoisted(() => ({ rpc: vi.fn(), online: true }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "ed000000-0000-4000-8000-000000000002" } },
  }),
}));
vi.mock("../../lib/online", () => ({
  useOnline: () => state.online,
  requireOnline: () => {
    if (!state.online) throw new Error("offline");
  },
}));
const id = "ed000000-0000-4000-8000-000000000010",
  claim = "ed000000-0000-4000-8000-000000000011",
  teacher = "ed000000-0000-4000-8000-000000000002",
  job = "ed000000-0000-4000-8000-000000000012";
const source = (): AssignmentSnapshot => ({
  claim_id: claim,
  job_id: job,
  course_run_id: null,
  lecturer_id: teacher,
  title: "Fictional versioned course",
  time_zone: "Europe/Berlin",
  delivery_type: "online",
  location: "https://meeting.example.invalid/old",
  scope: "Fictional literal <script>scope</script>",
  amount: 100,
  total_amount: 200,
  currency: "EUR",
  rate_unit: "per_day",
  terms: "Fictional original terms",
  cancel: false,
  sessions: [
    { starts_at: "2045-01-01T08:00:00Z", ends_at: "2045-01-01T09:00:00Z" },
  ],
});
const request = (): AssignmentChange => ({
  id,
  claim_id: claim,
  requester_id: teacher,
  lecturer_id: teacher,
  reason: "Fictional changed requirements",
  status: "draft",
  version: 1,
  original: source(),
  proposed: {
    ...source(),
    location: "https://meeting.example.invalid/new",
    amount: 150,
    total_amount: 300,
  },
  can_price: true,
  can_edit: true,
  can_submit: true,
  can_respond: false,
  can_apply: false,
  can_withdraw: true,
  manager_approved: false,
  lecturer_approved: false,
  created_at: "2026-11-16T01:00:00Z",
  updated_at: "2026-11-16T01:00:00Z",
  applied_at: null,
  events: [
    {
      action: "saved",
      actor_name: "Fictional lecturer",
      note: "",
      created_at: "2026-11-16T01:00:00Z",
    },
  ],
});
let data: AssignmentChange[], candidates: ChangeCandidate[];
const clients: QueryClient[] = [];
function response(value: unknown, error: unknown = null) {
  return Object.assign(Promise.resolve({ data: value, error }), {
    abortSignal() {
      return this;
    },
  });
}
function mount(path = `/changes/${id}`) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/changes" element={<ChangeRequestsPage />} />
          <Route path="/changes/:id" element={<ChangeRequestsPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(async () => {
  data = [request()];
  candidates = [
    {
      claim_id: claim,
      title: source().title,
      lecturer_name: "Fictional teacher",
      time_zone: "Europe/Berlin",
      can_price: true,
      commissioned: false,
      current: source(),
    },
  ];
  state.online = true;
  state.rpc.mockReset();
  state.rpc.mockImplementation((name) =>
    response(
      name === "assignment_changes"
        ? structuredClone(data)
        : name === "changeable_assignments"
          ? structuredClone(candidates)
          : id,
    ),
  );
  await i18n.changeLanguage("de");
});
afterEach(() => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.restoreAllMocks();
});
it("compares original/proposed persisted versions without executing authored markup", async () => {
  const { container } = mount();
  await screen.findByRole("heading", { name: "Versionsvergleich" });
  expect(container.querySelector("script")).toBeNull();
  expect(screen.getAllByText(source().scope)).toHaveLength(2);
  expect(screen.getByText("https://meeting.example.invalid/old")).toBeVisible();
  expect(screen.getByText("https://meeting.example.invalid/new")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Angenommene Änderung anwenden" }),
  ).not.toBeInTheDocument();
});
it("explicit consent binds the displayed request version and rejected responses show no success", async () => {
  data[0] = {
    ...data[0],
    status: "awaiting_response",
    can_edit: false,
    can_submit: false,
    can_respond: true,
  };
  mount();
  const user = userEvent.setup();
  const accept = await screen.findByRole("button", {
    name: "Dieser Änderung zustimmen",
  });
  expect(accept).toBeDisabled();
  await user.click(
    screen.getByLabelText(/Ich habe Original und vorgeschlagene Änderung/),
  );
  state.rpc.mockImplementation((name) =>
    name === "assignment_change_action"
      ? response(null, { code: "40001", message: "stale" })
      : response(
          name === "assignment_changes"
            ? structuredClone(data)
            : structuredClone(candidates),
        ),
  );
  await user.click(accept);
  await screen.findByText(/Antrag oder Originalauftrag wurden geändert/);
  expect(state.rpc).toHaveBeenCalledWith("assignment_change_action", {
    p_id: id,
    p_action: "accept",
    p_expected_version: 1,
    p_note: "",
    p_request_id: expect.any(String),
  });
  expect(
    screen.queryByText("Der Server hat die Änderung bestätigt."),
  ).not.toBeInTheDocument();
});
it("reject/withdraw require a meaningful explanation and use online server actions", async () => {
  mount();
  await screen.findByRole("button", { name: "Antrag zurückziehen" });
  const withdraw = screen.getByRole("button", { name: "Antrag zurückziehen" });
  expect(withdraw).toBeDisabled();
  await userEvent.type(
    screen.getByLabelText("Begründung für Ablehnung oder Rücknahme"),
    "Fictional withdrawal reason",
  );
  await userEvent.click(withdraw);
  await waitFor(() =>
    expect(state.rpc).toHaveBeenCalledWith(
      "assignment_change_action",
      expect.objectContaining({
        p_action: "withdraw",
        p_note: "Fictional withdrawal reason",
      }),
    ),
  );
});
it("creates a draft with named-zone instants and preserves its authored draft through DE/EN", async () => {
  mount("/changes");
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Änderungsantrag erstellen" }),
  );
  await user.type(
    screen.getByLabelText("Begründung"),
    "Fictional rescheduling reason",
  );
  await user.clear(screen.getByLabelText("Leistungsumfang"));
  await user.type(
    screen.getByLabelText("Leistungsumfang"),
    "Fictional new scope",
  );
  await act(() => i18n.changeLanguage("en"));
  expect(screen.getByLabelText("Scope of work")).toHaveValue(
    "Fictional new scope",
  );
  fireEvent.change(screen.getByLabelText("Start 1"), {
    target: { value: "2045-01-01T09:15" },
  });
  await user.click(screen.getByRole("button", { name: "Save draft online" }));
  await waitFor(() =>
    expect(state.rpc).toHaveBeenCalledWith(
      "save_assignment_change",
      expect.objectContaining({
        p_id: null,
        p_claim_id: claim,
        p_expected_version: 0,
        p_payload: expect.objectContaining({
          reason: "Fictional rescheduling reason",
          changes: expect.objectContaining({
            scope: "Fictional new scope",
            sessions: [
              {
                starts_at: "2045-01-01T08:15:00.000Z",
                ends_at: "2045-01-01T09:00:00Z",
              },
            ],
          }),
        }),
      }),
    ),
  );
});
it("submits only the shared dates and explains the independent consent in both languages", async () => {
  const candidate = candidates[0];
  candidate.current.course_run_id = "ed000000-0000-4000-8000-000000000013";
  candidate.schedule_editable = true;
  candidate.shared_schedule_only = true;
  mount("/changes");
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Änderungsantrag erstellen" }),
  );
  expect(screen.getByText(/jede betroffene Lehrkraft/)).toBeVisible();
  expect(screen.queryByLabelText("Ort oder Meeting-Link")).toBeNull();
  expect(screen.queryByLabelText("Leistungsumfang")).toBeNull();
  expect(screen.queryByLabelText("Vergütung pro Einheit")).toBeNull();
  expect(
    screen.queryByLabelText("Vollständigen Auftrag stornieren"),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Termin hinzufügen" }));
  await user.type(
    screen.getByLabelText("Begründung"),
    "Fictional shared reason",
  );
  await act(() => i18n.changeLanguage("en"));
  expect(
    screen.getByText(/each affected lecturer a separate request/),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText("Start 1"), {
    target: { value: "2045-01-01T09:15" },
  });
  fireEvent.change(screen.getByLabelText("Start 2"), {
    target: { value: "2045-01-01T11:15" },
  });
  fireEvent.change(screen.getByLabelText("Finish 2"), {
    target: { value: "2045-01-01T12:00" },
  });
  await user.click(screen.getByRole("button", { name: "Save draft online" }));
  await waitFor(() =>
    expect(state.rpc).toHaveBeenCalledWith(
      "save_assignment_change",
      expect.objectContaining({
        p_payload: {
          reason: "Fictional shared reason",
          changes: {
            sessions: [
              {
                starts_at: "2045-01-01T08:15:00.000Z",
                ends_at: "2045-01-01T09:00:00Z",
              },
              {
                starts_at: "2045-01-01T10:15:00.000Z",
                ends_at: "2045-01-01T11:00:00.000Z",
              },
            ],
          },
        },
      }),
    ),
  );
});
it("displays group progress and waits for every required approval before offering application", async () => {
  data[0] = {
    ...data[0],
    status: "accepted",
    can_edit: false,
    can_submit: false,
    shared_schedule_only: true,
    shared_schedule: { required: 2, accepted: 1, state: "awaiting_consent" },
  };
  mount();
  expect(await screen.findByText(/1 von 2 Aufträgen bestätigt/)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Angenommene Änderung anwenden" }),
  ).toBeNull();
  data[0] = {
    ...data[0],
    can_apply: true,
    shared_schedule: { required: 2, accepted: 2, state: "ready" },
  };
  await act(async () => {
    await i18n.changeLanguage("en");
    await clients
      .at(-1)!
      .invalidateQueries({ queryKey: ["assignment-changes"] });
  });
  expect(await screen.findByText(/2 of 2 assignments approved/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Apply accepted amendment" }),
  ).toBeVisible();
});
it.each([false, true])(
  "uses the selected assignment's exact instants after switching (refresh: %s)",
  async (refresh) => {
    const secondClaim = "ed000000-0000-4000-8000-000000000013";
    const sessions = [
      {
        starts_at: "2044-12-31T23:00:11.123Z",
        ends_at: "2045-01-01T00:00:22.456Z",
      },
    ];
    candidates.push({
      ...candidates[0],
      claim_id: secondClaim,
      title: "Fictional Brisbane course",
      time_zone: "Australia/Brisbane",
      current: {
        ...source(),
        claim_id: secondClaim,
        time_zone: "Australia/Brisbane",
        sessions,
      },
    });
    mount("/changes");
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Änderungsantrag erstellen" }),
    );

    // The selected course shows identical wall times but has different instants.
    expect(screen.getByLabelText("Beginn 1")).toHaveValue("2045-01-01T09:00");
    await user.selectOptions(
      screen.getByLabelText("Bestätigter Auftrag"),
      secondClaim,
    );
    expect(screen.getByLabelText("Beginn 1")).toHaveValue("2045-01-01T09:00");
    await user.type(
      screen.getByLabelText("Begründung"),
      "Fictional scope change",
    );

    if (refresh) {
      candidates[1].current = {
        ...candidates[1].current,
        ...source(),
        claim_id: secondClaim,
      };
      await act(() =>
        clients
          .at(-1)!
          .invalidateQueries({ queryKey: ["changeable-assignments"] }),
      );
      expect(screen.getByLabelText("Begründung")).toHaveValue(
        "Fictional scope change",
      );
      fireEvent.change(screen.getByLabelText("Beginn 1"), {
        target: { value: "2045-01-01T09:15" },
      });
    }

    await user.click(
      screen.getByRole("button", { name: "Entwurf online speichern" }),
    );
    await waitFor(() =>
      expect(state.rpc).toHaveBeenCalledWith(
        "save_assignment_change",
        expect.objectContaining({
          p_claim_id: secondClaim,
          p_payload: expect.objectContaining({
            changes: expect.objectContaining({
              sessions: [
                {
                  ...sessions[0],
                  starts_at: refresh
                    ? "2044-12-31T23:15:00.000Z"
                    : sessions[0].starts_at,
                },
              ],
            }),
          }),
        }),
      ),
    );
  },
);
it("retains precise times of the remaining row after removing an earlier session", async () => {
  const remaining = {
    starts_at: "2045-01-02T08:00:11.123Z",
    ends_at: "2045-01-02T09:00:22.456Z",
  };
  candidates[0].current.sessions.push(remaining);
  mount("/changes");
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Änderungsantrag erstellen" }),
  );
  await user.click(
    screen.getAllByRole("button", { name: "Termin entfernen" })[0],
  );
  expect(screen.getByLabelText("Beginn 1")).toHaveValue("2045-01-02T09:00");
  await user.click(screen.getByRole("button", { name: "Termin hinzufügen" }));
  fireEvent.change(screen.getByLabelText("Beginn 2"), {
    target: { value: "2045-01-03T09:00" },
  });
  fireEvent.change(screen.getByLabelText("Ende 2"), {
    target: { value: "2045-01-03T10:00" },
  });
  await user.type(
    screen.getByLabelText("Begründung"),
    "Fictional session replacement",
  );
  await user.click(
    screen.getByRole("button", { name: "Entwurf online speichern" }),
  );
  await waitFor(() =>
    expect(state.rpc).toHaveBeenCalledWith(
      "save_assignment_change",
      expect.objectContaining({
        p_claim_id: claim,
        p_payload: expect.objectContaining({
          changes: expect.objectContaining({
            sessions: [
              remaining,
              {
                starts_at: "2045-01-03T08:00:00.000Z",
                ends_at: "2045-01-03T09:00:00.000Z",
              },
            ],
          }),
        }),
      }),
    ),
  );
});
it("requires an explicit available assignment after following an obsolete deep link", async () => {
  mount("/changes?claim=ed000000-0000-4000-8000-000000000099");
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Änderungsantrag erstellen" }),
  );
  expect(screen.getByLabelText("Bestätigter Auftrag")).toHaveValue("");
  expect(
    screen.getByRole("button", { name: "Entwurf online speichern" }),
  ).toBeDisabled();
  expect(
    screen.getByLabelText("Bestätigter Auftrag"),
  ).toHaveAccessibleDescription(
    /Der ursprünglich ausgewählte Auftrag ist für Änderungen nicht verfügbar/,
  );
  await act(() => i18n.changeLanguage("en"));
  await user.selectOptions(
    screen.getByLabelText("Confirmed assignment"),
    claim,
  );
  expect(
    screen.getByLabelText("Confirmed assignment"),
  ).not.toHaveAccessibleDescription();
  await user.type(
    screen.getByLabelText("Reason"),
    "Fictional valid assignment",
  );
  await user.click(screen.getByRole("button", { name: "Save draft online" }));
  await waitFor(() =>
    expect(state.rpc).toHaveBeenCalledWith(
      "save_assignment_change",
      expect.objectContaining({ p_claim_id: claim }),
    ),
  );
  expect(
    state.rpc.mock.calls.filter(([name]) => name === "save_assignment_change"),
  ).toHaveLength(1);
});
it("retains the same request UUID when an unchanged draft submission has an uncertain response", async () => {
  mount("/changes");
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Änderungsantrag erstellen" }),
  );
  await user.type(
    screen.getByLabelText("Begründung"),
    "Fictional retry reason",
  );
  state.rpc.mockImplementation((name) =>
    name === "save_assignment_change"
      ? response(null, { message: "network uncertain" })
      : response(
          name === "assignment_changes"
            ? structuredClone(data)
            : structuredClone(candidates),
        ),
  );
  await user.click(
    screen.getByRole("button", { name: "Entwurf online speichern" }),
  );
  await screen.findByText(/Die Änderung wurde nicht bestätigt/);
  await user.click(
    screen.getByRole("button", { name: "Entwurf online speichern" }),
  );
  await waitFor(() =>
    expect(
      state.rpc.mock.calls.filter(
        ([name]) => name === "save_assignment_change",
      ),
    ).toHaveLength(2),
  );
  const writes = state.rpc.mock.calls.filter(
    ([name]) => name === "save_assignment_change",
  );
  expect(writes[0][1].p_request_id).toBe(writes[1][1].p_request_id);
});
it("an authorised own commissioned net proposal keeps customer pricing fixed and review explicit", async () => {
  candidates[0].commissioned = true;
  mount("/changes");
  await userEvent.click(
    await screen.findByRole("button", { name: "Änderungsantrag erstellen" }),
  );
  expect(screen.getByLabelText("Vergütung pro Einheit")).toBeVisible();
  expect(screen.getByLabelText("Vergütungseinheit")).toHaveAttribute(
    "aria-readonly",
    "true",
  );
  expect(
    screen.getByLabelText("Vergütungseinheit").querySelectorAll("option"),
  ).toHaveLength(1);
  expect(
    screen.getByText(/Der vereinbarte Kundenpreis bleibt unverändert/),
  ).toBeVisible();
  await userEvent.type(
    screen.getByLabelText("Begründung"),
    "Fictional commissioned amendment reason",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Entwurf online speichern" }),
  );
  await waitFor(() =>
    expect(
      state.rpc.mock.calls.some(([name]) => name === "save_assignment_change"),
    ).toBe(true),
  );
  expect(
    state.rpc.mock.calls.find(([name]) => name === "save_assignment_change")![1]
      .p_payload.changes.rate_unit,
  ).toBe("per_day");
});
it("customer proposals expose and submit only operational values without invented private terms", async () => {
  candidates[0] = {
    ...candidates[0],
    commissioned: true,
    can_price: false,
    customer_view: true,
    current: {
      ...source(),
      amount: null,
      total_amount: null,
      currency: null,
      rate_unit: null,
      terms: null,
    },
  };
  mount("/changes");
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Änderungsantrag erstellen" }),
  );
  expect(
    screen.queryByLabelText("Auftragsbedingungen"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByLabelText("Vergütung pro Einheit"),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("checkbox", {
      name: "Vollständigen Auftrag stornieren",
    }),
  ).not.toBeInTheDocument();
  await user.type(
    screen.getByLabelText("Begründung"),
    "Fictional customer request reason",
  );
  await user.click(
    screen.getByRole("button", { name: "Entwurf online speichern" }),
  );
  await waitFor(() =>
    expect(
      state.rpc.mock.calls.some(([name]) => name === "save_assignment_change"),
    ).toBe(true),
  );
  const payload = state.rpc.mock.calls.find(
    ([name]) => name === "save_assignment_change",
  )![1].p_payload;
  expect(Object.keys(payload.changes).sort()).toEqual([
    "location",
    "scope",
    "sessions",
  ]);
});
it("customer comparison hides commercial rows and cannot self-approve or apply in English", async () => {
  data[0] = {
    ...request(),
    customer_view: true,
    requested_by_customer: true,
    can_price: false,
    original: {
      ...source(),
      amount: null,
      total_amount: null,
      currency: null,
      rate_unit: null,
      terms: null,
    },
    proposed: {
      ...source(),
      amount: null,
      total_amount: null,
      currency: null,
      rate_unit: null,
      terms: null,
    },
    can_respond: false,
    can_apply: false,
  };
  await i18n.changeLanguage("en");
  mount();
  await screen.findByRole("heading", { name: "Version comparison" });
  expect(
    screen.queryByRole("rowheader", { name: "Assignment terms" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("rowheader", { name: "Total compensation" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Accept this amendment" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Apply accepted amendment" }),
  ).not.toBeInTheDocument();
});
it("offline mutation controls are disabled and denied refresh clears the retained comparison", async () => {
  state.online = false;
  mount();
  await screen.findByRole("heading", { name: "Versionsvergleich" });
  expect(
    screen.getByRole("button", { name: "Zur Zustimmung einreichen" }),
  ).toBeDisabled();
  expect(screen.getByText(/Offline: Änderungen/)).toBeVisible();
  state.online = true;
  state.rpc.mockReturnValue(
    response(null, { code: "42501", message: "revoked" }),
  );
  await act(async () => {
    await clients[0].invalidateQueries({ queryKey: ["assignment-changes"] });
  });
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", { name: "Versionsvergleich" }),
    ).not.toBeInTheDocument(),
  );
});
