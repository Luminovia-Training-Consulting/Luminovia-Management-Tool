import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { PeopleAdminPage } from "./people";

type Result = { data: unknown; error: unknown };
const state = vi.hoisted(() => ({
  permissions: ["users.manage", "qualifications.verify"],
  profiles: [
    {
      id: "admin",
      display_name: "Ada Verwaltung",
      bio_de: "",
      bio_en: "",
      phone: null,
      time_zone: "Europe/Berlin",
      locale: "de",
      active: true,
    },
    {
      id: "lecturer",
      display_name: "Mara Beispiel",
      bio_de: "Fiktive Dozentin.",
      bio_en: "Fictional lecturer.",
      phone: null,
      time_zone: "Australia/Brisbane",
      locale: "de",
      active: true,
    },
  ],
  expertise: [
    {
      user_id: "lecturer",
      topic_id: "python",
      verified: false,
      valid_until: null as string | null,
    },
  ],
  topics: [
    { id: "python", label_de: "Python", label_en: "Python", kind: "language" },
  ],
  rpc: vi.fn<
    (name: string, args?: Record<string, unknown>) => Promise<Result>
  >(),
  from: vi.fn<(table: string) => void>(),
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "admin" } } }),
}));
vi.mock("../../lib/supabase", () => ({
  db: () => ({
    rpc: state.rpc,
    from: (table: string) => {
      state.from(table);
      const rows =
        table === "profiles"
          ? state.profiles
          : table === "lecturer_topics"
            ? state.expertise
            : state.topics;
      return {
        select: () => ({
          order: async () => ({ data: structuredClone(rows), error: null }),
        }),
      };
    },
  }),
}));
let client: QueryClient;
beforeEach(async () => {
  await i18n.changeLanguage("de");
  state.permissions = ["users.manage", "qualifications.verify"];
  state.profiles = state.profiles.map((profile) => ({
    ...profile,
    active: true,
  }));
  state.expertise = [
    {
      user_id: "lecturer",
      topic_id: "python",
      verified: false,
      valid_until: null,
    },
  ];
  state.from.mockClear();
  state.rpc.mockReset();
  state.rpc.mockImplementation(async (name) => ({
    data: name === "get_my_permissions" ? state.permissions : null,
    error: null,
  }));
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});
afterEach(() => {
  cleanup();
  client.clear();
});
function page() {
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PeopleAdminPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
async function selectLecturer() {
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Mara Beispiel Aktiv",
    }),
  );
  return screen.getByRole("region", { name: "Mara Beispiel" });
}

describe("people administration interactions (mocked backend)", () => {
  it("requires both capabilities before querying private profiles", async () => {
    state.permissions = ["users.manage"];
    page();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Für diesen Bereich fehlt dir die Berechtigung.",
    );
    expect(state.from).not.toHaveBeenCalled();
  });

  it("verifies only the selected declared topic with an explicit UTC expiry after server confirmation", async () => {
    let finish!: (result: Result) => void;
    const pending = new Promise<Result>((resolve) => {
      finish = resolve;
    });
    state.rpc.mockImplementation(async (name) =>
      name === "get_my_permissions"
        ? { data: state.permissions, error: null }
        : pending,
    );
    page();
    const person = await selectLecturer();
    const form = within(person).getByRole("form", {
      name: "Expertise prüfen: Python",
    });
    fireEvent.change(within(form).getByLabelText("Gültig bis (UTC)"), {
      target: { value: "2040-06-01T17:30" },
    });
    await userEvent.click(
      within(form).getByRole("button", { name: "Expertise verifizieren" }),
    );
    await waitFor(() =>
      expect(state.rpc).toHaveBeenCalledWith("verify_lecturer_topic", {
        p_user_id: "lecturer",
        p_topic_id: "python",
        p_verified: true,
        p_valid_until: "2040-06-01T17:30:00.000Z",
      }),
    );
    expect(
      screen.queryByText("Die Verifizierung wurde gespeichert."),
    ).not.toBeInTheDocument();
    state.expertise = [
      {
        user_id: "lecturer",
        topic_id: "python",
        verified: true,
        valid_until: "2040-06-01T17:30:00Z",
      },
    ];
    await act(async () => finish({ data: null, error: null }));
    expect(
      await screen.findByText("Die Verifizierung wurde gespeichert."),
    ).toBeVisible();
    expect(within(form).getByText("Verifiziert")).toBeVisible();
  });

  it("never offers self suspension and requires a named confirmation for another account", async () => {
    page();
    await screen.findByRole("heading", { name: "Ada Verwaltung" });
    expect(
      screen.queryByRole("button", { name: "Zugang sperren" }),
    ).not.toBeInTheDocument();
    const search = screen.getByRole("searchbox", { name: "Personen suchen" });
    await userEvent.type(search, "Mara");
    const person = await selectLecturer();
    await userEvent.click(
      within(person).getByRole("button", { name: "Zugang sperren" }),
    );
    let dialog = screen.getByRole("dialog", { name: "Portalzugriff sperren?" });
    expect(dialog).toHaveAccessibleDescription(
      "Der Portalzugriff für Mara Beispiel wird gesperrt. Bestehende Aufträge und die Historie bleiben erhalten.",
    );
    expect(state.rpc).not.toHaveBeenCalledWith(
      "set_user_active",
      expect.anything(),
    );
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Abbrechen" }),
    );
    expect(search).toHaveValue("Mara");
    expect(screen.getByRole("region", { name: "Mara Beispiel" })).toBeVisible();
    await userEvent.click(
      within(person).getByRole("button", { name: "Zugang sperren" }),
    );
    dialog = screen.getByRole("dialog", { name: "Portalzugriff sperren?" });
    state.rpc.mockImplementation(async (name, args) => {
      if (name === "set_user_active")
        state.profiles = state.profiles.map((profile) =>
          profile.id === args?.p_user_id
            ? { ...profile, active: Boolean(args.p_active) }
            : profile,
        );
      return {
        data: name === "get_my_permissions" ? state.permissions : null,
        error: null,
      };
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Zugang sperren" }),
    );
    expect(
      await screen.findByText("Der Zugang für Mara Beispiel wurde gesperrt."),
    ).toBeVisible();
    expect(state.rpc).toHaveBeenCalledWith("set_user_active", {
      p_user_id: "lecturer",
      p_active: false,
    });
    expect(search).toHaveValue("Mara");
    expect(
      within(person).getByRole("button", { name: "Zugang aktivieren" }),
    ).toBeVisible();
  });

  it("keeps the active status and confirmation open when the server rejects suspension", async () => {
    page();
    const person = await selectLecturer();
    state.rpc.mockImplementation(async (name) => ({
      data: name === "get_my_permissions" ? state.permissions : null,
      error:
        name === "set_user_active" ? { message: "Denied by server" } : null,
    }));
    await userEvent.click(
      within(person).getByRole("button", { name: "Zugang sperren" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "Portalzugriff sperren?",
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Zugang sperren" }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Der Kontostatus konnte nicht geändert werden.",
    );
    expect(dialog).toBeVisible();
    expect(
      screen.queryByText("Der Zugang für Mara Beispiel wurde gesperrt."),
    ).not.toBeInTheDocument();
    expect(
      state.profiles.find((profile) => profile.id === "lecturer")?.active,
    ).toBe(true);
  });

  it("rejects a past expiry without sending a verification request", async () => {
    page();
    const person = await selectLecturer();
    const form = within(person).getByRole("form", {
      name: "Expertise prüfen: Python",
    });
    fireEvent.change(within(form).getByLabelText("Gültig bis (UTC)"), {
      target: { value: "2000-01-01T00:00" },
    });
    await userEvent.click(
      within(form).getByRole("button", { name: "Expertise verifizieren" }),
    );
    expect(
      await within(form).findByText(
        /Wähle einen gültigen zukünftigen Zeitpunkt/,
      ),
    ).toBeVisible();
    expect(state.rpc).not.toHaveBeenCalledWith(
      "verify_lecturer_topic",
      expect.anything(),
    );
  });
});
