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

const { read, saveName, saveAppearance } = vi.hoisted(() => ({
  read: vi.fn(),
  saveName: vi.fn(),
  saveAppearance: vi.fn(),
}));
vi.mock("../auth/auth-context", () => ({
  useAuth: () => ({ session: { user: { id: "learner" } } }),
}));
vi.mock("../../lib/online", () => ({ useOnline: () => true }));
vi.mock("./academy-personal-settings-api", () => ({
  academyPersonalSettingsQuery: (actor: string) => ({
    queryKey: ["academy-personal-settings", actor],
    queryFn: read,
    retry: false,
  }),
  saveAcademyUsername: saveName,
  saveAcademyAppearance: saveAppearance,
}));

const current = {
  username: { username: "saved.learner", version: 2 },
  appearance: { language: "en", theme: "system", version: 0 },
};

beforeEach(async () => {
  vi.resetAllMocks();
  read.mockResolvedValue(current);
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

it("refreshes the current version after a stale username without overwriting the new alias", async () => {
  saveName.mockRejectedValueOnce({ code: "PT409" });
  const user = setup();
  const input = await screen.findByRole("textbox", { name: "Username" });
  await user.clear(input);
  await user.type(input, " Another.Name ");
  read.mockResolvedValue({
    ...current,
    username: { username: "newer.alias", version: 3 },
  });
  await user.click(screen.getByRole("button", { name: "Save username" }));
  expect(saveName).toHaveBeenCalledWith("learner", "another.name", 2);
  expect(await screen.findByText(/username changed/i)).toBeVisible();
  expect(input).toHaveValue("newer.alias");
});

it("uses one accessible settings control and persists both first-save browser choices", async () => {
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
      language: "en",
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
  expect(screen.getByText(/saved\.learner/)).toBeVisible();
  expect(
    screen.queryByRole("textbox", { name: "Benutzername" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("combobox", { name: "Farbschema" }),
  ).not.toBeInTheDocument();
  expect(document.documentElement.dataset.theme).toBe("dark");
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
      language: "en",
      theme: "dark",
    }),
  );
  expect(theme).toHaveValue("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
});
