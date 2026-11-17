import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import "./platform-i18n";
import "./i18n";
import { CompanyFinanceReviews } from "./company-finance-reviews";
const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => fake }));
afterEach(() => {
  cleanup();
  fake.rpc.mockReset();
});
it("keeps an invoiced rejection visible with a next step and no dismiss action", async () => {
  await i18n.changeLanguage("de");
  fake.rpc.mockResolvedValue({
    data: [
      {
        claim_id: "claim",
        job_id: "job",
        job_title: "Example course",
        lecturer_name: "Alex Example",
        requested_at: "2030-01-01T12:00:00Z",
        invoices: [{ number: "FICT-1", status: "submitted" }],
      },
    ],
    error: null,
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CompanyFinanceReviews actor="manager" zone="Europe/Berlin" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(await screen.findByText("Example course")).toBeInTheDocument();
  expect(screen.getByText(/FICT-1/)).toHaveTextContent("Eingereicht");
  expect(screen.getByText(/Prüfe die Abrechnung/)).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Prüfung abschließen" }),
  ).toBeDisabled();
  client.clear();
});

it("reports an invalid response instead of crashing the finance page", async () => {
  await i18n.changeLanguage("de");
  fake.rpc.mockResolvedValue({ data: { unexpected: true }, error: null });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CompanyFinanceReviews actor="manager" zone="Europe/Berlin" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText(/Die Entscheidung konnte nicht geladen/),
  ).toBeInTheDocument();
  client.clear();
});

it("documents a reviewed rejection and waits for server confirmation", async () => {
  await i18n.changeLanguage("de");
  fake.rpc.mockImplementation(async (name: string) => {
    if (name === "company_invoice_reviews")
      return {
        data: [
          {
            claim_id: "claim",
            job_id: "job",
            job_title: "Example course",
            lecturer_name: "Alex Example",
            requested_at: "2030-01-01T12:00:00Z",
            invoices: [{ number: "FICT-1", status: "rejected" }],
          },
        ],
        error: null,
      };
    if (name === "resolve_company_invoice_rejection")
      return { data: null, error: null };
    return { data: null, error: new Error("Unexpected RPC") };
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CompanyFinanceReviews actor="manager" zone="Europe/Berlin" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Prüfung abschließen" }),
  );
  const confirm = screen.getByRole("button", {
    name: "Prüfung abschließen und Einsatz freigeben",
  });
  expect(confirm).toBeDisabled();
  await user.type(
    screen.getByLabelText(/Dokumentation der Prüfung/),
    "Rechnung wurde geprüft",
  );
  await user.click(confirm);
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith("resolve_company_invoice_rejection", {
      p_claim: "claim",
      p_note: "Rechnung wurde geprüft",
    }),
  );
  client.clear();
});
