import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useOutletContext,
} from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { FinanceWorkspace, LegacyFinanceRoute } from "./finance-workspace";

const state = vi.hoisted(() => ({
  roles: ["client"],
  permissions: [] as string[],
}));
vi.mock("../features/auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "fictional" } } }),
}));
vi.mock("../lib/queries", () => ({
  userRolesQuery: () => ({
    queryKey: ["roles"],
    queryFn: async () => state.roles,
  }),
  permissionsQuery: () => ({
    queryKey: ["permissions"],
    queryFn: async () => state.permissions,
  }),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

function AccountingFixture() {
  const { preferCustomer } = useOutletContext<{ preferCustomer: boolean }>();
  const { search, hash } = useLocation();
  return (
    <h1>
      {preferCustomer ? "Company invoices" : "Accounting"}
      {search}
      {hash}
    </h1>
  );
}

function open(path: string) {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/finance" element={<FinanceWorkspace />}>
            <Route index element={<h1>Overview</h1>} />
            <Route path="accounting" element={<AccountingFixture />} />
            <Route path="analytics" element={<h1>Analytics</h1>} />
          </Route>
          <Route
            path="/accounting"
            element={<LegacyFinanceRoute to="/finance/accounting" />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("opens company invoices by default and keeps lecturer finance out of the company workspace", async () => {
  state.roles = ["client"];
  state.permissions = [];
  open("/finance");
  await screen.findByRole("heading", { name: "Company invoices" });
  expect(screen.queryByRole("link", { name: "financeOverview" })).toBeNull();
  expect(screen.getByRole("link", { name: "analytics" })).toHaveAttribute(
    "href",
    "/finance/analytics",
  );
});

it("keeps management tabs together and forwards query and fragment from legacy accounting links", async () => {
  state.roles = ["management"];
  state.permissions = ["finance.manage"];
  open("/accounting?invoice=example#payments");
  await screen.findByRole("heading", {
    name: "Accounting?invoice=example#payments",
  });
  expect(screen.getByRole("link", { name: "financeOverview" })).toHaveAttribute(
    "href",
    "/finance",
  );
  expect(
    screen.getByRole("link", { name: "accountingExports" }),
  ).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: "analytics" })).toBeVisible();
});
