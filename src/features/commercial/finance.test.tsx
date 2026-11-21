/**
 * Exercise the invoice/payment UI through real React Hook Form and
 * QueryClient state. Only Auth, RPC responses and document transport are mocked;
 * fictional fees protect retry, currency and confirmation boundaries without
 * claiming database, scanned-byte, banking or native browser acceptance.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { FinancePage } from "./finance";
import { commercialKeys } from "./api";
import type { CommercialAccess, EarningRecord, InvoiceRecord } from "./types";

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  mutate: vi.fn(),
  upload: vi.fn(),
  download: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: state.rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "fictional-lecturer" } } }),
}));
vi.mock("../files/api", () => ({
  uploadDocument: state.upload,
  saveDownload: state.download,
}));
const actor = "fictional-lecturer";
const clients: QueryClient[] = [];
let earnings: EarningRecord[];
let reviewCandidates: Record<string, unknown>[];
let invoices: InvoiceRecord[];
let access: CommercialAccess;

/** Return an actor-owned accepted fee in its original currency. */
function earning(id: string, currency: "EUR" | "AUD" = "EUR"): EarningRecord {
  return {
    claim_id: id,
    job_id: `job-${id}`,
    lecturer_id: actor,
    lecturer_name: "Fictional Rowan",
    title: `Fictional course ${id}`,
    customer_name: "Fictional academy",
    starts_at: "2030-05-06T08:00:00Z",
    ends_at: "2030-05-06T09:00:00Z",
    amount: 120,
    rate_unit: "fixed_total",
    total_amount: 120,
    currency,
    stage: "completed",
    invoice_id: null,
    invoice_eligible_at: "2000-01-01T00:00:00Z",
    invoice_review_required: false,
    invoice_review_reason: null,
    invoice_review_status: null,
    invoice_review_note: null,
  };
}

/** Supply a confirmed invoice with a known remaining payment balance. */
function invoice(): InvoiceRecord {
  return {
    id: "invoice-a",
    user_id: actor,
    user_name: "Fictional Rowan",
    number: "FICTIONAL-001",
    issued_on: "2030-05-06",
    due_on: "2030-06-06",
    currency: "EUR",
    total_amount: 120,
    paid_amount: 20,
    status: "approved",
    document_id: "document-a",
    document_version_id: "document-version-a",
    claim_ids: ["eur-a"],
    created_at: "2030-05-06T08:00:00Z",
    paid_at: null,
    note: null,
    labels: [],
  };
}

beforeEach(async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  await i18n.changeLanguage("de");
  access = {
    can_submit_invoice: true,
    can_manage_finance: true,
    can_manage_contracts: false,
  };
  earnings = [earning("eur-a"), earning("aud-a", "AUD")];
  reviewCandidates = [];
  invoices = [invoice()];
  state.rpc.mockReset();
  state.mutate
    .mockReset()
    .mockResolvedValue({ data: "committed-id", error: null });
  state.upload.mockReset().mockResolvedValue({
    id: "uploaded-document",
    current_version_id: "uploaded-immutable-version",
    owner_id: actor,
    original_name: "fictional.pdf",
    status: "clean",
  });
  state.download.mockReset().mockResolvedValue(undefined);
  state.rpc.mockImplementation((name: string, payload?: unknown) => {
    if (name === "commercial_access")
      return Promise.resolve({ data: access, error: null });
    if (name === "commission_access")
      return Promise.resolve({
        data: {
          can_manage_gross: false,
          can_manage_client_memberships: false,
          can_request: false,
        },
        error: null,
      });
    if (name === "finance_earnings")
      return Promise.resolve({ data: earnings, error: null });
    if (name === "my_invoice_review_candidates")
      return Promise.resolve({ data: reviewCandidates, error: null });
    if (name === "invoice_review_cases")
      return Promise.resolve({ data: [], error: null });
    if (name === "invoice_records")
      return Promise.resolve({ data: invoices, error: null });
    if (name === "invoice_payments" || name === "company_invoice_reviews")
      return Promise.resolve({ data: [], error: null });
    return state.mutate(name, payload);
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.restoreAllMocks();
});

/** Mount real commercial queries with a fresh actor-scoped cache per test. */
function view(initialEntries = ["/"]) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  client.setQueryData(["profile", actor], { time_zone: "Europe/Berlin" });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <FinancePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

it("opens the invoice form from an accepted-course deep link and keeps future claims unselectable", async () => {
  const ready = earning("ready-claim"),
    future = earning("future-claim");
  future.invoice_eligible_at = "2099-05-06T09:00:00Z";
  earnings = [ready, future];
  view(["/finance?claim=ready-claim"]);

  const dialog = await screen.findByRole("dialog", {
    name: "Rechnung einreichen",
  });
  expect(
    await within(dialog).findByRole("checkbox", {
      name: /Fictional course ready-claim/,
    }),
  ).toBeChecked();
  expect(
    within(dialog).getByText(
      /Fictional course future-claim.*Der letzte geplante/,
    ),
  ).toBeVisible();
  expect(
    within(dialog).queryByRole("checkbox", { name: /future-claim/ }),
  ).not.toBeInTheDocument();
});

/** Prepare an owned scanned-PDF fixture and one real claim selection. */
async function invoiceForm() {
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Rechnung einreichen",
    }),
  );
  const dialog = screen.getByRole("dialog", { name: "Rechnung einreichen" });
  const fields = within(dialog);
  await userEvent.type(fields.getByLabelText("Rechnungsnummer"), "FICT-NEW");
  fireEvent.change(fields.getByLabelText("Rechnungsdatum"), {
    target: { value: "2030-05-06" },
  });
  fireEvent.change(fields.getByLabelText("Fällig am"), {
    target: { value: "2030-06-06" },
  });
  await userEvent.click(
    fields.getByRole("checkbox", { name: /Fictional course eur-a/ }),
  );
  await userEvent.upload(
    fields.getByLabelText("Rechnung als PDF"),
    new File(["%PDF-1.7"], "fictional.pdf", { type: "application/pdf" }),
  );
  await fields.findByText(/PDF geprüft und bereit/);
  return {
    dialog,
    fields,
    submit: fields.getByRole("button", {
      name: "Rechnung einreichen",
    }),
  };
}

/** Open the real payment form using an explicit Berlin local timestamp. */
async function paymentForm() {
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Zahlung eintragen",
    }),
  );
  const dialog = screen.getByRole("dialog", { name: "Zahlung eintragen" });
  const fields = within(dialog);
  fireEvent.change(fields.getByLabelText("Zahlungszeitpunkt (Europe/Berlin)"), {
    target: { value: "2030-05-06T10:00" },
  });
  await userEvent.type(
    fields.getByLabelText("Verwendungszweck / Referenz"),
    "Fictional received payment",
  );
  return {
    dialog,
    fields,
    submit: fields.getByRole("button", { name: "Zahlung speichern" }),
  };
}

const calls = (name: string) =>
  state.rpc.mock.calls.filter(([endpoint]) => endpoint === name);

describe("invoice confirmation and safe retry", () => {
  it("retains the scanned version and inputs after an uncertain response, then retries the same operation identity", async () => {
    state.mutate.mockRejectedValueOnce(new TypeError("Network response lost"));
    const client = view();
    const { dialog, fields, submit } = await invoiceForm();
    await userEvent.click(submit);
    expect(await fields.findByRole("alert")).toHaveTextContent(
      "Die Änderung wurde nicht bestätigt",
    );
    expect(dialog).toBeVisible();
    expect(fields.getByLabelText("Rechnungsnummer")).toHaveValue("FICT-NEW");
    expect(
      fields.getByRole("checkbox", { name: /Fictional course eur-a/ }),
    ).toBeChecked();
    expect(fields.getByText(/PDF geprüft und bereit/)).toBeVisible();
    expect(
      client.getQueryData([
        ...commercialKeys.finance(actor),
        "invoices",
        false,
      ]),
    ).toEqual(invoices);
    await userEvent.click(submit);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const attempts = calls("submit_invoice");
    expect(attempts).toHaveLength(2);
    expect(attempts[0][1]).toEqual(attempts[1][1]);
    expect(attempts[0][1]).toMatchObject({
      p_number: "FICT-NEW",
      p_claim_ids: ["eur-a"],
      p_document_version_id: "uploaded-immutable-version",
      p_issued_on: "2030-05-06",
      p_due_on: "2030-06-06",
      p_client_id: expect.any(String),
    });
  });

  it("uses a new operation identity after changing a rejected invoice payload", async () => {
    state.mutate.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "denied" },
    });
    view();
    const { fields, submit } = await invoiceForm();
    await userEvent.click(submit);
    await fields.findByRole("alert");
    await userEvent.clear(fields.getByLabelText("Rechnungsnummer"));
    await userEvent.type(
      fields.getByLabelText("Rechnungsnummer"),
      "FICT-CHANGED",
    );
    await userEvent.click(submit);
    await waitFor(() => expect(calls("submit_invoice")).toHaveLength(2));
    const [first, second] = calls("submit_invoice");
    expect(second[1].p_client_id).not.toBe(first[1].p_client_id);
    expect(second[1].p_number).toBe("FICT-CHANGED");
    expect(fields.getByLabelText("Rechnungsnummer")).toHaveValue(
      "FICT-CHANGED",
    );
    expect(screen.getByRole("dialog")).toBeVisible();
  });

  it("keeps the form pending until a real confirmation and prevents duplicate submissions", async () => {
    let confirm!: (value: { data: string; error: null }) => void;
    state.mutate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          confirm = resolve;
        }),
    );
    view();
    const { dialog, fields, submit } = await invoiceForm();
    await userEvent.click(submit);
    expect(dialog).toBeVisible();
    expect(submit).toBeDisabled();
    expect(fields.getByLabelText("Rechnungsnummer")).toBeDisabled();
    await userEvent.click(submit);
    expect(calls("submit_invoice")).toHaveLength(1);
    await act(async () => confirm({ data: "committed-invoice", error: null }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("does not accept a successful HTTP response without a committed invoice identifier", async () => {
    state.mutate.mockResolvedValue({ data: null, error: null });
    view();
    const { dialog, fields, submit } = await invoiceForm();
    await userEvent.click(submit);
    expect(await fields.findByRole("alert")).toHaveTextContent(
      "Die Änderung wurde nicht bestätigt",
    );
    expect(dialog).toBeVisible();
    expect(fields.getByLabelText("Rechnungsnummer")).toHaveValue("FICT-NEW");
  });

  it("refuses a due date before issue without contacting the invoice endpoint", async () => {
    view();
    const { fields, submit } = await invoiceForm();
    fireEvent.change(fields.getByLabelText("Fällig am"), {
      target: { value: "2030-05-05" },
    });
    await userEvent.click(submit);
    expect(await fields.findByRole("alert")).toHaveTextContent(
      "Das Fälligkeitsdatum darf nicht vor dem Rechnungsdatum liegen",
    );
    expect(calls("submit_invoice")).toHaveLength(0);
  });

  it("refuses a foreign PDF even if an upload response incorrectly supplied it", async () => {
    state.upload.mockResolvedValue({
      id: "foreign-document",
      current_version_id: "foreign-version",
      owner_id: "different-fictional-person",
      original_name: "fictional.pdf",
      status: "clean",
    });
    view();
    const { fields, submit } = await invoiceForm();
    await userEvent.click(submit);
    await fields.findByRole("alert");
    expect(calls("submit_invoice")).toHaveLength(0);
    expect(fields.getByLabelText("Rechnungsnummer")).toHaveValue("FICT-NEW");
  });

  it("keeps currencies separate and only offers the actor's not-yet-invoiced assignments", async () => {
    earnings.push({
      ...earning("foreign"),
      lecturer_id: "another-fictional-person",
    });
    earnings.push({
      ...earning("already-invoiced"),
      invoice_id: "old-invoice",
    });
    view();
    const { fields } = await invoiceForm();
    const eur = fields.getByRole("checkbox", {
      name: /Fictional course eur-a/,
    });
    const aud = fields.getByRole("checkbox", {
      name: /Fictional course aud-a/,
    });
    expect(aud).toBeDisabled();
    expect(
      fields.queryByRole("checkbox", { name: /Fictional course foreign/ }),
    ).not.toBeInTheDocument();
    expect(
      fields.queryByRole("checkbox", {
        name: /Fictional course already-invoiced/,
      }),
    ).not.toBeInTheDocument();
    await userEvent.click(eur);
    expect(aud).toBeEnabled();
    await userEvent.click(aud);
    expect(eur).toBeDisabled();
    expect(aud).toBeChecked();
  });
});

describe("recorded payment confirmation and validation", () => {
  it("preserves input after a lost response and retries the identical payment without confirming it early", async () => {
    state.mutate.mockRejectedValueOnce(new TypeError("Network response lost"));
    view();
    const { dialog, fields, submit } = await paymentForm();
    expect(fields.getByLabelText("Zahlungsbetrag (EUR)")).toHaveValue("100.00");
    await userEvent.click(submit);
    expect(await fields.findByRole("alert")).toHaveTextContent(
      "Die Änderung wurde nicht bestätigt",
    );
    expect(dialog).toBeVisible();
    expect(fields.getByLabelText("Verwendungszweck / Referenz")).toHaveValue(
      "Fictional received payment",
    );
    await userEvent.click(submit);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const attempts = calls("record_invoice_payment");
    expect(attempts).toHaveLength(2);
    expect(attempts[0][1]).toEqual(attempts[1][1]);
    expect(attempts[0][1]).toMatchObject({
      p_invoice_id: "invoice-a",
      p_amount: 100,
      p_paid_at: "2030-05-06T08:00:00.000Z",
      p_reference: "Fictional received payment",
      p_client_id: expect.any(String),
    });
  });

  it("changes the operation identity when a rejected payment amount changes", async () => {
    state.mutate.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "permission_revoked" },
    });
    view();
    const { fields, submit } = await paymentForm();
    await userEvent.click(submit);
    await fields.findByRole("alert");
    fireEvent.change(fields.getByLabelText("Zahlungsbetrag (EUR)"), {
      target: { value: "40.25" },
    });
    await userEvent.click(submit);
    await waitFor(() =>
      expect(calls("record_invoice_payment")).toHaveLength(2),
    );
    const [first, second] = calls("record_invoice_payment");
    expect(second[1].p_client_id).not.toBe(first[1].p_client_id);
    expect(second[1].p_amount).toBe(40.25);
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(fields.getByLabelText("Zahlungsbetrag (EUR)")).toHaveValue("40.25");
  });

  it.each(["0", "100.01"])(
    "rejects payment amount %s outside the outstanding balance before making a request",
    async (amount) => {
      view();
      const { fields, submit } = await paymentForm();
      fireEvent.change(fields.getByLabelText("Zahlungsbetrag (EUR)"), {
        target: { value: amount },
      });
      await userEvent.click(submit);
      expect(await fields.findByRole("alert")).toHaveTextContent(
        "darf den offenen Rechnungsbetrag nicht überschreiten",
      );
      expect(calls("record_invoice_payment")).toHaveLength(0);
      expect(fields.getByLabelText("Zahlungsbetrag (EUR)")).toHaveValue(amount);
    },
  );

  it.each(["2030-03-31T02:30", "2030-10-27T02:30"])(
    "refuses nonexistent or ambiguous Berlin payment time %s",
    async (paidAt) => {
      view();
      const { fields, submit } = await paymentForm();
      fireEvent.change(
        fields.getByLabelText("Zahlungszeitpunkt (Europe/Berlin)"),
        { target: { value: paidAt } },
      );
      await userEvent.click(submit);
      await fields.findByRole("alert");
      expect(calls("record_invoice_payment")).toHaveLength(0);
      expect(
        fields.getByLabelText("Zahlungszeitpunkt (Europe/Berlin)"),
      ).toHaveValue(paidAt);
    },
  );

  it("does not close or confirm a payment when the server supplies no identifier", async () => {
    state.mutate.mockResolvedValue({ data: null, error: null });
    view();
    const { fields, dialog, submit } = await paymentForm();
    await userEvent.click(submit);
    expect(await fields.findByRole("alert")).toHaveTextContent(
      "Die Änderung wurde nicht bestätigt",
    );
    expect(dialog).toBeVisible();
  });
});

describe("finance capability and connection boundaries", () => {
  it("does not offer management actions or request all-lecturer data for an ordinary lecturer", async () => {
    access.can_manage_finance = false;
    view();
    await screen.findByRole("heading", { name: "FICTIONAL-001" });
    expect(
      screen.queryByLabelText("Alle Dozierenden anzeigen"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Zahlung eintragen" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Rechnung prüfen" }),
    ).not.toBeInTheDocument();
    expect(calls("finance_earnings")).toEqual([
      ["finance_earnings", { p_all: false }],
    ]);
    expect(calls("invoice_records")).toEqual([
      ["invoice_records", { p_all: false }],
    ]);
    expect(calls("commission_report")).toHaveLength(0);
  });

  it("hides invoice creation when the current actor cannot submit invoices", async () => {
    access.can_submit_invoice = false;
    view();
    await screen.findByRole("heading", { name: "FICTIONAL-001" });
    expect(
      screen.queryByRole("button", { name: "Rechnung einreichen" }),
    ).not.toBeInTheDocument();
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("preserves an open invoice draft and disables submission after losing connectivity", async () => {
    view();
    const { fields, submit } = await invoiceForm();
    await act(async () => {
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      window.dispatchEvent(new Event("offline"));
    });
    expect(submit).toBeDisabled();
    expect(fields.getByLabelText("Rechnungsnummer")).toHaveValue("FICT-NEW");
    await userEvent.click(submit);
    expect(calls("submit_invoice")).toHaveLength(0);
  });
});
