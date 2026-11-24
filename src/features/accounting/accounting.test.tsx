/** Component-level visibility and online controls. Query fixtures are fictional;
 * actual Auth/Storage permissions are exercised by separate SQL/API suites. */
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  onlineManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { AccountingPage } from "./accounting";
import { accountingKeys } from "./api";
const { rpc, upload, auth } = vi.hoisted(() => ({
  rpc: vi.fn(),
  upload: vi.fn(),
  auth: {
    session: { user: { id: "teacher" }, access_token: "fictional-initial" },
  },
}));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => auth,
}));
vi.mock("../files/api", () => ({
  uploadDocument: upload,
  saveDownload: vi.fn(),
}));
/** Seed only the current actor's cache; no mocked business mutation is accepted
 * as evidence that a server-side invoice or export was created. */
function show(gross = false, companyView = false, personalView = false) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: Infinity },
      mutations: { retry: false },
    },
  });
  client.setQueryData(["commercial-access", "teacher"], {
    can_submit_invoice: true,
  });
  client.setQueryData([...accountingKeys.all("teacher"), "access"], {
    can_export_all_lecturers: false,
    can_manage_customer_invoices: gross,
    can_export_customer: gross || companyView,
  });
  client.setQueryData([...accountingKeys.all("teacher"), "invoices", "own"], {
    pages: [{ items: [], has_more: false }],
    pageParams: [null],
  });
  client.setQueryData(
    [...accountingKeys.all("teacher"), "invoices", "customer"],
    {
      pages: [{ items: [], has_more: false }],
      pageParams: [null],
    },
  );
  client.setQueryData(
    [...accountingKeys.all("teacher"), "customer-claims"],
    [],
  );
  const page = () => (
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AccountingPage
          scope={
            personalView
              ? "personal"
              : companyView
                ? "company"
                : gross
                  ? "staff"
                  : "personal"
          }
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  const view = render(page());
  return { client, rerender: () => view.rerender(page()) };
}
afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  auth.session.access_token = "fictional-initial";
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  onlineManager.setOnline(true);
  await i18n.changeLanguage("de");
});
it("starts company accounts on company invoices without unlocking invoice registration", () => {
  show(false, true);
  expect(document.getElementById("accounting-source")).toHaveValue("customer");
  expect(
    screen.queryByRole("button", {
      name: "Externe Rechnung an ein Unternehmen erfassen",
    }),
  ).not.toBeInTheDocument();
});

it("does not expose customer registration, gross data or management export to ordinary lecturers", () => {
  show();
  expect(
    screen.getByRole("heading", { level: 1, name: "Buchhaltungsexporte" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", {
      name: "Externe Rechnung an ein Unternehmen erfassen",
    }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("option", { name: "Alle Dozierendenrechnungen" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "JSON-Export erstellen" }),
  ).toBeDisabled();
  expect(rpc).not.toHaveBeenCalled();
});
it("does not expose platform data or actions in the personal export tab of a dual-role account", () => {
  show(true, false, true);
  expect(screen.queryByLabelText("Rechnungsquelle")).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Kursrechnung einreichen" }),
  ).toHaveAttribute("href", "/finance?invoice=new");
  expect(
    screen.queryByRole("option", { name: "Unternehmensrechnungen" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Abrechnungsjournal" }),
  ).toBeNull();
  expect(
    screen.queryByRole("button", {
      name: "Externe Rechnung an ein Unternehmen erfassen",
    }),
  ).toBeNull();
});

it("distinguishes a fully credited closing invoice from a payment", async () => {
  const { client } = show();
  const closingInvoice = {
    id: "b749e404-89bf-4c7d-9a89-5dfdf029b0b8",
    kind: "lecturer_invoice",
    number: "FICTIONAL-CLOSING",
    issued_on: "2026-11-30",
    due_on: "2026-11-22",
    currency: "EUR",
    recorded_total: "0.00",
    paid_total: "0.00",
    outstanding_total: "0.00",
    status: "paid",
    assignments: [],
    payments: [],
  };
  client.setQueryData([...accountingKeys.all("teacher"), "invoices", "own"], {
    pages: [{ items: [closingInvoice], has_more: false }],
    pageParams: [null],
  });
  expect(
    await screen.findByText("Vollständig verrechnet", { exact: true }),
  ).toBeVisible();
  expect(
    screen.queryByText("Bezahlt", { exact: true }),
  ).not.toBeInTheDocument();
});

it("offers CSV and JSON exports and requires accessible external-document confirmation", async () => {
  await i18n.changeLanguage("en");
  show(true);
  expect(
    screen.getByRole("button", { name: "Create JSON export" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Create CSV export" }),
  ).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Settlement journal" }),
  ).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", {
      name: "Record an external invoice to a company",
    }),
  );
  expect(
    screen.getByRole("dialog", {
      name: "Record an external invoice to a company",
    }),
  ).toBeVisible();
  expect(screen.getByLabelText("Recorded invoice total")).toBeVisible();
  expect(
    screen.getByRole("checkbox", { name: /I checked the number/ }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Record invoice" })).toBeDisabled();
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
  const { client } = show(true);
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

const reviewClaims = ["01", "02"].map((suffix, index) => ({
  claim_id: `a6000000-0000-4000-8000-0000000000${suffix}`,
  job_id: `a6000000-0000-4000-8000-0000000001${suffix}`,
  title: `Fictional reviewed agreement ${index === 0 ? "A" : "B"}`,
  organisation_id: "a6000000-0000-4000-8000-000000000003",
  organisation_name: "Fictional reviewed customer",
  currency: "AUD",
  accepted_charge: "200.03",
}));

/** Complete an actual rendered declaration using fictional uploaded metadata.
 * These mocks prove local consent binding, never scanner or database acceptance. */
async function reviewedForm() {
  await i18n.changeLanguage("en");
  const view = show(true),
    user = userEvent.setup();
  view.client.setQueryData(
    [...accountingKeys.all("teacher"), "customer-claims"],
    reviewClaims,
  );
  upload.mockImplementation(async (file: File) => ({
    id: "a6000000-0000-4000-8000-000000000004",
    current_version_id: file.name.includes("replacement")
      ? "a6000000-0000-4000-8000-000000000006"
      : "a6000000-0000-4000-8000-000000000005",
    original_name: file.name,
    status: "clean",
  }));
  // A simulated lost response retains the draft and permits inspecting exact
  // unchanged retry keys; this is not a mocked successful invoice mutation.
  rpc.mockResolvedValue({
    data: null,
    error: { code: "08006", message: "Fictional response lost" },
  });
  await user.click(
    screen.getByRole("button", {
      name: "Record an external invoice to a company",
    }),
  );
  await user.click(
    screen.getByRole("checkbox", { name: /Fictional reviewed agreement A/ }),
  );
  await user.type(
    screen.getByLabelText("Invoice number"),
    "FICTIONAL-REVIEW-001",
  );
  await user.type(screen.getByLabelText("Invoice date"), "2001-01-01");
  await user.type(screen.getByLabelText("Due on"), "2001-02-01");
  await user.type(screen.getByLabelText("Recorded invoice total"), "200.03");
  await user.type(
    screen.getByLabelText(i18n.t("difference", { ns: "accounting" })),
    "Fictional documented difference when required",
  );
  const fileInput = screen.getByLabelText(i18n.t("pdf", { ns: "accounting" }));
  expect(fileInput).toBeEnabled();
  fireEvent.change(fileInput, {
    target: {
      files: [
        new File(["fictional PDF fixture"], "Fictional-original.pdf", {
          type: "application/pdf",
        }),
      ],
    },
  });
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  await screen.findByText("Fictional-original.pdf");
  const declaration = screen.getByRole("checkbox", {
    name: /I checked the number/,
  });
  await user.click(declaration);
  expect(declaration).toBeChecked();
  expect(screen.getByRole("button", { name: "Record invoice" })).toBeEnabled();
  return { ...view, user, declaration, fileInput };
}

it.each([
  "PDF",
  "number",
  "invoice date",
  "due date",
  "total",
  "agreement",
] as const)(
  "requires a new declaration after changing the reviewed %s",
  async (changed) => {
    const { user, declaration, fileInput } = await reviewedForm();
    if (changed === "PDF") {
      fireEvent.change(fileInput, {
        target: {
          files: [
            new File(["different fictional PDF"], "Fictional-replacement.pdf", {
              type: "application/pdf",
            }),
          ],
        },
      });
      await screen.findByText("Fictional-replacement.pdf");
    } else if (changed === "agreement")
      await user.click(
        screen.getByRole("checkbox", {
          name: /Fictional reviewed agreement B/,
        }),
      );
    else {
      const [label, value] = {
        number: ["Invoice number", "FICTIONAL-REVIEW-002"],
        "invoice date": ["Invoice date", "2001-01-02"],
        "due date": ["Due on", "2001-02-02"],
        total: ["Recorded invoice total", "200.04"],
      }[changed];
      const field = screen.getByLabelText(label);
      await user.clear(field);
      await user.type(field, value);
    }
    expect(declaration).not.toBeChecked();
    const save = screen.getByRole("button", { name: "Record invoice" });
    expect(save).toBeDisabled();
    // The mutation must enforce the binding even if a submit event bypasses
    // the disabled button; button state alone is insufficient evidence.
    fireEvent.submit(save.closest("form")!);
    await screen.findByText(i18n.t("invalid", { ns: "accounting" }));
    expect(rpc).not.toHaveBeenCalled();
    await user.click(declaration);
    expect(save).toBeEnabled();
    await user.click(save);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith(
        "register_customer_invoice",
        expect.any(Object),
      ),
    );
  },
);

it("removes a reviewed declaration when its selected agreement is no longer available", async () => {
  const { client, declaration } = await reviewedForm();
  await act(async () => {
    client.setQueryData(
      [...accountingKeys.all("teacher"), "customer-claims"],
      reviewClaims.slice(1),
    );
  });
  await waitFor(() => expect(declaration).not.toBeChecked());
  expect(screen.getByRole("button", { name: "Record invoice" })).toBeDisabled();
});

it("preserves reviewed drafts and the same request key across language/token refresh and unchanged response-loss retries", async () => {
  const { user, declaration, rerender } = await reviewedForm();
  await user.click(screen.getByRole("button", { name: "Record invoice" }));
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
  const original = rpc.mock.calls[0][1];
  await act(async () => {
    auth.session.access_token = "fictional-refreshed";
    rerender();
    await i18n.changeLanguage("de");
  });
  expect(declaration).toBeChecked();
  expect(screen.getByLabelText("Rechnungsnummer")).toHaveValue(
    "FICTIONAL-REVIEW-001",
  );
  expect(screen.getByText("Fictional-original.pdf")).toBeVisible();
  const retry = screen.getByRole("button", { name: "Rechnung dokumentieren" });
  await waitFor(() => expect(retry).toBeEnabled());
  await user.click(retry);
  await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
  expect(rpc.mock.calls[1][1]).toEqual(original);
});
