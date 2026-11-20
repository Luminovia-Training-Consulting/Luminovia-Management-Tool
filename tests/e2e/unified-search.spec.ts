/** Actual desktop/mobile discovery and navigation with isolated fictional owners. */
import {expect, test} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {randomUUID} from "node:crypto";
import {actor, api, checked, login} from "./helpers/accounts-support";

test("universal search finds own wiki drafts, keeps foreign drafts private and opens the selected result in DE/EN", async ({
                                                                                                                               page,
                                                                                                                           }, testInfo) => {
    const owner = await actor("Fictional search owner", "lecturer"),
        peer = await actor("Fictional search peer", "lecturer"),
        service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!),
        clients = [
            api(process.env.SUPABASE_ANON_KEY!),
            api(process.env.SUPABASE_ANON_KEY!),
        ];
    const needle = `Search-${randomUUID()}`;
    const pages: string[] = [];
    try {
        for (const [index, user] of [owner, peer].entries()) {
            await checked(
                clients[index].auth.signInWithPassword({
                    email: user.email,
                    password: process.env.E2E_PASSWORD!,
                }),
            );
            const categories = await checked(
                clients[index].rpc("knowledge_categories", {p_kind: "wiki"}),
                {requireData: true},
            );
            const saved = await checked(
                clients[index].rpc("save_wiki_page", {
                    p_id: null,
                    p_title: `${needle} ${index ? "peer private" : "own draft"}`,
                    p_locale: "de",
                    p_category_id: categories[0].id,
                    p_content: {
                        type: "doc",
                        content: [
                            {
                                type: "paragraph",
                                content: [
                                    {
                                        type: "text",
                                        text: "Fictional authored private wiki draft",
                                    },
                                ],
                            },
                        ],
                    },
                    p_status: "draft",
                    p_expected_version: null,
                }),
                {requireData: true},
            );
            pages.push(saved.page_id);
        }
        await login(page, owner.email);
        await page.goto(`/search?q=${encodeURIComponent(needle)}&kind=wiki`);
        await expect(
            page.getByRole("heading", {name: "Universelle Suche", exact: true}),
        ).toBeVisible();
        const result = page.getByRole("link", {
            name: new RegExp(`${needle} own draft`),
        });
        await expect(result).toHaveAttribute("href", `/wiki?page=${pages[0]}`);
        await expect(
            page.getByText(`${needle} peer private`, {exact: true}),
        ).toHaveCount(0);
        const field = page.getByRole("searchbox", {
            name: "Suchbegriff",
            exact: true,
        });
        await field.fill("Unsaved authored search");
        await page.getByLabel("Sprache", {exact: true}).selectOption("en");
        await expect(
            page.getByRole("searchbox", {name: "Search term", exact: true}),
        ).toHaveValue("Unsaved authored search");
        await page.reload();
        await expect(
            page.getByRole("searchbox", {name: "Search term", exact: true}),
        ).toHaveValue(needle);
        expect(
            (
                await new AxeBuilder({page})
                    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
                    .analyze()
            ).violations,
        ).toEqual([]);
        expect(
            await page.evaluate(
                () => document.documentElement.scrollWidth <= innerWidth,
            ),
        ).toBe(true);
        await page.screenshot({
            path: testInfo.outputPath("universal-search.png"),
            fullPage: true,
        });
        await result.click();
        await expect(page).toHaveURL(new RegExp(`/wiki\\?page=${pages[0]}`));
        await expect(
            page.getByText(`${needle} own draft`, {exact: true}).first(),
        ).toBeVisible();
    } finally {
        for (const client of clients) await client.auth.signOut();
        if (pages.length)
            await checked(service.from("wiki_pages").delete().in("id", pages));
        await checked(
            service.from("notifications").delete().in("user_id", [owner.id, peer.id]),
        );
        await checked(
            service.from("audit_events").delete().in("actor_id", [owner.id, peer.id]),
        );
        for (const user of [owner, peer])
            await checked(service.auth.admin.deleteUser(user.id));
    }
});