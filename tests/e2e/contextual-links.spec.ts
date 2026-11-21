/** Verify Chat/Help references reuse the guarded Forum route and denied deep links reveal no thread data. */
import {expect, test} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {actor, api, login} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Context navigation permission checks require the isolated ./portal test project.",
);

test("Chats and Knowledge & Help reach the same Forum and outsiders cannot open a thread deep link", async ({
                                                                                                                page,
                                                                                                                browser,
                                                                                                            }) => {
    const administrator = await actor("Fictional forum navigation admin", "admin"),
        outsider = await actor("Fictional forum outsider", "guest"),
        service = api(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const forumRequests: string[] = [];
    page.on("request", (request) => {
        if (request.url().includes("/rest/v1/rpc/forum_"))
            forumRequests.push(request.url().split("?")[0]);
    });
    const guestContext = await browser.newContext({
        baseURL: process.env.E2E_BASE_URL,
    });
    const guestPage = await guestContext.newPage();
    const guestForumRequests: string[] = [];
    guestPage.on("request", (request) => {
        if (request.url().includes("/rest/v1/rpc/forum_"))
            guestForumRequests.push(request.url().split("?")[0]);
    });
    try {
        await login(page, administrator.email);
        await page.goto("/chats");
        await page
            .getByRole("link", {name: "Forum öffnen", exact: true})
            .click();
        await expect(page).toHaveURL(/\/forum$/);
        await expect(
            page.getByRole("heading", {name: "Forum", exact: true}),
        ).toBeVisible();
        await page.goto("/wiki");
        await page.getByRole("button", {name: "Forum", exact: true}).click();
        await expect(page).toHaveURL(/\/wiki\?section=forum$/);
        await expect(
            page.getByRole("heading", {name: "Forum", exact: true}),
        ).toBeVisible();
        expect(forumRequests.every((url) => /\/rest\/v1\/rpc\/forum_/.test(url))).toBe(true);

        await login(guestPage, outsider.email, /\/profile$/);
        await guestPage.goto(`/forum?thread=${randomUUID()}`);
        // The account shell rejects the deep link before mounting the Forum.
        await expect(guestPage).toHaveURL(/\/profile$/);
        await expect(guestPage.getByRole("heading", {name: "Forum", exact: true})).toHaveCount(0);
        expect(guestForumRequests).toEqual([]);
    } finally {
        await guestContext.close();
        await service.auth.admin.deleteUser(administrator.id);
        await service.auth.admin.deleteUser(outsider.id);
    }
});
