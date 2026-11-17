/** Existing authored profile data survives the move to a years input. */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { OwnProfileDetails } from "./profile-details";
const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});
it("retains legacy experience and hidden labels until years are supplied", async () => {
  await i18n.changeLanguage("de");
  fake.rpc.mockImplementation(async (name: string) => ({
    data:
      name === "own_profile_details"
        ? {
            country: "Germany",
            languages: ["German"],
            labels: ["legacy"],
            teaching_experience: "Teaching since 2012",
          }
        : null,
    error: null,
  }));
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <OwnProfileDetails />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const years = await screen.findByRole("spinbutton", {
    name: "Lehrerfahrung (Jahre)",
  });
  expect(years).toHaveValue(null);
  expect(screen.queryByLabelText(/Eigene Labels/)).not.toBeInTheDocument();
  expect(screen.getByText(/Teaching since 2012/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith("save_profile_details", {
      p_payload: {
        country: "Germany",
        languages: ["German"],
        labels: ["legacy"],
        teaching_experience: "Teaching since 2012",
      },
    }),
  );
  await userEvent.type(years, "8");
  await userEvent.click(screen.getByRole("button", { name: "Speichern" }));
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith("save_profile_details", {
      p_payload: {
        country: "Germany",
        languages: ["German"],
        labels: ["legacy"],
        teaching_experience: "8",
      },
    }),
  );
});
