import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { AcademyWhiteLabelSetup } from "./academy-white-label-setup";

const api = vi.hoisted(() => ({
  installation: "650d49c4-3ea9-4b6a-862b-92be9b92eac6",
  readBrand: vi.fn(),
  readLinks: vi.fn(),
  save: vi.fn(),
}));

vi.mock("../../lib/installation-brand", async (original) => {
  const source =
    await original<typeof import("../../lib/installation-brand")>();
  return {
    ...source,
    installationBrand: {
      ...source.internalInstallationBrand,
      name: "Fictional School",
      shortName: "Fictional",
      edition: "customer-managed",
      installationId: api.installation,
    },
  };
});
vi.mock("./academy-branding", () => ({
  useAcademyBrandingQuery: () => ({
    queryKey: ["brand"],
    queryFn: api.readBrand,
  }),
}));
vi.mock("./academy-brand-links", () => ({
  useAcademyBrandLinksQuery: () => ({
    queryKey: ["links"],
    queryFn: api.readLinks,
  }),
}));
vi.mock("./academy-white-label", () => ({ saveAcademyWhiteLabel: api.save }));
vi.mock("./academy-logo-editor", () => ({ AcademyLogoEditor: () => null }));
vi.mock("./academy-pwa-icon-editor", () => ({
  AcademyPwaIconEditor: () => null,
}));

const branding = { name: null, short_name: null, theme_color: null };
const links = {
  support_url: null,
  privacy_url: null,
  legal_url: null,
  terms_url: null,
};
const brandSource = {
  installation_id: api.installation,
  version: 0,
  ...branding,
};
const linksSource = { installation_id: api.installation, version: 2, ...links };

beforeEach(async () => {
  vi.resetAllMocks();
  api.readBrand.mockResolvedValue(brandSource);
  api.readLinks.mockResolvedValue(linksSource);
  await i18n.changeLanguage("en");
});
afterEach(cleanup);

async function openSetup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <AcademyWhiteLabelSetup />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Open White Label setup" }),
  );
  return user;
}

it("applies branding and links together and can restore the package branding", async () => {
  const custom = {
    name: "Fictional Academy",
    short_name: "Fictional",
    theme_color: "#172b4b",
  };
  const customLinks = { ...links, support_url: "https://help.example.invalid" };
  api.save.mockResolvedValueOnce({
    branding: { ...brandSource, ...custom, version: 1 },
    links: { ...linksSource, ...customLinks, version: 3 },
  });
  api.save.mockResolvedValueOnce({
    branding: { ...brandSource, version: 2 },
    links: { ...linksSource, ...customLinks, version: 3 },
  });
  const user = await openSetup();
  expect(
    screen.getByRole("dialog", { name: "White Label setup" }),
  ).toBeVisible();
  expect(screen.getByText("Current portal address")).toBeVisible();
  expect(screen.getByText("Managed by the operator")).toBeVisible();
  const input = await screen.findByLabelText("Academy name");
  const save = screen.getByRole("button", { name: "Apply settings" });

  await user.clear(input);
  expect(save).toBeDisabled();
  await user.type(input, custom.name);
  await user.type(screen.getByLabelText("Support"), customLinks.support_url);
  await user.click(save);
  expect(await screen.findByText("Settings applied.")).toBeVisible();
  expect(api.save).toHaveBeenCalledWith(0, 2, custom, customLinks);

  await user.click(
    screen.getByRole("button", { name: "Use package branding" }),
  );
  await user.click(save);
  expect(api.save).toHaveBeenLastCalledWith(1, 3, branding, customLinks);
  expect(await screen.findByDisplayValue("Fictional School")).toBeVisible();
});

it("preserves package defaults when only the public links are changed", async () => {
  api.save.mockResolvedValue({
    branding: brandSource,
    links: {
      ...linksSource,
      support_url: "https://help.example.invalid",
      version: 3,
    },
  });
  const user = await openSetup();
  const field = await screen.findByLabelText("Support");
  const save = screen.getByRole("button", { name: "Apply settings" });
  await user.type(field, "http://help.example.invalid");
  expect(save).toBeDisabled();
  await user.clear(field);
  await user.type(field, "https://help.example.invalid");
  await user.click(save);
  expect(await screen.findByText("Settings applied.")).toBeVisible();
  expect(api.save).toHaveBeenCalledWith(0, 2, brandSource, {
    ...links,
    support_url: "https://help.example.invalid",
  });
});

it("retains the draft after a conflict until both current revisions are reloaded", async () => {
  api.save.mockRejectedValue({ code: "PT409" });
  const user = await openSetup();
  const input = await screen.findByLabelText("Academy name");
  await user.clear(input);
  await user.type(input, "Fictional draft");
  await user.click(screen.getByRole("button", { name: "Apply settings" }));
  await screen.findByText("The settings were updated elsewhere.");
  expect(input).toHaveValue("Fictional draft");
  expect(screen.getByRole("button", { name: "Apply settings" })).toBeDisabled();
  api.readBrand.mockResolvedValue({
    ...brandSource,
    version: 1,
    name: "Current brand",
    short_name: "Brand",
    theme_color: "#224466",
  });
  api.readLinks.mockResolvedValue({
    ...linksSource,
    version: 3,
    support_url: "https://current.example.invalid",
  });
  await user.click(
    screen.getByRole("button", { name: "Reload current settings" }),
  );
  expect(await screen.findByDisplayValue("Current brand")).toBeVisible();
  expect(
    screen.getByDisplayValue("https://current.example.invalid"),
  ).toBeVisible();
});
