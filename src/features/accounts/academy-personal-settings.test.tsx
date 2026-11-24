import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import {
  AcademyAppearancePreferences,
  AcademyPersonalSettingsPage,
} from "./academy-personal-settings";

const { read, saveName, saveAppearance, readDelivery, saveDelivery } =
  vi.hoisted(() => ({
    read: vi.fn(),
    saveName: vi.fn(),
    saveAppearance: vi.fn(),
    readDelivery: vi.fn(),
    saveDelivery: vi.fn(),
  }));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "learner" } } }),
}));
vi.mock("../../lib/online", () => ({
  useOnline: () => true,
  requireOnline: vi.fn(),
}));
vi.mock("./academy-personal-settings-api", () => ({
  academyPersonalSettingsQuery: (actor: string) => ({
    queryKey: ["academy-personal-settings", actor],
    queryFn: read,
    retry: false,
  }),
  saveAcademyDisplayName: saveName,
  saveAcademyAppearance: saveAppearance,
}));
vi.mock("../notifications/delivery-api", async (load) => {
  const original = await load<typeof import("../notifications/delivery-api")>();
  return {
    ...original,
    deliveryPreferencesQuery: (actor: string) => ({
      queryKey: original.deliveryKey(actor),
      queryFn: readDelivery,
    }),
    saveDeliveryPreferences: saveDelivery,
  };
});

const current = {
  display_name: "Saved Learner",
  appearance: { language: "en", theme: "system", version: 0 },
};
const delivery = {
  email_enabled: false,
  quiet_start: null,
  quiet_end: null,
  time_zone: "Europe/Berlin",
  version: 1,
};

beforeEach(async () => {
  vi.resetAllMocks();
  read.mockResolvedValue(current);
  readDelivery.mockResolvedValue(delivery);
  await i18n.changeLanguage("en");
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

it("starts with email off and confirms only the learner's opt-in preferences", async () => {
  saveDelivery.mockResolvedValue({
    ...delivery,
    email_enabled: true,
    version: 2,
  });
  const user = setup();
  const checkbox = await screen.findByRole("checkbox", {
    name: "Receive additional alerts by email",
  });
  expect(checkbox).not.toBeChecked();
  await user.click(checkbox);
  await user.click(
    screen.getByRole("button", { name: "Save email preferences" }),
  );
  expect(await screen.findByText("Email preferences saved.")).toBeVisible();
  expect(saveDelivery).toHaveBeenCalledWith({
    ...delivery,
    email_enabled: true,
  });
});
afterEach(async () => {
  cleanup();
  localStorage.removeItem("luminovia.theme");
  await i18n.changeLanguage("de");
  vi.unstubAllGlobals();
});

function setup({
  access = "active",
  path = "/settings",
}: {
  access?: "active" | "grace";
  path?: string;
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            element={
              <>
                <AcademyAppearancePreferences actor="learner" access={access} />
                <Outlet context={access} />
              </>
            }
          >
            <Route path="/settings" element={<AcademyPersonalSettingsPage />} />
            <Route path="/learning" element={<p>Learning</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

it("changes the display name while providing email settings and no username field", async () => {
  saveName.mockResolvedValue("Updated Learner");
  const user = setup();
  const input = await screen.findByRole("textbox", { name: "Display name" });
  expect(
    screen.queryByRole("textbox", { name: "Username" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("textbox", { name: "New email address" }),
  ).toBeVisible();
  await user.clear(input);
  await user.type(input, "Updated Learner");
  await user.click(screen.getByRole("button", { name: "Save" }));
  expect(saveName).toHaveBeenCalledWith("learner", "Updated Learner");
  expect(await screen.findByText("Saved.")).toBeVisible();
});

it("uses one accessible settings control and preserves the account language on a first theme save", async () => {
  localStorage.setItem("luminovia.theme", "dark");
  saveAppearance.mockResolvedValue({
    language: "en",
    theme: "light",
    version: 1,
  });
  const user = setup();
  await screen.findByRole("heading", { name: "My settings" });
  const theme = screen.getByRole("combobox", { name: "Theme" });
  expect(theme).toHaveValue("dark");
  await user.selectOptions(theme, "light");
  await waitFor(() =>
    expect(saveAppearance).toHaveBeenCalledWith("learner", {
      theme: "light",
    }),
  );
  expect(document.documentElement.dataset.theme).toBe("light");
});

it("applies the saved account appearance on entry and leaves grace read-only", async () => {
  read.mockResolvedValue({
    ...current,
    appearance: { language: "de", theme: "dark", version: 3 },
  });
  setup({ access: "grace" });
  expect(
    await screen.findByRole("heading", { name: "Meine Einstellungen" }),
  ).toBeVisible();
  expect(
    screen.getByText("Deine Einstellungen sind derzeit nur lesbar."),
  ).toBeVisible();
  expect(screen.getByText(/Saved Learner/)).toBeVisible();
  expect(
    screen.queryByRole("textbox", { name: "Benutzername" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "Farbschema" }),
  ).not.toBeInTheDocument();
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(readDelivery).not.toHaveBeenCalled();
});

it("does not replace a local selection when an older load completes", async () => {
  let finishLoad!: (value: typeof current) => void;
  read.mockReturnValueOnce(
    new Promise<typeof current>((resolve) => {
      finishLoad = resolve;
    }),
  );
  saveAppearance.mockResolvedValue({
    language: "en",
    theme: "dark",
    version: 8,
  });
  const user = setup({ path: "/learning" });
  const theme = screen.getByRole("combobox", { name: "Theme" });
  await user.selectOptions(theme, "dark");
  finishLoad({
    ...current,
    appearance: { language: "en", theme: "light", version: 7 },
  });
  await waitFor(() =>
    expect(saveAppearance).toHaveBeenCalledWith("learner", {
      theme: "dark",
    }),
  );
  expect(theme).toHaveValue("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
});
