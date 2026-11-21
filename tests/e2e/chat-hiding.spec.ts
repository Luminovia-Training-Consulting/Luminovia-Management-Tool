/** Personal message hiding on an owned disposable backend, in separate actor sessions. */
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
    await page.getByLabel("Benutzername oder E-Mail", {exact: true}).fill(email);
    await page
        .getByLabel("Passwort", {exact: true})
        .fill(process.env.E2E_PASSWORD!);
    await page.getByRole("button", {name: "Anmelden", exact: true}).click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/chats");
}

test("hiding a message is personal, reaches another live session and survives reconnect", async ({
                                                                                                     page,
                                                                                                     browser,
                                                                                                 }, info) => {
    test.setTimeout(100_000);
    const owner = await actor();
    const member = await actor();
    const stranger = await actor();
    const title = `Hide QA ${randomUUID().slice(0, 8)}`;
    const room = await owner.api.rpc("create_chat_group", {
        p_title: title,
        p_member_ids: [member.id],
    });
    expect(room.error).toBeNull();
    const body = `Fictional message ${randomUUID()}`;
    const sent = await owner.api.rpc("send_message", {
        p_room_id: room.data,
        p_body: body,
        p_client_id: randomUUID(),
    });
    expect(sent.error).toBeNull();
    expect(
        (await stranger.api.rpc("hide_chat_message", {p_message_id: sent.data}))
            .error,
    ).toBeTruthy();
    const options = {
        baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:5173",
        viewport: info.project.use.viewport,
        isMobile: info.project.use.isMobile,
        hasTouch: info.project.use.hasTouch,
    };
    const other = await browser.newContext(options);
    const peer = await browser.newContext(options);
    try {
        await login(page, owner.email);
        const sameActor = await other.newPage();
        await login(sameActor, owner.email);
        const memberPage = await peer.newPage();
        await login(memberPage, member.email);
        for (const current of [page, sameActor, memberPage]) {
            await current.goto(`/chats?room=${room.data}`);
            await expect(current.getByText(body, {exact: true})).toBeVisible();
            await expect(current.locator("[data-realtime-status]")).toHaveAttribute(
                "data-realtime-status",
                "connected",
                {timeout: 20_000},
            );
        }
        const row = page.locator(".chat-message").filter({hasText: body});
        await row
            .getByRole("button", {name: "Für mich ausblenden", exact: true})
            .click();
        await page
            .getByRole("dialog")
            .getByRole("button", {name: "Für mich ausblenden", exact: true})
            .click();
        await expect(page.getByText(body, {exact: true})).toHaveCount(0);
        await expect(sameActor.getByText(body, {exact: true})).toHaveCount(0, {
            timeout: 20_000,
        });
        await expect(memberPage.getByText(body, {exact: true})).toBeVisible();
        await sameActor.reload();
        await expect(sameActor.getByText(body, {exact: true})).toHaveCount(0);
        await memberPage.reload();
        await expect(memberPage.getByText(body, {exact: true})).toBeVisible();
    } finally {
        await other.close();
        await peer.close();
    }
});