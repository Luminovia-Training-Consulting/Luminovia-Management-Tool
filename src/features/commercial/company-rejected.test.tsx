import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import "./platform-i18n";
import { CompanyRejectedLecturers } from "./company-rejected";

const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => fake }));
afterEach(() => {
  cleanup();
  fake.rpc.mockReset();
});
it("requires explicit confirmation before lifting a company rejection", async () => {
  await i18n.changeLanguage("de");
  fake.rpc.mockImplementation(async (name: string) =>
    name === "company_rejected_lecturers"
      ? {
          data: [{ claim_id: "claim-a", lecturer_name: "Alex Example" }],
          error: null,
        }
      : { data: null, error: null },
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={client}>
      <CompanyRejectedLecturers actor="company" job="job" />
    </QueryClientProvider>,
  );
  await user.click(
    await screen.findByRole("button", { name: "Ablehnung aufheben" }),
  );
  expect(fake.rpc).not.toHaveBeenCalledWith(
    "release_company_rejection",
    expect.anything(),
  );
  expect(screen.getByText(/nicht automatisch zugewiesen/)).toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Ablehnung verbindlich aufheben" }),
  );
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith("release_company_rejection", {
      p_claim: "claim-a",
    }),
  );
  client.clear();
});
it("reports a malformed server response without crashing", async () => {
  await i18n.changeLanguage("en");
  fake.rpc.mockResolvedValue({ data: {}, error: null });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <CompanyRejectedLecturers actor="company" job="job" />
    </QueryClientProvider>,
  );
  expect(
    await screen.findByText(
      "The list of rejected lecturers could not be loaded.",
    ),
  ).toBeInTheDocument();
  client.clear();
});
