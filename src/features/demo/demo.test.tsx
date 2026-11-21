/**
 * DOM regressions for fictional workflows, navigation, reset and keyboard focus. Mocked backend
 * imports and fetch expose accidental demo coupling; these fixtures do not test live workflows.
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import i18n from "../../lib/i18n";
import { DemoPage } from "./demo";
import { guideModules } from "../help/catalog";

// Any accidental backend import is a broken isolation boundary, even if a
// particular fixture interaction does not happen to invoke its query function.
vi.mock("../../lib/supabase", () => {
  throw new Error("Demo must not import a backend client");
});
const network = vi.fn(() =>
  Promise.reject(new Error("Demo must not send requests")),
);

function open(path = "/demo") {
  const needsRole = path === "/demo/admin" || path === "/demo/client";
  const rendered = render(
    <MemoryRouter initialEntries={[needsRole ? "/demo" : path]}>
      <DemoPage />
    </MemoryRouter>,
  );
  if (needsRole) section(path.replace(/^\/demo/, ""));
  return rendered;
}

function section(path: string) {
  if (path === "/admin" || path === "/client") {
    fireEvent.change(screen.getByLabelText("Demo-Rolle"), {
      target: { value: path === "/admin" ? "admin" : "client" },
    });
  }
  const nav = within(
    document.querySelector(".demo-sidebar") as HTMLElement,
  ).getByRole("navigation", { name: "Demo-Bereiche" });
  const link = [...nav.querySelectorAll("a")].find(
    (item) => item.getAttribute("href") === `/demo${path}`,
  )!;
  fireEvent.click(link);
}

beforeEach(async () => {
  await i18n.changeLanguage("de");
  vi.stubGlobal("fetch", network);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  network.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("public fictional demo boundary", () => {
  it("covers every catalog section without exposing backend or file upload controls", () => {
    open();
    const nav = within(
      document.querySelector(".demo-sidebar") as HTMLElement,
    ).getByRole("navigation", { name: "Demo-Bereiche" });
    expect(within(nav).getAllByRole("link").length).toBeGreaterThan(10);
    expect(within(nav).getAllByRole("link").length).toBeLessThan(
      guideModules.length,
    );
    expect(
      screen.getAllByText("DEMO · Nur fiktive Daten").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/sendet keine Nachrichten oder E-Mails/).length,
    ).toBeGreaterThan(0);
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(network).not.toHaveBeenCalled();
  });
  it("claims only the complete fictional block and reflects both sessions in the local calendar", () => {
    open("/demo/jobs");
    fireEvent.change(screen.getByLabelText("Ergebnis ausprobieren"), {
      target: { value: "conflict" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Auftrag zur Probe übernehmen" }),
    );
    expect(
      screen.getByText(/Simulation: Ein Termin überschneidet sich/),
    ).toBeVisible();
    expect(screen.getByText("Noch offen")).toBeVisible();
    fireEvent.change(screen.getByLabelText("Ergebnis ausprobieren"), {
      target: { value: "success" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Auftrag zur Probe übernehmen" }),
    );
    expect(
      screen.getByText(/Simulation: Der gesamte Block ist reserviert/),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Auftrag zur Probe übernehmen" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Demo-Rolle"), {
      target: { value: "client" },
    });
    fireEvent.change(screen.getByLabelText("Demo-Rolle"), {
      target: { value: "lecturer" },
    });
    expect(screen.getByText("In der Demo übernommen")).toBeVisible();
    section("/calendar");
    expect(
      screen.getByText("Demo-Auftrag: beide bestätigten Termine"),
    ).toBeVisible();
    expect(screen.getByText(/06.05.2030/)).toBeVisible();
    expect(screen.getByText(/07.05.2030/)).toBeVisible();
    expect(network).not.toHaveBeenCalled();
  });
  it.each(["filled", "qualification", "offline"])(
    "explains a %s rejection without reserving the offer",
    (value) => {
      open("/demo/jobs");
      fireEvent.change(screen.getByLabelText("Ergebnis ausprobieren"), {
        target: { value },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Auftrag zur Probe übernehmen" }),
      );
      expect(screen.getByText("Noch offen")).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Auftrag zur Probe übernehmen" }),
      ).toBeEnabled();
      expect(screen.getByRole("status")).toHaveTextContent("Simulation:");
      expect(network).not.toHaveBeenCalled();
    },
  );
  it("keeps chat text local, renders it as text, and clears it with reset", () => {
    open("/demo/chats");
    const message = '<img src=x onerror="alert(1)">';
    fireEvent.change(screen.getByLabelText("Demo-Nachricht"), {
      target: { value: message },
    });
    fireEvent.click(screen.getByRole("button", { name: "In Demo senden" }));
    expect(screen.getByText(message)).toBeVisible();
    expect(document.querySelector(".demo-messages img")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Demo zurücksetzen" }));
    expect(screen.queryByText(message)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Demo-Nachricht")).toHaveValue("");
    expect(network).not.toHaveBeenCalled();
  });
  it("keeps fictional profile edits across language/section changes but loses them when unmounted", async () => {
    const first = open("/demo/profile");
    fireEvent.change(screen.getByLabelText("Fiktiver Anzeigename"), {
      target: { value: "Demo Rowan" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Demo-Profil speichern" }),
    );
    await act(() => i18n.changeLanguage("en"));
    expect(screen.getByRole("heading", { name: "Demo Rowan" })).toBeVisible();
    expect(
      screen.getByText("Demo profile updated only in memory."),
    ).toBeVisible();
    first.unmount();
    open("/demo/profile");
    expect(screen.getByLabelText("Fictional display name")).toHaveValue(
      "Demo Alex",
    );
    expect(network).not.toHaveBeenCalled();
  });
  it("navigates a guided tour, pauses without navigation, and supports catalog query links", () => {
    open(`/demo?module=${guideModules[0].id}`);
    fireEvent.click(screen.getByRole("button", { name: "Rundgang starten" }));
    fireEvent.click(screen.getByRole("button", { name: "Nächster Bereich" }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      guideModules[1].title.de,
    );
    fireEvent.click(screen.getByRole("button", { name: "Rundgang pausieren" }));
    expect(
      screen.queryByRole("button", { name: "Nächster Bereich" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      guideModules[1].title.de,
    );
  });
  it("resets calendar, scan and invoice practice across sections", () => {
    open("/demo/calendar");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Fiktiven privaten Termin hinzufügen",
      }),
    );
    section("/files");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Prüfung einer Beispieldatei simulieren",
      }),
    );
    expect(screen.getByText(/Demo-Datei: Prüfung bestanden/)).toBeVisible();
    section("/finance");
    fireEvent.click(
      screen.getByRole("button", { name: "Fiktive Rechnung vormerken" }),
    );
    expect(screen.getByText(/Demo-Rechnung DEMO-001 vorgemerkt/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Demo zurücksetzen" }));
    expect(
      screen.getByRole("button", { name: "Fiktive Rechnung vormerken" }),
    ).toBeEnabled();
    section("/calendar");
    expect(screen.getByText("Noch kein eigener Demo-Termin.")).toBeVisible();
    section("/files");
    expect(
      screen.getByText("Beispielstatus: wartet auf Prüfung"),
    ).toBeVisible();
  });
});

describe("connected fictional workflows", () => {
  it("offers role-scoped dashboard shortcuts and filters only fictional courses", async () => {
    open();
    const shortcuts = screen.getByRole("navigation", {
      name: "Demo-Schnellzugriff",
    });
    expect(
      within(shortcuts).getByRole("link", { name: "Aufträge übernehmen" }),
    ).toHaveAttribute("href", "/demo/jobs");
    fireEvent.change(screen.getByLabelText("Demo-Rolle"), {
      target: { value: "participant" },
    });
    const learnerNavigation = within(
      document.querySelector(".demo-sidebar")!,
    ).getByRole("navigation", { name: "Demo-Bereiche" });
    expect(
      within(learnerNavigation)
        .getAllByRole("link")
        .map((item) => item.getAttribute("href")),
    ).toEqual(["/demo/learning", "/demo/my-reviews", "/demo/notifications"]);
    expect(screen.getByRole("heading", { name: "Meine Kurse" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Linux Grundlagen · Demo-Akademie" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Netzwerkeinstieg · Demo-Akademie" }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Kurse filtern"), {
      target: { value: "upcoming" },
    });
    expect(
      screen.queryByRole("heading", {
        name: "Netzwerkeinstieg · Demo-Akademie",
      }),
    ).not.toBeInTheDocument();
    await act(() => i18n.changeLanguage("en"));
    expect(
      screen.getByRole("heading", { name: "Linux basics · Demo Academy" }),
    ).toBeVisible();
    expect(network).not.toHaveBeenCalled();
  });
  it("opens course-scoped sections and keeps practice chat, material and quiz actions isolated", () => {
    open("/demo/courses/linux-basics/workspace");
    expect(screen.getByLabelText("Demo-Rolle")).toHaveValue("participant");
    expect(
      screen.getByRole("heading", { name: "Linux Grundlagen · Demo-Akademie" }),
    ).toBeVisible();
    const navigation = screen.getByRole("navigation", { name: "Kursbereiche" });
    fireEvent.click(within(navigation).getByRole("link", { name: "Klausur" }));
    expect(
      screen.getByRole("heading", { name: "Klausur" }).closest("section"),
    ).toHaveFocus();
    expect(
      screen.queryByText(/Lösungsschlüssel|Anwesenheitsliste/),
    ).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Fiktive Kursnachricht"), {
      target: { value: "Fiktive Frage" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Nachricht in Demo hinzufügen" }),
    );
    expect(screen.getByText("Fiktive Frage")).toBeVisible();
    fireEvent.click(screen.getByRole("radio", { name: "cd" }));
    fireEvent.click(screen.getByRole("button", { name: "Antwort prüfen" }));
    expect(screen.getByText(/versuche es erneut/)).toBeVisible();
    fireEvent.click(screen.getByRole("radio", { name: "pwd" }));
    fireEvent.click(screen.getByRole("button", { name: "Antwort prüfen" }));
    expect(screen.getByText("Richtig.")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Beispielnachweis anzeigen" }),
    ).not.toBeInTheDocument();
    section("/learning");
    fireEvent.click(
      screen.getByRole("link", { name: /Kurs öffnen: Netzwerkeinstieg/ }),
    );
    expect(
      screen.queryByRole("heading", { name: "Klausur" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Fiktive Frage")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "4" }));
    fireEvent.click(screen.getByRole("button", { name: "Antwort prüfen" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Beispielnachweis anzeigen" }),
    );
    expect(
      screen.getByText("Fiktiver Teilnahmenachweis · Netzwerkeinstieg"),
    ).toBeVisible();
    expect(network).not.toHaveBeenCalled();
  });

  it("keeps reviews and course notifications local and follows the material link", () => {
    open("/demo/learning");
    section("/my-reviews");
    fireEvent.change(screen.getByLabelText("Bewertung (1 bis 5)"), {
      target: { value: "4" },
    });
    fireEvent.change(screen.getByLabelText("Fiktiver Kommentar"), {
      target: { value: "Fiktiver Kommentar zu IP-Adressen" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Bewertung in Demo speichern" }),
    );
    expect(
      screen.getByText("Bewertung in dieser Demo gespeichert. 4/5"),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Demo-Bewertung zurückziehen" }),
    );
    expect(screen.queryByText(/gespeichert. 4\/5/)).not.toBeInTheDocument();
    section("/notifications");
    fireEvent.click(
      screen.getByRole("button", { name: "Als gelesen markieren" }),
    );
    expect(screen.getByText("Gelesen")).toBeVisible();
    fireEvent.click(
      screen.getByRole("link", { name: "Beispielmaterial ansehen" }),
    );
    expect(
      screen.getByRole("heading", { name: "Materialien" }).closest("section"),
    ).toHaveFocus();
    section("/notifications");
    expect(screen.getByText("Gelesen")).toBeVisible();
    expect(network).not.toHaveBeenCalled();
  });

  it("keeps an accepted example fixed instead of silently marking a later publication as already claimed", () => {
    open("/demo/jobs");
    fireEvent.click(
      screen.getByRole("button", { name: "Auftrag zur Probe übernehmen" }),
    );
    section("/admin");
    expect(
      screen.getByRole("button", { name: "Demo-Angebot veröffentlichen" }),
    ).toBeDisabled();
    expect(screen.getByLabelText("Fiktiver Auftragstitel")).toBeDisabled();
    expect(
      screen.getByText(/Dieser Demo-Terminblock wurde bereits übernommen/),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Demo zurücksetzen" }));
    section("/admin");
    expect(screen.getByLabelText("Fiktiver Auftragstitel")).toBeEnabled();
  });
  it("uses a published title for the actual claim and its calendar allocation rather than an unrelated sample heading", () => {
    open("/demo/admin");
    fireEvent.change(screen.getByLabelText("Fiktiver Auftragstitel"), {
      target: { value: "Fictional SQL workshop" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Demo-Angebot als Entwurf speichern",
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Demo-Angebot veröffentlichen" }),
    );
    section("/jobs");
    expect(
      screen.getByRole("heading", { level: 3, name: "Fictional SQL workshop" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("heading", {
        level: 3,
        name: "Linux Grundlagen · Demo-Akademie",
      }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Auftrag zur Probe übernehmen" }),
    );
    section("/calendar");
    expect(
      screen.getByRole("heading", { name: "Fictional SQL workshop" }),
    ).toBeVisible();
    expect(screen.getByText(/06.05.2030/)).toBeVisible();
    expect(screen.getByText(/07.05.2030/)).toBeVisible();
  });
  it("requires a saved draft before publishing and exposes only that fictional offer in demo jobs", () => {
    open("/demo/admin");
    const publish = screen.getByRole("button", {
      name: "Demo-Angebot veröffentlichen",
    });
    expect(publish).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Fiktiver Auftragstitel"), {
      target: { value: "Fictional SQL workshop" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Demo-Angebot als Entwurf speichern",
      }),
    );
    expect(publish).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Fiktiver Auftragstitel"), {
      target: { value: "Fictional shell workshop" },
    });
    expect(publish).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Demo-Angebot als Entwurf speichern",
      }),
    );
    fireEvent.click(publish);
    section("/jobs");
    expect(
      screen.getByRole("heading", { name: "Fictional shell workshop" }),
    ).toBeVisible();
    expect(
      screen.queryByText("Fictional SQL workshop"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Demo zurücksetzen" }));
    expect(
      screen.queryByText("Fictional shell workshop"),
    ).not.toBeInTheDocument();
    expect(network).not.toHaveBeenCalled();
  });
  it("records a local client request and explicitly keeps it separate from a reservation", () => {
    open("/demo/client");
    fireEvent.change(screen.getByLabelText("Fiktive Kursanfrage"), {
      target: { value: "Fictional Linux training" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Kursanfrage in Demo vormerken" }),
    );
    expect(
      screen.getByText("Fictional Linux training", { selector: "blockquote" }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent(
      "reserviert keine Dozierenden",
    );
    expect(network).not.toHaveBeenCalled();
  });
  it("acknowledges a sample agreement without suggesting a legally binding action", () => {
    open("/demo/contracts");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Beispielbedingungen zur Probe bestätigen",
      }),
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Keine rechtsverbindliche Erklärung",
    );
    fireEvent.click(screen.getByRole("button", { name: "Demo zurücksetzen" }));
    expect(
      screen.getByRole("button", {
        name: "Beispielbedingungen zur Probe bestätigen",
      }),
    ).toBeEnabled();
  });
  it("separates wiki/forum drafts, renders authored text safely, and resets both", () => {
    open("/demo/wiki");
    const post = "<script>fictional()</script>";
    fireEvent.change(screen.getByLabelText("Fiktiver Beitragstext"), {
      target: { value: post },
    });
    section("/forum");
    expect(screen.getByLabelText("Fiktiver Beitragstext")).toHaveValue("");
    section("/wiki");
    expect(screen.getByLabelText("Fiktiver Beitragstext")).toHaveValue(post);
    fireEvent.click(
      screen.getByRole("button", { name: "Beitrag in Demo veröffentlichen" }),
    );
    expect(screen.getByText(post)).toBeVisible();
    expect(document.querySelector(".demo-messages script")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Demo zurücksetzen" }));
    expect(screen.queryByText(post)).not.toBeInTheDocument();
    expect(network).not.toHaveBeenCalled();
  });
});

describe("tour navigation and invalid deep links", () => {
  it("walks every catalog entry through finish/restart without losing practice state or making a request", () => {
    open();
    const paths = [...document.querySelectorAll(".demo-sidebar nav a")].map(
      (link) => link.getAttribute("href")?.replace(/^\/demo/, "") || "/",
    );
    const visibleModules = paths.map((path) =>
      guideModules.find((item) => item.path === path)!,
    );
    fireEvent.click(screen.getByRole("button", { name: "Rundgang starten" }));
    expect(
      screen.getByRole("button", { name: "Vorheriger Bereich" }),
    ).toBeDisabled();
    for (let index = 1; index < visibleModules.length; index++) {
      fireEvent.click(screen.getByRole("button", { name: "Nächster Bereich" }));
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        visibleModules[index].title.de,
      );
    }
    fireEvent.click(
      screen.getByRole("button", { name: "Rundgang abschließen" }),
    );
    expect(screen.getByText(/Rundgang abgeschlossen/)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Rundgang neu starten" }),
    );
    expect(
      screen.getByRole("heading", { name: "Demo zum Ausprobieren" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Vorheriger Bereich" }),
    ).toBeDisabled();
    expect(network).not.toHaveBeenCalled();
  });
  it("marks the selected query-linked module and explains unknown sections safely", () => {
    const first = open("/demo?module=jobs");
    expect(
      document.querySelector(
        'nav[aria-label="Demo-Bereiche"] a[aria-current="page"]',
      ),
    ).toHaveAttribute("href", "/demo/jobs");
    first.unmount();
    open("/demo/unknown");
    expect(
      screen.getByRole("heading", { name: "Demo zum Ausprobieren" }),
    ).toBeVisible();
    expect(network).not.toHaveBeenCalled();
  });
  it("never stores authored practice input in browser persistence", () => {
    localStorage.clear();
    sessionStorage.clear();
    open("/demo/chats");
    const text = "Fictional unique message for memory-only boundary";
    fireEvent.change(screen.getByLabelText("Demo-Nachricht"), {
      target: { value: text },
    });
    fireEvent.click(screen.getByRole("button", { name: "In Demo senden" }));
    for (const storage of [localStorage, sessionStorage]) {
      expect(
        Array.from({ length: storage.length }, (_, index) =>
          storage.getItem(storage.key(index)!),
        ).join(" "),
      ).not.toContain(text);
    }
    expect(network).not.toHaveBeenCalled();
  });
});

describe("demo tour keyboard focus", () => {
  it("keeps focus on surviving elements when starting and pausing without changing the selected section", () => {
    open("/demo/jobs");
    const start = screen.getByRole("button", { name: "Rundgang starten" });
    start.focus();
    fireEvent.click(start);
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
    const pause = screen.getByRole("button", { name: "Rundgang pausieren" });
    pause.focus();
    fireEvent.click(pause);
    expect(
      screen.getByRole("button", { name: "Rundgang starten" }),
    ).toHaveFocus();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      guideModules.find((item) => item.path === "/jobs")!.title.de,
    );
  });
  it("restores focus to restart after the final focused tour action is removed", () => {
    open();
    const last = [...document.querySelectorAll(".demo-sidebar nav a")].at(
      -1,
    ) as HTMLAnchorElement;
    fireEvent.click(last);
    fireEvent.click(screen.getByRole("button", { name: "Rundgang starten" }));
    const finish = screen.getByRole("button", { name: "Rundgang abschließen" });
    finish.focus();
    fireEvent.click(finish);
    const restart = screen.getByRole("button", {
      name: "Rundgang neu starten",
    });
    expect(restart).toHaveFocus();
    fireEvent.click(restart);
    expect(
      screen.getByRole("heading", { name: "Demo zum Ausprobieren" }),
    ).toHaveFocus();
  });
});
