/**
 * Vitest-Regressionen für Sprach-/Farbschemawechsel bei blockiertem Browserstorage. SDK-/DOM-Fixtures isolieren den Browservertrag; echte RLS-, Auth-, Storage- und Browserabnahme bleibt Teil des separaten Gesamtprüflaufs.
 */
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Preferences } from "./shell";
import "../lib/i18n";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

/** Simuliert die System-Farbschemameldung ohne echte Betriebssystemeinstellungen zu verändern. */
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
