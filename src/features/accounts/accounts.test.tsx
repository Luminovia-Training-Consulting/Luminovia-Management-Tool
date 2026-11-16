/**
 * Vitest-Regressionen für Rechte vor Kontosuche und erhaltenen Suchfokus bei ausstehenden Seitenabfragen. Lokale SDK-/DOM-Fixtures isolieren den Browservertrag; echte Datenbank-/API-Abnahme bleibt Teil des separaten Gesamtprüflaufs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  notifyManager,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
let client: QueryClient;
/** Rendert die tatsächliche Seite in ihrem Router-/Query-Kontext für die folgenden Bedienprüfungen. */
function page() {
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AccountsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
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
afterEach(async () => {
  // Detach React observers before cancelling pending search requests.
  cleanup();
  await client.cancelQueries();
  client.clear();
  // The mocked transport ignores cancellation; let its real promises finish.
  await Promise.all(
    [...fake.rpc.mock.results, ...fake.invoke.mock.results]
      .filter((result) => result.type === "return")
      .map((result) => result.value),
  );
  // Flush already-queued query notifications while jsdom still owns window.
  await act(async () => {
    await new Promise<void>((resolve) => notifyManager.schedule(resolve));
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
