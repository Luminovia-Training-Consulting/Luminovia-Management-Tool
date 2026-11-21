import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../lib/i18n";
import { DemoPage } from "./demo";

vi.mock("../../lib/installation-brand", async (original) => {
  const module =
    await original<typeof import("../../lib/installation-brand")>();
  return {
    ...module,
    installationBrand: {
      ...module.internalInstallationBrand,
      edition: "customer-managed",
      name: "Example Learning Centre",
      shortName: "Example Centre",
      logo: "/brand/customer-logo.svg",
      mark: "/brand/customer-mark.svg",
    },
    portalInternalEdition: false,
  };
});

vi.mock("../../lib/supabase", () => {
  throw new Error("Academy demo must stay independent of real account data");
});

beforeEach(async () => {
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

afterEach(() => vi.unstubAllGlobals());

it("applies academy branding and offers the fictional course workflow without internal destinations", () => {
  render(
    <MemoryRouter initialEntries={["/demo/jobs?role=admin"]}>
      <DemoPage />
    </MemoryRouter>,
  );
  expect(screen.getByLabelText("Demo role")).toHaveValue("admin");
  const sidebar = document.querySelector<HTMLElement>(".demo-sidebar")!;
  expect(within(sidebar).getByText("Example Learning Centre")).toBeVisible();
  expect(sidebar.querySelector("img")).toHaveAttribute(
    "src",
    "/brand/customer-mark.svg",
  );
  expect(
    screen.queryByText(/Luminovia|Practise claiming this job/),
  ).not.toBeInTheDocument();
  const nav = within(sidebar).getByRole("navigation");
  expect(nav.querySelector('a[href="/demo/jobs"]')).toBeNull();
  expect(nav.querySelector('a[href="/demo/contracts"]')).toBeNull();
  expect(nav.querySelector('a[href="/demo/finance"]')).toBeNull();
  expect(nav.querySelector('a[href="/demo/admin"]')).toBeNull();
  fireEvent.click(nav.querySelector('a[href="/demo/courses"]')!);
  fireEvent.click(screen.getAllByRole("link", { name: "Open course" })[0]);
  expect(
    screen.getByRole("heading", { name: "Course information & meeting" }),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText("Demo role"), {
    target: { value: "participant" },
  });
  expect(
    screen.getByRole("navigation", { name: "Course sections" }),
  ).toBeVisible();
  expect(screen.queryByText("Attendance register")).not.toBeInTheDocument();
});
