/** Exercise the actual export dialog and check that stale sessions cannot download private rows. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import AssignmentFinanceExport from "./assignment-finance-export";

const fake = vi.hoisted(() => ({
  rpc: vi.fn(),
  session: vi.fn(),
  save: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({ rpc: fake.rpc, auth: { getSession: fake.session } }),
}));
vi.mock("./assignment-finance-export-file", () => ({
  saveAssignmentFinanceExport: fake.save,
}));

const actor = "fictional-finance";
const report = {
  schema_version: 1,
  time_zone: "Australia/Brisbane",
  from: "2026-06-08",
  through: "2026-06-09",
  generated_at: "2026-06-09T03:00:00Z",
  assignments: [
    {
      claim_id: "00000000-0000-4000-8000-000000000001",
      job_id: "00000000-0000-4000-8000-000000000002",
      title: "Fictional training",
      lecturer_name: "Fictional lecturer",
      customer_name: "Fictional company",
      finance: {
        currency: "AUD",
        claim_status: "confirmed",
        agreed_lecturer: "42.13",
        adjustment_lecturer: "0.00",
        agreed_customer: null,
        contract_margin: null,
        approved_timesheet_minutes: null,
        recorded_teaching_minutes: null,
        delivered_minutes: null,
        lecturer_invoices: [],
        lecturer_invoiced: null,
        lecturer_paid: null,
        lecturer_outstanding: null,
        cancellation_compensation: null,
        customer_invoice_number: null,
        customer_invoice_grouped: null,
        customer_invoiced: null,
        customer_net_invoiced: null,
        customer_received: null,
        customer_retained: null,
        customer_outstanding: null,
        expenses: [],
      },
    },
  ],
};

beforeEach(async () => {
  await i18n.changeLanguage("de");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  fake.rpc.mockReset().mockResolvedValue({ data: report, error: null });
  fake.save.mockReset();
  fake.session.mockReset().mockResolvedValue({
    data: { session: { user: { id: actor } } },
    error: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function openDialog() {
  const user = userEvent.setup();
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <AssignmentFinanceExport actor={actor} zone={report.time_zone} />
    </QueryClientProvider>,
  );
  await user.click(
    screen.getByRole("button", { name: "Auftragsabrechnungen exportieren" }),
  );
  return {
    user,
    dialog: within(
      screen.getByRole("dialog", { name: "Abrechnung exportieren" }),
    ),
  };
}

it("validates the complete period and downloads the live results in the selected format", async () => {
  const { user, dialog } = await openDialog();
  expect(fake.rpc).not.toHaveBeenCalled();
  fireEvent.change(dialog.getByLabelText("Von"), {
    target: { value: report.through },
  });
  fireEvent.change(dialog.getByLabelText("Bis einschließlich"), {
    target: { value: report.from },
  });
  await user.click(dialog.getByRole("button", { name: "CSV herunterladen" }));
  expect(dialog.getByText(/höchstens 93 Tagen/)).toBeVisible();
  expect(fake.rpc).not.toHaveBeenCalled();

  fireEvent.change(dialog.getByLabelText("Von"), {
    target: { value: report.from },
  });
  fireEvent.change(dialog.getByLabelText("Bis einschließlich"), {
    target: { value: report.through },
  });
  await user.click(dialog.getByRole("button", { name: "JSON herunterladen" }));
  expect(await dialog.findByText(/zum Download bereitgestellt/)).toBeVisible();
  expect(fake.rpc).toHaveBeenCalledWith(
    "assignment_finance_export",
    { p_from: report.from, p_through: report.through },
    { get: true },
  );
  expect(fake.save).toHaveBeenCalledWith(report, "json");
});

it("discards the response when the session belongs to another user", async () => {
  const { user, dialog } = await openDialog();
  fake.session.mockResolvedValue({
    data: { session: { user: { id: "different-user" } } },
    error: null,
  });
  await user.click(dialog.getByRole("button", { name: "CSV herunterladen" }));
  expect(
    await dialog.findByText("Die Abrechnung konnte nicht exportiert werden."),
  ).toBeVisible();
  expect(fake.save).not.toHaveBeenCalled();
});

it("keeps the export formats identifiable and announces one pending status", async () => {
  const { user, dialog } = await openDialog();
  let resolveReport!: (value: { data: typeof report; error: null }) => void;
  fake.rpc.mockReturnValue(
    new Promise((resolve) => {
      resolveReport = resolve;
    }),
  );

  const csv = dialog.getByRole("button", { name: "CSV herunterladen" });
  const json = dialog.getByRole("button", { name: "JSON herunterladen" });
  await user.click(csv);
  expect(await dialog.findByRole("status")).toHaveTextContent(
    "Export wird erstellt",
  );
  expect(dialog.getAllByRole("status")).toHaveLength(1);
  expect(csv).toHaveAccessibleName("CSV herunterladen");
  expect(json).toHaveAccessibleName("JSON herunterladen");
  expect(csv).toBeDisabled();
  expect(json).toBeDisabled();

  resolveReport({ data: report, error: null });
  expect(await dialog.findByText(/zum Download bereitgestellt/)).toBeVisible();
});
