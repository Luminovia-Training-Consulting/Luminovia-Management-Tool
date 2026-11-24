/** Guest settings render only own profile/Auth controls and do not request operational data. */
import { afterEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import {
  cleanup,
  render,
  screen,
  within,
  act,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "../../lib/i18n";
import { ProfilePage } from "./profile";

const fake = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ db: () => fake }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({
    session: { user: { id: "guest-own", email: "guest@example.invalid" } },
  }),
}));
let client: QueryClient;
afterEach(() => {
  cleanup();
  client?.clear();
  vi.clearAllMocks();
});
it("keeps a guest's own profile usable without loading expertise, permissions or qualification widgets", async () => {
  await i18n.changeLanguage("de");
  fake.rpc.mockResolvedValue({
    data: { username: "fictional-guest", version: 1 },
    error: null,
  });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["profile", "guest-own"], {
    id: "guest-own",
    luminovia_user_id: "LV-0001-0002-0003-0004-0005",
    display_name: "Fictional Guest",
    phone: "",
    time_zone: "US/Eastern",
    bio_de: "",
    bio_en: "",
    locale: "de",
    active: true,
  });
  client.setQueryData(["user-roles", "guest-own"], ["guest"]);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByDisplayValue("Fictional Guest")).toBeVisible();
  const timeZone = screen.getByRole("combobox", { name: "Zeitzone" });
  expect(timeZone).toHaveValue("US/Eastern");
  expect(timeZone).toHaveAccessibleDescription(/Standard für deinen Kalender/);
  const common = within(timeZone).getByRole("group", {
    name: "Häufige Zeitzonen",
  });
  expect(within(common).getAllByRole("option")).toHaveLength(35);
  expect(
    within(common).getByRole("option", { name: "Australia/Adelaide" }),
  ).toBeInTheDocument();
  expect(
    within(timeZone).getByRole("group", { name: "Weitere Zeitzonen" }),
  ).toContainElement(
    within(timeZone).getByRole("option", { name: "US/Eastern" }),
  );
  expect(
    screen.getByRole("option", { name: "Asia/Tokyo" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("option", { name: "Australia/Brisbane" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText("LV-0001-0002-0003-0004-0005", { exact: true }),
  ).toBeVisible();
  expect(
    screen.getByText("guest@example.invalid", { exact: true }),
  ).toBeVisible();
  expect(screen.queryByText("Fachgebiete & Expertise")).not.toBeInTheDocument();
  expect(document.querySelector(".profile-privacy-grid")).toBeNull();
  expect(fake.from).not.toHaveBeenCalled();
  expect(
    screen.queryByRole("textbox", { name: "Benutzername" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Standardsprache" })).toHaveValue(
    "de",
  );
  expect(fake.rpc).not.toHaveBeenCalled();
  await act(() => i18n.changeLanguage("en"));
  expect(
    within(timeZone).getByRole("group", { name: "Common time zones" }),
  ).toBeVisible();
  expect(timeZone).toHaveValue("US/Eastern");
  expect(client.getQueryState(["topics"])?.fetchStatus).toBe("idle");
  expect(client.getQueryState(["expertise", "guest-own"])?.fetchStatus).toBe(
    "idle",
  );
});

it("saves English as the account language and applies it only after confirmation", async () => {
  await i18n.changeLanguage("de");
  let confirmSave!: (response: { data: unknown; error: null }) => void;
  fake.rpc.mockImplementation((name: string) =>
    name === "save_ui_preferences"
      ? new Promise((resolve) => {
          confirmSave = resolve;
        })
      : Promise.resolve({ data: { username: null, version: 0 }, error: null }),
  );
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  const profileKey = ["profile", "guest-own"];
  client.setQueryData(profileKey, {
    id: "guest-own",
    display_name: "Fictional Guest",
    time_zone: "Europe/Zurich",
    locale: "de",
    active: true,
  });
  client.setQueryData(["user-roles", "guest-own"], ["participant"]);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  const select = screen.getByRole("combobox", { name: "Standardsprache" });
  expect(
    Array.from(select.querySelectorAll("option"), ({ value }) => value),
  ).toEqual(["de", "en"]);
  await user.selectOptions(select, "en");
  await user.click(screen.getByRole("button", { name: "Sprache speichern" }));
  await waitFor(() =>
    expect(fake.rpc).toHaveBeenCalledWith("save_ui_preferences", {
      p_patch: { language: "en" },
    }),
  );
  expect(i18n.language).toBe("de");
  expect(select).toBeDisabled();
  await act(async () =>
    confirmSave({
      data: {
        language: "en",
        theme: "system",
        sidebar_collapsed: false,
        version: 1,
      },
      error: null,
    }),
  );
  expect(
    await screen.findByText("Default language saved to your account."),
  ).toBeVisible();
  expect(document.documentElement).toHaveAttribute("lang", "en");
  expect(client.getQueryData(profileKey)).toMatchObject({ locale: "en" });
  await i18n.changeLanguage("de");
});

it("saves a new time zone without overwriting an existing biography in another language", async () => {
  await i18n.changeLanguage("de");
  fake.rpc.mockResolvedValue({
    data: { username: "fictional-guest", version: 1 },
    error: null,
  });
  const update = vi.fn(() => ({
    eq: () => ({
      select: () => ({
        single: async () => ({ data: { id: "guest-own" }, error: null }),
      }),
    }),
  }));
  fake.from.mockImplementation(() => ({
    update,
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: profile, error: null }) }),
    }),
  }));
  const profile = {
    id: "guest-own",
    luminovia_user_id: "LV-0001-0002-0003-0004-0005",
    display_name: "Fictional Guest",
    phone: "",
    time_zone: "Europe/Berlin",
    bio_de: "Deutscher Profiltext",
    bio_en: "A different English profile",
    locale: "de",
    active: true,
  };
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(["profile", "guest-own"], profile);
  client.setQueryData(["user-roles", "guest-own"], ["guest"]);
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Zeitzone" }),
    "Australia/Adelaide",
  );
  await user.click(screen.getByRole("button", { name: "Profil speichern" }));
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith({
      display_name: "Fictional Guest",
      phone: "",
      time_zone: "Australia/Adelaide",
    }),
  );
});
