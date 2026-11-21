/** Verify admin-only double confirmation, version-aware toggle and read-only management status. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompanyPremiumControl } from "./company-premium";
import type { CompanyPremiumSetting } from "./company-premium-schema";

const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
vi.mock("../../lib/online", () => ({
  requireOnline: () => undefined,
  useOnline: () => true,
}));

const initial: CompanyPremiumSetting = {
  organisation_id: "c1c7235f-8f2d-49a3-898b-729ca578915e",
  enabled: false,
  version: 0,
  updated_at: null,
};
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});
beforeEach(() => {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  fake.rpc.mockImplementation(
    async (name: string, args?: Record<string, unknown>) => {
      if (name === "set_company_premium")
        return {
          data: {
            status: "updated",
            enabled: args?.p_enabled,
            version: Number(args?.p_expected_version) + 1,
          },
          error: null,
        };
      if (name === "retained_company_lms")
        return {
          data: {
            organisation_id: initial.organisation_id,
            premium_enabled: false,
            course_count: 0,
            courses: [],
          },
          error: null,
        };
      return { data: null, error: { code: "unexpected_rpc" } };
    },
  );
});

function mount(isAdmin: boolean, setting = initial) {
  return render(
    <QueryClientProvider client={client}>
      <CompanyPremiumControl
        actor="fictional-admin"
        setting={setting}
        isAdmin={isAdmin}
      />
    </QueryClientProvider>,
  );
}

it("requires both confirmations before an admin command and sends no command on cancel", async () => {
  mount(true);
  const user = userEvent.setup();
  await user.click(screen.getByRole("switch", { name: "Premium aktivieren" }));
  expect(
    await screen.findByRole("dialog", { name: "Premium LMS aktivieren?" }),
  ).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Weiter" }));
  expect(fake.rpc).not.toHaveBeenCalledWith(
    "set_company_premium",
    expect.anything(),
  );
  await user.click(
    screen.getByRole("button", { name: "Premium LMS jetzt einschalten" }),
  );
  expect(
    await screen.findByText("Premium-Einstellung wurde gespeichert."),
  ).toBeVisible();
  expect(fake.rpc).toHaveBeenCalledTimes(1);
  expect(fake.rpc).toHaveBeenCalledWith(
    "set_company_premium",
    expect.objectContaining({
      p_organisation_id: initial.organisation_id,
      p_enabled: true,
      p_expected_version: 0,
      p_request_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    }),
  );
});

it("shows status without toggle or retained-data access for management", async () => {
  mount(false);
  expect(await screen.findByText("Premium LMS AUS")).toBeVisible();
  expect(
    screen.getByText("Nur eine aktive Administration darf Premium umschalten."),
  ).toBeVisible();
  expect(
    screen.queryByRole("switch", { name: "Premium aktivieren" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Beibehaltene Kursdaten ansehen" }),
  ).not.toBeInTheDocument();
  expect(fake.rpc).not.toHaveBeenCalled();
});

it("sends no toggle when cancelled and applies the same confirmations when disabling", async () => {
  mount(true);
  const user = userEvent.setup();
  await user.click(screen.getByRole("switch", { name: "Premium aktivieren" }));
  await user.click(await screen.findByRole("button", { name: "Abbrechen" }));
  expect(fake.rpc).not.toHaveBeenCalledWith(
    "set_company_premium",
    expect.anything(),
  );
  expect(screen.getByText("Premium LMS AUS")).toBeVisible();

  cleanup();
  mount(true, { ...initial, enabled: true, version: 1 });
  await user.click(
    screen.getByRole("switch", { name: "Premium deaktivieren" }),
  );
  await user.click(await screen.findByRole("button", { name: "Weiter" }));
  expect(fake.rpc).not.toHaveBeenCalledWith(
    "set_company_premium",
    expect.anything(),
  );
  await user.click(
    screen.getByRole("button", { name: "Premium LMS jetzt ausschalten" }),
  );
  expect(
    await screen.findByText("Premium-Einstellung wurde gespeichert."),
  ).toBeVisible();
  expect(fake.rpc).toHaveBeenCalledWith(
    "set_company_premium",
    expect.objectContaining({
      p_enabled: false,
      p_expected_version: 1,
    }),
  );
});
