/**
 * DOM regressions for explicit tour navigation, actor-scoped progress, capability changes and
 * keyboard focus. Browser-storage fixtures do not replace native authorization/MFA checks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import i18n from "../../lib/i18n";
import { PortalTour } from "./tour";
import {
  initialTour,
  permittedTourModules,
  readTour,
  storeTour,
} from "./tour-state";
import { guideModules } from "./catalog";
function Location() {
  return <output aria-label="route">{useLocation().pathname}</output>;
}
function mount(
  roles: string[] = ["lecturer"],
  permissions: string[] = [],
  ready = true,
  actor = "fictional",
) {
  return render(
    <MemoryRouter>
      <PortalTour
        key={actor}
        actor={actor}
        roles={roles}
        permissions={permissions}
        ready={ready}
      />
      <Location />
    </MemoryRouter>,
  );
}
beforeEach(async () => {
  sessionStorage.clear();
  await i18n.changeLanguage("de");
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
describe("live portal guidance", () => {
  it("navigates only after explicit choices, pauses and resumes after remount per actor", async () => {
    const user = userEvent.setup();
    const page = mount();
    await user.click(screen.getByRole("button", { name: "Portal-Rundgang" }));
    expect(screen.getByText(/Du bist im echten Portal/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Weiter" }));
    const modules = permittedTourModules(["lecturer"], []);
    expect(screen.getByLabelText("route")).toHaveTextContent(modules[1].path);
    await user.click(screen.getByRole("button", { name: "Pausieren" }));
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    page.unmount();
    mount();
    await user.click(
      screen.getByRole("button", { name: "Rundgang fortsetzen" }),
    );
    expect(screen.getByLabelText("route")).toHaveTextContent(modules[1].path);
    expect(readTour("other-account")).toEqual(initialTour);
  });
  it("keeps the current step on a language switch, supports keyboard pause and full finish/restart", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "Portal-Rundgang" }));
    await user.click(screen.getByRole("button", { name: "Weiter" }));
    const state = readTour("fictional");
    await i18n.changeLanguage("en");
    expect(screen.getByRole("region", { name: "Portal tour" })).toBeVisible();
    expect(readTour("fictional")).toEqual(state);
    const select = screen.getByRole("combobox", { name: "Choose a section" });
    select.focus();
    await user.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Resume tour" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Resume tour" }));
    const modules = permittedTourModules(["lecturer"], []);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Choose a section" }),
      modules.at(-1)!.id,
    );
    await user.click(screen.getByRole("button", { name: "Finish tour" }));
    expect(screen.getByRole("button", { name: "Portal tour" })).toHaveFocus();
    expect(
      within(screen.getByRole("region", { name: "Portal tour" })).getByRole(
        "status",
      ),
    ).toHaveTextContent("Tour completed");
    await user.click(screen.getByRole("button", { name: "Portal tour" }));
    expect(readTour("fictional").step).toBe(modules[0].id);
  });
  it("waits for permissions and immediately removes revoked destinations", async () => {
    const user = userEvent.setup();
    const page = mount(
      ["admin"],
      ["users.manage", "qualifications.verify", "audit.read"],
      false,
    );
    expect(
      screen.getByRole("button", { name: "Portal-Rundgang" }),
    ).toBeDisabled();
    page.rerender(
      <MemoryRouter>
        <PortalTour
          actor="fictional"
          roles={["admin"]}
          permissions={["users.manage", "qualifications.verify", "audit.read"]}
          ready
        />
        <Location />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: "Portal-Rundgang" }));
    const audit = guideModules.find(
      (module) => module.path === "/admin/audit",
    )!;
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Bereich auswählen" }),
      audit.id,
    );
    page.rerender(
      <MemoryRouter>
        <PortalTour
          actor="fictional"
          roles={["participant"]}
          permissions={[]}
          ready
        />
        <Location />
      </MemoryRouter>,
    );
    const options = within(screen.getByRole("combobox")).getAllByRole("option");
    expect(
      options.some((item) => item.getAttribute("value") === audit.id),
    ).toBe(false);
    expect(
      screen.getByRole("link", { name: "Hilfe zu diesem Bereich" }),
    ).not.toHaveAttribute("href", expect.stringContaining(audit.id));
  });
  it("validates session storage and tolerates browser storage denial", async () => {
    sessionStorage.setItem(
      "luminovia.tour.v1.bad",
      '{"status":"active","step":"/admin/forged"}',
    );
    expect(readTour("bad")).toEqual(initialTour);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readTour("bad")).toEqual(initialTour);
    expect(() =>
      storeTour("bad", { status: "paused", step: "home" }),
    ).not.toThrow();
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole("button", { name: "Portal-Rundgang" }));
    expect(screen.getByRole("progressbar")).toBeVisible();
  });
  it("never derives administrative paths from an unrelated role", () => {
    for (const role of [
      "participant",
      "client",
      "lecturer",
      "senior_lecturer",
      "management",
    ]) {
      const modules = permittedTourModules([role], []);
      expect(modules.some((module) => module.path.startsWith("/admin"))).toBe(
        false,
      );
    }
    expect(
      permittedTourModules(["management"], ["users.manage"]).some(
        (module) => module.path === "/admin/people",
      ),
    ).toBe(false);
    expect(
      permittedTourModules(
        ["management"],
        ["users.manage", "qualifications.verify"],
      ).some((module) => module.path === "/admin/people"),
    ).toBe(true);
  });
});
