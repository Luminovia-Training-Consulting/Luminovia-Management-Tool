/** Verify role-specific default previews without granting gross detail to unauthorized actors. */
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import i18n from "../../lib/i18n";
import { RoleFeePreview } from "./pricing";
import type { CommissionAccess } from "./commission-api";

afterEach(cleanup);

it("shows distinct regular and senior lecturer defaults from the current offer policy", async () => {
  await i18n.changeLanguage("de");
  const access = {
    can_manage_gross: true,
    policy_configured: true,
    regular_lecturer_percent: 31,
    senior_lecturer_percent: 73,
  } as CommissionAccess;
  render(<RoleFeePreview gross={100} currency="EUR" access={access} />);

  expect(
    screen.getByRole("heading", {
      name: /Dozent:in – Standardanteil \(31\s*%\)/,
    }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", {
      name: /Senior-Dozent:in – Standardanteil \(73\s*%\)/,
    }),
  ).toBeVisible();
  expect(screen.getAllByRole("group")).toHaveLength(2);
  expect(
    screen.getByText(/angenommene Honorare bleiben unverändert/),
  ).toBeVisible();
});

it("keeps the fallback at 50 percent only until no policy has been configured", async () => {
  await i18n.changeLanguage("en");
  const access = {
    can_manage_gross: true,
    policy_configured: false,
    regular_lecturer_percent: null,
    senior_lecturer_percent: null,
  } as CommissionAccess;
  render(<RoleFeePreview gross={200} currency="EUR" access={access} />);

  expect(
    screen.getByRole("heading", {
      name: /Lecturer — default share \(50\s*%\)/,
    }),
  ).toBeVisible();
  expect(
    screen.getByRole("heading", {
      name: /Senior lecturer — default share \(50\s*%\)/,
    }),
  ).toBeVisible();
});

it("does not render role percentages when gross-finance permission is absent", async () => {
  await i18n.changeLanguage("en");
  const access = {
    can_manage_gross: false,
    regular_lecturer_percent: 31,
    senior_lecturer_percent: 73,
  } as CommissionAccess;

  const { container } = render(
    <RoleFeePreview gross={100} currency="EUR" access={access} />,
  );
  expect(container).toBeEmptyDOMElement();
  expect(screen.queryByText(/default share/)).not.toBeInTheDocument();
});
