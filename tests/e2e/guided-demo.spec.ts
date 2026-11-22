/**
 * Public browser journeys through fictional in-memory practice and help content.
 * These exercise the rendered UI without proving real job claims or backend workflows.
 */
import {expect, type Page, test as base} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const backendPath = /\/(?:auth|rest|storage|functions|realtime)\/v1(?:\/|$)/;

// Abort matching HTTP requests and fail on attempts instead of mocking success.
// WebSocket attempts are recorded separately; the listener does not block them.
// The automatic fixture checks every scenario after its browser actions finish.
const test = base.extend<{ isolatedDemo: void }>({
    isolatedDemo: [
        async ({page}, use) => {
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
        {auto: true},
    ],
});

/** Waits for fonts before checking viewport fit and automated WCAG rules. */
async function accessibleWithoutOverflow(page: Page) {
    await page.evaluate(() => document.fonts.ready);
  const layout = await page.evaluate(() => ({
    fits: document.documentElement.scrollWidth <= window.innerWidth,
    viewport: window.innerWidth,
    offenders: [...document.querySelectorAll("body *")]
      .filter(
        (element) =>
          element.getBoundingClientRect().right > window.innerWidth + 1,
      )
      .slice(0, 5)
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}.${element.className?.toString().replaceAll(" ", ".")}`,
        ),
  }));
  expect(
    layout.fits,
    `The public guide fits ${layout.viewport}px: ${layout.offenders.join(", ")}`,
    ).toBe(true);
    const result = await new AxeBuilder({page})
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(
        result.violations.map(({id, nodes}) => ({
            id,
            nodes: nodes.map(({target, failureSummary}) => ({
                target,
                failureSummary,
            })),
        })),
    ).toEqual([]);
}

async function visitDemoSection(page: Page, path: string) {
  const desktop = page.locator(`.demo-sidebar nav a[href="/demo${path}"]`);
  if (await desktop.isVisible()) {
    await desktop.click();
    return;
  }
  const primary = page.locator(
    `.demo-mobile-primary-nav a[href="/demo${path}"]`,
  );
  if (await primary.count()) {
    await primary.click();
    return;
  }
  await page
    .getByRole("button", { name: /Mehr Demo-Bereiche|More demo sections/ })
    .click();
  await page.locator(`#demo-mobile-navigation a[href="/demo${path}"]`).click();
}

test("fictional course cards and dark theme stay accessible at portal widths", async ({
  page,
}, testInfo) => {
  await page.goto("/demo/courses");
  await expect(
    page.getByRole("heading", { name: "Linux Grundlagen · Demo-Akademie" }),
  ).toBeVisible();
  await page.getByLabel("Kurse filtern").selectOption("upcoming");
  await expect(
    page.getByRole("heading", { name: "Netzwerkeinstieg · Demo-Akademie" }),
  ).toHaveCount(0);
  await page.getByLabel("Sprache", { exact: true }).selectOption("en");
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  for (const width of [390, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("heading", { name: "Linux basics · Demo Academy" }),
    ).toBeVisible();
    await accessibleWithoutOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath(`demo-courses-${width}-dark-en.png`),
      fullPage: true,
    });
  }
});

// Rejected attempts stay retryable; simulated success survives role/language
// changes until reset. Light/dark scans cover only the rendered demo state.
test("mobile demo navigation explains and permits access to its remaining sections", async ({
                                                                                                page,
                                                                                            }, testInfo) => {
    await page.goto("/demo");
    if (testInfo.project.name === "mobile-chromium") {
        await expect(page.locator(".demo-mobile-nav")).toBeVisible();
        await page
            .getByRole("button", {name: "Mehr Demo-Bereiche", exact: true})
            .click();
        const nav = page.locator("#demo-mobile-navigation");
        await expect(nav).toBeVisible();
        const last = nav.getByRole("link").last();
        await last.focus();
        await expect(last).toBeInViewport();
        await page.getByLabel("Sprache", {exact: true}).selectOption("en");
        await expect(
            page.getByRole("button", {name: "More demo sections", exact: true}),
        ).toBeVisible();
        await page.getByLabel("Language", {exact: true}).focus();
        await expect(nav).toBeHidden();
    } else {
        const nav = page.locator(".demo-sidebar nav");
        await expect(nav).toBeVisible();
        await expect(nav.getByRole("link").last()).toBeVisible();
    }
    const viewport = page.viewportSize();
    for (const width of [390, 768, 1280, 1920]) {
        await page.setViewportSize({width, height: 900});
        await accessibleWithoutOverflow(page);
        await page.screenshot({
            path: testInfo.outputPath(`demo-home-${width}-light.png`),
            fullPage: true,
        });
    }
    if (viewport) await page.setViewportSize(viewport);
});

test("demo More opens beside the bottom navigation and restores keyboard focus", async ({page}) => {
  await page.setViewportSize({width: 320, height: 568});
  await page.goto("/demo");
  const role = page.locator("#demo-role");
  await role.focus();
  await role.press("ArrowDown");
  await expect(role).toHaveValue("management");
  await expect(role).toBeFocused();
  await role.press("ArrowDown");
  await expect(role).toHaveValue("admin");
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const offset = await page.evaluate(() => window.scrollY);
  expect(offset).toBeGreaterThan(0);
  const trigger = page.getByRole("button", {name: "Mehr Demo-Bereiche"});
  const panel = page.locator("#demo-mobile-panel");
  await expect(trigger).toHaveCount(1);
  await trigger.click();
  await expect(panel).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(await page.evaluate(() => window.scrollY)).toBe(offset);
  await expect(panel.locator('a[href="/help"]')).toHaveCount(1);
  await expect(panel.locator('a[href="/login"]')).toHaveCount(1);
  for (const [width, height] of [[320, 568], [568, 320]]) {
    await page.setViewportSize({width, height});
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    expect(box!.y + box!.height).toBeLessThanOrEqual(height);
  }
  await panel.getByRole("link").last().focus();
  await expect(panel.getByRole("link").last()).toBeInViewport();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await page.locator(".demo-mobile-primary-nav a[href='/demo/calendar']").click();
  await expect(page).toHaveURL(/\/demo\/calendar$/);
  await expect(panel).toBeHidden();
});

test("fictional job outcomes never reserve real work, and language changes retain practice state", async ({
                                                                                                              page,
                                                                                                          }, testInfo) => {
    await page.goto("/login");
    await expect(
        page.getByRole("link", {name: "Hilfe & Anleitungen", exact: true}),
    ).toHaveAttribute("href", "/help");
    await page
        .getByRole("link", {
            name: "Demo mit Beispieldaten ausprobieren",
            exact: true,
        })
        .click();
    await expect(page).toHaveURL((url) => url.pathname === "/demo");
    await page
        .getByRole("navigation", {name: "Demo-Bereiche", exact: true})
        .getByRole("link", {name: "Aufträge übernehmen", exact: true})
        .click();
    await expect(
    page
      .locator(".demo-main")
      .getByText("DEMO · Nur fiktive Daten", { exact: true }),
    ).toBeVisible();
    for (const [outcome, explanation] of [
        ["filled", "Ein anderer Dozent war schneller"],
        ["conflict", "Ein Termin überschneidet sich"],
        [
            "qualification",
            "Ein erforderliches Thema im Profil oder ein gültiger Vertrag fehlt",
        ],
        ["offline", "Ohne Verbindung wird keine Übernahme bestätigt"],
    ]) {
        await page
            .getByLabel("Ergebnis ausprobieren", {exact: true})
            .selectOption(outcome);
        const claim = page.getByRole("button", {
            name: "Auftrag zur Probe übernehmen",
            exact: true,
        });
        await claim.click();
        await expect(page.getByRole("status")).toContainText(explanation);
        await expect(claim).toBeEnabled();
        await expect(page.getByText("Noch offen", {exact: true})).toBeVisible();
    }
    await page
        .getByLabel("Ergebnis ausprobieren", {exact: true})
        .selectOption("success");
    await page
        .getByRole("button", {name: "Auftrag zur Probe übernehmen", exact: true})
        .click();
    await expect(page.getByRole("status")).toContainText(
        "Simulation: Der gesamte Block ist reserviert. Im echten Portal ist erst die Serverbestätigung verbindlich.",
    );
    await page.getByLabel("Sprache", {exact: true}).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("status")).toContainText(
        "Simulation: The entire block is reserved. In the real portal, only server confirmation is binding.",
    );
  await page.locator("#demo-role").selectOption("client");
  await page.locator("#demo-role").selectOption("lecturer");
    await page.locator('a[href="/demo/jobs"]:visible').first().click();
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
    await page.getByLabel("Theme", {exact: true}).selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await accessibleWithoutOverflow(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
        path: testInfo.outputPath("demo-jobs-en-dark.png"),
        fullPage: true,
    });
    await page.getByRole("button", {name: "Reset demo", exact: true}).click();
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

// In-app navigation retains practice drafts, while a full reload discards them.
// The automatic backend guard distinguishes this from a persisted chat/profile flow.
test("demo chat and profile drafts stay fictional and a page reload clears practice", async ({
                                                                                                 page,
                                                                                             }) => {
    await page.goto("/demo/chats");
    await page
        .getByLabel("Demo-Nachricht", {exact: true})
        .fill("Fictional classroom question");
    await page
        .getByRole("button", {name: "In Demo senden", exact: true})
        .click();
    await expect(
        page.getByText("Fictional classroom question", {exact: true}),
    ).toBeVisible();
  await visitDemoSection(page, "/profile");
    await page
        .getByLabel("Fiktiver Anzeigename", {exact: true})
        .fill("Fictional guide learner");
    await page
        .getByRole("button", {name: "Demo-Profil speichern", exact: true})
        .click();
  await visitDemoSection(page, "/chats");
    await expect(
        page.getByText("Fictional classroom question", {exact: true}),
    ).toBeVisible();
    await page.reload();
    await expect(
        page.getByText("Fictional classroom question", {exact: true}),
    ).toHaveCount(0);
});

// Connect the management and lecturer exercises through shared fictional state,
// then verify one reset clears the publication, allocation and calendar effects.
test("connected demo publication, allocation, calendar and document exercises reset together", async ({
                                                                                                          page,
                                                                                                      }) => {
    await page.goto("/demo/admin");
  await page.locator("#demo-role").selectOption("management");
    await page
        .getByLabel("Fiktiver Auftragstitel", {exact: true})
        .fill("Fictional guided Linux block");
    await page
        .getByRole("button", {
            name: "Demo-Angebot als Entwurf speichern",
            exact: true,
        })
        .click();
    await page
        .getByRole("button", {name: "Demo-Angebot veröffentlichen", exact: true})
        .click();
    // Follow rendered links so navigation retains the same in-memory demo session.
    const visit = async (path: string) => {
    await visitDemoSection(page, path);
    };
  await page.locator("#demo-role").selectOption("lecturer");
    await visit("/jobs");
    await expect(
        page.getByRole("heading", {
            name: "Fictional guided Linux block",
            level: 3,
            exact: true,
        }),
    ).toBeVisible();
    await page
        .getByRole("button", {name: "Auftrag zur Probe übernehmen", exact: true})
        .click();
    await visit("/calendar");
    await expect(
        page.getByText("Demo-Auftrag: beide bestätigten Termine", {exact: true}),
    ).toBeVisible();
    await expect(
        page
            .getByRole("region", {name: "Jetzt mit Beispielen üben", exact: true})
            .getByRole("listitem")
            .filter({hasText: "Europe/Berlin"}),
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
        .getByRole("button", {name: "Fiktive Rechnung vormerken", exact: true})
        .click();
    await expect(page.getByRole("status")).toContainText(
        "Kein PDF hochgeladen, keine Zahlung ausgelöst",
    );
    await page
        .getByRole("button", {name: "Demo zurücksetzen", exact: true})
        .click();
    await visit("/calendar");
    await expect(
        page.getByText("Demo-Auftrag: beide bestätigten Termine", {exact: true}),
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

// Check the complete demo navigation inventory before walking its displayed order.
// Pausing, changing language and restarting must retain coherent tour controls.
test("the guided demo visits every actual portal area, pauses and restarts in either language", async ({
                                                                                                           page,
                                                                                                       }) => {
    await page.goto("/demo");
  await page.locator("#demo-role").selectOption("admin");
  const desktopNavigation = page.locator(".demo-sidebar nav");
  const mobile = !(await desktopNavigation.isVisible());
  if (mobile)
    await page.getByRole("button", { name: "Mehr Demo-Bereiche" }).click();
  const navigation = mobile
    ? page.locator("#demo-mobile-navigation")
    : desktopNavigation;
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole("link")).toHaveCount(25);
    const paths = await navigation
        .getByRole("link")
        .evaluateAll((links) =>
            links.map((link) => new URL((link as HTMLAnchorElement).href).pathname),
        );
  if (mobile) await page.locator(".demo-mobile-more > summary").click();
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
            "/admin",
            "/admin/accounts",
            "/admin/people",
            "/admin/audit",
            "/auth/password",
            "/search",
        ]
            .map((path) => `/demo${path}`)
            .sort(),
    );
    await page
        .getByRole("button", {name: "Rundgang starten", exact: true})
        .click();
    for (let index = 0; index < paths.length; index++) {
        await expect(page).toHaveURL((url) => url.pathname === paths[index]);
        await expect(page.getByRole("heading", {level: 1})).toBeVisible();
        if (index === 2) {
            await page
                .getByRole("button", {name: "Rundgang pausieren", exact: true})
                .click();
            await expect(
                page.getByRole("button", {name: "Nächster Bereich", exact: true}),
            ).toHaveCount(0);
            await page.getByLabel("Sprache", {exact: true}).selectOption("en");
            await page
                .getByRole("button", {name: "Start guided tour", exact: true})
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
        .getByRole("button", {name: "Restart guided tour", exact: true})
        .click();
    await expect(page).toHaveURL((url) => url.pathname === "/demo");
    await expect(
        page.getByRole("button", {name: "Previous section", exact: true}),
    ).toBeDisabled();
    await accessibleWithoutOverflow(page);
});

// A deep-linked help topic survives translation; searching filters topic links
// and choosing a result updates the shareable URL without backend interaction.
test("public help searches practical recovery instructions and keeps the selected topic across language changes", async ({
                                                                                                                             page,
                                                                                                                         }, testInfo) => {
    await page.goto("/help?topic=jobs");
    await expect(
        page.getByRole("heading", {name: "Hilfe & Anleitungen", exact: true}),
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
            {exact: true},
        ),
    ).toBeVisible();
    await page.getByLabel("Sprache", {exact: true}).selectOption("en");
    await expect(
        page.getByRole("heading", {name: "Claim jobs", exact: true, level: 2}),
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
    await search.fill("claim");
    await expect(
        page.getByRole("heading", {name: "Claim jobs", exact: true, level: 2}),
    ).toHaveCount(0);
    await page.getByRole("link", {name: /^Claim jobs\b/}).click();
    await expect(
        page.getByRole("heading", {name: "Claim jobs", exact: true, level: 2}),
    ).toBeFocused();
    await expect(page).toHaveURL(
        (url) => url.searchParams.get("topic") === "jobs",
    );
    await search.fill("quarantine");
    await expect(
        page.getByRole("link", {name: /^File centre\b/}),
    ).toBeVisible();
    await search.fill("zzzz-no-fictional-help-match-zzzz");
    await expect(page.getByRole("link", {name: /^File centre\b/})).toHaveCount(
        0,
    );
    await page.getByRole("button", {name: "Clear search", exact: true}).click();
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("");
    await page.getByRole("link", {name: /^File centre\b/}).click();
    await expect(page).toHaveURL(
        (url) => url.searchParams.get("topic") === "files",
    );
});
test("LMS help filters course guides, supports keyboard reading and opens the matching demo role", async ({
  page,
}) => {
  await page.goto("/help");
  await page
    .getByRole("combobox", { name: "Themenbereich" })
    .selectOption("courses");
  await expect(page.getByRole("link", { name: /^Dateizentrale/ })).toHaveCount(
    0,
  );
  await page
    .getByRole("link", { name: /^Meine Kurse und Lernmaterialien/ })
    .press("Enter");
  await expect(
    page.getByRole("heading", {
      name: "Meine Kurse und Lernmaterialien",
      level: 2,
    }),
  ).toBeFocused();
  await page.getByRole("combobox", { name: "Sprache" }).selectOption("en");
  await expect(
    page.getByRole("heading", {
      name: "My courses and learning materials",
      level: 2,
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(
    (url) =>
      url.searchParams.get("area") === "courses" &&
      url.searchParams.get("topic") === "lms-learning",
  );
  await accessibleWithoutOverflow(page);
  await page.getByRole("button", { name: "Back to overview" }).click();
  await expect(
    page.getByRole("searchbox", { name: "Search help" }),
  ).toBeFocused();
  await page
    .getByRole("link", { name: /^My courses and learning materials/ })
    .press("Enter");
  await page
    .getByRole("link", { name: "Practise this section in the demo" })
    .click();
  await expect(page.getByRole("combobox", { name: "Demo role" })).toHaveValue(
    "participant",
  );
  await expect(page.getByRole("heading", { name: "My courses" })).toBeVisible();
});

test("Premium learner demo mirrors scoped course navigation and keeps practice local in both themes", async ({
  page,
}, testInfo) => {
  await page.goto("/demo");
  await page.getByRole("combobox", {name: "Demo-Rolle", exact: true}).selectOption("participant");
  await expect(page).toHaveURL(/\/demo\/learning$/);
  await expect(page.getByRole("heading", {name: "Meine Kurse"})).toBeVisible();
  const nav = page.locator(".demo-sidebar nav, .demo-mobile-primary-nav");
  await expect(nav.locator('a[href="/demo/learning"]')).toHaveCount(2);
  await expect(nav.locator('a[href="/demo/chats"], a[href="/demo/files"]')).toHaveCount(0);
  await page.getByRole("link", {name: /Kurs öffnen: Linux Grundlagen/}).click();
  await expect(page.getByRole("heading", {name: /Linux Grundlagen/})).toBeVisible();
  const sections = page.getByRole("navigation", {name: "Kursbereiche"});
  await sections.getByRole("link", {name: "Kurschat"}).click();
  await expect(page.locator("#course-chat")).toBeFocused();
  await page.getByLabel("Fiktive Kursnachricht").fill("Fiktive Frage zum Shell-Kurs");
  await page.getByRole("button", {name: "Nachricht in Demo hinzufügen"}).click();
  await expect(page.getByText("Fiktive Frage zum Shell-Kurs")).toBeVisible();
  await accessibleWithoutOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path: testInfo.outputPath("learner-workspace-light-de.png"), fullPage: true});

  await page.getByLabel("Sprache", {exact: true}).selectOption("en");
  await page.getByLabel("Theme", {exact: true}).selectOption("dark");
  await expect(page.getByRole("navigation", {name: "Course sections"})).toBeVisible();
  await expect(page.getByText("Fiktive Frage zum Shell-Kurs")).toBeVisible();
  await page.getByRole("link", {name: "Back to my courses"}).click();
  await page.getByRole("link", {name: /Open course: Network basics/}).click();
  await expect(page.getByRole("navigation", {name: "Course sections"}).getByRole("link", {name: "Exam"})).toHaveCount(0);
  await page.getByRole("radio", {name: "4", exact: true}).check();
  await page.getByRole("button", {name: "Check answer"}).click();
  await page.getByRole("button", {name: "Show sample record"}).click();
  await expect(page.getByText("Fictional completion record · Network basics")).toBeVisible();
  await accessibleWithoutOverflow(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({path: testInfo.outputPath("learner-workspace-dark-en.png"), fullPage: true});

  await page.reload();
  await expect(page.getByRole("heading", {name: /Network basics/})).toBeVisible();
  await expect(page.getByText("Fictional completion record · Network basics")).toHaveCount(0);
  await expect(page.getByRole("radio", {name: "4", exact: true})).not.toBeChecked();
});

test("LMS demo shares a practice course across roles and keeps the learner view private", async ({page}, testInfo) => {
  await page.goto("/demo/courses/linux-basics/workspace?role=management");
  const role = page.locator("#demo-role");
  await expect(role).toHaveValue("management");
  await page.getByLabel("Willkommen im Kurs", {exact: true}).fill("Fiktiver Kursstart im Demo-Raum.");
  await page.getByRole("button", {name: "Begrüßung veröffentlichen"}).click();
  await page.getByRole("button", {name: "Beispiel-Meeting freigeben"}).click();
  await page.getByText("Materialien", {exact: true}).click();
  await page.getByRole("button", {name: "Beispielmaterial freigeben"}).click();
  await page.getByText("Einladungen & Einschreibung", {exact: true}).click();
  await page.getByLabel("Fiktive Person").selectOption("Kim Beispiel");
  await page.getByRole("button", {name: "Einladung in der Demo vormerken"}).click();
  await page.getByRole("button", {name: "Kim Beispiel einschreiben"}).click();
  await page.getByText("Anwesenheitsliste", {exact: true}).click();
  await page.getByLabel("Demo Alex", {exact: true}).selectOption("present");
  await page.getByLabel("Kim Beispiel", {exact: true}).selectOption("absent");
  await accessibleWithoutOverflow(page);
  await page.screenshot({path: testInfo.outputPath("lms-staff-workspace-light-de.png"), fullPage: true});

  await role.selectOption("participant");
  await expect(page.getByText("Fiktiver Kursstart im Demo-Raum.")).toBeVisible();
  await expect(page.getByText("Arbeitsblatt zur Wiederholung")).toBeVisible();
  await expect(page.getByText("Anwesend", {exact: true})).toBeVisible();
  await expect(page.getByText("Kim Beispiel", {exact: true})).toHaveCount(0);
  await expect(page.getByText("Anwesenheitsliste", {exact: true})).toHaveCount(0);
  await page.getByRole("button", {name: "Beispiel-Meeting öffnen"}).click();
  await expect(page.getByRole("status")).toContainText("Kamera und Mikrofon bleiben aus");
  await page.getByLabel("Sprache", {exact: true}).selectOption("en");
  await expect(page.getByText("Present", {exact: true})).toBeVisible();
  await accessibleWithoutOverflow(page);

  await role.selectOption("lecturer");
  await expect(page.getByText("Invitations & enrolment", {exact: true})).toHaveCount(0);
  await page.locator(".demo-practice-section > summary").filter({hasText: /^Exam$/}).click();
  await page.getByRole("checkbox", {name: "Exam required"}).uncheck();
  await role.selectOption("participant");
  await expect(page.getByRole("link", {name: "Exam", exact: true})).toHaveCount(0);
});
