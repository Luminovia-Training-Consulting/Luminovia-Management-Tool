/**
 * Browser workflows for shared topic hierarchies and lecturer access limited to discovery.
 * Rendered workflows are checked in isolation; this does not replace manual device/platform acceptance.
 */
import {expect, type Page, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {actor, adminLogin, api, checked, login,} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Taxonomy mutations belong to the disposable canonical stack.",
);

/** Checks the rendered state with axe; keyboard interaction and data flows retain separate assertions. */
async function accessibility(page: Page) {
    await page.evaluate(() => document.fonts.ready);
    const result = await new AxeBuilder({page})
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
    expect(
        result.violations.map(({id, nodes}) => ({
            id,
            targets: nodes.map((node) => node.target),
        })),
    ).toEqual([]);
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
        ),
    ).toBe(true);
}

test("management edits a real shared hierarchy while lecturers only discover permitted topics", async ({
                                                                                                           page,
                                                                                                           browser,
                                                                                                           context,
                                                                                                       }, testInfo) => {
    test.setTimeout(120000);
    const administrator = await actor(
            "Fictional taxonomy administrator",
            "admin",
        ),
        lecturer = await actor("Fictional taxonomy lecturer", "lecturer");
    const service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
        suffix = randomUUID().slice(0, 8),
        root = `Fiktive Werkzeuge ${suffix}`,
        child = `Fiktiver Editor ${suffix}`,
        childEn = `Fictional editor ${suffix}`,
        alias = `EditorAlias-${suffix}`;
    let readerContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
    try {
        await adminLogin(page, administrator);
        await page.goto("/topics");
        await expect(
            page.getByRole("heading", {
                name: "Themen, Tools & Programmiersprachen",
                exact: true,
            }),
        ).toBeVisible();
        await page
            .getByRole("button", {name: "Eintrag erstellen", exact: true})
            .click();
        await page.getByLabel("Bezeichnung (Deutsch)", {exact: true}).fill(root);
        await page
            .getByLabel("Bezeichnung (Englisch)", {exact: true})
            .fill(`Fictional tools ${suffix}`);
        await page.getByRole("button", {name: "Speichern", exact: true}).click();
        await expect(
            page.getByRole("heading", {name: root, exact: true}),
        ).toBeVisible();
        await page
            .getByRole("button", {name: "Eintrag erstellen", exact: true})
            .click();
        await page.getByLabel("Bezeichnung (Deutsch)", {exact: true}).fill(child);
        await page
            .getByLabel("Bezeichnung (Englisch)", {exact: true})
            .fill(childEn);
        await page
            .getByRole("dialog")
            .getByLabel("Art", {exact: true})
            .selectOption("tool");
        await page
            .getByLabel("Übergeordneter Eintrag", {exact: true})
            .selectOption({label: root});
        await page
            .getByLabel("Aliasse (mit Komma trennen)", {exact: true})
            .fill(alias);
        await page.getByRole("button", {name: "Speichern", exact: true}).click();
        await expect(
            page.getByRole("heading", {name: child, exact: true}),
        ).toBeVisible();
        await page.getByLabel("Katalog durchsuchen", {exact: true}).fill(alias);
        const card = page
            .getByRole("article")
            .filter({has: page.getByRole("heading", {name: child, exact: true})});
        await expect(card).toBeVisible();
        await expect(card).toContainText(root);
        await card.getByRole("button", {name: "Bearbeiten", exact: true}).click();
        const draft = "Fiktive Beschreibung <script>bleibt Text</script>";
        await page
            .getByLabel("Beschreibung (Deutsch)", {exact: true})
            .fill(draft);
        await page.getByLabel("Sprache", {exact: true}).selectOption("en");
        await expect(
            page.getByLabel("Description (German)", {exact: true}),
        ).toHaveValue(draft);
        await page
            .getByLabel("Description (English)", {exact: true})
            .fill("Fictional tool for the shared course catalogue.");
        await page.getByRole("button", {name: "Save", exact: true}).click();
        await expect(page.getByRole("dialog")).not.toBeVisible();
        await page.getByLabel("Theme", {exact: true}).selectOption("dark");
        await expect(
            page.getByLabel("Search catalogue", {exact: true}),
        ).toHaveValue(alias);
        await accessibility(page);
        await page.screenshot({
            path: `.local/screenshots/${testInfo.project.name}-taxonomy.png`,
            fullPage: true,
        });
        const englishCard = page.getByRole("article").filter({
            has: page.getByRole("heading", {name: childEn, exact: true}),
        });
        await englishCard
            .getByRole("button", {name: "Archive", exact: true})
            .click();
        await page
            .getByRole("dialog")
            .getByRole("button", {name: "Archive", exact: true})
            .click();
        await expect(
            page.getByText("No matching catalogue entries.", {exact: true}),
        ).toBeVisible();
        await page.getByLabel("Include archived entries", {exact: true}).check();
        await expect(
            englishCard.getByText("Archived", {exact: true}),
        ).toBeVisible();
        await englishCard
            .getByRole("button", {name: "Restore", exact: true})
            .click();
        await page
            .getByRole("dialog")
            .getByRole("button", {name: "Restore", exact: true})
            .click();
        await expect(
            englishCard.getByRole("button", {name: "Edit", exact: true}),
        ).toBeVisible();
        await context.setOffline(true);
        await expect(
            page.getByRole("button", {name: "Create entry", exact: true}),
        ).toBeDisabled();
        await context.setOffline(false);
        readerContext = await browser.newContext();
        const reader = await readerContext.newPage();
        await login(reader, lecturer.email);
        await reader.goto("/topics");
        await reader.getByLabel("Katalog durchsuchen", {exact: true}).fill(alias);
        await expect(
            reader.getByRole("heading", {name: child, exact: true}),
        ).toBeVisible();
        await expect(
            reader.getByRole("button", {name: "Bearbeiten", exact: true}),
        ).toHaveCount(0);
        await expect(
            reader.getByRole("button", {name: "Eintrag erstellen", exact: true}),
        ).toHaveCount(0);
        await accessibility(reader);
    } finally {
        await context.setOffline(false);
        await readerContext?.close();
        const own = await checked(
            service.from("topics").select("id").in("label_de", [root, child]),
        );
        if (own?.length)
            await checked(
                service
                    .from("topics")
                    .delete()
                    .in(
                        "id",
                        own.map((topic) => topic.id),
                    ),
            );
        await checked(
            service
                .from("audit_events")
                .delete()
                .in("actor_id", [administrator.id, lecturer.id]),
        );
        for (const user of [administrator, lecturer])
            await checked(service.auth.admin.deleteUser(user.id));
    }
});