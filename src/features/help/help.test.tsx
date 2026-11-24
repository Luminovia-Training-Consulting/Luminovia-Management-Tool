/**
 * DOM regressions for URL-selected guides, bilingual search, language switches and recovery text.
 * Catalog checks cover authored completeness and route identity, not live feature permissions.
 */
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import i18n from "../../lib/i18n";
import { HelpCenter } from "./help";
import { guideModules, guideText } from "./catalog";

beforeEach(async () => {
  await i18n.changeLanguage("de");
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
});

function page(path = "/help") {
  const router = createMemoryRouter(
    [
      { path: "/help", element: <HelpCenter /> },
      { path: "/assistance", element: <HelpCenter embedded /> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("public bilingual help", () => {
  it("opens a practical claim guide directly and keeps the topic while switching languages", async () => {
    page("/help?topic=jobs");
    expect(
      screen.getByRole("heading", { level: 2, name: "Aufträge übernehmen" }),
    ).toBeVisible();
    expect(
      screen.getByText(/Erst die erfolgreiche Datenbankbestätigung/),
    ).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText("Sprache"), "en");
    expect(
      screen.getByRole("heading", { level: 2, name: "Claim jobs" }),
    ).toBeVisible();
    expect(
      screen.getByText(/Only successful database confirmation/),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open section in the portal" }),
    ).toHaveAttribute("href", "/jobs");
  });
  it("finds recovery text across languages and clears an empty result without backend data", async () => {
    page();
    const search = screen.getByRole("searchbox", {
      name: "Suche in der Hilfe",
    });
    await userEvent.type(search, "quarantine");
    expect(screen.getByRole("link", { name: /Dateizentrale/ })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Kursbewertungen/ }),
    ).not.toBeInTheDocument();
    await userEvent.clear(search);
    await userEvent.type(search, "no-such-article-6729");
    expect(
      screen.getByText("Keine passende Anleitung gefunden."),
    ).toBeVisible();
    await userEvent.click(
      screen.getByRole("button", { name: "Suche zurücksetzen" }),
    );
    expect(search).toHaveValue("");
    expect(search).toHaveFocus();
    expect(screen.getByRole("link", { name: /Kursbewertungen/ })).toBeVisible();
  });
  it("updates selected guides on actual URL navigation and tolerates unknown topics", async () => {
    const router = page("/help?topic=files");
    expect(
      screen.getByRole("heading", { level: 2, name: "Dateizentrale" }),
    ).toBeVisible();
    await act(async () => router.navigate("/help?topic=security"));
    expect(
      screen.getByRole("heading", { level: 2, name: "Anmeldung & Sicherheit" }),
    ).toBeVisible();
    await act(async () => router.navigate("/help?topic=missing-topic"));
    expect(screen.getByText(/Diese Anleitung gibt es nicht/)).toBeVisible();
    expect(screen.getByRole("link", { name: /Dateizentrale/ })).toBeVisible();
  });
  it("provides general error recovery without sending or asking for secrets", async () => {
    page("/help?topic=troubleshooting");
    expect(
      screen.getByRole("heading", {
        name: "Probleme Schritt für Schritt lösen",
      }),
    ).toBeVisible();
    expect(
      screen.getByText(/Diese Hilfe sendet keine Nachricht/),
    ).toBeVisible();
    expect(screen.getByText(/Teile keine Passwörter, Schlüssel/)).toBeVisible();
    await userEvent.selectOptions(screen.getByLabelText("Sprache"), "en");
    expect(
      screen.getByRole("heading", { name: "Solve problems step by step" }),
    ).toBeVisible();
    expect(screen.getByText(/This help page sends no message/)).toBeVisible();
  });
  it("opens a selected guide from search results", async () => {
    const router = page();
    await userEvent.type(screen.getByRole("searchbox"), "Sommerzeit");
    await userEvent.click(screen.getByRole("link", { name: /Kalender/ }));
    expect(router.state.location.search).toBe("?topic=calendar");
    expect(
      screen.getByRole("heading", { level: 2, name: "Kalender" }),
    ).toBeVisible();
    expect(screen.getByRole("searchbox")).toHaveValue("");
  });
  it("restores focus when search reopens the same selected guide", async () => {
    const router = page("/help?topic=jobs");
    await userEvent.type(screen.getByRole("searchbox"), "Übernahme");
    expect(
      screen.queryByRole("heading", { level: 2, name: "Aufträge übernehmen" }),
    ).not.toBeInTheDocument();
    await userEvent.clear(screen.getByRole("searchbox"));
    expect(screen.getByRole("searchbox")).toHaveFocus();
    await userEvent.type(screen.getByRole("searchbox"), "Übernahme");
    await userEvent.click(
      screen.getByRole("link", { name: /^Aufträge übernehmen/ }),
    );
    expect(router.state.location.search).toBe("?topic=jobs");
    expect(
      screen.getByRole("heading", { level: 2, name: "Aufträge übernehmen" }),
    ).toHaveFocus();
  });
  it("keeps assistance context through category, keyboard article selection and recovery", async () => {
    const router = page("/assistance?section=help");
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Themenbereich" }),
      "courses",
    );
    expect(router.state.location.search).toBe("?section=help&area=courses");
    expect(screen.queryByRole("link", { name: /^Dateizentrale/ })).toBeNull();
    const course = screen.getByRole("link", {
      name: /^Meine Kurse und Lernmaterialien/,
    });
    course.focus();
    await userEvent.keyboard("{Enter}");
    expect(router.state.location.pathname).toBe("/assistance");
    expect(router.state.location.search).toBe(
      "?section=help&area=courses&topic=lms-learning",
    );
    expect(
      screen.getByRole("heading", {
        name: "Meine Kurse und Lernmaterialien",
        level: 2,
      }),
    ).toHaveFocus();
    await userEvent.click(
      screen.getByRole("button", { name: /^Zur Übersicht(?: |$)/ }),
    );
    expect(screen.getByRole("searchbox")).toHaveFocus();
    await userEvent.click(
      screen.getByRole("button", { name: /^Probleme lösen(?: |$)/ }),
    );
    const recovery = screen.getByRole("region", {
      name: "Probleme Schritt für Schritt lösen",
    });
    await userEvent.click(
      within(recovery).getByRole("link", { name: "Anmeldung & Sicherheit" }),
    );
    expect(router.state.location.search).toBe(
      "?section=help&area=courses&topic=security",
    );
    expect(
      screen.getByRole("heading", { name: "Anmeldung & Sicherheit", level: 2 }),
    ).toHaveFocus();
  });
  it("documents internal Premium activation and email sign-in", async () => {
    const router = page("/help?topic=premium-lms");
    expect(
      screen.getByText(
        /Verwaltung → Unternehmen und wähle das aktive Unternehmen/,
      ),
    ).toBeVisible();
    await act(async () => router.navigate("/help?topic=security"));
    expect(
      screen.getByText(/mit deiner E-Mail-Adresse und deinem Passwort/),
    ).toBeVisible();
    expect(screen.getByText(/Postfach des Kontos/)).toBeVisible();
  });
  it("keeps complete authored guides and unique routes for every current section", () => {
    expect(new Set(guideModules.map((module) => module.id)).size).toBe(
      guideModules.length,
    );
    expect(new Set(guideModules.map((module) => module.path)).size).toBe(
      guideModules.length,
    );
    for (const module of guideModules) {
      expect(module.path.startsWith("/")).toBe(true);
      for (const language of ["de", "en"]) {
        expect(guideText(module.title, language).trim().length).toBeGreaterThan(
          0,
        );
        expect(guideText(module.steps, language).length).toBeGreaterThanOrEqual(
          3,
        );
        expect(
          guideText(module.resolution, language).length,
        ).toBeGreaterThanOrEqual(2);
      }
    }
    expect(guideText({ de: "Deutsch", en: "English" }, "de-DE")).toBe(
      "Deutsch",
    );
    expect(guideText({ de: "Deutsch", en: "English" }, "en-AU")).toBe(
      "English",
    );
  });
});
