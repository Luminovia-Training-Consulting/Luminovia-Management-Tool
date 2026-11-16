import { expect, test as base, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const backendPath = /\/(?:auth|rest|storage|functions|realtime)\/v1(?:\/|$)/;

// A public walkthrough must not silently turn a practice action into a real
// request. Abort unexpected backend calls before they can affect even an
// isolated fixture, then fail on the attempted request rather than mock success.
const test = base.extend<{ isolatedDemo: void }>({
  isolatedDemo: [
    async ({ page }, use) => {
      const attempted: string[] = [];
      await page.route("**/*", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (backendPath.test(path)) {
          attempted.push(path);
          await route.abort("blockedbyclient");
        } else {
          await route.continue();
        }
      });
      page.on("websocket", (socket) => {
        const path = new URL(socket.url()).pathname;
        if (backendPath.test(path)) attempted.push(path);
      });
      await use();
      expect(attempted, "Public practice never calls a backend").toEqual([]);
    },
    { auto: true },
  ],
});

async function accessibleWithoutOverflow(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    "The public guide fits the viewport",
  ).toBe(true);
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    result.violations.map(({ id, nodes }) => ({
      id,
      nodes: nodes.map(({ target, failureSummary }) => ({
        target,
        failureSummary,
      })),
    })),
  ).toEqual([]);
}

test("fictional job outcomes never reserve real work, and language changes retain practice state", async ({
  page,
}, testInfo) => {
  await page.goto("/demo/jobs");
  await expect(
    page.getByText("DEMO · Nur fiktive Daten", { exact: true }).first(),
  ).toBeVisible();
  for (const [outcome, explanation] of [
    ["filled", "Ein anderer Dozent war schneller"],
    ["conflict", "Ein Termin überschneidet sich"],
    ["qualification", "Eine geprüfte Qualifikation"],
    ["offline", "Ohne Verbindung wird keine Übernahme bestätigt"],
  ]) {
    await page
      .getByLabel("Ergebnis ausprobieren", { exact: true })
      .selectOption(outcome);
    const claim = page.getByRole("button", {
      name: "Auftrag zur Probe übernehmen",
      exact: true,
    });
    await claim.click();
    await expect(page.getByRole("status")).toContainText(explanation);
    await expect(claim).toBeEnabled();
    await expect(page.getByText("Noch offen", { exact: true })).toBeVisible();
  }
  await page
    .getByLabel("Ergebnis ausprobieren", { exact: true })
    .selectOption("success");
  await page
    .getByRole("button", { name: "Auftrag zur Probe übernehmen", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Simulation: Der gesamte Block ist reserviert. Im echten Portal ist erst die Serverbestätigung verbindlich.",
  );
  await page.getByLabel("Sprache", { exact: true }).selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("status")).toContainText(
    "Simulation: The entire block is reserved. In the real portal, only server confirmation is binding.",
  );
  await page.getByLabel("Demo role", { exact: true }).selectOption("client");
  await page.getByLabel("Demo role", { exact: true }).selectOption("lecturer");
  await expect(
    page.getByRole("button", {
      name: "Practise claiming this job",
      exact: true,
    }),
  ).toBeDisabled();
  await accessibleWithoutOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("demo-jobs-en-light.png"),
    fullPage: true,
  });
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await accessibleWithoutOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("demo-jobs-en-dark.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Reset demo", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Practise claiming this job",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    page.getByText("Simulation: The entire block is reserved.", {
      exact: false,
    }),
  ).toHaveCount(0);
});

test("demo chat and profile drafts stay fictional and a page reload clears practice", async ({
  page,
}) => {
  await page.goto("/demo/chats");
  await page
    .getByLabel("Demo-Nachricht", { exact: true })
    .fill("Fictional classroom question");
  await page
    .getByRole("button", { name: "In Demo senden", exact: true })
    .click();
  await expect(
    page.getByText("Fictional classroom question", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "Demo-Bereiche", exact: true })
    .locator('a[href="/demo/profile"]')
    .click();
  await page
    .getByLabel("Fiktiver Anzeigename", { exact: true })
    .fill("Fictional guide learner");
  await page
    .getByRole("button", { name: "Demo-Profil speichern", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Demo-Bereiche", exact: true })
    .locator('a[href="/demo/chats"]')
    .click();
  await expect(
    page.getByText("Fictional classroom question", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Fictional classroom question", { exact: true }),
  ).toHaveCount(0);
});

test("connected demo publication, allocation, calendar and document exercises reset together", async ({
  page,
}) => {
  await page.goto("/demo/admin");
  await page
    .getByLabel("Demo-Rolle", { exact: true })
    .selectOption("management");
  await page
    .getByLabel("Fiktiver Auftragstitel", { exact: true })
    .fill("Fictional guided Linux block");
  await page
    .getByRole("button", {
      name: "Demo-Angebot als Entwurf speichern",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Demo-Angebot veröffentlichen", exact: true })
    .click();
  const visit = async (path: string) => {
    await page
      .getByRole("navigation", { name: "Demo-Bereiche", exact: true })
      .locator(`a[href="/demo${path}"]`)
      .click();
  };
  await page.getByLabel("Demo-Rolle", { exact: true }).selectOption("lecturer");
  await visit("/jobs");
  await expect(
    page.getByRole("heading", {
      name: "Fictional guided Linux block",
      level: 3,
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Auftrag zur Probe übernehmen", exact: true })
    .click();
  await visit("/calendar");
  await expect(
    page.getByText("Demo-Auftrag: beide bestätigten Termine", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Jetzt mit Beispielen üben", exact: true })
      .getByRole("listitem")
      .filter({ hasText: "Europe/Berlin" }),
  ).toHaveCount(2);
  await page
    .getByRole("button", {
      name: "Fiktiven privaten Termin hinzufügen",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Fiktive Vorbereitung · nur in deiner Demo", {
      exact: true,
    }),
  ).toBeVisible();
  await visit("/files");
  await expect(page.getByRole("status")).toContainText("wartet auf Prüfung");
  await page
    .getByRole("button", {
      name: "Prüfung einer Beispieldatei simulieren",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Demo-Datei: Prüfung bestanden",
  );
  await visit("/finance");
  await page
    .getByRole("button", { name: "Fiktive Rechnung vormerken", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Kein PDF hochgeladen, keine Zahlung ausgelöst",
  );
  await page
    .getByRole("button", { name: "Demo zurücksetzen", exact: true })
    .click();
  await visit("/calendar");
  await expect(
    page.getByText("Demo-Auftrag: beide bestätigten Termine", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Fiktive Vorbereitung · nur in deiner Demo", {
      exact: true,
    }),
  ).toHaveCount(0);
  await visit("/files");
  await expect(page.getByRole("status")).toContainText("wartet auf Prüfung");
  await visit("/jobs");
  await expect(
    page.getByRole("heading", {
      name: "Fictional guided Linux block",
      exact: true,
    }),
  ).toHaveCount(0);
});

test("the guided demo visits every actual portal area, pauses and restarts in either language", async ({
  page,
}) => {
  await page.goto("/demo");
  const navigation = page.getByRole("navigation", {
    name: "Demo-Bereiche",
    exact: true,
  });
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole("link")).toHaveCount(25);
  const paths = await navigation
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((link) => new URL((link as HTMLAnchorElement).href).pathname),
    );
  expect([...paths].sort()).toEqual(
    [
      "",
      "/jobs",
      "/calendar",
      "/availability",
      "/chats",
      "/files",
      "/courses",
      "/people",
      "/client",
      "/my-reviews",
      "/contracts",
      "/finance",
      "/clients",
      "/wiki",
      "/forum",
      "/notifications",
      "/topics",
      "/settings",
      "/profile",
      "/security",
      "/admin",
      "/admin/accounts",
      "/admin/people",
      "/admin/audit",
      "/search",
    ]
      .map((path) => `/demo${path}`)
      .sort(),
  );
  await page
    .getByLabel("Demo-Rolle", { exact: true })
    .selectOption("management");
  await page
    .getByRole("button", { name: "Rundgang starten", exact: true })
    .click();
  for (let index = 0; index < paths.length; index++) {
    await expect(page).toHaveURL((url) => url.pathname === paths[index]);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    if (index === 2) {
      await page
        .getByRole("button", { name: "Rundgang pausieren", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Nächster Bereich", exact: true }),
      ).toHaveCount(0);
      await page.getByLabel("Sprache", { exact: true }).selectOption("en");
      await page
        .getByRole("button", { name: "Start guided tour", exact: true })
        .click();
    }
    await page
      .getByRole("button", {
        name:
          index === paths.length - 1
            ? "Finish guided tour"
            : index < 2
              ? "Nächster Bereich"
              : "Next section",
        exact: true,
      })
      .click();
  }
  await expect(
    page.getByText("Tour completed. You can keep practising or start again.", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Restart guided tour", exact: true })
    .click();
  await expect(page).toHaveURL((url) => url.pathname === "/demo");
  await expect(
    page.getByRole("button", { name: "Previous section", exact: true }),
  ).toBeDisabled();
  await accessibleWithoutOverflow(page);
});

test("public help searches practical recovery instructions and keeps the selected topic across language changes", async ({
  page,
}, testInfo) => {
  await page.goto("/help?topic=jobs");
  await expect(
    page.getByRole("heading", { name: "Hilfe & Anleitungen", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Aufträge übernehmen",
      exact: true,
      level: 2,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Die Übernahme wurde abgelehnt oder ihr Ergebnis ist unklar.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByLabel("Sprache", { exact: true }).selectOption("en");
  await expect(
    page.getByRole("heading", { name: "Claim jobs", exact: true, level: 2 }),
  ).toBeVisible();
  await expect(
    page.getByText("A claim was rejected or its result is unclear.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("topic") === "jobs",
  );
  await accessibleWithoutOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: testInfo.outputPath("help-jobs-en-light.png"),
    fullPage: true,
  });
  const search = page.getByRole("searchbox", {
    name: "Search help",
    exact: true,
  });
  await search.fill("quarantine");
  await expect(
    page.getByRole("link", { name: /^File centre\b/ }),
  ).toBeVisible();
  await search.fill("zzzz-no-fictional-help-match-zzzz");
  await expect(page.getByRole("link", { name: /^File centre\b/ })).toHaveCount(
    0,
  );
  await search.fill("");
  await page.getByRole("link", { name: /^File centre\b/ }).click();
  await expect(page).toHaveURL(
    (url) => url.searchParams.get("topic") === "files",
  );
});
