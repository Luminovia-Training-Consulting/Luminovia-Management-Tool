/** Verify the edition proof before rendering any private customer route. */
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { AcademyCourseAccess } from "./installation-access";

const fakes = vi.hoisted(() => ({
  rpc: vi.fn(),
  online: true,
  installation: "c23c5015-398f-4d6a-9dd2-f7bb1d8b27ca",
}));
vi.mock("../../lib/installation-brand", async (load) => {
  const source = await load<typeof import("../../lib/installation-brand")>();
  return {
    ...source,
    portalInternalEdition: false,
    installationBrand: {
      ...source.installationBrand,
      edition: "customer-managed",
      installationId: fakes.installation,
    },
  };
});
vi.mock("../../lib/online", () => ({ useOnline: () => fakes.online }));
vi.mock("./auth-context", () => ({ useAuth: () => ({ session: null }) }));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: (name: string) => ({ abortSignal: () => fakes.rpc(name) }),
    auth: { signOut: vi.fn() },
  }),
}));

const proof = {
  installation_id: fakes.installation,
  edition: "customer-managed",
  licence_status: "active",
  marketplace_available: false,
  company_premium_switch_available: false,
};

function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AcademyCourseAccess actor="fictional-admin">
        {(access) => <h1>Private example course ({access})</h1>}
      </AcademyCourseAccess>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  fakes.online = true;
  fakes.rpc.mockReset();
  await i18n.changeLanguage("en");
});
afterEach(() => cleanup());

it.each([
  ["different installation UUID", { ...proof, installation_id: "other" }],
  ["different edition", { ...proof, edition: "customer-self-hosted" }],
  ["expired licence", { ...proof, licence_status: "expired" }],
  ["marketplace exposed", { ...proof, marketplace_available: true }],
  [
    "per-company premium switch exposed",
    { ...proof, company_premium_switch_available: true },
  ],
  ["missing capability projection", null],
])("denies the customer route with %s", async (_, data) => {
  fakes.rpc.mockResolvedValue({ data, error: null });
  open();
  expect(await screen.findByText(/course area is unavailable/)).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: /Private example course/ }),
  ).not.toBeInTheDocument();
  expect(fakes.rpc).toHaveBeenCalledWith("installation_capabilities");
});

it("keeps the customer route closed when portal access is denied", async () => {
  fakes.rpc
    .mockResolvedValueOnce({ data: proof, error: null })
    .mockResolvedValueOnce({ data: false, error: null });
  open();
  expect(await screen.findByText(/course area is unavailable/)).toBeVisible();
  expect(fakes.rpc).toHaveBeenCalledWith("portal_access");
});

it.each(["active", "grace"])(
  "opens with %s access only after both server proofs",
  async (status) => {
    fakes.rpc
      .mockResolvedValueOnce({
        data: { ...proof, licence_status: status },
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null });
    open();
    expect(
      await screen.findByRole("heading", {
        name: `Private example course (${status})`,
      }),
    ).toBeVisible();
  },
);

it("keeps the customer page closed while offline", () => {
  fakes.online = false;
  open();
  expect(screen.getByText(/Connect to the internet/)).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: /Private example course/ }),
  ).not.toBeInTheDocument();
  expect(fakes.rpc).not.toHaveBeenCalled();
});
