/**
 * Regressions for language/theme changes when browser storage is blocked. DOM fixtures isolate
 * preference behavior; full browser acceptance remains separate.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { waitFor } from "@testing-library/react";
import { Preferences } from "./shell";
import "../lib/i18n";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

/** Simulate the system colour-scheme notification without changing operating-system settings. */
function systemDark() {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
}

it("keeps the theme selector functional when browser storage is blocked", () => {
  systemDark();
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new DOMException("Storage blocked", "SecurityError");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Storage blocked", "SecurityError");
  });
  expect(() => render(<Preferences />)).not.toThrow();
  const selector = screen.getByLabelText("Farbschema");
  expect(selector).toBeVisible();
  expect(document.documentElement.dataset.theme).toBe("dark");
  fireEvent.change(selector, { target: { value: "light" } });
  expect(document.documentElement.dataset.theme).toBe("light");
});

it("normalises an obsolete saved theme to the actual system theme", () => {
  systemDark();
  localStorage.setItem("luminovia.theme", "obsolete-theme");
  render(<Preferences />);
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem("luminovia.theme")).toBe("system");
});

it("synchronizes header and settings theme controls without duplicate label targets", () => {
  systemDark();
  render(
    <>
      <Preferences />
      <Preferences />
    </>,
  );
  const themes = screen.getAllByLabelText("Farbschema");
  expect(themes).toHaveLength(2);
  expect(themes[0].id).not.toBe(themes[1].id);
  fireEvent.change(themes[0], { target: { value: "light" } });
  expect(themes[1]).toHaveValue("light");
  expect(document.documentElement.dataset.theme).toBe("light");
  fireEvent.change(themes[1], { target: { value: "dark" } });
  expect(themes[0]).toHaveValue("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
});

it("sends signed-in visual changes to the own-account API", async () => {
  systemDark();
  const saveUiPreferences = vi.fn().mockResolvedValue({
    language: "de",
    theme: "light",
    sidebar_collapsed: false,
    version: 1,
  });
  render(<Preferences onSave={saveUiPreferences} />);
  fireEvent.change(screen.getByLabelText("Farbschema"), {
    target: { value: "light" },
  });
  await waitFor(() =>
    expect(saveUiPreferences).toHaveBeenCalledWith({ theme: "light" }),
  );
});
