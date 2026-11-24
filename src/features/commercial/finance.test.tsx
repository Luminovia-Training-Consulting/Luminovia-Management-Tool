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
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { FinancePage } from "./finance";
import { commercialKeys, earningsQuery } from "./api";
import type { CommercialAccess, EarningRecord, InvoiceRecord } from "./types";
import type { InvoiceException } from "./invoice-exception-schema";
import type { InvoiceSeriesRecord } from "./invoice-series-schema";
import type {
  InvoiceSeriesCorrection,
  InvoiceSeriesCorrectionOptions,
} from "./invoice-series-correction-schema";

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
let exceptionalApprovals: InvoiceException[];
let seriesEntries: InvoiceSeriesRecord[];
let corrections: InvoiceSeriesCorrection[];
let correctionOptions: InvoiceSeriesCorrectionOptions | null;
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
  onlineManager.setOnline(true);
  await i18n.changeLanguage("de");
  access = {
    can_submit_invoice: true,
    can_manage_finance: true,
    can_manage_contracts: false,
  };
  earnings = [earning("eur-a"), earning("aud-a", "AUD")];
  reviewCandidates = [];
  exceptionalApprovals = [];
  seriesEntries = [];
  corrections = [];
  correctionOptions = null;
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
    if (name === "my_invoice_exceptions")
      return Promise.resolve({ data: exceptionalApprovals, error: null });
    if (
      name === "invoice_review_cases" ||
      name === "finance_pending_invoice_exceptions"
    )
      return Promise.resolve({ data: [], error: null });
    if (name === "invoice_records")
      return Promise.resolve({ data: invoices, error: null });
    if (name === "invoice_series_records")
      return Promise.resolve({ data: seriesEntries, error: null });
    if (name === "invoice_series_corrections")
      return Promise.resolve({
        data: {
          entries: corrections,
          options: (payload as { p_all: boolean }).p_all
            ? correctionOptions
            : null,
        },
        error: null,
      });
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
function view(
  initialEntries = ["/"],
  roles = ["lecturer"],
  scope: "personal" | "staff" = roles.includes("management")
    ? "staff"
    : "personal",
) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  client.setQueryData(["profile", actor], { time_zone: "Europe/Berlin" });
  client.setQueryData(["user-roles", actor], roles);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <FinancePage scope={scope} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

it("hides cached monthly earnings when the server no longer permits the read", async () => {
  const client = view();
  const trend = { name: "Monatliche Entwicklung" };
  expect(await screen.findByRole("heading", trend)).toBeVisible();
  const rpc = state.rpc.getMockImplementation()!;
  state.rpc.mockImplementation((name: string, args?: unknown) =>
    name === "finance_earnings"
      ? Promise.resolve({ data: null, error: { code: "42501" } })
      : rpc(name, args),
  );
  await act(() =>
    client.invalidateQueries({
      queryKey: earningsQuery(actor, false).queryKey,
    }),
  );
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.queryByRole("heading", trend)).not.toBeInTheDocument();
});

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

it.each(["management", "client", "participant", "admin", "owner"])(
  "does not open the invoice upload from a direct claim link for %s without a teaching role",
  async (role) => {
    view(["/finance?claim=eur-a"], [role], "personal");
    await screen.findByRole("heading", { name: "Meine Finanzen" });
    expect(screen.queryByRole("heading", { name: "FICTIONAL-001" })).toBeNull();
    expect(calls("finance_earnings")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: "Rechnung einreichen" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(state.upload).not.toHaveBeenCalled();
  },
);

/** Prepare an owned scanned-PDF fixture and one real claim selection. */
async function invoiceForm({ open = true } = {}) {
  if (open) {
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Rechnung einreichen",
      }),
    );
  }
  const dialog = await screen.findByRole("dialog", {
    name: "Rechnung einreichen",
  });
  const fields = within(dialog);
  await userEvent.type(
    await fields.findByLabelText("Rechnungsnummer"),
    "FICT-NEW",
  );
  fireEvent.change(fields.getByLabelText("Rechnungsdatum"), {
    target: { value: "2030-05-06" },
  });
  fireEvent.change(fields.getByLabelText("Fällig am"), {
    target: { value: "2030-06-06" },
  });
  await userEvent.click(
    await fields.findByRole("checkbox", { name: /Fictional course eur-a/ }),
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
  it("submits an approved exception using its scanned PDF and fixed due date", async () => {
    const exception = {
      id: "3bc476a0-e8d7-4b16-9ed2-09068e1fd313",
      claim_id: "18f8117f-e577-4a11-b5ef-4f21a5ff381c",
      title: "Fictional reviewed assignment",
      contract_version: 2,
      amount: 85.2,
      currency: "EUR",
      due_on: "2030-03-02",
      approved_at: "2030-03-01T15:00:00Z",
    } as const;
    exceptionalApprovals = [exception];
    view();
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Ausnahmerechnung einreichen",
      }),
    );
    const dialog = within(
      await screen.findByRole("dialog", {
        name: "Ausnahmerechnung einreichen",
      }),
    );
    const due = dialog.getByLabelText("Fällig am");
    expect(due).toHaveValue(exception.due_on);
    expect(due).toHaveAttribute("readonly");
    expect(dialog.getByText(/^85,20\s€$/)).toBeVisible();
    expect(dialog.queryByRole("checkbox")).not.toBeInTheDocument();
    await userEvent.type(dialog.getByLabelText("Rechnungsnummer"), "FIX-EX-1");
    fireEvent.change(dialog.getByLabelText("Rechnungsdatum"), {
      target: { value: "2030-03-10" },
    });
    const submit = dialog.getByRole("button", { name: "Rechnung einreichen" });
    expect(submit).toBeDisabled();
    await userEvent.upload(
      dialog.getByLabelText("Rechnung als PDF"),
      new File(["%PDF-1.7"], "reviewed.pdf", { type: "application/pdf" }),
    );
    await dialog.findByText(/PDF geprüft und bereit/);
    await userEvent.click(submit);
    await waitFor(() =>
      expect(calls("submit_exception_invoice")).toHaveLength(1),
    );
    expect(calls("submit_invoice")).toHaveLength(0);
    expect(calls("submit_exception_invoice").at(0)?.[1]).toEqual({
      p_number: "FIX-EX-1",
      p_document_version_id: "uploaded-immutable-version",
      p_issued_on: "2030-03-10",
      p_exception_id: exception.id,
      p_client_id: expect.any(String),
    });
  });

  it("submits an eligible assignment from a stale deep link and uses the changed issue date for the default term", async () => {
    view(["/finance?claim=unavailable-assignment"]);
    const { fields, submit } = await invoiceForm({ open: false });
    fireEvent.change(fields.getByLabelText("Rechnungsdatum"), {
      target: { value: "2024-01-30" },
    });
    fireEvent.change(fields.getByLabelText("Fällig am"), {
      target: { value: "" },
    });
    expect(fields.getByLabelText("Fällig am")).toHaveAccessibleDescription(
      /29.02.2024|29\. Feb\. 2024/,
    );
    await userEvent.click(submit);
    await waitFor(() => expect(calls("submit_invoice")).toHaveLength(1));
    expect(calls("submit_invoice")[0][1]).toMatchObject({
      p_issued_on: "2024-01-30",
      p_due_on: "2024-02-29",
      p_claim_ids: ["eur-a"],
    });
  });

  it("opens the invoice form with only the selected completed course preselected", async () => {
    earnings.push({
      ...earning("future"),
      invoice_eligible_at: "2099-01-01T00:00:00Z",
    });
    view();
    const course = await screen.findByRole("row", {
      name: /Fictional course eur-a/,
    });
    const future = screen.getByRole("row", { name: /Fictional course future/ });
    expect(
      within(future).queryByRole("button", {
        name: "Für diesen Kurs abrechnen",
      }),
    ).toBeNull();
    await userEvent.click(
      await within(course).findByRole("button", {
        name: "Für diesen Kurs abrechnen",
      }),
    );
    const dialog = within(
      await screen.findByRole("dialog", { name: "Rechnung einreichen" }),
    );
    expect(
      dialog.getByRole("checkbox", { name: /Fictional course eur-a/ }),
    ).toBeChecked();
    expect(
      dialog.getByRole("checkbox", { name: /Fictional course aud-a/ }),
    ).not.toBeChecked();
  });

  it("requires explicit removal when a manually selected assignment becomes unavailable during editing", async () => {
    earnings.push(earning("eur-b"));
    const client = view();
    const { fields, submit } = await invoiceForm();
    await userEvent.click(
      fields.getByRole("checkbox", { name: /Fictional course eur-b/ }),
    );
    await act(async () => {
      client.setQueryData(
        [...commercialKeys.finance(actor), "earnings", false],
        earnings.filter((row) => row.claim_id !== "eur-a"),
      );
    });
    await waitFor(() => expect(submit).toBeDisabled());
    expect(calls("submit_invoice")).toHaveLength(0);
    await userEvent.click(
      fields.getByRole("button", {
        name: "Nicht verfügbare Aufträge abwählen",
      }),
    );
    await userEvent.click(submit);
    await waitFor(() => expect(calls("submit_invoice")).toHaveLength(1));
    expect(calls("submit_invoice")[0][1].p_claim_ids).toEqual(["eur-b"]);
  });

  it.each([
    [
      "invoice_not_ready: final scheduled session has not ended",
      /letzte geplante Unterrichtstermin/,
    ],
    [
      "invoice_review_required: partial or inconsistent assignment block",
      /muss vor einer Rechnung geprüft werden/,
    ],
  ])(
    "shows the server's specific invoicing decision for %s",
    async (message, expected) => {
      state.mutate.mockResolvedValueOnce({
        data: null,
        error: { code: "22023", message },
      });
      view();
      const { fields, submit } = await invoiceForm();
      await userEvent.click(submit);
      expect(await fields.findByRole("alert")).toHaveTextContent(expected);
      expect(fields.getByText(/PDF geprüft und bereit/)).toBeVisible();
    },
  );

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
    view(["/admin/finance"], ["management"]);
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
    view(["/admin/finance"], ["management"]);
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
      view(["/admin/finance"], ["management"]);
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
      view(["/admin/finance"], ["management"]);
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
    view(["/admin/finance"], ["management"]);
    const { fields, dialog, submit } = await paymentForm();
    await userEvent.click(submit);
    expect(await fields.findByRole("alert")).toHaveTextContent(
      "Die Änderung wurde nicht bestätigt",
    );
    expect(dialog).toBeVisible();
  });
});

describe("finance capability and connection boundaries", () => {
  it("never loads platform earnings or payment controls in a dual-role account's own overview", async () => {
    view(["/finance"], ["management", "lecturer"], "personal");
    await screen.findByRole("heading", { name: "FICTIONAL-001" });
    expect(
      screen.queryByRole("button", { name: "Zahlung eintragen" }),
    ).toBeNull();
    expect(calls("finance_earnings")).toEqual([
      ["finance_earnings", { p_all: false }],
    ]);
    expect(calls("invoice_records")).toEqual([
      ["invoice_records", { p_all: false }],
    ]);
  });

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

const seriesClaim = "531235a0-4151-41c6-9dba-97dea50db84a";
const seriesContract = "9fd92d26-da89-4a09-b851-16cdddabd58d";
const seriesEntryId = "8fb55554-e132-4b96-90ae-b298cb3dfdd5";
const invoiceId = "09210f3f-bcd6-4eea-9f14-0ed6dd823624";

function seriesEntry(): InvoiceSeriesRecord {
  return {
    id: seriesEntryId,
    claim_id: seriesClaim,
    title: "Fictional invoice series",
    currency: "EUR",
    kind: "final",
    contract_version: 2,
    gross_amount: 120,
    credit_amount: 50,
    amount: 70,
    due_on: "2030-06-01",
    approved_at: "2030-05-20T10:00:00Z",
    note: "Fictional reviewed reconciliation.",
    state: "ready",
    invoice_id: null,
    invoice_number: null,
    credits: [
      {
        payment_id: "303a180d-a489-414b-a1dd-bd61d03c4f97",
        invoice_id: "2567b478-32e8-4744-8cca-c7d937d9db93",
        invoice_number: "FICT-INTERIM",
        amount: 50,
        paid_at: "2030-05-06T00:00:00Z",
      },
    ],
  };
}

it("opens the reviewed final amount with its earlier PDF due date and exact interim receipt", async () => {
  await i18n.changeLanguage("en");
  seriesEntries = [seriesEntry()];
  view();
  const open = await screen.findByRole("button", {
    name: "Submit final invoice with credits",
  });
  await userEvent.click(open);
  const dialog = within(
    screen.getByRole("dialog", { name: "Submit final invoice with credits" }),
  );
  expect(dialog.getByText(/^Invoice amount: €70.00$/)).toBeVisible();
  await userEvent.click(dialog.getByText("Credited interim payments: €50.00"));
  expect(dialog.getByText(/FICT-INTERIM/)).toBeVisible();
  expect(dialog.getByLabelText("Due date")).toHaveValue("2030-06-01");
  expect(dialog.getByLabelText("Due date")).toHaveAttribute("readonly");
  await userEvent.type(
    dialog.getByLabelText("Invoice number"),
    "FICTIONAL-FINAL",
  );
  fireEvent.change(dialog.getByLabelText("Issue date"), {
    target: { value: "2030-06-10" },
  });
  const submit = dialog.getByRole("button", { name: "Submit invoice" });
  expect(submit).toBeDisabled();
  await userEvent.upload(
    dialog.getByLabelText("Invoice PDF"),
    new File(["%PDF-1.7"], "fictional.pdf", { type: "application/pdf" }),
  );
  await waitFor(() => expect(submit).toBeEnabled());
  await userEvent.click(submit);
  await waitFor(() =>
    expect(calls("submit_invoice_series_entry")).toHaveLength(1),
  );
  expect(calls("submit_invoice_series_entry")[0][1]).toEqual({
    p_approval_id: seriesEntryId,
    p_number: "FICTIONAL-FINAL",
    p_issued_on: "2030-06-10",
    p_document_version_id: "uploaded-immutable-version",
    p_client_id: expect.any(String),
  });
  expect(calls("submit_invoice")).toHaveLength(0);
});

it("lets finance approve the agreement, gross final amount, and actual deadline", async () => {
  earnings = [earning(seriesClaim)];
  state.mutate.mockImplementation((name) =>
    Promise.resolve({
      data:
        name === "invoice_series_options"
          ? {
              claim_id: seriesClaim,
              currency: "EUR",
              ceiling: 120,
              credited: 50,
              contracts: [
                {
                  id: seriesContract,
                  kind: "master",
                  version: 2,
                  effective_from: "2030-01-01T00:00:00Z",
                },
              ],
              can_interim: false,
              can_final: true,
              approvals: [],
            }
          : seriesEntryId,
      error: null,
    }),
  );
  view(["/admin/finance"], ["management"]);
  await userEvent.click(
    await screen.findByRole("button", { name: "Rechnungsserie öffnen" }),
  );
  const dialog = within(
    screen.getByRole("dialog", { name: "Rechnungsserie öffnen" }),
  );
  const amount = await dialog.findByLabelText("Geprüfter Gesamtanspruch (EUR)");
  await userEvent.type(amount, "40");
  fireEvent.change(dialog.getByLabelText("Vereinbarte Fälligkeit"), {
    target: { value: "2030-05-01" },
  });
  await userEvent.type(
    dialog.getByLabelText(/Prüfnotiz/),
    "Fiktive Belege geprüft und abgeglichen.",
  );
  const approve = dialog.getByRole("button", { name: "Einreichung freigeben" });
  expect(approve).toBeDisabled();
  await userEvent.clear(amount);
  await userEvent.type(amount, "80,25");
  expect(dialog.getByText(/^Rechnungsbetrag: 30,25\s€$/)).toBeVisible();
  await userEvent.click(approve);
  await waitFor(() =>
    expect(calls("approve_invoice_series_entry")).toHaveLength(1),
  );
  expect(calls("approve_invoice_series_entry")[0][1]).toEqual({
    p_claim_id: seriesClaim,
    p_contract_id: seriesContract,
    p_kind: "final",
    p_amount: 80.25,
    p_due_on: "2030-05-01",
    p_note: "Fiktive Belege geprüft und abgeglichen.",
    p_client_id: expect.any(String),
  });
});

it("labels a zero-balance close as fully credited and offers no payment action", async () => {
  invoices = [
    {
      ...invoice(),
      id: invoiceId,
      status: "paid",
      total_amount: 0,
      paid_amount: 0,
    },
  ];
  seriesEntries = [
    {
      ...seriesEntry(),
      invoice_id: invoiceId,
      invoice_number: invoices[0].number,
      state: "paid",
      amount: 0,
      gross_amount: 50,
    },
  ];
  view(["/admin/finance"], ["management"]);
  expect(await screen.findAllByText("Vollständig verrechnet")).not.toHaveLength(
    0,
  );
  expect(
    screen.queryByRole("button", { name: "Zahlung eintragen" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Rechnung prüfen" })).toBeVisible();
});

const correctionId = "265492ea-05d9-4299-b663-6cd9dba13fc0";

function correction(): InvoiceSeriesCorrection {
  return {
    id: correctionId,
    title: "Fictional reviewed overpayment",
    claim_id: seriesClaim,
    currency: "EUR",
    contract_version: 2,
    reviewed_total: 70,
    credited: 90,
    balance: -20,
    repaid: 0,
    outstanding: 20,
    due_on: "2030-06-01",
    proposed_at: "2030-05-20T10:00:00Z",
    responded_at: null,
    withdrawn_at: null,
    withdrawal_note: null,
    dispute_note: null,
    note: "Fictional reviewed correction evidence.",
    state: "proposed",
    credits: seriesEntry().credits,
    repayments: [],
  };
}

function managementCorrection(path = "/finance") {
  earnings = [
    { ...earning(seriesClaim), lecturer_id: "fictional-other-lecturer" },
  ];
  const options = {
    claim_id: seriesClaim,
    currency: "EUR",
    ceiling: 120,
    credited: 90,
    contracts: [
      {
        id: seriesContract,
        kind: "master",
        version: 2,
        effective_from: "2030-01-01T00:00:00Z",
      },
    ],
  } as const;
  correctionOptions = {
    ...options,
    contracts: [...options.contracts],
    can_propose: true,
  };
  state.mutate.mockImplementation((name) =>
    Promise.resolve({
      data:
        name === "invoice_series_options"
          ? {
              ...options,
              can_interim: false,
              can_final: true,
              approvals: [],
            }
          : seriesEntryId,
      error: null,
    }),
  );
  view([path], ["management"]);
}

it("requires the lecturer to confirm the displayed negative balance and reviewed terms", async () => {
  access.can_manage_finance = false;
  await i18n.changeLanguage("en");
  corrections = [correction()];
  view();
  const region = await screen.findByRole("heading", {
    name: "Correction of excess interim payments",
  });
  expect(region).toBeVisible();
  expect(screen.getByText("-€20.00")).toBeVisible();
  const acknowledge = screen.getByRole("button", {
    name: "Acknowledge correction",
  });
  expect(acknowledge).toBeDisabled();
  expect(
    screen.queryByRole("button", { name: "Record received repayment" }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("checkbox", { name: /I reviewed the contract version/ }),
  );
  await userEvent.click(acknowledge);
  await waitFor(() =>
    expect(calls("acknowledge_invoice_series_correction")).toEqual([
      [
        "acknowledge_invoice_series_correction",
        { p_correction_id: correctionId },
      ],
    ]),
  );
});

it("lets the lecturer submit a reasoned dispute without acknowledging", async () => {
  access.can_manage_finance = false;
  corrections = [correction()];
  view();
  await userEvent.click(
    await screen.findByRole("button", { name: "Korrektur beanstanden" }),
  );
  const button = screen.getByRole("button", { name: "Korrektur beanstanden" });
  expect(button).toBeDisabled();
  await userEvent.type(
    screen.getByLabelText(/Begründung/),
    "Fiktiver Einwand zur Leistung.",
  );
  await userEvent.click(button);
  await waitFor(() =>
    expect(calls("dispute_invoice_series_correction")).toEqual([
      [
        "dispute_invoice_series_correction",
        {
          p_correction_id: correctionId,
          p_note: "Fiktiver Einwand zur Leistung.",
        },
      ],
    ]),
  );
  expect(calls("acknowledge_invoice_series_correction")).toHaveLength(0);
});

it("lets a manager propose a reviewed zero entitlement without recording money", async () => {
  managementCorrection();
  await userEvent.click(
    await screen.findByRole("button", { name: "Rechnungsserie öffnen" }),
  );
  const dialog = within(
    screen.getByRole("dialog", { name: "Rechnungsserie öffnen" }),
  );
  await userEvent.click(
    await dialog.findByText("Überzahlung zur Prüfung vorlegen", {
      selector: "summary",
    }),
  );
  const form = within(
    await dialog.findByRole("group", {
      name: "Überzahlung zur Prüfung vorlegen",
    }),
  );
  await userEvent.type(
    form.getByLabelText("Geprüfter Gesamtanspruch (EUR)"),
    "0",
  );
  fireEvent.change(form.getByLabelText("Vereinbarte Fälligkeit"), {
    target: { value: "2030-05-01" },
  });
  await userEvent.type(
    form.getByLabelText(/Prüfnotiz/),
    "Fiktive Vertragsfassung geprüft.",
  );
  expect(form.getByText(/Saldo nach Abschlägen: -90,00/)).toBeVisible();
  await userEvent.click(
    form.getByRole("button", { name: "Korrektur vorlegen" }),
  );
  await waitFor(() =>
    expect(calls("propose_invoice_series_correction")).toHaveLength(1),
  );
  expect(calls("propose_invoice_series_correction")[0][1]).toEqual({
    p_claim_id: seriesClaim,
    p_contract_id: seriesContract,
    p_reviewed_total: 0,
    p_due_on: "2030-05-01",
    p_note: "Fiktive Vertragsfassung geprüft.",
    p_client_id: expect.any(String),
  });
  expect(calls("record_invoice_series_repayment")).toHaveLength(0);
});

it("caps the recorded repayment at the acknowledged outstanding amount", async () => {
  corrections = [
    {
      ...correction(),
      state: "acknowledged",
      responded_at: "2030-05-21T10:00:00Z",
    },
  ];
  managementCorrection();
  await userEvent.click(
    await screen.findByRole("button", { name: "Rechnungsserie öffnen" }),
  );
  const dialog = within(
    screen.getByRole("dialog", { name: "Rechnungsserie öffnen" }),
  );
  const receipt = within(
    await dialog.findByRole("group", { name: "Rückzahlungseingang erfassen" }),
  );
  const amount = receipt.getByLabelText("Geprüfter Betrag (EUR)");
  await userEvent.type(amount, "20,01");
  fireEvent.change(receipt.getByLabelText("Eingangsdatum"), {
    target: { value: "2030-05-01" },
  });
  await userEvent.type(
    receipt.getByLabelText("Referenz des Zahlungseingangs"),
    "FIKT-REF",
  );
  const submit = receipt.getByRole("button", {
    name: "Rückzahlungseingang erfassen",
  });
  expect(submit).toBeDisabled();
  await userEvent.clear(amount);
  await userEvent.type(amount, "10,25");
  await userEvent.click(submit);
  await waitFor(() =>
    expect(calls("record_invoice_series_repayment")).toHaveLength(1),
  );
  expect(calls("record_invoice_series_repayment")[0][1]).toEqual({
    p_correction_id: correctionId,
    p_amount: 10.25,
    p_received_on: "2030-05-01",
    p_reference: "FIKT-REF",
    p_client_id: expect.any(String),
  });
});

it("opens the matching management dialogue from an authorized finance notice", async () => {
  corrections = [
    { ...correction(), state: "disputed", dispute_note: "Fiktiver Einwand." },
  ];
  managementCorrection("/finance?series=" + seriesClaim);
  const dialog = within(
    await screen.findByRole("dialog", { name: "Rechnungsserie öffnen" }),
  );
  expect(await dialog.findByText("Beanstandet")).toBeVisible();
  expect(calls("finance_earnings")).toContainEqual([
    "finance_earnings",
    { p_all: true },
  ]);
  expect(calls("invoice_series_corrections")).toContainEqual([
    "invoice_series_corrections",
    { p_claim_id: seriesClaim, p_all: true },
  ]);
  await userEvent.click(dialog.getByRole("button", { name: "Schließen" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.queryByLabelText("Alle Dozierenden anzeigen")).toBeNull();
  expect(calls("finance_earnings")).not.toContainEqual([
    "finance_earnings",
    { p_all: false },
  ]);
});

it("keeps a management link out of a lecturer's own finance scope", async () => {
  access.can_manage_finance = false;
  view(["/finance?series=" + seriesClaim]);
  await screen.findByRole("heading", { name: "FICTIONAL-001" });
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(calls("finance_earnings")).toEqual([
    ["finance_earnings", { p_all: false }],
  ]);
  expect(calls("invoice_series_corrections")).toEqual([
    ["invoice_series_corrections", { p_claim_id: null, p_all: false }],
  ]);
});

it("focuses the requested own correction after the authorized list loads", async () => {
  access.can_manage_finance = false;
  corrections = [correction()];
  view(["/finance#correction-" + correctionId]);
  const item = await screen.findByText("Fictional reviewed overpayment");
  expect(item.closest("article")).toHaveAttribute(
    "id",
    "correction-" + correctionId,
  );
  expect(item.closest("article")).toHaveFocus();
});
