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
import { CustomerCreditNotes } from "./credit-notes";
import type { AccountingInvoice } from "./schema";
import "./i18n";

const { rpc, upload, download } = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../files/api", () => ({
  saveDownload: download,
  uploadDocument: upload,
}));
vi.mock("../../lib/online", () => ({
  requireOnline: () => undefined,
  useOnline: () => true,
}));

const id = "23456789-1111-4111-8111-012345678900",
  originalDocument = "23456789-1111-4111-8111-012345678901",
  originalVersion = "23456789-1111-4111-8111-012345678902",
  creditDocument = "23456789-1111-4111-8111-012345678903",
  creditVersion = "23456789-1111-4111-8111-012345678904",
  noteId = "23456789-1111-4111-8111-012345678905";

const invoice: AccountingInvoice = {
  id,
  kind: "customer_invoice",
  number: "Fictional INV-24",
  issued_on: "2020-01-01",
  due_on: "2020-02-01",
  currency: "AUD",
  recorded_total: "250.00",
  paid_total: "250.00",
  outstanding_total: "0.00",
  status: "paid",
  document_id: originalDocument,
  document_version_id: originalVersion,
  document_sha256: "a".repeat(64),
  organisation_id: null,
  organisation_name: "Fictional client",
  accepted_charge_total: null,
  difference_reason: null,
  assignments: [],
  payments: [],
  tax: {
    status: "not_recorded",
    net: null,
    gross: null,
    vat_rate: null,
    vat_amount: null,
  },
  credit_note_reference: null,
};

function response(data: unknown, error: unknown = null) {
  return Object.assign(Promise.resolve({ data, error }), {
    abortSignal() {
      return this;
    },
  });
}
const clients: QueryClient[] = [];
function mount() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <CustomerCreditNotes
        actor="finance"
        invoice={invoice}
        onDenied={vi.fn()}
      />
    </QueryClientProvider>,
  );
}
afterEach(async () => {
  cleanup();
  clients.forEach((client) => client.clear());
  clients.length = 0;
  vi.resetAllMocks();
  await i18n.changeLanguage("de");
});

it("reviews and retries the exact credit, then downloads the registered PDF version", async () => {
  await i18n.changeLanguage("de");
  let calls = 0;
  const record = {
    id: noteId,
    invoice_id: id,
    reference: "Fictional CR-24",
    issued_on: "2020-02-01",
    currency: "AUD",
    amount: "13.00",
    reason: "Fictional issued adjustment",
    document_id: creditDocument,
    document_version_id: creditVersion,
    document_sha256: "b".repeat(64),
    created_at: "2026-11-21T10:00:00Z",
  };
  rpc.mockImplementation((name) => {
    if (name === "register_customer_credit_note") {
      calls++;
      return calls === 1
        ? response(null, Error("Uncertain response"))
        : response({ id: noteId });
    }
    return response({ items: calls > 1 ? [record] : [], has_more: false });
  });
  upload.mockResolvedValue({
    original_name: "fictional-credit.pdf",
    status: "clean",
    current_version_id: creditVersion,
  });
  download.mockResolvedValue(undefined);
  mount();
  const user = userEvent.setup();
  expect(
    await screen.findByText(/noch keine Gutschriften erfasst/),
  ).toBeVisible();
  await user.type(screen.getByLabelText("Gutschriftnummer"), record.reference);
  fireEvent.change(screen.getByLabelText("Ausstellungsdatum der Gutschrift"), {
    target: { value: record.issued_on },
  });
  await user.type(
    screen.getByLabelText("Betrag der Gutschrift in AUD"),
    "12,00",
  );
  await user.type(screen.getByLabelText("Grund der Gutschrift"), record.reason);
  await user.upload(
    screen.getByLabelText("Ausgestellter Gutschriftbeleg als PDF"),
    new File(["fictional"], "fictional-credit.pdf", {
      type: "application/pdf",
    }),
  );
  const confirm = screen.getByRole("checkbox");
  const save = screen.getByRole("button", { name: "Gutschriftbeleg erfassen" });
  await waitFor(() => expect(confirm).toBeEnabled());
  await user.click(confirm);
  await user.clear(screen.getByLabelText("Betrag der Gutschrift in AUD"));
  await user.type(
    screen.getByLabelText("Betrag der Gutschrift in AUD"),
    "13,00",
  );
  expect(confirm).not.toBeChecked();
  expect(save).toBeDisabled();
  await user.click(confirm);
  await user.click(save);
  expect(
    await screen.findByText(/Du kannst die Erfassung erneut versuchen/),
  ).toBeVisible();
  await user.click(save);
  await waitFor(() =>
    expect(screen.getByText("Fictional CR-24")).toBeVisible(),
  );
  const writes = rpc.mock.calls.filter(
    ([name]) => name === "register_customer_credit_note",
  );
  expect(writes).toHaveLength(2);
  expect(writes[0]).toEqual(writes[1]);
  expect(writes[0][1]).toEqual(
    expect.objectContaining({
      p_invoice_id: id,
      p_payload: {
        reference: record.reference,
        issued_on: record.issued_on,
        amount: record.amount,
        currency: record.currency,
        reason: record.reason,
        document_version_id: creditVersion,
        issued_and_reviewed: true,
      },
    }),
  );
  await user.click(
    screen.getByRole("button", {
      name: "PDF für Gutschrift Fictional CR-24 herunterladen",
    }),
  );
  expect(download).toHaveBeenCalledWith(
    creditDocument,
    "Fictional CR-24.pdf",
    creditVersion,
  );
});

it("keeps the form and history hidden when current finance access is denied", async () => {
  await i18n.changeLanguage("en");
  rpc.mockImplementation(() => response(null, { code: "42501" }));
  mount();
  expect(
    await screen.findByText("The credit note evidence could not be loaded."),
  ).toBeVisible();
  expect(screen.queryByLabelText("Credit note number")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Record credit note evidence" }),
  ).not.toBeInTheDocument();
});
