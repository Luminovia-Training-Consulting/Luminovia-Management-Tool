/** Test request/redacted review UI flows using fictional SQL results without touching invoices or payments. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import { InvoiceReviewQueue, MyInvoiceReviewRequests } from "./invoice-review";

const fake = vi.hoisted(() => ({
  candidates: [] as Record<string, unknown>[],
  cases: [] as Record<string, unknown>[],
  rpc: vi.fn(),
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
vi.mock("../../lib/online", () => ({
  requireOnline: () => undefined,
  useOnline: () => true,
}));

let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});
beforeEach(async () => {
  await i18n.changeLanguage("de");
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  fake.candidates = [
    {
      claim_id: "fictional-claim",
      job_id: "fictional-job",
      title: "Fictional cancelled assignment",
      claim_status: "cancelled",
      reason: "cancelled",
      review_status: null,
      requested_at: null,
      resolution_note: null,
      scheduled_end: "2026-11-20T11:00:00Z",
    },
  ];
  fake.cases = [
    {
      id: "fictional-review",
      claim_id: "fictional-claim",
      job_id: "fictional-job",
      title: "Fictional partial assignment",
      lecturer_id: "fictional-lecturer",
      lecturer_name: "Fictional lecturer",
      reason: "partial_delivery",
      requested_at: "2026-11-20T10:00:00Z",
      scheduled_end: "2026-11-20T11:00:00Z",
      accepted_total: 200,
      currency: "EUR",
    },
  ];
  fake.rpc.mockImplementation(
    async (name: string, args?: Record<string, unknown>) => {
      if (name === "my_invoice_review_candidates")
        return { data: structuredClone(fake.candidates), error: null };
      if (name === "request_invoice_review") {
        fake.candidates[0].review_status = "pending";
        fake.candidates[0].requested_at = "2026-11-20T10:05:00Z";
        return { data: "fictional-review-id", error: null };
      }
      if (name === "invoice_review_cases")
        return { data: structuredClone(fake.cases), error: null };
      if (name === "resolve_invoice_review_request") {
        fake.cases = [];
        fake.candidates[0].review_status = "resolved";
        fake.candidates[0].resolution_note = args?.p_note;
        return { data: null, error: null };
      }
      return { data: null, error: { code: "unexpected_rpc" } };
    },
  );
});

it("requests a review idempotently without creating an invoice or payment", async () => {
  render(
    <QueryClientProvider client={client}>
      <MyInvoiceReviewRequests
        actor="fictional-lecturer"
        zone="Europe/Berlin"
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Prüfung anfordern" }),
  );
  expect(await screen.findByText("Prüfung angefordert")).toBeVisible();
  expect(fake.rpc).toHaveBeenCalledWith(
    "request_invoice_review",
    expect.objectContaining({
      p_claim_id: "fictional-claim",
      p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    }),
  );
  expect(fake.rpc).not.toHaveBeenCalledWith(
    "submit_invoice",
    expect.anything(),
  );
  expect(fake.rpc).not.toHaveBeenCalledWith(
    "record_invoice_payment",
    expect.anything(),
  );
});

it("requires a reasoned finance note and resolves only the review request", async () => {
  render(
    <QueryClientProvider client={client}>
      <InvoiceReviewQueue actor="fictional-manager" />
    </QueryClientProvider>,
  );
  const note = await screen.findByLabelText(
    "Prüfnotiz (mindestens 10 Zeichen)",
  );
  const button = screen.getByRole("button", { name: "Prüfung dokumentieren" });
  expect(button).toBeDisabled();
  const user = userEvent.setup();
  await user.type(note, "Reviewed");
  expect(button).toBeDisabled();
  await user.type(note, " and recorded");
  expect(button).toBeEnabled();
  await user.click(button);
  await waitFor(() =>
    expect(
      screen.queryByRole("heading", {
        name: "Prüfung stornierter und teilweise freigegebener Buchungen",
      }),
    ).not.toBeInTheDocument(),
  );
  expect(fake.rpc).toHaveBeenCalledWith("resolve_invoice_review_request", {
    p_request_id: "fictional-review",
    p_note: "Reviewed and recorded",
  });
  expect(fake.rpc).not.toHaveBeenCalledWith(
    "submit_invoice",
    expect.anything(),
  );
  expect(fake.rpc).not.toHaveBeenCalledWith(
    "record_invoice_payment",
    expect.anything(),
  );
});
