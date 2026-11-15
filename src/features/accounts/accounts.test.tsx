import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountsPage } from "./accounts";
const fake = vi.hoisted(() => ({
  capabilities: [] as string[],
  invoke: vi.fn(),
  rpc: vi.fn(),
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "own-actor" } } }),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({ rpc: fake.rpc, functions: { invoke: fake.invoke } }),
}));
function page() {
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false },
              mutations: { retry: false },
            },
          })
        }
      >
        <AccountsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  fake.capabilities = [];
  fake.invoke.mockReset();
  fake.rpc.mockReset();
  fake.rpc.mockImplementation(async () => ({
    data: fake.capabilities,
    error: null,
  }));
  fake.invoke.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return {
      data: {
        items: [
          {
            id: "teacher-id",
            display_name: "Anna",
            email: "anna@example.invalid",
            active: true,
            locale: "de",
            time_zone: "Europe/Berlin",
            roles: ["lecturer"],
          },
        ],
        total: 1,
        limit: 25,
        offset: 0,
      },
      error: null,
    };
  });
});
describe("Account administration", () => {
  it("does not request the private account directory before administrative permission is available", async () => {
    page();
    await screen.findByText(/Für die Kontoverwaltung sind Verwaltungsrechte/);
    expect(fake.invoke).not.toHaveBeenCalled();
    expect(screen.queryByText("anna@example.invalid")).not.toBeInTheDocument();
  });
  it("keeps search focus and typed input while successive real-query promises are pending", async () => {
    fake.capabilities = ["users.manage"];
    page();
    const input = await screen.findByRole("searchbox", {
      name: "Konten suchen",
    });
    await userEvent.type(input, "Anna");
    expect(input).toHaveFocus();
    expect(input).toHaveValue("Anna");
    await waitFor(() =>
      expect(
        fake.invoke.mock.calls.some((call) =>
          String(call[0]).includes("q=Anna"),
        ),
      ).toBe(true),
    );
    expect(await screen.findByText("anna@example.invalid")).toBeVisible();
  });
});
