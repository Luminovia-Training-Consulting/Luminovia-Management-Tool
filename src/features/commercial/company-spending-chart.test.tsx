import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { DateTime } from "luxon";
import { CompanySpendingChart } from "./company-spending-chart";
import type { CompanyMonthlySpending } from "./commission-api";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      key === "acceptedAssignmentsCount" ? `${options?.count} accepted` : key,
    i18n: { language: "en" },
  }),
}));
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
