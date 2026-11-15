import { describe, it, expect, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach } from "vitest";
import { ClientsPage } from "./clients";
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "actor" } } }),
}));
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ from }) }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe("private client directory capability boundary", () => {
  it("does not request organisation/contact/note data without the verified management permission", () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    client.setQueryData(["permissions", "actor"], []);
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ClientsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Für diesen Bereich fehlt dir die Berechtigung.",
    );
    expect(from).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("button", { name: "Organisation anlegen" }),
    ).not.toBeInTheDocument();
  });
});
