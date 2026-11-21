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
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import { PersonalizedWidgets, TeachingDayWidget } from "./personal";
import {
  defaultDashboardPreferences,
  teachingDaySchema,
  teachingLink,
} from "./personal-api";

const fake = vi.hoisted(() => ({
  rpc: vi.fn(),
  responses: {} as Record<string, unknown>,
  errors: {} as Record<string, unknown>,
}));
vi.mock("../../lib/supabase", () => ({ db: () => fake }));
const clients: QueryClient[] = [];
const claim = "6ed51acb-935b-44e2-bd87-fc8eb55d77a7";

function day() {
  return {
    day: "2026-11-16",
    time_zone: "Europe/Berlin",
    sessions: [
      {
        id: "cb3c83b2-c8d5-4755-a562-afc069e49877",
        claim_id: claim,
        job_id: "1722aa1e-16be-4ca3-8064-fe81e49752ae",
        title: "Fictional Linux course",
        customer_name: "Fictional client",
        starts_at: "2026-11-16T08:00:00Z",
        ends_at: "2026-11-16T11:00:00Z",
        time_zone: "Europe/Berlin",
        delivery_type: "online",
        location: "https://example.invalid/class",
        documents: [
          {
            id: "dc294aa7-19fc-4577-a6c7-963713607c4e",
            name: "Fictional handout.pdf",
          },
        ],
        preparation: {
          materials_ready: false,
          location_ready: false,
          contact_ready: false,
          version: 0,
        },
      },
    ],
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("de");
  fake.responses = {
    dashboard_preferences: { ...defaultDashboardPreferences, version: 2 },
    teaching_day: day(),
  };
  fake.errors = {};
  fake.rpc.mockReset().mockImplementation((name: string) => {
    const request = {
      abortSignal: () => request,
      then: (resolve: (value: unknown) => unknown) =>
        Promise.resolve(fake.responses[name]).then((data) =>
          resolve({ data, error: fake.errors[name] ?? null }),
        ),
    };
    return request;
  });
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((c) => c.clear());
});

function mount(view: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{view}</MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

const cards = {
  activity: <section aria-label="Activity fixture">Activity fixture</section>,
  files: <section aria-label="Files fixture">Files fixture</section>,
};
describe("personal dashboard", () => {
  it("shows explicitly shared contact, exact resource links and shared progress without changing private checkbox state", async () => {
    const payload = day(),
      run = "27e70a15-c7e3-4234-ad6b-d810610be31b";
    Object.assign(payload.sessions[0], {
      course_run_id: run,
      course_contact: {
        name: "Fictional selected contact",
        email: "course@example.invalid",
        phone: "+49 40 123",
      },
      shared_preparation: { done: 1, total: 2 },
      course_resources: [
        {
          id: "e980ed88-5a96-435f-afb6-2abb01faef88",
          version_id: "50cbe43b-6594-4299-b876-a4c81273911b",
          name: "Agreed original V1.pdf",
          sha256: "a".repeat(64),
          category: "material",
        },
      ],
      course_resource_count: 12,
    });
    fake.responses.teaching_day = payload;
    mount(<TeachingDayWidget actor="actor-a" />);
    expect(
      await screen.findByRole("link", { name: "course@example.invalid" }),
    ).toHaveAttribute("href", "mailto:course%40example.invalid");
    expect(screen.getByRole("link", { name: "+49 40 123" })).toHaveAttribute(
      "href",
      "tel:+4940123",
    );
    expect(
      screen.getByText("1 von 2 Vorbereitungspunkten erledigt"),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Agreed original V1.pdf" }),
    ).toHaveAttribute("href", `/courses/${run}/workspace`);
    expect(
      screen.getByText("11 weitere freigegebene Fassung(en) im Kursbereich."),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", {
        name: "Unterlagen geprüft und vorbereitet",
      }),
    ).not.toBeChecked();
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    expect(screen.getByText("1 of 2 preparation items complete")).toBeVisible();
  });
  it("treats legacy payloads as unavailable shared context rather than fabricated completed preparation", () => {
    const parsed = teachingDaySchema.parse(day()).sessions[0];
    expect(parsed.course_run_id).toBeNull();
    expect(parsed.course_contact).toBeNull();
    expect(parsed.shared_preparation).toBeNull();
    expect(parsed.course_resources).toEqual([]);
  });
  it("loads saved hidden cards and persists reordered draft only after server confirmation", async () => {
    const user = userEvent.setup();
    fake.responses.dashboard_preferences = {
      ...defaultDashboardPreferences,
      hidden_widgets: ["files"],
      version: 2,
    };
    mount(<PersonalizedWidgets actor="actor-a" widgets={cards} />);
    const customize = await screen.findByRole("button", {
      name: "Dashboard anpassen",
    });
    await waitFor(() => expect(customize).toBeEnabled());
    expect(
      screen.queryByRole("region", { name: "Files fixture" }),
    ).not.toBeInTheDocument();
    await user.click(customize);
    await user.click(
      screen.getByRole("checkbox", { name: "Zuletzt hinzugefügte Dateien" }),
    );
    await user.click(
      screen.getByRole("button", {
        name: "Zuletzt hinzugefügte Dateien nach oben",
      }),
    );
    let resolve!: (data: unknown) => void;
    fake.responses.save_dashboard_preferences = new Promise(
      (r) => (resolve = r),
    );
    await user.click(
      screen.getByRole("button", { name: "Dashboard speichern" }),
    );
    expect(
      screen.queryByRole("region", { name: "Files fixture" }),
    ).not.toBeInTheDocument();
    expect(fake.rpc).toHaveBeenLastCalledWith("save_dashboard_preferences", {
      p_expected_version: 2,
      p_payload: {
        widget_order: [
          "teaching_day",
          "activity",
          "files",
          "contracts",
          "followups",
        ],
        hidden_widgets: [],
      },
    });
    await act(async () =>
      resolve({
        widget_order: [
          "teaching_day",
          "activity",
          "files",
          "contracts",
          "followups",
        ],
        hidden_widgets: [],
        version: 3,
      }),
    );
    expect(
      await screen.findByRole("region", { name: "Files fixture" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Dashboard speichern" }),
    ).not.toBeInTheDocument();
  });
  it("keeps a conflicting draft and offers explicit reload without overwriting current server state", async () => {
    const user = userEvent.setup();
    mount(<PersonalizedWidgets actor="actor-a" widgets={cards} />);
    const customize = screen.getByRole("button", {
      name: "Dashboard anpassen",
    });
    await waitFor(() => expect(customize).toBeEnabled());
    await user.click(customize);
    await user.click(
      screen.getByRole("checkbox", { name: "Zuletzt hinzugefügte Dateien" }),
    );
    fake.errors.save_dashboard_preferences = { code: "PT409" };
    await user.click(
      screen.getByRole("button", { name: "Dashboard speichern" }),
    );
    expect(
      await screen.findByText(/Dashboard wurde inzwischen geändert/),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "Zuletzt hinzugefügte Dateien" }),
    ).not.toBeChecked();
    expect(screen.getByRole("region", { name: "Files fixture" })).toBeVisible();
    fake.responses.dashboard_preferences = {
      ...defaultDashboardPreferences,
      hidden_widgets: ["activity"],
      version: 3,
    };
    await user.click(
      screen.getByRole("button", { name: "Gespeicherte Auswahl neu laden" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("checkbox", { name: "Nachrichten & Meldungen" }),
      ).not.toBeChecked(),
    );
    expect(
      screen.getByRole("checkbox", { name: "Zuletzt hinzugefügte Dateien" }),
    ).toBeChecked();
  });
  it("renders authorized course files and HTTPS link and waits for actual checklist save", async () => {
    const user = userEvent.setup();
    mount(<TeachingDayWidget actor="actor-a" />);
    const panel = await screen.findByRole("region", {
      name: "Mein Unterrichtstag",
    });
    expect(
      await within(panel).findByRole("link", {
        name: "Unterrichtslink öffnen",
      }),
    ).toHaveAttribute("href", "https://example.invalid/class");
    expect(
      within(panel).getByRole("link", { name: "Fictional handout.pdf" }),
    ).toHaveAttribute("href", "/files?q=Fictional%20handout.pdf");
    let resolve!: (data: unknown) => void;
    fake.responses.save_teaching_preparation = new Promise(
      (r) => (resolve = r),
    );
    const checkbox = within(panel).getByRole("checkbox", {
      name: "Unterlagen geprüft und vorbereitet",
    });
    await user.click(checkbox);
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toBeDisabled();
    const updated = day();
    updated.sessions[0].preparation.materials_ready = true;
    updated.sessions[0].preparation.version = 1;
    fake.responses.teaching_day = updated;
    await act(async () => resolve(updated.sessions[0].preparation));
    await waitFor(() => expect(checkbox).toBeChecked());
    expect(fake.rpc).toHaveBeenCalledWith("save_teaching_preparation", {
      p_claim_id: claim,
      p_item: "materials_ready",
      p_done: true,
      p_expected_version: 0,
    });
  });
  it("does not make authored unsafe teaching locations executable and translates without refetch", async () => {
    const unsafe = day();
    unsafe.sessions[0].location = "javascript:alert(1)";
    fake.responses.teaching_day = unsafe;
    mount(<TeachingDayWidget actor="actor-a" />);
    expect(await screen.findByText("Fictional Linux course")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Unterrichtslink öffnen" }),
    ).not.toBeInTheDocument();
    const count = fake.rpc.mock.calls.length;
    await act(async () => {
      await i18n.changeLanguage("en");
    });
    expect(
      screen.getByRole("region", { name: "My teaching day" }),
    ).toBeVisible();
    expect(fake.rpc).toHaveBeenCalledTimes(count);
    for (const bad of [
      "javascript:alert(1)",
      "http://example.invalid",
      "https://user:secret@example.invalid",
      "//example.invalid",
    ])
      expect(teachingLink(bad)).toBeNull();
  });
});
