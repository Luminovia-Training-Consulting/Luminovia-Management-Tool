import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompensationPolicyPanel } from "./compensation-policy";
import { RoleFeePreview } from "./pricing";
import { commissionKeys, type CommissionAccess } from "./commission-api";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc }) }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "admin" } } }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const access: CommissionAccess = {
  can_manage_gross: true,
  can_manage_client_memberships: true,
  can_request: true,
  policy_configured: false,
  policy_version: 0,
};
function setup(policy = access) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(commissionKeys.access("admin"), policy);
  render(
    <QueryClientProvider client={client}>
      <CompensationPolicyPanel />
    </QueryClientProvider>,
  );
  return client;
}
it("does not disclose policy controls or percentages without current administration capability", () => {
  setup({
    ...access,
    can_manage_gross: false,
    regular_lecturer_percent: 31,
    senior_lecturer_percent: 73,
  });
  expect(screen.queryByRole("spinbutton")).not.toBeInTheDocument();
  expect(screen.queryByText("Vergütungsregeln")).not.toBeInTheDocument();
  expect(rpc).not.toHaveBeenCalled();
});
it("requires explicit private configuration and waits for server confirmation", async () => {
  const user = userEvent.setup();
  let confirm!: (response: unknown) => void;
  rpc.mockReturnValue(
    new Promise((resolve) => {
      confirm = resolve;
    }),
  );
  setup();
  const save = screen.getByRole("button", {
    name: "Vergütungsregeln speichern",
  });
  expect(save).toBeDisabled();
  expect(
    screen.getByLabelText("Dozent:in – Honorar vom Auftragspreis (%)"),
  ).toHaveValue(null);
  await user.type(
    screen.getByLabelText("Dozent:in – Honorar vom Auftragspreis (%)"),
    "31",
  );
  await user.type(
    screen.getByLabelText("Senior-Dozent:in – Honorar vom Auftragspreis (%)"),
    "73",
  );
  await user.click(save);
  expect(rpc).toHaveBeenCalledWith("configure_compensation_policy", {
    p_regular_percent: 31,
    p_senior_percent: 73,
    p_expected_version: 0,
  });
  expect(
    screen.queryByText("Vergütungsregeln wurden bestätigt."),
  ).not.toBeInTheDocument();
  await act(async () =>
    confirm({
      data: { ...access, policy_configured: true, policy_version: 1 },
      error: null,
    }),
  );
  expect(
    await screen.findByText("Vergütungsregeln wurden bestätigt."),
  ).toBeVisible();
});
it("keeps the reviewed version when another administrator changes the policy", async () => {
  setup({
    ...access,
    policy_configured: true,
    policy_version: 3,
    regular_lecturer_percent: 31,
    senior_lecturer_percent: 73,
  });
  rpc.mockImplementation(async (name: string) =>
    name === "commission_access"
      ? {
          data: {
            ...access,
            policy_configured: true,
            policy_version: 4,
            regular_lecturer_percent: 32,
            senior_lecturer_percent: 74,
          },
          error: null,
        }
      : { error: { code: "40001" }, data: null },
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Vergütungsregeln speichern" }),
  );
  expect(rpc).toHaveBeenCalledWith(
    "configure_compensation_policy",
    expect.objectContaining({ p_expected_version: 3 }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Aktuelle Regeln laden" }),
  );
  await waitFor(() =>
    expect(
      screen.getByLabelText("Dozent:in – Honorar vom Auftragspreis (%)"),
    ).toHaveValue(32),
  );
  expect(rpc).toHaveBeenCalledWith("commission_access");
  expect(
    screen.queryByText("Vergütungsregeln wurden bestätigt."),
  ).not.toBeInTheDocument();
});
it("previews cent rounding from the lecturer share and reveals nothing for management", () => {
  const view = render(
    <RoleFeePreview
      gross={0.05}
      currency="EUR"
      access={{
        ...access,
        regular_lecturer_percent: 31,
        senior_lecturer_percent: 73,
      }}
    />,
  );
  expect(
    screen.getByRole("heading", { name: "Dozent:in · 31%" }),
  ).toBeVisible();
  expect(screen.getAllByText("0,02 €")[0]).toBeVisible();
  view.rerender(
    <RoleFeePreview
      gross={1000}
      currency="EUR"
      access={{
        ...access,
        can_manage_gross: false,
        regular_lecturer_percent: 31,
        senior_lecturer_percent: 73,
      }}
    />,
  );
  expect(screen.queryByRole("heading")).not.toBeInTheDocument();
});
