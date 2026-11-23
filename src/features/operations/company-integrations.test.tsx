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

function view(canSubscribePremium = false, canSubscribeAccounting = false) {
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
        canSubscribeAccounting={canSubscribeAccounting}
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
              expires_at: null,
              revoked_at: null,
              version: 1,
              webhook_eligible: true,
            },
            {
              id: "delegated-key",
              label: "Company-issued key",
              expires_at: null,
              revoked_at: null,
              version: 1,
              webhook_eligible: false,
            },
          ]
        : name === "company_course_webhook_subscribe"
          ? { signing_secret: signingKey }
          : [],
    error: null,
  }));
  const { toggle, client, user } = view(true);
  toggle(true);
  await user.click(screen.getByText(/Unternehmens-Webhooks|Company webhooks/));
  const key = await screen.findByRole("combobox", {
    name: /^Integrationsschlüssel$|^Integration key$/,
  });
  expect(
    screen.queryByRole("option", { name: "Company-issued key" }),
  ).toBeNull();
  await user.selectOptions(key, "fictional-key");
  await user.type(
    screen.getByRole("textbox", { name: /Empfänger-Alias|Receiver alias/ }),
    "course-sync",
  );
  const premium = screen.getByRole("checkbox", {
    name: /Premium-Kursereignisse|Include Premium/,
  });
  expect(premium).not.toBeChecked();
  expect(
    screen.queryByRole("option", {
      name: /Unternehmensabrechnung|Company accounting/,
    }),
  ).toBeNull();
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

it.each([
  [null, null],
  ["23505", /bereits verwendet|alias is already in use/],
  ["PT429", /fünf aktive Abonnements|five active subscriptions/],
] as const)(
  "handles accounting-only subscription result %s without enabling course events",
  async (code, message) => {
    const signingKey = "c".repeat(64);
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
          : name === "company_accounting_webhook_subscribe"
            ? { signing_secret: signingKey }
            : [
                {
                  id: "fictional-accounting",
                  destination: "accounts-sync",
                  integration_label: "Fictional accounts",
                  active: true,
                  accounting_events: true,
                  deliveries: [
                    {
                      id: "fictional-delivery",
                      event_type: "payment.reversed",
                      occurred_at: "2026-11-21T09:00:00Z",
                      attempts: 1,
                      state: "delivered",
                    },
                  ],
                },
              ],
      error:
        name === "company_accounting_webhook_subscribe" && code
          ? { code }
          : null,
    }));
    const { toggle, user } = view(true, true);
    toggle(true);
    await user.click(
      screen.getByText(/Unternehmens-Webhooks|Company webhooks/),
    );
    await user.selectOptions(
      await screen.findByRole("combobox", { name: /^Ereignisse$|^Events$/ }),
      "accounting",
    );
    expect(
      screen.queryByRole("checkbox", {
        name: /Premium-Kursereignisse|Include Premium/,
      }),
    ).toBeNull();
    await user.selectOptions(
      screen.getByRole("combobox", {
        name: /^Integrationsschlüssel$|^Integration key$/,
      }),
      "fictional-key",
    );
    await user.type(
      screen.getByRole("textbox", { name: /Empfänger-Alias|Receiver alias/ }),
      "accounts-sync",
    );
    await user.click(
      screen.getByRole("button", {
        name: /Webhook abonnieren|Subscribe to webhooks/,
      }),
    );
    expect(fake.rpc).toHaveBeenCalledWith(
      "company_accounting_webhook_subscribe",
      {
        p_organisation: "fictional-company",
        p_integration: "fictional-key",
        p_destination: "accounts-sync",
      },
    );
    if (message) {
      expect(await screen.findByText(message)).toBeVisible();
      expect(screen.queryByDisplayValue(signingKey)).toBeNull();
    } else {
      expect(await screen.findByDisplayValue(signingKey)).toBeVisible();
    }
    expect(
      screen.getByText(/Zahlung storniert|Payment reversed/),
    ).toBeVisible();
  },
);

it("creates a permanent company key, lists its validity and preserves it on rotation", async () => {
  const key = {
    id: "permanent-key",
    version: 2,
    label: "Fictional integration",
    expires_at: null,
    revoked_at: null,
    last_used_at: null,
    scope: "courses.read",
  };
  let created = false;
  fake.rpc.mockImplementation(async (rpc) => {
    if (rpc === "company_integration_keys")
      return { data: created ? [key] : [], error: null };
    created = true;
    return { data: { credential: "fictional-one-time-key" }, error: null };
  });
  const { toggle, user } = view();
  toggle(true);
  await user.type(
    await screen.findByRole("textbox", { name: /Bezeichnung|Label/ }),
    key.label,
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: /Gültigkeit|Validity/ }),
    "permanent",
  );
  await user.click(
    screen.getByRole("button", { name: /Schlüssel erstellen|Create key/ }),
  );
  expect(fake.rpc).toHaveBeenCalledWith(
    "issue_scoped_company_integration_key",
    expect.objectContaining({
      p_organisation_id: "fictional-company",
      p_expires_at: null,
    }),
  );
  await user.click(
    await screen.findByRole("button", {
      name: /Schlüssel ersetzen|Replace key/,
    }),
  );
  expect(
    screen.getByRole("combobox", { name: /Gültigkeit|Validity/ }),
  ).toHaveValue("permanent");
  await user.click(screen.getByRole("button", { name: /Bestätigen|Confirm/ }));
  expect(fake.rpc).toHaveBeenCalledWith(
    "issue_scoped_company_integration_key",
    expect.objectContaining({
      p_rotate_id: key.id,
      p_expected_version: key.version,
      p_expires_at: null,
    }),
  );
});
