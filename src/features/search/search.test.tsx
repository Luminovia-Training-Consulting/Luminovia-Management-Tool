/**
 * Regressions for URL-driven search, retained typing drafts and no requests for short terms. UI
 * fixtures do not replace permission-filtered server search.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PortalSearch } from "./search";

const fake = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "search-actor" } } }),
}));
vi.mock("../../lib/supabase", () => ({ db: () => fake }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
beforeEach(() => {
  fake.rpc.mockReset().mockResolvedValue({ data: [], error: null });
  fake.from.mockReset().mockImplementation(() => {
    const query = {
      select: () => query,
      ilike: () => query,
      is: () => query,
      limit: () => Promise.resolve({ data: [], error: null }),
    };
    return query;
  });
});
afterEach(cleanup);
/** Render the real page in its router/query context for the interaction checks below. */
function page() {
  const router = createMemoryRouter(
    [{ path: "/search", element: <PortalSearch /> }],
    {
      initialEntries: ["/search?q=Alpha"],
    },
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
describe("URL-driven portal search", () => {
  it("replaces the draft on query navigation but preserves ordinary unsaved typing", async () => {
    const router = page();
    const input = screen.getByRole("searchbox", { name: "portalSearch" });
    expect(input).toHaveValue("Alpha");
    await userEvent.clear(input);
    await userEvent.type(input, "unfinished draft");
    expect(input).toHaveValue("unfinished draft");
    await router.navigate("/search?q=Beta");
    await waitFor(() =>
      expect(
        screen.getByRole("searchbox", { name: "portalSearch" }),
      ).toHaveValue("Beta"),
    );
    await router.navigate("/search?q=Alpha");
    await waitFor(() =>
      expect(
        screen.getByRole("searchbox", { name: "portalSearch" }),
      ).toHaveValue("Alpha"),
    );
  });
  it("does not request any data for a short query", async () => {
    const router = page();
    await waitFor(() => expect(fake.rpc).toHaveBeenCalled());
    fake.rpc.mockClear();
    fake.from.mockClear();
    await router.navigate("/search?q=x");
    expect(fake.rpc).not.toHaveBeenCalled();
    expect(fake.from).not.toHaveBeenCalled();
  });
});
