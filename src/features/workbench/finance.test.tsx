import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { TimesheetsPage } from "./timesheets";
import { ControlCenterPage } from "./control-center";
import { financePeriodSchema } from "./finance-api";

const fake = vi.hoisted(() => ({
  rpc: vi.fn(),
  actor: "a597a651-389e-45f8-acba-92c006d6d261",
  responses: {} as Record<string, unknown>,
  errors: {} as Record<string, unknown>,
  download: vi.fn(async () => undefined),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    ...fake,
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: fake.actor } } },
      }),
    },
  }),
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: fake.actor } } }),
}));
vi.mock("../learning/api", () => ({ downloadPortalDocument: fake.download }));
const teacher = "a597a651-389e-45f8-acba-92c006d6d261",
  manager = "2587ce24-0dbb-4bcf-a78d-4fb766d68746",
  session = "cb3c83b2-c8d5-4755-a562-afc069e49877",
  claim = "6ed51acb-935b-44e2-bd87-fc8eb55d77a7",
  job = "1722aa1e-16be-4ca3-8064-fe81e49752ae";
const item = () => ({
  id: "69da2ce7-1a76-45e0-b46f-fdbe5dde3561",
  session_id: session,
  lecturer_id: teacher,
  claim_id: claim,
  job_id: job,
  title: "Fictional actual teaching",
  lecturer_name: "Fictional Lecturer",
  time_zone: "UTC",
  starts_at: "2020-01-06T08:00:00Z",
  ends_at: "2020-01-06T16:00:00Z",
  break_minutes: 30,
  minutes: 450,
  note: "Fictional actual teaching evidence",
  state: "draft",
  version: 1,
  reviewed_by: null,
  reviewed_at: null,
  review_note: "",
  created_at: "2020-01-07T00:00:00Z",
  updated_at: "2020-01-07T00:00:00Z",
});
const timeData = (items: unknown[] = []) => ({
  time_zone: "UTC",
  can_review: false,
  items,
  sessions: [
    {
      id: session,
      claim_id: claim,
      job_id: job,
      title: "Fictional actual teaching",
      starts_at: "2020-01-06T08:00:00Z",
      ends_at: "2020-01-06T16:00:00Z",
      time_zone: "UTC",
      editable: true,
    },
  ],
});
let client: QueryClient;
beforeEach(async () => {
  await i18n.changeLanguage("de");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  fake.actor = teacher;
  fake.errors = {};
  fake.download.mockClear();
  fake.responses = {
    timesheets: timeData(),
    get_my_permissions: ["jobs.manage", "finance.manage"],
    control_center: {
      from: "2020-01-01",
      until: "2020-02-01",
      time_zone: "UTC",
      unstaffed: [
        {
          id: job,
          title: "Fictional unstaffed course",
          customer_name: "Fictional academy",
          starts_at: "2020-01-06T08:00:00Z",
          open_positions: 1,
        },
      ],
      missing_documents: [],
      cancellations: [],
      overdue_tasks: [],
      requests: [],
      contracts_expiring: [],
      qualifications_expiring: [],
      preparation: [],
      quality: [{ run_id: job, responses: 2, average_rating: null }],
    },
    finance_forecast: {
      from: "2020-01-01",
      until: "2020-02-01",
      time_zone: "UTC",
      pipeline_probability: 0,
      gross_authorized: false,
      payment_basis: "lecturer_invoice_payment_records",
      months: [
        {
          month: "2020-01-01",
          currency: "EUR",
          accepted_lecturer_cost: 300,
          accepted_gross_known: null,
          accepted_margin_known: null,
          unknown_gross_claims: null,
          pipeline_lecturer_cost_known: 0,
          pipeline_gross_known: null,
          lecturer_invoice_payments: 0,
        },
      ],
    },
  };
  fake.rpc.mockReset().mockImplementation((name: string) => {
    const request = {
      abortSignal: () => request,
      then: (done: (value: unknown) => unknown) =>
        Promise.resolve(fake.responses[name]).then((data) =>
          done({ data, error: fake.errors[name] ?? null }),
        ),
    };
    return request;
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});
function mount(view: React.ReactNode) {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{view}</MemoryRouter>
    </QueryClientProvider>,
  );
}

it("records local actual time with exact own-session payload and waits for server confirmation", async () => {
  const user = userEvent.setup();
  mount(<TimesheetsPage />);
  await user.click(
    await screen.findByRole("button", { name: "Unterrichtszeit erfassen" }),
  );
  const dialog = screen.getByRole("dialog");
  await user.selectOptions(
    within(dialog).getByLabelText("Bestätigter Unterrichtstermin"),
    session,
  );
  await user.clear(within(dialog).getByLabelText("Pause in Minuten"));
  await user.type(within(dialog).getByLabelText("Pause in Minuten"), "30");
  let resolve!: (value: unknown) => void;
  fake.responses.save_timesheet = new Promise((done) => {
    resolve = done;
  });
  await user.click(
    within(dialog).getByRole("button", { name: "Zeitnachweis speichern" }),
  );
  expect(
    within(dialog).getByRole("button", { name: "Zeitnachweis speichern" }),
  ).toBeDisabled();
  expect(screen.queryByRole("article")).not.toBeInTheDocument();
  expect(fake.rpc).toHaveBeenCalledWith(
    "save_timesheet",
    expect.objectContaining({
      p_expected_version: 0,
      p_payload: {
        session_id: session,
        starts_at: "2020-01-06T08:00:00.000Z",
        ends_at: "2020-01-06T16:00:00.000Z",
        break_minutes: 30,
        note: "",
      },
    }),
  );
  fake.responses.timesheets = timeData([item()]);
  await act(async () => resolve(item()));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(await screen.findByRole("article")).toHaveTextContent("450 Minuten");
});

it("submitted time becomes read-only only after confirmation and cannot be self-approved", async () => {
  const user = userEvent.setup();
  fake.responses.timesheets = timeData([item()]);
  mount(<TimesheetsPage />);
  await screen.findByRole("article");
  let resolve!: (value: unknown) => void;
  fake.responses.manage_timesheet = new Promise((done) => {
    resolve = done;
  });
  await user.click(
    screen.getByRole("button", { name: "Zur Prüfung einreichen" }),
  );
  expect(
    screen.getByRole("button", { name: "Zur Prüfung einreichen" }),
  ).toBeDisabled();
  expect(
    screen.queryByText("Der neue Stand wurde vom Server bestätigt."),
  ).not.toBeInTheDocument();
  const submitted = { ...item(), state: "submitted", version: 2 };
  fake.responses.timesheets = timeData([submitted]);
  await act(async () => resolve(submitted));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Entwurf bearbeiten" }),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.queryByRole("button", { name: "Zeitnachweis freigeben" }),
  ).not.toBeInTheDocument();
});

it("stale management review keeps its reason, offers refresh and never claims approval", async () => {
  const user = userEvent.setup();
  fake.actor = manager;
  fake.responses.timesheets = { ...timeData(), can_review: true };
  mount(<TimesheetsPage />);
  await screen.findByRole("checkbox", {
    name: "Finanzprüfung für alle Lehrkräfte",
  });
  fake.responses.timesheets = {
    ...timeData([{ ...item(), state: "submitted", version: 2 }]),
    can_review: true,
  };
  await user.click(
    screen.getByRole("checkbox", { name: "Finanzprüfung für alle Lehrkräfte" }),
  );
  const reason = await screen.findByLabelText(
    "Begründung der Prüfung oder Korrektur",
  );
  await user.type(reason, "Fictional review reason retained");
  fake.errors.manage_timesheet = { code: "40001" };
  await user.click(
    screen.getByRole("button", { name: "Zeitnachweis freigeben" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "inzwischen geändert",
  );
  expect(reason).toHaveValue("Fictional review reason retained");
  expect(
    screen.queryByText("Der neue Stand wurde vom Server bestätigt."),
  ).not.toBeInTheDocument();
  expect(fake.rpc).toHaveBeenCalledWith(
    "manage_timesheet",
    expect.objectContaining({
      p_action: "approve",
      p_expected_version: 2,
      p_reason: "Fictional review reason retained",
    }),
  );
});

it("requests protected PDF facts through the owned document endpoint and preserves draft language changes", async () => {
  const user = userEvent.setup();
  fake.responses.timesheets = timeData([item()]);
  mount(<TimesheetsPage />);
  await screen.findByRole("article");
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  await user.click(
    screen.getByRole("button", { name: "Assignment confirmation PDF" }),
  );
  await waitFor(() =>
    expect(fake.download).toHaveBeenCalledWith(
      { kind: "assignment_confirmation", id: claim },
      expect.stringContaining(claim),
      expect.any(AbortSignal),
    ),
  );
  await user.click(
    screen.getByRole("button", { name: "Download earnings statement PDF" }),
  );
  expect(fake.download).toHaveBeenLastCalledWith(
    expect.objectContaining({ kind: "earnings_statement", all: false }),
    expect.any(String),
    expect.any(AbortSignal),
  );
});

it("renders scoped Control Center findings and scenario controls without exposing unauthorized gross values", async () => {
  const user = userEvent.setup();
  mount(<ControlCenterPage />);
  expect(await screen.findByText("Fictional unstaffed course")).toBeVisible();
  expect(
    screen.getByText("Bewertung wird erst ab drei Rückmeldungen angezeigt."),
  ).toBeVisible();
  const table = await screen.findByRole("table");
  expect(
    within(table).queryByRole("columnheader", {
      name: "Bekannter Bruttoumsatz",
    }),
  ).not.toBeInTheDocument();
  await user.clear(
    screen.getByLabelText(
      "Angenommene Wahrscheinlichkeit für offene Angebote und Anfragen (%)",
    ),
  );
  await user.type(
    screen.getByLabelText(
      "Angenommene Wahrscheinlichkeit für offene Angebote und Anfragen (%)",
    ),
    "50",
  );
  await user.click(screen.getByRole("button", { name: "Szenario berechnen" }));
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith(
      "finance_forecast",
      expect.objectContaining({ p_pipeline_probability: 0.5 }),
    ),
  );
  await act(async () => {
    await i18n.changeLanguage("en");
  });
  expect(screen.getByRole("heading", { name: "Control Center" })).toBeVisible();
  expect(
    screen.getByText("Ratings appear only after at least three responses."),
  ).toBeVisible();
});

it("does not fetch any privileged Control Center or forecast data without current management permission", async () => {
  fake.responses.get_my_permissions = [];
  mount(<ControlCenterPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Managementberechtigung",
  );
  expect(fake.rpc).toHaveBeenCalledTimes(1);
  expect(fake.rpc).toHaveBeenCalledWith("get_my_permissions");
});

it("rejects impossible and oversized periods before any new data request", () => {
  for (const period of [
    { from: "2020-02-30", until: "2020-03-02" },
    { from: "2020-01-01", until: "2020-01-01" },
    { from: "2020-01-01", until: "2021-01-01" },
  ])
    expect(financePeriodSchema.safeParse(period).success).toBe(false);
  expect(
    financePeriodSchema.safeParse({ from: "2020-01-01", until: "2020-02-01" })
      .success,
  ).toBe(true);
});
