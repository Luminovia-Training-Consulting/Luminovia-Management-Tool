import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OwnContactVisibility } from "./contact-visibility";
import { PersonContact } from "../people/person-contact";
import { contactEmailLink, contactPhoneLink } from "./contact-api";
import i18n from "../../lib/i18n";

const fake = vi.hoisted(() => ({
  rpc: vi.fn(),
  responses: {} as Record<string, unknown>,
  errors: {} as Record<string, unknown>,
}));
vi.mock("../../lib/supabase", () => ({ db: () => fake }));
const clients: QueryClient[] = [];
function preferences() {
  return {
    email_visible: false,
    phone_visible: false,
    version: 0,
    can_share: true,
    email_address: "fictional@example.invalid",
    phone_number: "+49 40 123456",
  };
}
beforeEach(async () => {
  await i18n.changeLanguage("de");
  fake.responses = {
    contact_visibility_preferences: preferences(),
    person_contact: { email: null, phone: null },
  };
  fake.errors = {};
  fake.rpc.mockReset().mockImplementation((name: string) => {
    const request = {
      abortSignal: () => request,
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve(fake.responses[name]).then((data) =>
          resolve({ data, error: fake.errors[name] ?? null }),
        ),
    };
    return request;
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});
function setup(settings = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      {settings && <OwnContactVisibility actor="owner" />}
      <PersonContact actor="peer" target="owner" />
    </QueryClientProvider>,
  );
  return client;
}
describe("explicit staff contact visibility", () => {
  it("keeps absent contacts private and renders safe permitted mail and telephone actions", async () => {
    const client = setup();
    expect(
      await screen.findByText(
        "Keine Kontaktangaben für dein Konto freigegeben.",
      ),
    ).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    fake.responses.person_contact = {
      email: "fictional@example.invalid",
      phone: "+49 (40) 123456",
    };
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["person-contact"] });
    });
    expect(
      await screen.findByRole("link", { name: "E-Mail schreiben" }),
    ).toHaveAttribute("href", "mailto:fictional%40example.invalid");
    expect(screen.getByRole("link", { name: "Anrufen" })).toHaveAttribute(
      "href",
      "tel:+4940123456",
    );
  });
  it("publishes changed visibility only after an actual server save without a browser actor ID", async () => {
    const user = userEvent.setup();
    setup(true);
    await user.click(
      await screen.findByRole("checkbox", {
        name: "E-Mail-Adresse für das Team anzeigen",
      }),
    );
    let resolve!: (data: unknown) => void;
    fake.responses.save_contact_visibility_preferences = new Promise(
      (r) => (resolve = r),
    );
    await user.click(
      screen.getByRole("button", { name: "Kontaktfreigabe speichern" }),
    );
    expect(
      screen.getByRole("button", { name: "Kontaktfreigabe speichern" }),
    ).toBeDisabled();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(fake.rpc).toHaveBeenCalledWith(
      "save_contact_visibility_preferences",
      {
        p_payload: { email_visible: true, phone_visible: false },
        p_expected_version: 0,
      },
    );
    fake.responses.person_contact = {
      email: "fictional@example.invalid",
      phone: null,
    };
    await act(async () =>
      resolve({ ...preferences(), email_visible: true, version: 1 }),
    );
    expect(
      await screen.findByRole("link", { name: "E-Mail schreiben" }),
    ).toBeVisible();
    expect(
      await screen.findByText("Kontaktfreigabe gespeichert."),
    ).toBeVisible();
  });
  it("retains a conflicting consent draft and explicitly reloads the saved version", async () => {
    const user = userEvent.setup();
    setup(true);
    await user.click(
      await screen.findByRole("checkbox", {
        name: "Telefonnummer für das Team anzeigen",
      }),
    );
    fake.errors.save_contact_visibility_preferences = { code: "40001" };
    await user.click(
      screen.getByRole("button", { name: "Kontaktfreigabe speichern" }),
    );
    expect(
      await screen.findByText(/Kontaktfreigabe wurde inzwischen geändert/),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", {
        name: "Telefonnummer für das Team anzeigen",
      }),
    ).toBeChecked();
    fake.responses.contact_visibility_preferences = {
      ...preferences(),
      email_visible: true,
      version: 2,
    };
    await user.click(
      screen.getByRole("button", { name: "Kontaktfreigabe neu laden" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", {
          name: "E-Mail-Adresse für das Team anzeigen",
        }),
      ).toBeChecked(),
    );
    expect(
      screen.getByRole("checkbox", {
        name: "Telefonnummer für das Team anzeigen",
      }),
    ).not.toBeChecked();
  });
  it("hides retained private contact data after a failed current permission check", async () => {
    fake.responses.person_contact = {
      email: "fictional@example.invalid",
      phone: "+49 40 123456",
    };
    const client = setup();
    expect(await screen.findByText("fictional@example.invalid")).toBeVisible();
    fake.errors.person_contact = { code: "42501" };
    await act(async () => {
      await client.invalidateQueries({ queryKey: ["person-contact"] });
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Kontaktangaben konnten nicht geladen werden.",
    );
    expect(
      screen.queryByText("fictional@example.invalid"),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Kontaktangaben konnten nicht geladen werden.",
    );
  });
  it("treats hostile contact values as text and translates loaded data without new requests", async () => {
    fake.responses.person_contact = {
      email: "fictional@example.invalid\nBcc:other@example.invalid",
      phone: "javascript:alert(1)",
    };
    setup();
    const panel = screen.getByRole("region", { name: "Kontakt" });
    expect(await within(panel).findByText("javascript:alert(1)")).toBeVisible();
    expect(within(panel).queryByRole("link")).not.toBeInTheDocument();
    const count = fake.rpc.mock.calls.length;
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    expect(screen.getByRole("region", { name: "Contact" })).toBeVisible();
    expect(fake.rpc).toHaveBeenCalledTimes(count);
    expect(contactEmailLink("user?subject=evil@example.invalid")).toBe(
      "mailto:user%3Fsubject%3Devil%40example.invalid",
    );
    for (const value of [
      "tel:+123?body=evil",
      "+49\n40",
      "javascript:123",
      "12",
    ])
      expect(contactPhoneLink(value)).toBeNull();
  });
});
