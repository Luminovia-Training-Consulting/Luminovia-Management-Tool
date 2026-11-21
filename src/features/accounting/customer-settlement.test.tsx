import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import { CustomerSettlementPanel } from "./customer-settlement";
import { customerSettlementSchema, type CustomerSettlement } from "./schema";
import "./i18n";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../../lib/online", () => ({
  useOnline: () => true,
  requireOnline: () => undefined,
}));

const invoice = {
  id: "10000000-0000-4000-8000-000000000001",
  number: "Fictional INV-CASE",
};
const receiptId = "10000000-0000-4000-8000-000000000002";
const fixture: CustomerSettlement = {
  invoice_id: invoice.id,
  currency: "AUD",
  can_manage: true,
  original_total: "100.00",
  credit_total: "20.01",
  net_total: "79.99",
  received_total: "100.00",
  refunded_total: "0.00",
  retained_total: "100.00",
  outstanding_total: "0.00",
  refund_due_total: "20.01",
  status: "refund_due",
  credit_applications: [
    {
      id: "10000000-0000-4000-8000-000000000003",
      credit_note_id: "10000000-0000-4000-8000-000000000004",
      reference: "Fictional CR-01",
      amount: "20.01",
      reverses_id: null,
      reason: "Fictional documented correction",
      created_at: "2026-11-20T11:00:00Z",
    },
  ],
  refunds: [],
};
const clients: QueryClient[] = [];
function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <CustomerSettlementPanel
        actor="fixture"
        invoice={invoice}
        onDenied={vi.fn()}
      />
    </QueryClientProvider>,
  );
}
function response(data: unknown, error: unknown = null) {
  return Object.assign(Promise.resolve({ data, error }), {
    abortSignal() {
      return this;
    },
  });
}
afterEach(async () => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.resetAllMocks();
  await i18n.changeLanguage("de");
});

it("posts only a confirmed actual refund within the net surplus and retries the exact request", async () => {
  await i18n.changeLanguage("de");
  let writes = 0;
  rpc.mockImplementation((name) => {
    if (name === "record_customer_invoice_refund") {
      writes++;
      return writes === 1
        ? response(null, Error("Fictional lost response"))
        : response({ id: receiptId });
    }
    if (name === "accounting_customer_credit_notes")
      return response({ items: [], has_more: false });
    return response(
      writes > 1
        ? {
            ...fixture,
            refunded_total: "12.34",
            retained_total: "87.66",
            refund_due_total: "7.67",
            refunds: [
              {
                id: receiptId,
                amount: "12.34",
                reference: "Fictional bank receipt",
                refunded_at: "2020-01-01T12:30:00Z",
                created_at: "2026-11-21T10:00:00Z",
                reverses_id: null,
              },
            ],
          }
        : fixture,
    );
  });
  renderPanel();
  const user = userEvent.setup();
  expect(await screen.findByText("Rückzahlung offen")).toBeVisible();
  await user.selectOptions(screen.getByLabelText("Vorgang"), "recordRefund");
  const save = screen.getByRole("button", {
    name: "Rückzahlung dokumentieren",
  });
  const amount = screen.getByLabelText("Tatsächlich erstatteter Betrag in AUD");
  await user.type(amount, "20,02");
  fireEvent.change(
    screen.getByLabelText("Tatsächlicher Rückzahlungszeitpunkt (UTC)"),
    {
      target: { value: "2020-01-01T12:30" },
    },
  );
  await user.type(
    screen.getByLabelText("Referenz der ausgeführten Rückzahlung"),
    "Fictional bank receipt",
  );
  await user.click(screen.getByRole("checkbox"));
  expect(save).toBeDisabled();
  await user.clear(amount);
  await user.type(amount, "12,34");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  await user.click(screen.getByRole("checkbox"));
  await user.click(save);
  expect(await screen.findByText(/Prüfe den aktuellen Saldo/)).toBeVisible();
  await user.click(save);
  await waitFor(() => expect(screen.getByText("7.67 AUD")).toBeVisible());
  const recorded = rpc.mock.calls.filter(
    ([name]) => name === "record_customer_invoice_refund",
  );
  expect(recorded).toHaveLength(2);
  expect(recorded[0]).toEqual(recorded[1]);
  expect(recorded[0][1]).toMatchObject({
    p_invoice_id: invoice.id,
    p_amount: "12.34",
    p_refunded_at: "2020-01-01T12:30:00.000Z",
    p_reference: "Fictional bank receipt",
  });
});

it("shows authorised customers their balances without staff actions or audit references", async () => {
  await i18n.changeLanguage("en");
  rpc.mockImplementation(() =>
    response({
      ...fixture,
      can_manage: false,
      credit_applications: null,
      refunds: null,
    }),
  );
  renderPanel();
  expect(await screen.findByText("Refund still due")).toBeVisible();
  expect(screen.getAllByText("20.01 AUD", { exact: true })).toHaveLength(2);
  expect(screen.queryByLabelText("Action")).not.toBeInTheDocument();
  expect(screen.queryByText("Fictional CR-01")).not.toBeInTheDocument();
  expect(
    rpc.mock.calls.every(([name]) => name === "accounting_customer_settlement"),
  ).toBe(true);
});

it("rejects inconsistent original-currency totals or exposed customer audit rows", () => {
  expect(customerSettlementSchema.safeParse(fixture).success).toBe(true);
  expect(
    customerSettlementSchema.safeParse({
      ...fixture,
      outstanding_total: "20.01",
    }).success,
  ).toBe(false);
  expect(
    customerSettlementSchema.safeParse({
      ...fixture,
      can_manage: false,
      refunds: null,
    }).success,
  ).toBe(false);
});
