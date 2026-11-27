import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import { CompanyDispatchSettings } from "./company-dispatch-settings";

const fake = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => fake }));
vi.mock("../../lib/online", () => ({
  useOnline: () => true,
  requireOnline: () => undefined,
}));

const first = "512ac29a-27b9-46cc-a0f6-b891aca05c62";
const second = "a18d467e-46e0-426f-a1b1-a57cf9baa8c2";
const classId = "fcacd52f-1dd1-4ad3-94bb-47b9a037dfd0";
const contactId = "15040eac-5572-4496-9b90-2dbbe6123f33";
const empty = { classes: [], contacts: [], contact_id: null };

afterEach(() => {
  cleanup();
  fake.rpc.mockReset();
});

async function open() {
  await i18n.changeLanguage("de");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>
      <CompanyDispatchSettings
        actor="company"
        organisations={[
          { id: first, name: "Fiktiver Betrieb A" },
          { id: second, name: "Fiktiver Betrieb B" },
        ]}
      />
    </QueryClientProvider>,
  );
  const details = result.container.querySelector("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  return userEvent.setup();
}

it("creates a class with an HTTPS default room for the selected company without Premium input", async () => {
  const meeting = "https://meeting.example.invalid/class?access=fictional";
  fake.rpc.mockImplementation((procedure: string) =>
    procedure === "company_class_directory"
      ? { abortSignal: async () => ({ data: empty, error: null }) }
      : Promise.resolve({
          data: {
            ...empty,
            classes: [
              { id: classId, name: "Fiktive Klasse", meeting_url: meeting },
            ],
          },
          error: null,
        }),
  );
  const user = await open();
  await user.selectOptions(screen.getByLabelText("Unternehmen"), second);
  await user.click(
    await screen.findByRole("button", { name: "Klasse anlegen" }),
  );
  const editor = within(screen.getByRole("form", { name: "Klasse anlegen" }));
  await user.type(editor.getByLabelText("Klassenname"), "Fiktive Klasse");
  await user.type(
    editor.getByLabelText("Standard-Meetinglink"),
    "http://example.invalid",
  );
  await user.click(editor.getByRole("button", { name: "Speichern" }));
  expect(
    await screen.findByText("Gib einen gültigen HTTPS-Link ein."),
  ).toBeVisible();
  expect(fake.rpc).not.toHaveBeenCalledWith(
    "save_company_dispatch_class",
    expect.anything(),
  );
  await user.clear(editor.getByLabelText("Standard-Meetinglink"));
  await user.type(editor.getByLabelText("Standard-Meetinglink"), meeting);
  await user.click(editor.getByRole("button", { name: "Speichern" }));
  expect(await screen.findByText(meeting)).toBeVisible();
  expect(fake.rpc).toHaveBeenCalledWith("save_company_dispatch_class", {
    p_organisation_id: second,
    p_class_id: null,
    p_name: "Fiktive Klasse",
    p_meeting_url: meeting,
  });
});

it("allows a company with an empty directory to create its first default contact", async () => {
  fake.rpc.mockImplementation((procedure: string) =>
    procedure === "company_class_directory"
      ? { abortSignal: async () => ({ data: empty, error: null }) }
      : Promise.resolve({
          data: {
            ...empty,
            contact_id: contactId,
            contacts: [
              {
                id: contactId,
                name: "Fiktiver Kontakt",
                email: "person@example.invalid",
                phone: "",
              },
            ],
          },
          error: null,
        }),
  );
  const user = await open();
  await user.click(
    await screen.findByRole("button", {
      name: "Neuen Auftragskontakt anlegen",
    }),
  );
  const editor = within(
    screen.getByRole("form", { name: "Neuen Auftragskontakt anlegen" }),
  );
  await user.type(editor.getByLabelText("Name"), "Fiktiver Kontakt");
  await user.type(editor.getByLabelText("E-Mail"), "person@example.invalid");
  await user.click(
    editor.getByRole("button", { name: "Neuen Auftragskontakt anlegen" }),
  );
  expect(await screen.findByText("Gespeichert.")).toBeVisible();
  expect(screen.getByLabelText("Standardkontakt für Aufträge")).toHaveValue(
    contactId,
  );
  expect(fake.rpc).toHaveBeenCalledWith("save_company_dispatch_settings", {
    p_organisation_id: first,
    p_contact_id: null,
    p_new_contact: {
      name: "Fiktiver Kontakt",
      email: "person@example.invalid",
      phone: "",
    },
  });
});

it("lets a company deliberately clear an inherited contact", async () => {
  const directory = {
    ...empty,
    contact_id: contactId,
    contacts: [
      { id: contactId, name: "Fiktiver Kontakt", email: null, phone: null },
    ],
  };
  fake.rpc.mockImplementation((procedure: string) =>
    procedure === "company_class_directory"
      ? { abortSignal: async () => ({ data: directory, error: null }) }
      : Promise.resolve({
          data: { ...directory, contact_id: null },
          error: null,
        }),
  );

  const user = await open();
  const contact = await screen.findByLabelText("Standardkontakt für Aufträge");
  expect(contact).toHaveValue(contactId);
  await user.selectOptions(contact, "");
  await user.click(screen.getByRole("button", { name: "Speichern" }));
  expect(await screen.findByText("Gespeichert.")).toBeVisible();
  expect(fake.rpc).toHaveBeenCalledWith("save_company_dispatch_settings", {
    p_organisation_id: first,
    p_contact_id: null,
  });
  expect(contact).toHaveValue("");
});
