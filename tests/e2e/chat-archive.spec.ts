/** Personal archive/restore against real isolated Auth and chat membership. */
import {expect, test} from "@playwright/test";
import {randomUUID} from "node:crypto";
import {actor, api, checked, login} from "./helpers/accounts-support";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Requires the isolated portal test environment.",
);
test("personal archive persists and leaves another member's conversation active", async ({
                                                                                             page,
                                                                                             browser,
                                                                                         }, info) => {
    test.setTimeout(90000);
    const a = await actor("Fictional archive owner", "lecturer"),
        b = await actor("Fictional archive peer", "lecturer"),
        outsider = await actor("Fictional archive outsider", "lecturer");
    const signIn = async (email: string) => {
        const client = api(process.env.SUPABASE_ANON_KEY!);
        await checked(
            client.auth.signInWithPassword({
                email,
                password: process.env.E2E_PASSWORD!,
            }),
        );
        return client;
    };
    const owner = await signIn(a.email),
        stranger = await signIn(outsider.email);
    const title = `Fictional archive ${randomUUID().slice(0, 8)}`;
    const room = await checked(
        owner.rpc("create_chat_group", {p_title: title, p_member_ids: [b.id]}),
        {requireData: true},
    );
    expect(
        (
            await stranger.rpc("set_chat_personal_archive", {
                p_room_id: room,
                p_archived: true,
            })
        ).error,
    ).toBeTruthy();
    const other = await browser.newContext({
        baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
        viewport: info.project.use.viewport,
        isMobile: info.project.use.isMobile,
        hasTouch: info.project.use.hasTouch,
    });
    try {
        await login(page, a.email);
        await page.goto("/chats");
        await page
            .getByRole("button", {
                name: `${title} persönlich archivieren`,
                exact: true,
            })
            .click();
        await expect(page.getByText(title, {exact: true})).toHaveCount(0);
        await page.reload();
        await page.getByRole("button", {name: "Archiviert", exact: true}).click();
        await expect(page.getByText(title, {exact: true})).toBeVisible();
        const peer = await other.newPage();
        await login(peer, b.email);
        await peer.goto("/chats");
        await expect(peer.getByText(title, {exact: true})).toBeVisible();
        await page
            .getByRole("button", {
                name: `${title} persönlich wiederherstellen`,
                exact: true,
            })
            .click();
        await expect(page.getByText(title, {exact: true})).toHaveCount(0);
        await page.getByRole("button", {name: "Aktiv", exact: true}).click();
        await expect(page.getByText(title, {exact: true})).toBeVisible();
    } finally {
        await other.close();
    }
});