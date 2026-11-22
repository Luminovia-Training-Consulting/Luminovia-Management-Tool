import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DateTime } from "luxon";
import { CompanySpendingChart } from "./company-spending-chart";
import type { CompanyMonthlySpending } from "./commission-api";

const exportFixture = vi.hoisted(() => ({
  read: vi.fn(),
  download: vi.fn(),
}));
vi.mock("./commission-api", () => ({
  readCompanyMonthlySpending: exportFixture.read,
}));
vi.mock("../../lib/csv", () => ({ downloadCsv: exportFixture.download }));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "actor" } } },
        error: null,
      }),
    },
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      key === "acceptedAssignmentsCount" ? `${options?.count} accepted` : key,
    i18n: { language: "en" },
  }),
}));
beforeEach(() => {
  exportFixture.read.mockReset();
  exportFixture.download.mockReset();
});
afterEach(cleanup);

it("renders twelve company-local months and separate original currencies", () => {
  const month = DateTime.now()
    .setZone("Europe/Berlin")
    .startOf("month")
    .toISODate()!;
  const rows: CompanyMonthlySpending[] = [
    {
      organisation_id: "own",
      organisation_name: "Fictional Academy",
      time_zone: "Europe/Berlin",
      currency: "EUR",
      month_start: month,
      gross_amount: 125.25,
      claim_count: 2,
    },
    {
      organisation_id: "own",
      organisation_name: "Fictional Academy",
      time_zone: "Europe/Berlin",
      currency: "AUD",
      month_start: month,
      gross_amount: 30,
      claim_count: 1,
    },
  ];
  render(<CompanySpendingChart rows={rows} />);
  expect(
    screen.getByRole("heading", { name: "monthlyAcceptedSpending" }),
  ).toBeInTheDocument();
  expect(screen.getAllByRole("progressbar")).toHaveLength(24);
  expect(screen.getByText("2 accepted")).toBeInTheDocument();
  expect(screen.getByText("1 accepted")).toBeInTheDocument();
  expect(screen.getByText("Fictional Academy · EUR")).toBeInTheDocument();
  expect(screen.getByText("Fictional Academy · AUD")).toBeInTheDocument();
});

it("shows a truthful empty state without inventing a zero-cost assignment", () => {
  render(<CompanySpendingChart rows={[]} />);
  expect(screen.getByText("noAcceptedSpending")).toBeInTheDocument();
  expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
});

it("exports fresh accepted fees with only scoped period and currency fields", async () => {
  const user = userEvent.setup();
  const current = DateTime.now().setZone("Europe/Berlin").startOf("month");
  const event: CompanyMonthlySpending = {
    organisation_id: "own",
    organisation_name: "Fictional Academy",
    time_zone: "Europe/Berlin",
    currency: "EUR",
    month_start: current.toISODate()!,
    gross_amount: 125.25,
    claim_count: 2,
  };
  exportFixture.read.mockResolvedValue([
    event,
    { ...event, month_start: current.minus({ months: 12 }).toISODate()! },
  ]);
  render(
    <CompanySpendingChart
      rows={[]}
      exportScope={{ actor: "actor", organisation: "own", boundary: null }}
    />,
  );
  await user.click(
    screen.getByRole("button", { name: "companySpendingExport" }),
  );
  await waitFor(() => expect(exportFixture.download).toHaveBeenCalledTimes(1));
  expect(exportFixture.read).toHaveBeenCalledWith("own");
  expect(exportFixture.download).toHaveBeenCalledWith(
    "company-accepted-fees.csv",
    [
      [
        "companySpendingExportOrganisation",
        "companySpendingExportMonth",
        "companySpendingExportCurrency",
        "confirmedSpend",
      ],
      ["Fictional Academy", current.toFormat("yyyy-MM"), "EUR", 125.25],
    ],
  );
});

it("discards a completed download after the selected company changes", async () => {
  const user = userEvent.setup();
  let complete!: (rows: CompanyMonthlySpending[]) => void;
  exportFixture.read.mockImplementation(
    () =>
      new Promise<CompanyMonthlySpending[]>((resolve) => {
        complete = resolve;
      }),
  );
  const view = render(
    <CompanySpendingChart
      rows={[]}
      exportScope={{ actor: "actor", organisation: "previous", boundary: null }}
    />,
  );
  await user.click(
    screen.getByRole("button", { name: "companySpendingExport" }),
  );
  expect(exportFixture.read).toHaveBeenCalledWith("previous");
  view.rerender(
    <CompanySpendingChart
      rows={[]}
      exportScope={{ actor: "actor", organisation: "current", boundary: null }}
    />,
  );
  await act(async () => {
    complete([]);
  });
  expect(exportFixture.download).not.toHaveBeenCalled();
  expect(screen.queryAllByText("noAcceptedSpending")).toHaveLength(1);
});
