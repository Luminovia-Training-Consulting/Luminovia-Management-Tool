/** Component-level visibility and online controls. Query fixtures are fictional;
 * actual Auth/MFA/Storage permissions are exercised by separate SQL/API suites. */
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { AccountingPage } from "./accounting";
import { accountingKeys } from "./api";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "teacher" } } }),
}));
/** Seed only the current actor's cache; no mocked business mutation is accepted
 * as evidence that a server-side invoice or export was created. */
function show(gross = false) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData([...accountingKeys.all("teacher"), "access"], {
    can_export_all_lecturers: false,
    can_manage_customer_invoices: gross,
    can_export_customer: gross,
  });
  client.setQueryData([...accountingKeys.all("teacher"), "invoices", "own"], {
    pages: [{ items: [], has_more: false }],
    pageParams: [null],
  });
  client.setQueryData(
    [...accountingKeys.all("teacher"), "customer-claims"],
    [],
  );
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AccountingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  await i18n.changeLanguage("de");
});
it("does not expose customer registration, gross data or management export to ordinary lecturers", () => {
  show();
  expect(
    screen.getByRole("heading", { level: 1, name: "Buchhaltungsexporte" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Externe Kundenrechnung erfassen" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Alle Dozierendenrechnungen" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "JSON-Export erstellen" }),
  ).toBeDisabled();
  expect(rpc).not.toHaveBeenCalled();
});
it("provides English format boundaries and accessible external-document confirmation", async () => {
  await i18n.changeLanguage("en");
  show(true);
  await userEvent.click(
    screen.getByRole("button", {
      name: "Record an external customer invoice",
    }),
  );
  expect(
    screen.getByRole("dialog", { name: "Record an external customer invoice" }),
  ).toBeVisible();
  expect(screen.getByLabelText("Recorded invoice total")).toBeVisible();
  expect(
    screen.getByRole("checkbox", { name: /I checked the number/ }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Record invoice" })).toBeDisabled();
  expect(
    screen.getByText(/XRechnung and ZUGFeRD generation is not yet available/),
  ).toBeInTheDocument();
});
it("disables online writes and new exports when connectivity is lost", async () => {
  show(true);
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  window.dispatchEvent(new Event("offline"));
  await waitFor(() =>
    expect(screen.getByText(/Online-Verbindung erforderlich/)).toBeVisible(),
  );
  expect(
    screen.getByRole("button", { name: "CSV-Export erstellen" }),
  ).toBeDisabled();
  expect(rpc).not.toHaveBeenCalled();
});
it("hides a cached customer projection when current server capabilities remove access", async () => {
  const client = show(true);
  client.setQueryData(
    [...accountingKeys.all("teacher"), "invoices", "customer"],
    {
      pages: [
        {
          items: [
            {
              id: "a6000000-0000-4000-8000-000000000001",
              number: "FICTIONAL-PRIVATE-CUSTOMER",
              organisation_name: "Fictional private customer",
              kind: "customer_invoice",
              recorded_total: "999.99",
              paid_total: "0.00",
              outstanding_total: "999.99",
              currency: "AUD",
              issued_on: "2001-01-01",
              due_on: "2001-02-01",
              status: "registered",
              assignments: [],
              payments: [],
            },
          ],
          has_more: false,
        },
      ],
      pageParams: [null],
    },
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Rechnungsquelle"),
    "customer",
  );
  expect(screen.getByText("FICTIONAL-PRIVATE-CUSTOMER")).toBeVisible();
  await act(async () => {
    client.setQueryData([...accountingKeys.all("teacher"), "access"], {
      can_export_all_lecturers: false,
      can_manage_customer_invoices: false,
      can_export_customer: false,
    });
  });
  await waitFor(() =>
    expect(
      screen.queryByText("FICTIONAL-PRIVATE-CUSTOMER"),
    ).not.toBeInTheDocument(),
  );
  expect(
    screen.getByRole("button", { name: "JSON-Export erstellen" }),
  ).toBeDisabled();
});
