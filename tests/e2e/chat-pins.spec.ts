/** Personal room pins on an owned disposable backend, in separate actor sessions. */
import {expect, type Page, test} from "@playwright/test";
import {createClient} from "@supabase/supabase-js";
import {randomUUID} from "node:crypto";

test.skip(
    process.env.PORTAL_TEST_MODE !== "1",
    "Requires the isolated portal test environment.",
);

function client(key: string) {
    const url = process.env.SUPABASE_URL!;
    if (
        !url ||
        !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)
    )
        throw new Error("Fictional chat fixtures require loopback.");
    return createClient(url, key, {
        auth: {persistSession: false, autoRefreshToken: false},
    });
}

async function actor() {
    const service = client(process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const email = `pin-${randomUUID()}@example.invalid`;
    const created = await service.auth.admin.createUser({
        email,
        password: process.env.E2E_PASSWORD!,
        email_confirm: true,
    });
    expect(created.error).toBeNull();
    const id = created.data.user!.id;
    expect(
        (await service.from("user_roles").insert({user_id: id, role: "lecturer"}))
            .error,
    ).toBeNull();
    const api = client(process.env.SUPABASE_ANON_KEY!);
    expect(
        (
            await api.auth.signInWithPassword({
                email,
                password: process.env.E2E_PASSWORD!,
            })
        ).error,
    ).toBeNull();
    return {id, email, api};
}

async function login(page: Page, email: string) {
    await page.goto("/login");
    await page.getByLabel("E-Mail", {exact: true}).fill(email);
    await page
        .getByLabel("Passwort", {exact: true})
        .fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", {name: "Anmelden", exact: true}).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/chats");
}

test("pins persist for the owner, remain personal, and deny a foreign actor", async ({
                                                                                         page,
                                                                                         browser,
                                                                                     }, info) => {
    test.setTimeout(90_000);
    const owner = await actor();
    const member = await actor();
    const stranger = await actor();
    const title = `Fictional pin ${randomUUID().slice(0, 8)}`;
    const created = await owner.api.rpc("create_chat_group", {
        p_title: title,
        p_member_ids: [member.id],
    });
    expect(created.error).toBeNull();
    const title2 = `Fictional pin ${randomUUID().slice(0, 8)}`;
    const created2 = await owner.api.rpc("create_chat_group", {
        p_title: title2,
        p_member_ids: [member.id],
    });
    expect(created2.error).toBeNull();
    expect(
        (
            await stranger.api.rpc("set_chat_pin", {
                p_room_id: created.data,
                p_pinned: true,
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
        await login(page, owner.email);
        await page
            .getByRole("button", {name: `${title} anheften`, exact: true})
            .click();
        await expect(
            page.getByRole("button", {name: `${title} lösen`, exact: true}),
        ).toHaveAttribute("aria-pressed", "true");
        await page
            .getByRole("button", {name: `${title2} anheften`, exact: true})
            .click();
        await expect(
            page.getByRole("button", {name: `${title2} lösen`, exact: true}),
        ).toBeVisible();
        await page
            .getByRole("button", {
                name: `${title2} nach oben verschieben`,
                exact: true,
            })
            .click();
        await expect(page.locator(".chat-room-list > li").first()).toContainText(
            title2,
        );
        await page.reload();
        await expect(
            page.getByRole("button", {name: `${title} lösen`, exact: true}),
        ).toBeVisible();
        await expect(page.locator(".chat-room-list > li").first()).toContainText(
            title2,
        );
        const second = await other.newPage();
        await login(second, member.email);
        await expect(
            second.getByRole("button", {name: `${title} anheften`, exact: true}),
        ).toHaveAttribute("aria-pressed", "false");
        await page
            .getByRole("button", {name: `${title} lösen`, exact: true})
            .click();
        await expect(
            page.getByRole("button", {name: `${title} anheften`, exact: true}),
        ).toBeVisible();
        await page.reload();
        await expect(
            page.getByRole("button", {name: `${title} anheften`, exact: true}),
        ).toBeVisible();
    } finally {
        await other.close();
    }
});