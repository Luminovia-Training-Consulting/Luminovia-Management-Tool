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

function view(canSubscribePremium = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <CompanyIntegrations
        actor="fictional-admin"
        organisation="fictional-company"
        archived={false}
        canSubscribePremium={canSubscribePremium}
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
  await user.selectOptions(
    screen.getByRole("combobox", { name: /API-Berechtigung|API permission/ }),
    "reports.read",
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
  expect(fake.rpc).toHaveBeenCalledWith(
    "issue_scoped_company_integration_key",
    expect.objectContaining({ p_scope: "reports.read" }),
  );
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

it("opts a company webhook into Premium explicitly and discards its one-time signing key", async () => {
  const signingKey = "b".repeat(64);
  fake.rpc.mockImplementation(async (name) => ({
    data:
      name === "company_integration_keys"
        ? [
            {
              id: "fictional-key",
              label: "Training sync",
              expires_at: "2100-01-01T00:00:00Z",
              revoked_at: null,
              version: 1,
            },
          ]
        : name === "company_course_webhook_subscribe"
          ? { signing_secret: signingKey }
          : [],
    error: null,
  }));
  const { toggle, client, user } = view(true);
  toggle(true);
  await user.click(screen.getByText(/Kurs-Webhooks|Course webhooks/));
  const key = await screen.findByRole("combobox", {
    name: /^Integrationsschlüssel$|^Integration key$/,
  });
  await user.selectOptions(key, "fictional-key");
  await user.type(
    screen.getByRole("textbox", { name: /Empfänger-Alias|Receiver alias/ }),
    "course-sync",
  );
  const premium = screen.getByRole("checkbox", {
    name: /Premium-Kursereignisse|Include Premium/,
  });
  expect(premium).not.toBeChecked();
  await user.click(premium);
  await user.click(
    screen.getByRole("button", {
      name: /Webhook abonnieren|Subscribe to webhooks/,
    }),
  );
  expect(fake.rpc).toHaveBeenCalledWith("company_course_webhook_subscribe", {
    p_organisation: "fictional-company",
    p_integration: "fictional-key",
    p_destination: "course-sync",
    p_premium_events: true,
  });
  expect(
    await screen.findByRole("textbox", {
      name: /Signaturschlüssel|Signing key/,
    }),
  ).toHaveValue(signingKey);
  expect(
    client.getQueryData([
      "company-course-webhooks",
      "fictional-admin",
      "fictional-company",
    ]),
  ).toEqual([]);
  toggle(false);
  expect(screen.queryByDisplayValue(signingKey)).toBeNull();
});
