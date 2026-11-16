/** A prospective role quote is displayed only when the server actually supplied it. */
import { afterEach, it, expect } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { JobCard } from "./card";
import type { Job } from "../../lib/types";
import i18n from "../../lib/i18n";
afterEach(cleanup);
const job: Job = {
  id: "fictional-job",
  title: "Fictional restricted offer",
  description: "",
  customer_name: "Fictional academy",
  delivery_type: "online",
  location: "",
  time_zone: "Europe/Berlin",
  status: "published",
  amount: null,
  total_amount: null,
  currency: "EUR",
  rate_unit: "fixed_total",
  terms: "Fictional",
  terms_version: 3,
  requires_contract: false,
  claim_deadline: null,
  job_sessions: [],
  job_requirements: [],
};
it("renders restricted text in DE/EN without inventing a numeric compensation", async () => {
  await i18n.changeLanguage("de");
  const view = render(
    <MemoryRouter>
      <JobCard job={job} />
    </MemoryRouter>,
  );
  expect(screen.getByText("Honorar geschützt")).toBeVisible();
  expect(screen.queryByText(/0,00/)).not.toBeInTheDocument();
  await i18n.changeLanguage("en");
  view.rerender(
    <MemoryRouter>
      <JobCard job={job} />
    </MemoryRouter>,
  );
  expect(screen.getByText("Compensation restricted")).toBeVisible();
});
it("retains an explicitly supplied real zero quote and the current tier's positive quote", async () => {
  await i18n.changeLanguage("de");
  const view = render(
    <MemoryRouter>
      <JobCard job={{ ...job, amount: 0, total_amount: 0 }} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/0,00/)).toBeVisible();
  view.rerender(
    <MemoryRouter>
      <JobCard
        job={{ ...job, amount: 500, total_amount: 500, terms_version: 32 }}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText(/500,00/)).toBeVisible();
  expect(screen.queryByText("Honorar geschützt")).not.toBeInTheDocument();
});
