import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
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
  const company = useLocation().pathname.startsWith("/client/");
  const { search, hash } = useLocation();
  return (
    <h1>
      {company ? "Company invoices" : "Accounting"}
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
          <Route path="/" element={<h1>Home</h1>} />
          <Route path="/client" element={<h1>Company portal</h1>} />
          <Route
            path="/finance"
            element={<FinanceWorkspace scope="personal" />}
          >
            <Route index element={<h1>Overview</h1>} />
            <Route path="accounting" element={<AccountingFixture />} />
            <Route path="analytics" element={<h1>Analytics</h1>} />
          </Route>
          <Route
            path="/admin/finance"
            element={<FinanceWorkspace scope="staff" />}
          >
            <Route index element={<h1>Platform overview</h1>} />
            <Route path="accounting" element={<AccountingFixture />} />
            <Route path="analytics" element={<h1>Platform analytics</h1>} />
          </Route>
          <Route
            path="/client/finance"
            element={<FinanceWorkspace scope="company" />}
          >
            <Route path="accounting" element={<AccountingFixture />} />
            <Route path="analytics" element={<h1>Company analytics</h1>} />
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
  expect(
    screen.queryByRole("link", { name: /^financeOverview(?: |$)/ }),
  ).toBeNull();
  expect(
    screen.getByRole("link", { name: /^analytics(?: |$)/ }),
  ).toHaveAttribute("href", "/client/finance/analytics");
});

it("keeps management tabs together and forwards query and fragment from legacy accounting links", async () => {
  state.roles = ["management"];
  state.permissions = ["finance.manage"];
  open("/accounting?invoice=example#payments");
  await screen.findByRole("heading", {
    name: "Accounting?invoice=example#payments",
  });
  expect(
    screen.getByRole("link", { name: /^financeOverview(?: |$)/ }),
  ).toHaveAttribute("href", "/admin/finance");
  expect(
    screen.getByRole("link", { name: /^accountingExports(?: |$)/ }),
  ).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: /^analytics(?: |$)/ })).toBeVisible();
});

it("keeps a manager who also teaches in personal finance unless opening a platform link", async () => {
  state.roles = ["management", "lecturer"];
  state.permissions = ["finance.manage"];
  open("/finance");
  await screen.findByRole("heading", { name: "Overview" });
  expect(
    screen.getByRole("link", { name: /^analytics(?: |$)/ }),
  ).toHaveAttribute("href", "/finance/analytics");
  expect(
    screen.queryByRole("link", { name: /^accountingExports(?: |$)/ }),
  ).toBeNull();
});

it("forwards management invoice-series bookmarks for dual-role users to the platform view", async () => {
  state.roles = ["management", "lecturer"];
  state.permissions = ["finance.manage"];
  open("/finance?series=fictional");
  await screen.findByRole("heading", { name: "Platform overview" });
  expect(
    screen.getByRole("link", { name: /^analytics(?: |$)/ }),
  ).toHaveAttribute("href", "/admin/finance/analytics");
});

it("keeps the staff workspace inaccessible to an ordinary lecturer", async () => {
  state.roles = ["lecturer"];
  state.permissions = [];
  open("/admin/finance/accounting");
  expect(
    await screen.findByRole("heading", { name: "notFound" }),
  ).toBeVisible();
  expect(screen.queryByRole("heading", { name: "Accounting" })).toBeNull();
});

it("keeps old personal invoice links out of the company finance view", async () => {
  state.roles = ["client"];
  state.permissions = [];
  open("/finance?claim=fictional");
  expect(
    await screen.findByRole("heading", { name: "Company portal" }),
  ).toBeVisible();
});
