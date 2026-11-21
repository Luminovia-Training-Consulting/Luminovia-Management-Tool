/**
 * Browser workflows for scanned private bytes, previews and exact document versions.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import {expect, type Request, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Run through ./portal test in its isolated database.",
);

/** Signs this test actor in through the visible form and waits for confirmed navigation. */
async function login(page: import("@playwright/test").Page) {
    await page.goto("/login");
    await page
        .getByLabel("Benutzername oder E-Mail", {exact: true})
        .fill(process.env.E2E_LECTURER_EMAIL!);
    await page
        .getByLabel("Passwort", {exact: true})
        .fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", {name: "Anmelden", exact: true}).click();
    await expect(page).toHaveURL(/\/$/);
}

test("real private upload exposes authorized scan and current-version details, downloads and archives", async ({
                                                                                                                   page,
                                                                                                               }, testInfo) => {
    test.setTimeout(65_000);
    await login(page);
    await page.goto("/files");
    const name = `Material-${randomUUID().slice(0, 8)}.txt`;
    const text = "Fictional persistent teaching material.";
    await page
        .getByRole("button", {name: "Datei hochladen", exact: true})
        .click();
    const dialog = page.getByRole("dialog");
    await dialog
        .getByLabel("Datei auswählen", {exact: true})
        .setInputFiles({name, mimeType: "text/plain", buffer: Buffer.from(text)});
    await dialog
        .getByRole("button", {name: "Datei hochladen", exact: true})
        .click();
    await expect(dialog).not.toBeVisible({timeout: 45000});
    const row = page
        .getByRole("listitem")
        .filter({has: page.getByText(name, {exact: true})});
    await expect(row.getByText("Geprüft", {exact: true})).toBeVisible();
    // Both configured Chromium layouts exercise this real scanned upload and
    // the authorized exact-current-version read, without a mocked backend.
    await row
        .getByRole("button", {name: `Dateidetails: ${name}`, exact: true})
        .click();
    const details = page.getByRole("dialog", {name: "Dateidetails"});
    await expect(details.getByText(name, {exact: true})).toBeVisible();
    await expect(details.getByText("text/plain", {exact: true})).toBeVisible();
    await expect(
        details.locator("dt", {hasText: "Dateigröße"}).locator("+ dd"),
    ).toHaveText(`${Buffer.byteLength(text)} Byte`);
    await expect(
        details.locator("dt", {hasText: "Aktuelle Version"}).locator("+ dd"),
    ).toHaveText("1");
    await expect(
        details.locator("dt", {hasText: "Prüfstatus"}).locator("+ dd"),
    ).toHaveText("Geprüft");
    await details.getByRole("button", {name: "Schließen", exact: true}).click();
    const received = page.waitForEvent("download");
    await row
        .getByRole("button", {name: `Herunterladen: ${name}`, exact: true})
        .click();
    const download = await received;
    expect(download.suggestedFilename()).toBe(name);
    expect(await download.failure()).toBeNull();
    await row
        .getByRole("button", {name: `Versionen: ${name}`, exact: true})
        .click();
    await expect(page.getByRole("dialog").getByText(/Version 1/)).toBeVisible();
    await page.getByRole("button", {name: "Schließen", exact: true}).click();
    await row.getByLabel(`Dateiname: ${name}`, {exact: true}).click();
    await row.getByRole("button", {name: "Umbenennen", exact: true}).click();
    const renamed = `Kurs-${name}`;
    await page.getByLabel("Dateiname", {exact: true}).fill(renamed);
    await page
        .getByRole("dialog")
        .getByRole("button", {name: "Umbenennen", exact: true})
        .click();
    await expect(page.getByText(renamed, {exact: true})).toBeVisible();
    await page.goto("/search");
    // A selected mobile destination must close its menu before the new page is
    // used; an open overlay otherwise blocks the actual search-result click.
    await expect(page.locator("details.mobile-more")).toHaveJSProperty(
        "open",
        false,
    );
    // The navigation label opens the eleven-area search, whose own field and
    // page title are distinct. Exercise its real authorised result deep link.
    const search = page.getByRole("searchbox", {
        name: "Suchbegriff",
        exact: true,
    });
    await search.fill(renamed);
    await search.press("Enter");
    await expect(
        page.getByRole("heading", {name: "Universelle Suche", exact: true}),
    ).toBeVisible();
    const result = page.getByRole("link", {
        name: new RegExp(renamed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    });
    await expect(result).toBeVisible();
    await result.click();
    await expect(page).toHaveURL(
        (url) => url.pathname === "/files" && url.searchParams.get("q") === renamed,
    );
    const foundFile = page
        .getByRole("listitem")
        .filter({has: page.getByText(renamed, {exact: true})});
    await expect(foundFile.getByText(renamed, {exact: true})).toBeVisible();
    const renamedDownloadPromise = page.waitForEvent("download");
    await foundFile
        .getByRole("button", {name: `Herunterladen: ${renamed}`, exact: true})
        .click();
    const renamedDownload = await renamedDownloadPromise;
    expect(renamedDownload.suggestedFilename()).toBe(renamed);
    expect(await renamedDownload.failure()).toBeNull();
    expect(readFileSync((await renamedDownload.path())!, "utf8")).toBe(text);
    // Observe a real settled list beyond its former ten-second polling period.
    // Preference-only renders must neither reload the document nor refetch files.
    await page.waitForLoadState("networkidle");
    const idleReads: string[] = [];
    const navigations: string[] = [];
    /** Counts actual document-metadata requests to detect unnecessary polling, not merely timer activity. */
    const countReads = (request: Request) => {
        if (
            request.method() === "GET" &&
            new URL(request.url()).pathname === "/rest/v1/documents"
        )
            idleReads.push(request.url());
        if (request.isNavigationRequest() && request.frame() === page.mainFrame())
            navigations.push(request.url());
    };
    page.on("request", countReads);
    await page.getByLabel("Sprache", {exact: true}).selectOption("en");
    await page.getByLabel("Theme", {exact: true}).selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByText(renamed, {exact: true})).toBeVisible();
    await page.waitForTimeout(10_100);
    expect(idleReads).toEqual([]);
    expect(navigations).toEqual([]);
    page.off("request", countReads);
    await page.getByLabel("Language", {exact: true}).selectOption("de");
    await page.getByLabel("Farbschema", {exact: true}).selectOption("system");
    const scan = await new AxeBuilder({page})
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(
        scan.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.target),
        })),
    ).toEqual([]);
    await page.screenshot({
        path: `.local/screenshots/${testInfo.project.name}-files.png`,
        fullPage: true,
    });
    const renamedRow = page
        .getByRole("listitem")
        .filter({has: page.getByText(renamed, {exact: true})});
    await renamedRow.getByLabel(`Dateiname: ${renamed}`, {exact: true}).click();
    await renamedRow
        .getByRole("button", {name: "Archivieren", exact: true})
        .click();
    await page
        .getByRole("dialog")
        .getByRole("button", {name: "Archivieren", exact: true})
        .click();
    await expect(page.getByText(renamed, {exact: true})).toHaveCount(0);
    await page
        .getByRole("button", {
            name: "Archivierte eigene Materialien",
            exact: true,
        })
        .click();
    const archive = page.getByRole("dialog", {
        name: "Archivierte eigene Materialien",
    });
    await archive
        .getByRole("button", {name: `${renamed} wiederherstellen`, exact: true})
        .click();
    const confirmation = page.getByRole("dialog", {
        name: "Material wiederherstellen?",
    });
    await confirmation
        .getByRole("button", {name: `${renamed} wiederherstellen`, exact: true})
        .click();
    // The scan list refresh may show a loading status alongside the receipt.
    await expect(archive.getByRole("status").filter({
        hasText: /^Material wiederhergestellt\.$/,
    })).toBeVisible();
    await archive.getByRole("button", {name: "Schließen", exact: true}).click();
    await expect(page.getByText(renamed, {exact: true})).toBeVisible();
});
test("a clean private image preview loads authenticated bytes without caching a public URL", async ({
                                                                                                        page,
                                                                                                    }) => {
    await login(page);
    await page.goto("/files");
    const name = `Bild-${randomUUID().slice(0, 8)}.webp`;
    await page
        .getByRole("button", {name: "Datei hochladen", exact: true})
        .click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("Datei auswählen", {exact: true}).setInputFiles({
        name,
        mimeType: "image/webp",
        buffer: readFileSync("public/brand/luminovia-logo-mark-160.webp"),
    });
    await dialog
        .getByRole("button", {name: "Datei hochladen", exact: true})
        .click();
    await expect(dialog).not.toBeVisible({timeout: 45000});
    const row = page
        .getByRole("listitem")
        .filter({has: page.getByText(name, {exact: true})});
    await expect(row.getByText("Geprüft", {exact: true})).toBeVisible();
    await row
        .getByRole("button", {name: `Vorschau: ${name}`, exact: true})
        .click();
    const image = page
        .getByRole("dialog")
        .getByRole("img", {name, exact: true});
    await expect(image).toBeVisible();
    await expect
        .poll(() =>
            image.evaluate((element) => (element as HTMLImageElement).naturalWidth),
        )
        .toBeGreaterThan(0);
    await expect(image).toHaveAttribute("src", /^blob:/);
});
test("qualification evidence uses a real private scanned upload from the profile", async ({
                                                                                              page,
                                                                                          }) => {
    await login(page);
    await page.goto("/profile");
    const section = page.locator("section").filter({
        has: page.getByRole("heading", {
            name: "Qualifikationsnachweis",
            exact: true,
        }),
    });
    const name = `Nachweis-${randomUUID().slice(0, 8)}.txt`;
    await section.getByLabel("Datei auswählen", {exact: true}).setInputFiles({
        name,
        mimeType: "text/plain",
        buffer: Buffer.from(
            "Fictional qualification evidence for local tests only.",
        ),
    });
    await section
        .getByRole("button", {name: "Datei hochladen", exact: true})
        .click();
    const evidence = section.getByRole("listitem").filter({
        has: page.getByText(name, {exact: true}),
    });
    await expect(evidence.getByText("Geprüft", {exact: true})).toBeVisible({
        timeout: 45000,
    });
    await page.reload();
    await expect(evidence.getByText("Geprüft", {exact: true})).toBeVisible();
});
