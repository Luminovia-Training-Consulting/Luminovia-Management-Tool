import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import {
  filterSettlementJournal,
  settlementJournalCsv,
  settlementJournalTotalsCsv,
} from "./settlement-journal-api";
import {
  settlementJournalPeriodSchema,
  settlementJournalSchema,
} from "./settlement-journal-schema";
import { SettlementJournalButton } from "./settlement-journal";
import "./i18n";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));

const originalId = "10000000-0000-4000-8000-000000000001";
const subject = "10000000-0000-4000-8000-000000000002";
const period = { p_from: "2024-02-29", p_to: "2024-03-01" };
const instant = "2024-03-01T13:00:00Z";
const item = {
  kind: "customer_refund",
  id: "10000000-0000-4000-8000-000000000003",
  reverses_id: originalId,
  subject_id: subject,
  currency: "AUD",
  amount: "10.01",
  reference: '=Fictional "bank", receipt',
  recorded_at: instant,
  effective_on: "2024-03-01",
};
const received = {
  ...item,
  kind: "lecturer_repayment",
  id: originalId,
  reverses_id: null,
  currency: "EUR",
  amount: "12.34",
  effective_on: "2024-02-29",
  reference: "Fictional lecturer receipt",
};
const response = {
  schema_version: "luminovia.settlement-journal/1",
  from: period.p_from,
  to: period.p_to,
  generated_at: instant,
  scopes: ["customer", "lecturer"],
  items: [item, received],
  totals: [
    {
      kind: "customer_refund",
      currency: "AUD",
      recorded: "0.00",
      reversed: "10.01",
      net: "-10.01",
    },
    {
      kind: "lecturer_repayment",
      currency: "EUR",
      recorded: "12.34",
      reversed: "0.00",
      net: "12.34",
    },
  ],
};

afterEach(async () => {
  cleanup();
  vi.resetAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await i18n.changeLanguage("de");
});

it("reconciles exact original-currency totals for a reversal-only period and sanitizes authored CSV cells", () => {
  const parsed = settlementJournalSchema.parse(response);
  const csv = settlementJournalCsv(parsed);
  expect(csv).toContain('"AUD","10.01","\'=Fictional ""bank"", receipt"');
  expect(csv).toContain('"EUR","12.34","Fictional lecturer receipt"');
  expect(csv).toContain(`"${item.id}","${originalId}","${subject}"`);
  expect(csv.split("\r\n")).toHaveLength(3);
  expect(
    settlementJournalSchema.safeParse({
      ...response,
      totals: [response.totals[0], { ...response.totals[1], currency: "AUD" }],
    }).success,
  ).toBe(false);
  expect(
    settlementJournalSchema.safeParse({ ...response, scopes: ["customer"] })
      .success,
  ).toBe(false);
  expect(
    settlementJournalSchema.safeParse({ ...response, items: [item, item] })
      .success,
  ).toBe(false);
  expect(
    settlementJournalSchema.safeParse({
      ...response,
      items: [{ ...item, amount: "not-a-decimal" }, received],
    }).success,
  ).toBe(false);
  expect(
    settlementJournalSchema.safeParse({
      ...response,
      items: [{ ...item, effective_on: "2024-03-02" }, received],
    }).success,
  ).toBe(false);
});

it("filters all journal types and keeps the detail, JSON and exact sums consistent", () => {
  const credit = {
    ...item,
    id: "10000000-0000-4000-8000-000000000004",
    kind: "customer_credit",
    reverses_id: null,
    amount: "25.08",
    reference: "Fictional matched credit",
  };
  const report = settlementJournalSchema.parse({
    ...response,
    items: [...response.items, credit],
    totals: [
      ...response.totals,
      {
        kind: "customer_credit",
        currency: "AUD",
        recorded: "25.08",
        reversed: "0.00",
        net: "25.08",
      },
    ],
  });
  const posted = filterSettlementJournal(report, {
    kind: "",
    currency: "AUD",
    posting: "recorded",
  });
  expect(posted.items).toEqual([credit]);
  expect(posted.totals).toEqual([report.totals[2]]);
  expect(settlementJournalSchema.parse(posted)).toEqual(posted);
  const reversed = filterSettlementJournal(report, {
    kind: "customer_refund",
    currency: "AUD",
    posting: "reversed",
  });
  expect(reversed.items).toEqual([item]);
  expect(settlementJournalSchema.parse(reversed)).toEqual(reversed);
  expect(settlementJournalCsv(reversed)).not.toMatch(
    /Fictional matched credit|lecturer_repayment/,
  );
  const totals = settlementJournalTotalsCsv(reversed);
  expect(totals.split("\r\n")).toHaveLength(2);
  expect(totals).toContain('"customer_refund","AUD","0.00","10.01","-10.01"');
  const empty = filterSettlementJournal(report, {
    kind: "lecturer_repayment",
    currency: "AUD",
    posting: "",
  });
  expect(empty.items).toEqual([]);
  expect(empty.totals).toEqual([]);
  expect(settlementJournalTotalsCsv(empty).split("\r\n")).toHaveLength(1);
});

it("validates leap dates, inclusive bounds and reversed periods", () => {
  expect(settlementJournalPeriodSchema.safeParse(period).success).toBe(true);
  expect(
    settlementJournalPeriodSchema.safeParse({
      p_from: "2023-02-29",
      p_to: "2023-03-01",
    }).success,
  ).toBe(false);
  expect(
    settlementJournalPeriodSchema.safeParse({
      p_from: "2023-01-01",
      p_to: "2024-01-01",
    }).success,
  ).toBe(true);
  expect(
    settlementJournalPeriodSchema.safeParse({
      p_from: "2023-01-01",
      p_to: "2024-01-02",
    }).success,
  ).toBe(false);
  expect(
    settlementJournalPeriodSchema.safeParse({
      p_from: "2024-03-01",
      p_to: "2024-02-29",
    }).success,
  ).toBe(false);
});

it("refreshes authority for export and removes journal values when access is denied", async () => {
  await i18n.changeLanguage("de");
  rpc.mockResolvedValueOnce({ data: response, error: null });
  rpc.mockResolvedValueOnce({ data: null, error: { code: "42501" } });
  const client = new QueryClient();
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <SettlementJournalButton />
    </QueryClientProvider>,
  );
  const button = screen.getByRole("button", { name: "Abrechnungsjournal" });
  await user.click(button);
  const dialog = within(
    screen.getByRole("dialog", { name: "Abrechnungsjournal" }),
  );
  fireEvent.change(dialog.getByLabelText("Von (einschließlich)"), {
    target: { value: period.p_from },
  });
  fireEvent.change(dialog.getByLabelText("Bis (einschließlich)"), {
    target: { value: period.p_to },
  });
  await user.click(dialog.getByRole("button", { name: "Journal anzeigen" }));
  expect(await dialog.findByText("Gegenbuchung −10.01 AUD")).toBeVisible();
  expect(dialog.getByText("12.34 EUR")).toBeVisible();
  expect(rpc).toHaveBeenLastCalledWith("accounting_settlement_journal", period);

  await user.selectOptions(dialog.getByLabelText("Buchungsstatus"), "reversed");
  expect(dialog.getByText(item.reference)).toBeVisible();
  expect(dialog.queryByText(received.reference)).not.toBeInTheDocument();
  expect(rpc).toHaveBeenCalledTimes(1);

  await i18n.changeLanguage("en");
  await user.click(
    dialog.getByRole("button", { name: "Download journal JSON" }),
  );
  expect(
    await dialog.findByText(
      "Your account does not currently have permission to read this journal.",
    ),
  ).toBeVisible();
  expect(dialog.queryByText(item.reference)).not.toBeInTheDocument();
  expect(rpc).toHaveBeenCalledTimes(2);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(button).toHaveFocus();
  client.clear();
});

it("discards a loaded journal on disconnect and waits for a new read on reconnect", async () => {
  const online = vi.spyOn(window.navigator, "onLine", "get");
  online.mockReturnValue(true);
  const user = userEvent.setup();
  const client = new QueryClient();
  rpc.mockImplementation(async (_name, args: typeof period) => ({
    data:
      rpc.mock.calls.length === 1
        ? response
        : {
            ...response,
            from: args.p_from,
            to: args.p_to,
            items: [],
            totals: [],
          },
    error: null,
  }));
  render(
    <QueryClientProvider client={client}>
      <SettlementJournalButton />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Abrechnungsjournal" }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Von (einschließlich)"), {
    target: { value: period.p_from },
  });
  fireEvent.change(dialog.getByLabelText("Bis (einschließlich)"), {
    target: { value: period.p_to },
  });
  await user.click(dialog.getByRole("button", { name: "Journal anzeigen" }));
  expect(await dialog.findByText(item.reference)).toBeVisible();

  act(() => {
    online.mockReturnValue(false);
    window.dispatchEvent(new Event("offline"));
  });
  expect(dialog.queryByText(item.reference)).not.toBeInTheDocument();
  expect(
    dialog.queryByRole("button", { name: "Journal als JSON" }),
  ).not.toBeInTheDocument();
  act(() => {
    online.mockReturnValue(true);
    window.dispatchEvent(new Event("online"));
  });
  expect(dialog.queryByText(item.reference)).not.toBeInTheDocument();
  expect(rpc).toHaveBeenCalledTimes(1);
  await user.click(dialog.getByRole("button", { name: "Journal anzeigen" }));
  expect(
    await dialog.findByText(
      "Für diese Auswahl sind keine Buchungen vorhanden.",
    ),
  ).toBeVisible();
  expect(rpc).toHaveBeenCalledTimes(2);
  client.clear();
});

it("does not download a pending export after the dialog loses connectivity", async () => {
  const online = vi.spyOn(window.navigator, "onLine", "get");
  online.mockReturnValue(true);
  const createObjectURL = vi.fn(() => "blob:fictional-journal");
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = vi.fn();
    },
  );
  const client = new QueryClient();
  const user = userEvent.setup();
  let finish:
    ((value: { data: typeof response; error: null }) => void) | undefined;
  rpc.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(
    <QueryClientProvider client={client}>
      <SettlementJournalButton />
    </QueryClientProvider>,
  );
  await user.click(screen.getByRole("button", { name: "Abrechnungsjournal" }));
  const dialog = within(screen.getByRole("dialog"));
  fireEvent.change(dialog.getByLabelText("Von (einschließlich)"), {
    target: { value: period.p_from },
  });
  fireEvent.change(dialog.getByLabelText("Bis (einschließlich)"), {
    target: { value: period.p_to },
  });
  await user.click(dialog.getByRole("button", { name: "Summen als CSV" }));
  expect(rpc).toHaveBeenCalledWith("accounting_settlement_journal", period);
  act(() => {
    online.mockReturnValue(false);
    window.dispatchEvent(new Event("offline"));
  });
  await act(async () => finish?.({ data: response, error: null }));
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(dialog.queryByText(item.reference)).not.toBeInTheDocument();
  client.clear();
});
