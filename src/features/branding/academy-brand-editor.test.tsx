import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { AcademyBrandEditor } from "./academy-brand-editor";
import type { AcademyBrandingSettings } from "./academy-branding-schema";

const ids = vi.hoisted(() => ({
  installation: "650d49c4-3ea9-4b6a-862b-92be9b92eac6",
  read: vi.fn(),
  save: vi.fn(),
}));

vi.mock("../../lib/installation-brand", async (original) => {
  const source =
    await original<typeof import("../../lib/installation-brand")>();
  return {
    ...source,
    installationBrand: {
      ...source.internalInstallationBrand,
      name: "Practice School",
      shortName: "Practice",
      edition: "customer-managed",
      installationId: ids.installation,
    },
  };
});
vi.mock("./academy-branding", () => ({
  useAcademyBrandingQuery: () => ({ queryKey: ["brand"], queryFn: ids.read }),
  saveAcademyBranding: ids.save,
}));

const defaults: AcademyBrandingSettings = {
  installation_id: ids.installation,
  version: 0,
  name: null,
  short_name: null,
  theme_color: null,
};

beforeEach(async () => {
  vi.resetAllMocks();
  ids.read.mockResolvedValue(defaults);
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

function showEditor() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AcademyBrandEditor />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

it("updates current branding and restores the signed package defaults", async () => {
  const custom = {
    name: "Fictional Academy",
    short_name: "Practice",
    theme_color: "#172b4b",
  };
  ids.save.mockResolvedValueOnce({ ...defaults, ...custom, version: 1 });
  ids.save.mockResolvedValueOnce({ ...defaults, version: 2 });
  const user = showEditor();
  const input = await screen.findByLabelText("Academy name");
  const save = screen.getByRole("button", { name: "Save branding" });
  await user.clear(input);
  expect(save).toBeDisabled();
  await user.type(input, custom.name);
  await user.click(save);
  expect(await screen.findByText("Branding saved.")).toBeVisible();
  expect(ids.save).toHaveBeenCalledWith(0, custom);
  await user.click(
    screen.getByRole("button", { name: "Use package branding" }),
  );
  expect(ids.save).toHaveBeenLastCalledWith(1, {
    name: null,
    short_name: null,
    theme_color: null,
  });
  expect(await screen.findByDisplayValue("Practice School")).toBeVisible();
});

it("retains the current draft until the administrator reloads competing changes", async () => {
  ids.save.mockRejectedValue({ code: "PT409" });
  const user = showEditor();
  const input = await screen.findByLabelText("Academy name");
  await user.clear(input);
  await user.type(input, "Fictional draft");
  await user.click(screen.getByRole("button", { name: "Save branding" }));
  await screen.findByText("Branding was updated elsewhere.");
  expect(input).toHaveValue("Fictional draft");
  expect(screen.getByRole("button", { name: "Save branding" })).toBeDisabled();
  ids.read.mockResolvedValue({
    ...defaults,
    version: 1,
    name: "Current brand",
    short_name: "Brand",
    theme_color: "#224466",
  });
  await user.click(
    screen.getByRole("button", { name: "Reload current branding" }),
  );
  expect(await screen.findByDisplayValue("Current brand")).toBeVisible();
});
