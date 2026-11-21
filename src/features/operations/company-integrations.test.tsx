import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompanyIntegrations } from "./company-integrations";
import "./i18n";

const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => ({ rpc: fake.rpc }) }));
vi.mock("../../lib/online", () => ({
  useOnline: () => true,
  requireOnline: () => undefined,
}));

afterEach(() => {
  cleanup();
  fake.rpc.mockReset();
});

function view() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <CompanyIntegrations
        actor="fictional-admin"
        organisation="fictional-company"
        archived={false}
        zone="Europe/Berlin"
      />
    </QueryClientProvider>,
  );
  const details = result.container.querySelector("details")!;
  function toggle(open: boolean) {
    details.open = open;
    fireEvent(details, new Event("toggle"));
  }
  return { toggle, client, user: userEvent.setup() };
}

it("reveals the one-time key from an explicit create and keeps it out of the query cache", async () => {
  const fictionalSecret = "fictional-revealed-once";
  fake.rpc.mockImplementation(async (name) => ({
    data:
      name === "company_integration_keys"
        ? []
        : { credential: fictionalSecret },
    error: null,
  }));
  const { toggle, client, user } = view();
  expect(fake.rpc).not.toHaveBeenCalled();
  toggle(true);
  await user.type(
    await screen.findByRole("textbox", { name: /Bezeichnung|Label/ }),
    "Training catalog",
  );
  await user.click(
    await screen.findByRole("button", {
      name: /Schlüssel erstellen|Create key/,
    }),
  );
  expect(
    (
      await screen.findByRole("textbox", { name: /Neuer Schlüssel|New key/ })
    ).getAttribute("value"),
  ).toBe(fictionalSecret);
  expect(
    client.getQueryData([
      "company-integration-keys",
      "fictional-admin",
      "fictional-company",
    ]),
  ).toEqual([]);
  toggle(false);
  toggle(true);
  expect(
    screen.queryByRole("textbox", { name: /Neuer Schlüssel|New key/ }),
  ).toBeNull();
});

it("asks for confirmation before sending a versioned revocation", async () => {
  fake.rpc.mockImplementation(async (name) => ({
    data:
      name === "company_integration_keys"
        ? [
            {
              id: "key-id",
              label: "Training catalog",
              expires_at: "2030-01-01T00:00:00Z",
              version: 7,
            },
          ]
        : null,
    error: null,
  }));
  const { toggle, user } = view();
  toggle(true);
  await user.click(
    await screen.findByRole("button", {
      name: /Schlüssel widerrufen|Revoke key/,
    }),
  );
  expect(fake.rpc.mock.calls.map(([name]) => name)).toEqual([
    "company_integration_keys",
  ]);
  await user.click(screen.getByRole("button", { name: /Bestätigen|Confirm/ }));
  expect(fake.rpc).toHaveBeenCalledWith("revoke_company_integration_key", {
    p_id: "key-id",
    p_expected_version: 7,
  });
});
